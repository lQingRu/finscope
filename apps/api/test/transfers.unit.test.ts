import assert from "node:assert/strict";
import { test } from "vitest";
import type { TransferWrites } from "../src/transfers/transfers.repository.ts";
import { createTransferService } from "../src/transfers/transfers.service.ts";

const owner = "owner";
const id = "transfer";
const input = { sourceAccountId: "source", destinationAccountId: "destination", amount: "100.00", date: "2026-11-01" };
const saved = { ...input, id };

function serviceWithWrites(overrides: Partial<TransferWrites>) {
  const unexpected = async () => assert.fail("Unexpected repository call");
  return createTransferService({
    withWrite: async (ownerUserId, run) => {
      assert.equal(ownerUserId, owner);
      return run({
        find: unexpected,
        lockAccountOpeningDates: unexpected,
        save: unexpected,
        remove: unexpected,
        readTradeFunding: unexpected,
        retainDeletion: unexpected,
        ...overrides,
      });
    },
  });
}

test("a transfer before the later account opening date is rejected before writing", async () => {
  const service = serviceWithWrites({
    lockAccountOpeningDates: async (source, destination) => {
      assert.equal(source, input.sourceAccountId);
      assert.equal(destination, input.destinationAccountId);
      return [{ id: destination, openingDate: "2026-11-02" }, { id: source, openingDate: input.date }];
    },
  });

  assert.deepEqual(await service.recordTransfer(owner, input), {
    status: "before_opening", openingDate: "2026-11-02",
  });
});

test("a transfer correction checks funding for both the original and new account pairs after saving", async () => {
  const operations: string[] = [];
  const service = serviceWithWrites({
    find: async () => ({ ...saved, sourceAccountId: "previous-source", destinationAccountId: "previous-destination" }),
    lockAccountOpeningDates: async (source, destination) => [
      { id: source, openingDate: input.date }, { id: destination, openingDate: input.date },
    ],
    save: async (details, transferId) => {
      assert.deepEqual(details, input);
      assert.equal(transferId, id);
      operations.push("save");
      return saved;
    },
    readTradeFunding: async (accountId) => {
      operations.push(accountId);
      return undefined;
    },
  });

  assert.deepEqual(await service.correctTransfer(owner, id, input), { status: "saved", transfer: saved });
  assert.deepEqual(operations, ["save", input.sourceAccountId, input.destinationAccountId, "previous-source", "previous-destination"]);
});

test("transfer deletion checks funding for both accounts before retaining the deleted record", async () => {
  const removed = { ...saved, ownerUserId: owner, createdAt: new Date(0) };
  const operations: string[] = [];
  const service = serviceWithWrites({
    remove: async (transferId) => {
      assert.equal(transferId, id);
      operations.push("remove");
      return removed;
    },
    readTradeFunding: async (accountId) => {
      operations.push(accountId);
      return undefined;
    },
    retainDeletion: async (record) => {
      assert.deepEqual(record, removed);
      operations.push("retain record");
    },
  });

  assert.equal(await service.deleteTransfer(owner, id), "deleted");
  assert.deepEqual(operations, ["remove", input.sourceAccountId, input.destinationAccountId, "retain record"]);
});
