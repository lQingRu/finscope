import { minimumTransferDate } from "@finscope/contracts/transfers";
import type { TransferInput } from "@finscope/contracts/transfers";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { retainDeletedActivity } from "../audit/activity-deletions.ts";
import { assertSavedBuysFunded } from "../etf-trades/cash.ts";
import { lockOwnerActivity } from "../financial-accounts/activity-lock.ts";
import { accounts } from "../financial-accounts/table.ts";
import type { TransferRepository, TransferWriteResult } from "./routes.ts";
import { transferColumns, transfers } from "./table.ts";

export function createTransferRepository(db: NodePgDatabase): TransferRepository {
  async function saveTransfer(ownerUserId: string, input: TransferInput, transferId?: string): Promise<TransferWriteResult> {
    return db.transaction(async (write) => {
      await lockOwnerActivity(write, ownerUserId);
      const transferScope = transferId && and(eq(transfers.ownerUserId, ownerUserId), eq(transfers.id, transferId));
      const [existing] = transferScope ? await write.select(transferColumns).from(transfers).where(transferScope) : [];
      if (transferScope && !existing) return { status: "not_found" };

      // Lock both account rows against opening-date updates from older API versions.
      const selected = await write.select({ id: accounts.id, openingDate: accounts.openingDate }).from(accounts)
        .where(and(eq(accounts.ownerUserId, ownerUserId), inArray(accounts.id, [
          input.sourceAccountId, input.destinationAccountId,
        ]))).orderBy(asc(accounts.id)).for("share");
      const source = selected.find(({ id }) => id === input.sourceAccountId);
      if (!source) return { status: "missing_account", field: "sourceAccountId" };
      const destination = selected.find(({ id }) => id === input.destinationAccountId);
      if (!destination) return { status: "missing_account", field: "destinationAccountId" };

      const openingDate = minimumTransferDate(source.openingDate, destination.openingDate);
      if (input.date < openingDate) return { status: "before_opening", openingDate };

      const values = { ...input, ownerUserId };
      const [transfer] = transferScope
        ? await write.update(transfers).set(values).where(transferScope).returning(transferColumns)
        : await write.insert(transfers).values(values).returning(transferColumns);
      const affectedAccounts = [input.sourceAccountId, input.destinationAccountId];
      if (existing) affectedAccounts.push(existing.sourceAccountId, existing.destinationAccountId);
      await assertSavedBuysFunded(write, ownerUserId, affectedAccounts);
      return { status: "saved", transfer };
    }, { isolationLevel: "read committed" });
  }

  return {
    async deleteTransfer(ownerUserId, transferId) {
      return db.transaction(async (write) => {
        await lockOwnerActivity(write, ownerUserId);
        const [removed] = await write.delete(transfers)
          .where(and(eq(transfers.ownerUserId, ownerUserId), eq(transfers.id, transferId))).returning();
        if (!removed) return "not_found";

        await assertSavedBuysFunded(write, ownerUserId, [removed.sourceAccountId, removed.destinationAccountId]);
        await retainDeletedActivity(write, "transfer", removed);
        return "deleted";
      }, { isolationLevel: "read committed" });
    },
    recordTransfer: (ownerUserId, input) => saveTransfer(ownerUserId, input),
    correctTransfer: (ownerUserId, transferId, input) => saveTransfer(ownerUserId, input, transferId),
  };
}
