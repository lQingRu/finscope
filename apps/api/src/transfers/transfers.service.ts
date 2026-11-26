import { minimumTransferDate } from "@finscope/contracts/transfers";
import type { Transfer, TransferAccountField, TransferInput } from "@finscope/contracts/transfers";
import { assertSavedTradesFunded } from "../account-activity/trade-funding.service.ts";
import type { TransferRepository } from "./transfers.repository.ts";

type TransferWriteResult =
  | { status: "saved"; transfer: Transfer }
  | { status: "missing_account"; field: TransferAccountField }
  | { status: "not_found" }
  | { status: "before_opening"; openingDate: string };

export function createTransferService(repository: TransferRepository) {
  function saveTransfer(ownerUserId: string, input: TransferInput, id?: string) {
    return repository.withWrite<TransferWriteResult>(ownerUserId, async (write) => {
      const existing = id ? await write.find(id) : undefined;
      if (id && !existing) return { status: "not_found" };

      const selected = await write.lockAccountOpeningDates(input.sourceAccountId, input.destinationAccountId);
      const source = selected.find(({ id }) => id === input.sourceAccountId);
      if (!source) return { status: "missing_account", field: "sourceAccountId" };
      const destination = selected.find(({ id }) => id === input.destinationAccountId);
      if (!destination) return { status: "missing_account", field: "destinationAccountId" };

      const openingDate = minimumTransferDate(source.openingDate, destination.openingDate);
      if (input.date < openingDate) return { status: "before_opening", openingDate };

      const transfer = await write.save(input, id);
      const affectedAccounts = [input.sourceAccountId, input.destinationAccountId];
      if (existing) affectedAccounts.push(existing.sourceAccountId, existing.destinationAccountId);
      await assertSavedTradesFunded(write.readTradeFunding, affectedAccounts);
      return { status: "saved", transfer };
    });
  }

  return {
    recordTransfer: (ownerUserId: string, input: TransferInput) => saveTransfer(ownerUserId, input),
    correctTransfer: (ownerUserId: string, id: string, input: TransferInput) => saveTransfer(ownerUserId, input, id),
    deleteTransfer(ownerUserId: string, id: string) {
      return repository.withWrite<"deleted" | "not_found">(ownerUserId, async (write) => {
        const removed = await write.remove(id);
        if (!removed) return "not_found";

        await assertSavedTradesFunded(write.readTradeFunding, [removed.sourceAccountId, removed.destinationAccountId]);
        await write.retainDeletion(removed);
        return "deleted";
      });
    },
  };
}

export type TransferService = ReturnType<typeof createTransferService>;
