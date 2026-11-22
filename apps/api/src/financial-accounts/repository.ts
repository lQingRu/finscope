import type { AccountHistory, TransactionInput } from "@finscope/contracts/transactions";
import type { TransferHistoryEntry } from "@finscope/contracts/transfers";
import { and, asc, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { retainDeletedActivity } from "../audit/activity-deletions.ts";
import type { TransactionWriteResult } from "../transactions/routes.ts";
import { transactions } from "../transactions/table.ts";
import { transferColumns, transfers } from "../transfers/table.ts";
import { lockOwnerActivity } from "./activity-lock.ts";
import type { FinancialAccountRepository } from "./routes.ts";
import { summarizeFinancialAccounts } from "./summary.ts";
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

const transactionColumns = {
  id: transactions.id,
  accountId: transactions.accountId,
  type: transactions.type,
  amount: transactions.amount,
  date: transactions.date,
  category: transactions.category,
  description: transactions.description,
};

function linkedTransfers(ownerUserId: string | typeof accounts.ownerUserId, accountId: string | typeof accounts.id) {
  return and(
    eq(transfers.ownerUserId, ownerUserId),
    or(eq(transfers.sourceAccountId, accountId), eq(transfers.destinationAccountId, accountId)),
  );
}

export function createFinancialAccountRepository(db: NodePgDatabase): FinancialAccountRepository {
  async function saveTransaction(ownerUserId: string, input: TransactionInput, transactionId?: string): Promise<TransactionWriteResult> {
    return db.transaction(async (write) => {
      await lockOwnerActivity(write, ownerUserId);
      const transactionScope = transactionId && and(eq(transactions.ownerUserId, ownerUserId), eq(transactions.id, transactionId));
      if (transactionScope) {
        const [existing] = await write.select({ id: transactions.id }).from(transactions).where(transactionScope);
        if (!existing) return { status: "not_found" };
      }
      // An older API can still update this account without taking the workspace advisory lock.
      const [account] = await write.select({ openingDate: accounts.openingDate }).from(accounts)
        .where(and(eq(accounts.ownerUserId, ownerUserId), eq(accounts.id, input.accountId))).for("share");
      if (!account) return { status: "missing_account" };
      if (input.date < account.openingDate) return { status: "before_opening", openingDate: account.openingDate };

      const values = { ...input, ownerUserId, description: input.description || null };
      const [transaction] = transactionScope
        ? await write.update(transactions).set(values).where(transactionScope).returning(transactionColumns)
        : await write.insert(transactions).values(values).returning(transactionColumns);
      return { status: "saved", transaction };
    }, { isolationLevel: "read committed" });
  }

  return {
    async list(ownerUserId, period) {
      const duringPeriod = sql`${transactions.date} between ${period.from} and ${period.to}`;
      // Keep the outer account ID qualified in the lateral subquery's select list.
      const transferActivity = db.select({
        earliestDate: sql<string | null>`min(${transfers.date})`.as("earliest_date"),
        net: sql<string>`coalesce(sum(case when ${transfers.destinationAccountId} = "financial_accounts"."id"
          then ${transfers.amount} else -${transfers.amount} end), 0)`.as("net"),
      }).from(transfers).where(linkedTransfers(accounts.ownerUserId, accounts.id)).as("transfer_activity");
      const rows = await db.select({
        ...publicColumns,
        earliestActivityDate: sql<string | null>`least(min(${transactions.date}), ${transferActivity.earliestDate})::text`,
        net: sql<string>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amount} else -${transactions.amount} end), 0) + ${transferActivity.net}`,
        income: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'income' and ${duringPeriod}), 0)`,
        expenses: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'expense' and ${duringPeriod}), 0)`,
      }).from(accounts).leftJoin(transactions, and(
        eq(transactions.ownerUserId, accounts.ownerUserId), eq(transactions.accountId, accounts.id),
      )).leftJoinLateral(transferActivity, sql`true`).where(eq(accounts.ownerUserId, ownerUserId))
        .groupBy(accounts.id, transferActivity.earliestDate, transferActivity.net)
        .orderBy(asc(accounts.openingDate), asc(accounts.name), asc(accounts.id));
      return summarizeFinancialAccounts(rows.map((row) => ({ ...row, currency: "SGD" })), period);
    },
    async listTransactions(ownerUserId, accountId, filters): Promise<AccountHistory | undefined> {
      return db.transaction(async (snapshot) => {
        const [account] = await snapshot.select({ id: accounts.id }).from(accounts)
          .where(and(eq(accounts.ownerUserId, ownerUserId), eq(accounts.id, accountId)));
        if (!account) return undefined;
        const everyday = await snapshot.select(transactionColumns).from(transactions)
          .where(and(
            eq(transactions.ownerUserId, ownerUserId), eq(transactions.accountId, accountId),
            filters.type ? eq(transactions.type, filters.type) : undefined,
            filters.category ? eq(transactions.category, filters.category) : undefined,
            filters.from ? gte(transactions.date, filters.from) : undefined,
            filters.to ? lte(transactions.date, filters.to) : undefined,
          ))
          .orderBy(desc(transactions.date), desc(transactions.createdAt), desc(transactions.id));
        if (!filters.includeTransfers) return { transactions: everyday };
        if (filters.type || filters.category) return { transactions: everyday, transfers: [] };

        const accountTransfers = await snapshot.select({
          ...transferColumns,
          direction: sql<TransferHistoryEntry["direction"]>`case when ${transfers.sourceAccountId} = ${accountId}::uuid
            then 'outgoing' else 'incoming' end`,
        }).from(transfers).where(and(
          linkedTransfers(ownerUserId, accountId),
          filters.from ? gte(transfers.date, filters.from) : undefined,
          filters.to ? lte(transfers.date, filters.to) : undefined,
        )).orderBy(desc(transfers.date), desc(transfers.createdAt), desc(transfers.id));
        return { transactions: everyday, transfers: accountTransfers };
      }, { isolationLevel: "repeatable read", accessMode: "read only" });
    },
    async deleteTransaction(ownerUserId, transactionId) {
      return db.transaction(async (write) => {
        await lockOwnerActivity(write, ownerUserId);
        const [removed] = await write.delete(transactions)
          .where(and(eq(transactions.ownerUserId, ownerUserId), eq(transactions.id, transactionId))).returning();
        if (!removed) return "not_found";

        await retainDeletedActivity(write, "transaction", removed);
        return "deleted";
      }, { isolationLevel: "read committed" });
    },
    recordTransaction: (ownerUserId, input) => saveTransaction(ownerUserId, input),
    correctTransaction: (ownerUserId, transactionId, input) => saveTransaction(ownerUserId, input, transactionId),
    async open(ownerUserId, { name, type, openingDate, openingBalance }) {
      const [row] = await db.insert(accounts).values({
        ownerUserId, name, type, openingDate, openingBalance,
      }).returning(publicColumns);
      return { ...row, currency: "SGD" };
    },
    async delete(ownerUserId, accountId) {
      try {
        return await db.transaction(async (write) => {
          await lockOwnerActivity(write, ownerUserId);
          const [removed] = await write.delete(accounts)
            .where(and(eq(accounts.ownerUserId, ownerUserId), eq(accounts.id, accountId)))
            .returning({ id: accounts.id });
          return removed ? "deleted" : "not_found";
        }, { isolationLevel: "read committed" });
      } catch (error) {
        if (isForeignKeyViolation(error)) return "linked_activity";
        throw error;
      }
    },
    async correct(ownerUserId, accountId, { name, openingDate, openingBalance }) {
      return db.transaction(async (write) => {
        await lockOwnerActivity(write, ownerUserId);
        const [activity] = await write.select({ date: transactions.date }).from(transactions)
          .where(and(eq(transactions.ownerUserId, ownerUserId), eq(transactions.accountId, accountId)))
          .orderBy(asc(transactions.date)).limit(1);
        const [transfer] = await write.select({ date: transfers.date }).from(transfers)
          .where(linkedTransfers(ownerUserId, accountId)).orderBy(asc(transfers.date)).limit(1);
        const [earliestActivityDate] = [activity?.date, transfer?.date].filter((date) => date !== undefined).sort();
        if (earliestActivityDate && openingDate > earliestActivityDate) {
          return { status: "after_activity", activityDate: earliestActivityDate };
        }

        const [row] = await write.update(accounts).set({ name, openingDate, openingBalance })
          .where(and(eq(accounts.ownerUserId, ownerUserId), eq(accounts.id, accountId)))
          .returning(publicColumns);
        return row ? { status: "saved", account: { ...row, currency: "SGD" } } : { status: "not_found" };
      }, { isolationLevel: "read committed" });
    },
  };
}
