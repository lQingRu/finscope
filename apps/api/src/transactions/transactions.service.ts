import type { Transaction, TransactionInput } from "@finscope/contracts/transactions";
import { assertSavedTradesFunded } from "../account-activity/trade-funding.service.ts";
import type { TransactionRepository } from "./transactions.repository.ts";

type TransactionWriteResult =
  | { status: "saved"; transaction: Transaction }
  | { status: "missing_account" }
  | { status: "not_found" }
  | { status: "before_opening"; openingDate: string };

export function createTransactionService(repository: TransactionRepository) {
  function saveTransaction(ownerUserId: string, input: TransactionInput, id?: string) {
    return repository.withWrite<TransactionWriteResult>(ownerUserId, async (write) => {
      const previousAccountId = id ? await write.findTransactionAccountId(id) : undefined;
      if (id && !previousAccountId) return { status: "not_found" };

      const openingDate = await write.lockAccountOpeningDate(input.accountId);
      if (openingDate === undefined) return { status: "missing_account" };
      if (input.date < openingDate) return { status: "before_opening", openingDate };

      const transaction = await write.save(input, id);
      const affectedAccounts = [input.accountId];
      if (previousAccountId) affectedAccounts.push(previousAccountId);
      await assertSavedTradesFunded(write.readTradeFunding, affectedAccounts);
      return { status: "saved", transaction };
    });
  }

  return {
    listTransactions: repository.listTransactions,
    recordTransaction: (ownerUserId: string, input: TransactionInput) => saveTransaction(ownerUserId, input),
    correctTransaction: (ownerUserId: string, id: string, input: TransactionInput) => saveTransaction(ownerUserId, input, id),
    deleteTransaction(ownerUserId: string, id: string) {
      return repository.withWrite<"deleted" | "not_found">(ownerUserId, async (write) => {
        const removed = await write.remove(id);
        if (!removed) return "not_found";

        await assertSavedTradesFunded(write.readTradeFunding, [removed.accountId]);
        await write.retainDeletion(removed);
        return "deleted";
      });
    },
  };
}

export type TransactionService = ReturnType<typeof createTransactionService>;
