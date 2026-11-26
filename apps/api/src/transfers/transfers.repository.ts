import type { Transfer, TransferInput } from "@finscope/contracts/transfers";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { retainDeletedActivity } from "../audit/activity-deletions.ts";
import { readSavedTradeFunding } from "../account-activity/cash.repository.ts";
import { withOwnerActivityWrite } from "../account-activity/activity-lock.ts";
import { accounts } from "../financial-accounts/table.ts";
import { transferColumns, transfers } from "./table.ts";

type WriteDatabase = Pick<NodePgDatabase, "select" | "insert" | "update" | "delete" | "execute">;

function transferWrites(write: WriteDatabase, ownerUserId: string) {
  const transferScope = (id: string) => and(eq(transfers.ownerUserId, ownerUserId), eq(transfers.id, id));

  return {
    async find(id: string): Promise<Transfer | undefined> {
      const [transfer] = await write.select(transferColumns).from(transfers).where(transferScope(id));
      return transfer;
    },
    async lockAccountOpeningDates(sourceAccountId: string, destinationAccountId: string) {
      // Lock both account rows in the same order against opening-date updates from older API versions.
      return write.select({ id: accounts.id, openingDate: accounts.openingDate }).from(accounts)
        .where(and(eq(accounts.ownerUserId, ownerUserId), inArray(accounts.id, [sourceAccountId, destinationAccountId])))
        .orderBy(asc(accounts.id)).for("share");
    },
    async save(input: TransferInput, id?: string): Promise<Transfer> {
      const values = { ...input, ownerUserId };
      const [transfer] = id
        ? await write.update(transfers).set(values).where(transferScope(id)).returning(transferColumns)
        : await write.insert(transfers).values(values).returning(transferColumns);
      return transfer;
    },
    async remove(id: string): Promise<typeof transfers.$inferSelect | undefined> {
      const [removed] = await write.delete(transfers).where(transferScope(id)).returning();
      return removed;
    },
    readTradeFunding: (accountId: string) => readSavedTradeFunding(write, ownerUserId, accountId),
    retainDeletion: (record: typeof transfers.$inferSelect) => retainDeletedActivity(write, "transfer", record),
  };
}

export type TransferWrites = ReturnType<typeof transferWrites>;

export function createTransferRepository(db: NodePgDatabase) {
  return {
    withWrite<T>(ownerUserId: string, run: (write: TransferWrites) => Promise<T>) {
      return withOwnerActivityWrite(db, ownerUserId, (write) => run(transferWrites(write, ownerUserId)));
    },
  };
}

export type TransferRepository = ReturnType<typeof createTransferRepository>;
