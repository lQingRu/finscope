import type { TransactionInput } from "@finscope/contracts/transactions";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { date, numeric, pgSchema, text, uuid, varchar } from "drizzle-orm/pg-core";
import type { TransactionWriteResult } from "../transactions/routes.ts";
import { transactions } from "../transactions/table.ts";
import type { FinancialAccountRepository } from "./routes.ts";
import { summarizeFinancialAccounts } from "./summary.ts";

async function lockOwnerActivity(write: Pick<NodePgDatabase, "execute">, ownerUserId: string) {
  // Coordinate date checks and deletion across all API processes for this workspace.
  await write.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ownerUserId}::text, 20261122))`);
}

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Error && (
    ("code" in error && error.code === "23503") || isForeignKeyViolation(error.cause)
  );
}

const accounts = pgSchema("finscope_private").table("financial_accounts", {
  id: uuid().defaultRandom().primaryKey(),
  ownerUserId: uuid("owner_user_id").notNull(),
  name: varchar({ length: 100 }).notNull(),
  type: text({ enum: ["bank", "brokerage"] }).notNull(),
  openingDate: date("opening_date").notNull(),
  openingBalance: numeric("opening_balance", { precision: 14, scale: 2 }).notNull(),
});

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

export function createFinancialAccountRepository(db: NodePgDatabase): FinancialAccountRepository {
  async function saveTransaction(ownerUserId: string, input: TransactionInput, transactionId?: string): Promise<TransactionWriteResult> {
    return db.transaction(async (write) => {
      await lockOwnerActivity(write, ownerUserId);
      const transactionScope = transactionId && and(eq(transactions.ownerUserId, ownerUserId), eq(transactions.id, transactionId));
      if (transactionScope) {
        const [existing] = await write.select({ id: transactions.id }).from(transactions).where(transactionScope);
        if (!existing) return { status: "not_found" };
      }
      const [account] = await write.select({ openingDate: accounts.openingDate }).from(accounts)
        .where(and(eq(accounts.ownerUserId, ownerUserId), eq(accounts.id, input.accountId)));
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
      const rows = await db.select({
        ...publicColumns,
        earliestActivityDate: sql<string | null>`min(${transactions.date})::text`,
        net: sql<string>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amount} else -${transactions.amount} end), 0)`,
        income: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'income' and ${duringPeriod}), 0)`,
        expenses: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'expense' and ${duringPeriod}), 0)`,
      }).from(accounts).leftJoin(transactions, and(
        eq(transactions.ownerUserId, accounts.ownerUserId), eq(transactions.accountId, accounts.id),
      )).where(eq(accounts.ownerUserId, ownerUserId))
        .groupBy(accounts.id)
        .orderBy(asc(accounts.openingDate), asc(accounts.name), asc(accounts.id));
      return summarizeFinancialAccounts(rows.map((row) => ({ ...row, currency: "SGD" })), period);
    },
    async listTransactions(ownerUserId, accountId, filters) {
      return db.transaction(async (snapshot) => {
        const [account] = await snapshot.select({ id: accounts.id }).from(accounts)
          .where(and(eq(accounts.ownerUserId, ownerUserId), eq(accounts.id, accountId)));
        if (!account) return undefined;
        return snapshot.select(transactionColumns).from(transactions)
          .where(and(
            eq(transactions.ownerUserId, ownerUserId), eq(transactions.accountId, accountId),
            filters.type ? eq(transactions.type, filters.type) : undefined,
            filters.category ? eq(transactions.category, filters.category) : undefined,
            filters.from ? gte(transactions.date, filters.from) : undefined,
            filters.to ? lte(transactions.date, filters.to) : undefined,
          ))
          .orderBy(desc(transactions.date), desc(transactions.createdAt), desc(transactions.id));
      }, { isolationLevel: "repeatable read", accessMode: "read only" });
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
        if (activity && openingDate > activity.date) {
          return { status: "after_activity", activityDate: activity.date };
        }

        const [row] = await write.update(accounts).set({ name, openingDate, openingBalance })
          .where(and(eq(accounts.ownerUserId, ownerUserId), eq(accounts.id, accountId)))
          .returning(publicColumns);
        return row ? { status: "saved", account: { ...row, currency: "SGD" } } : { status: "not_found" };
      }, { isolationLevel: "read committed" });
    },
  };
}
