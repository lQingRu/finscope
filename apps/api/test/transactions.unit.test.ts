import assert from "node:assert/strict";
import { test } from "vitest";
import type { TransactionWrites } from "../src/transactions/transactions.repository.ts";
import { createTransactionService } from "../src/transactions/transactions.service.ts";

const owner = "owner";
const id = "transaction";
const input = {
  accountId: "destination", type: "income", category: "Salary", amount: "100.00", date: "2026-11-01",
} as const;
const saved = { ...input, id, description: null };

function serviceWithWrites(overrides: Partial<TransactionWrites>) {
  const unexpected = async () => assert.fail("Unexpected repository call");
  return createTransactionService({
    listTransactions: unexpected,
    withWrite: async (ownerUserId, run) => {
      assert.equal(ownerUserId, owner);
      return run({
        findTransactionAccountId: unexpected,
        lockAccountOpeningDate: unexpected,
        save: unexpected,
        remove: unexpected,
        readTradeFunding: unexpected,
        retainDeletion: unexpected,
        ...overrides,
      });
    },
  });
}

test("a transaction before the locked opening date is rejected before writing", async () => {
  const service = serviceWithWrites({
    lockAccountOpeningDate: async (accountId) => {
      assert.equal(accountId, input.accountId);
      return "2026-11-02";
    },
  });

  assert.deepEqual(await service.recordTransaction(owner, input), {
    status: "before_opening", openingDate: "2026-11-02",
  });
});

test("a correction checks funding for both accounts after saving", async () => {
  let wrote = false;
  const fundedAccounts: string[] = [];
  const service = serviceWithWrites({
    findTransactionAccountId: async () => "original",
    lockAccountOpeningDate: async () => input.date,
    save: async (details, transactionId) => {
      assert.deepEqual(details, input);
      assert.equal(transactionId, id);
      wrote = true;
      return saved;
    },
    readTradeFunding: async (accountId) => {
      assert.equal(wrote, true);
      fundedAccounts.push(accountId);
      return undefined;
    },
  });

  assert.deepEqual(await service.correctTransaction(owner, id, input), { status: "saved", transaction: saved });
  assert.deepEqual(fundedAccounts, [input.accountId, "original"]);
});

test("a funding failure rejects deletion before an audit record is retained", async () => {
  const service = serviceWithWrites({
    remove: async () => ({ ...saved, ownerUserId: owner, createdAt: new Date(0) }),
    readTradeFunding: async (accountId) => {
      assert.equal(accountId, input.accountId);
      return {
        openingBalance: "0.00", cash: [],
        trades: [{ id: "trade", ticker: "ES3", date: input.date, type: "buy", cashMovement: "-10.00" }],
      };
    },
  });

  await assert.rejects(service.deleteTransaction(owner, id), {
    conflict: {
      status: "insufficient_cash", shortfall: "10.00", affectedTradeId: "trade",
      message: "Purchase of ES3 on 2026-11-01 needs 10.00 SGD more brokerage cash.",
    },
  });
});
