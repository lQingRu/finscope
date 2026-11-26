import type { AccountHistory, TransactionHistoryQuery, TransactionInput } from "@finscope/contracts/transactions";
import type { TransferHistoryEntry } from "@finscope/contracts/transfers";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { retainDeletedActivity } from "../audit/activity-deletions.ts";
import { readSavedTradeFunding } from "../account-activity/cash.repository.ts";
import { withOwnerActivityWrite } from "../account-activity/activity-lock.ts";
import { accounts } from "../financial-accounts/table.ts";
import { linkedTransfers, transferColumns, transfers } from "../transfers/table.ts";
import { transactions } from "./table.ts";

const transactionColumns = {
  id: transactions.id,
  accountId: transactions.accountId,
  type: transactions.type,
  amount: transactions.amount,
  date: transactions.date,
  category: transactions.category,
  description: transactions.description,
};

type WriteDatabase = Pick<NodePgDatabase, "select" | "insert" | "update" | "delete" | "execute">;

function transactionWrites(write: WriteDatabase, ownerUserId: string) {
  const transactionScope = (id: string) => and(eq(transactions.ownerUserId, ownerUserId), eq(transactions.id, id));

  return {
    async findTransactionAccountId(id: string): Promise<string | undefined> {
      const [row] = await write.select({ accountId: transactions.accountId })
        .from(transactions).where(transactionScope(id));
      return row?.accountId;
    },
    async lockAccountOpeningDate(accountId: string): Promise<string | undefined> {
      // An older API can still update this account without taking the workspace advisory lock.
      const [account] = await write.select({ openingDate: accounts.openingDate }).from(accounts)
        .where(and(eq(accounts.ownerUserId, ownerUserId), eq(accounts.id, accountId))).for("share");
      return account?.openingDate;
    },
    async save(input: TransactionInput, id?: string) {
      const values = { ...input, ownerUserId, description: input.description || null };
      const [transaction] = id
        ? await write.update(transactions).set(values).where(transactionScope(id)).returning(transactionColumns)
        : await write.insert(transactions).values(values).returning(transactionColumns);
      return transaction;
    },
    async remove(id: string): Promise<typeof transactions.$inferSelect | undefined> {
      const [removed] = await write.delete(transactions).where(transactionScope(id)).returning();
      return removed;
    },
    readTradeFunding: (accountId: string) => readSavedTradeFunding(write, ownerUserId, accountId),
    retainDeletion: (record: typeof transactions.$inferSelect) => retainDeletedActivity(write, "transaction", record),
  };
}

export type TransactionWrites = ReturnType<typeof transactionWrites>;

export function createTransactionRepository(db: NodePgDatabase) {
  return {
    withWrite<T>(ownerUserId: string, run: (write: TransactionWrites) => Promise<T>) {
      return withOwnerActivityWrite(db, ownerUserId, (write) => run(transactionWrites(write, ownerUserId)));
    },
    async listTransactions(ownerUserId: string, accountId: string, filters: TransactionHistoryQuery): Promise<AccountHistory | undefined> {
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
  };
}

export type TransactionRepository = ReturnType<typeof createTransactionRepository>;
