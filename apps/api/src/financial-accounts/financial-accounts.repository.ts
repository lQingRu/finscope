import type {
  CorrectFinancialAccount,
  FinancialAccount,
  OpenFinancialAccount,
  ReportingPeriod,
} from "@finscope/contracts/financial-accounts";
import { and, asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { readSavedTradeFunding, transactionCashMovement, transferCashMovement } from "../account-activity/cash.repository.ts";
import { etfTrades } from "../etf-trades/table.ts";
import { transactions } from "../transactions/table.ts";
import { linkedTransfers, transfers } from "../transfers/table.ts";
import { withOwnerActivityWrite } from "../account-activity/activity-lock.ts";
import { accounts } from "./table.ts";

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Error && (
    ("code" in error && error.code === "23503") || isForeignKeyViolation(error.cause)
  );
}

const publicColumns = {
  id: accounts.id,
  name: accounts.name,
  type: accounts.type,
  openingDate: accounts.openingDate,
  openingBalance: accounts.openingBalance,
};

function accountCorrectionWrites(write: Pick<NodePgDatabase, "select" | "update" | "execute">, ownerUserId: string, accountId: string) {
  return {
    async findEarliestActivityDate(): Promise<string | undefined> {
      const [activity] = await write.select({ date: transactions.date }).from(transactions)
        .where(and(eq(transactions.ownerUserId, ownerUserId), eq(transactions.accountId, accountId)))
        .orderBy(asc(transactions.date)).limit(1);
      const [transfer] = await write.select({ date: transfers.date }).from(transfers)
        .where(linkedTransfers(ownerUserId, accountId)).orderBy(asc(transfers.date)).limit(1);
      const [trade] = await write.select({ date: etfTrades.date }).from(etfTrades)
        .where(and(eq(etfTrades.ownerUserId, ownerUserId), eq(etfTrades.accountId, accountId)))
        .orderBy(asc(etfTrades.date)).limit(1);
      const dates = [activity?.date, transfer?.date, trade?.date].filter((date) => date !== undefined);
      return dates.sort()[0];
    },
    async update({ name, openingDate, openingBalance }: CorrectFinancialAccount): Promise<FinancialAccount | undefined> {
      const [row] = await write.update(accounts).set({ name, openingDate, openingBalance })
        .where(and(eq(accounts.ownerUserId, ownerUserId), eq(accounts.id, accountId)))
        .returning(publicColumns);
      return row ? { ...row, currency: "SGD" } : undefined;
    },
    readTradeFunding: () => readSavedTradeFunding(write, ownerUserId, accountId),
  };
}

export type AccountCorrectionWrites = ReturnType<typeof accountCorrectionWrites>;

export function createFinancialAccountRepository(db: NodePgDatabase) {
  return {
    async listActivity(ownerUserId: string, period: ReportingPeriod) {
      const duringPeriod = sql`${transactions.date} between ${period.from} and ${period.to}`;
      // Keep the outer account ID qualified in the lateral subquery's select list.
      const transferActivity = db.select({
        earliestDate: sql<string | null>`min(${transfers.date})`.as("earliest_date"),
        net: sql<string>`coalesce(sum(${transferCashMovement(sql`"financial_accounts"."id"`)}), 0)`.as("net"),
      }).from(transfers).where(linkedTransfers(accounts.ownerUserId, accounts.id)).as("transfer_activity");
      const tradeActivity = db.select({
        earliestDate: sql<string | null>`min(${etfTrades.date})`.as("earliest_trade_date"),
        net: sql<string>`coalesce(sum(${etfTrades.cashMovement}), 0)`.as("trade_net"),
      }).from(etfTrades).where(and(
        eq(etfTrades.ownerUserId, accounts.ownerUserId), eq(etfTrades.accountId, accounts.id),
      )).as("trade_activity");
      return db.select({
        ...publicColumns,
        earliestActivityDate: sql<string | null>`least(min(${transactions.date}), ${transferActivity.earliestDate}, ${tradeActivity.earliestDate})::text`,
        net: sql<string>`coalesce(sum(${transactionCashMovement}), 0) + ${transferActivity.net} + ${tradeActivity.net}`,
        income: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'income' and ${duringPeriod}), 0)`,
        expenses: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'expense' and ${duringPeriod}), 0)`,
      }).from(accounts).leftJoin(transactions, and(
        eq(transactions.ownerUserId, accounts.ownerUserId), eq(transactions.accountId, accounts.id),
      )).leftJoinLateral(transferActivity, sql`true`).leftJoinLateral(tradeActivity, sql`true`).where(eq(accounts.ownerUserId, ownerUserId))
        .groupBy(accounts.id, transferActivity.earliestDate, transferActivity.net, tradeActivity.earliestDate, tradeActivity.net)
        .orderBy(asc(accounts.openingDate), asc(accounts.name), asc(accounts.id));
    },
    async open(ownerUserId: string, { name, type, openingDate, openingBalance }: OpenFinancialAccount): Promise<FinancialAccount> {
      const [row] = await db.insert(accounts).values({
        ownerUserId, name, type, openingDate, openingBalance,
      }).returning(publicColumns);
      return { ...row, currency: "SGD" };
    },
    async delete(ownerUserId: string, accountId: string): Promise<"deleted" | "not_found" | "linked_activity"> {
      try {
        return await withOwnerActivityWrite(db, ownerUserId, async (write) => {
          const [removed] = await write.delete(accounts)
            .where(and(eq(accounts.ownerUserId, ownerUserId), eq(accounts.id, accountId)))
            .returning({ id: accounts.id });
          return removed ? "deleted" : "not_found";
        });
      } catch (error) {
        if (isForeignKeyViolation(error)) return "linked_activity";
        throw error;
      }
    },
    withCorrection<T>(ownerUserId: string, accountId: string, run: (write: AccountCorrectionWrites) => Promise<T>) {
      return withOwnerActivityWrite(db, ownerUserId, (write) => run(accountCorrectionWrites(write, ownerUserId, accountId)));
    },
  };
}

export type FinancialAccountRepository = ReturnType<typeof createFinancialAccountRepository>;
