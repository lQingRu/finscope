import assert from "node:assert/strict";
import type { EtfTradeInput } from "@finscope/contracts/etf-trades";
import { test } from "vitest";
import type { EtfTradeWrites, TradeRow } from "../src/etf-trades/etf-trades.repository.ts";
import { createEtfTradeService } from "../src/etf-trades/etf-trades.service.ts";

const owner = "owner";
const accountId = "brokerage";
const details = {
  accountId, ticker: "ES3", exchange: "SGX", type: "buy",
  date: "2026-11-02", quantity: "10", executionPrice: "50.00", fee: "2.00",
} as const;
const input = { ...details, currency: "SGD" } satisfies EtfTradeInput;
const saved: TradeRow = {
  ...details, id: "first", ownerUserId: owner, entryOrder: 1n,
  purpose: "", strategy: "", tags: [], notes: "", grossAmount: "500.00",
  cashMovement: "-502.00", costBasisChange: "502.00", realisedPnl: null,
};

function serviceWithWrites(overrides: Partial<EtfTradeWrites>, openingBalance = "0.00") {
  const unexpected = async () => assert.fail("Unexpected repository call");
  return createEtfTradeService({
    readHoldingsSnapshot: unexpected,
    readPortfolioSnapshot: unexpected,
    withWrite: async (ownerUserId, run) => {
      assert.equal(ownerUserId, owner);
      return run({
        find: unexpected,
        lockAccount: async (id) => {
          assert.equal(id, accountId);
          return { type: "brokerage", openingBalance, openingDate: input.date };
        },
        listTrades: unexpected,
        readCashEntries: unexpected,
        updateContext: unexpected,
        updateAmounts: unexpected,
        save: unexpected,
        remove: unexpected,
        retainDeletion: unexpected,
        ...overrides,
      });
    },
  });
}

test("an unfunded trade is rejected before any ledger write", async () => {
  const service = serviceWithWrites({
    listTrades: async () => [],
    readCashEntries: async () => [{ date: "2026-11-03", amount: "1000.00" }],
  }, "500.00");

  assert.deepEqual(await service.recordTrade(owner, input), {
    status: "insufficient_cash",
    shortfall: "2.00",
    affectedTradeId: undefined,
    message: "Purchase of ES3 on 2026-11-02 needs 2.00 SGD more brokerage cash.",
  });
});

test("a historical trade allows a context edit and rejects changes to financial details", async () => {
  const service = serviceWithWrites({
    find: async (id) => {
      assert.equal(id, saved.id);
      return saved;
    },
    listTrades: async () => [saved, { ...saved, id: "second", entryOrder: 2n }],
    updateContext: async (id, context) => {
      assert.equal(id, saved.id);
      assert.deepEqual(context, { purpose: "", strategy: "", tags: [], notes: "Updated note" });
      return { ...saved, ...context };
    },
  });

  const annotated = await service.updateTrade(owner, saved.id, { ...input, notes: "Updated note" });
  assert.equal(annotated.status, "saved");
  assert.equal(annotated.trade.notes, "Updated note");
  assert.equal(annotated.trade.canChangeFinancialDetails, false);

  const corrected = await service.updateTrade(owner, saved.id, { ...input, quantity: "11" });
  assert.equal(corrected.status, "historical_trade");

  const deleted = await service.deleteTrade(owner, saved.id);
  assert.ok(typeof deleted === "object");
  assert.equal(deleted.status, "historical_trade");
});

test("a backdated buy updates a later sale's cost basis before saving the buy", async () => {
  const sale: TradeRow = {
    ...saved, id: "sale", entryOrder: 2n, date: "2026-11-04", type: "sell", quantity: "5",
    executionPrice: "80.00", fee: "0.00", grossAmount: "400.00", cashMovement: "400.00",
    costBasisChange: "-251.00", realisedPnl: "149.00",
  };
  const operations: string[] = [];
  const service = serviceWithWrites({
    listTrades: async () => [saved, sale],
    readCashEntries: async () => [],
    updateAmounts: async (id, tradeId, amounts) => {
      assert.equal(id, accountId);
      assert.equal(tradeId, sale.id);
      assert.deepEqual(amounts, {
        grossAmount: "400.00", cashMovement: "400.00", costBasisChange: "-300.50", realisedPnl: "99.50",
      });
      operations.push("update sale");
    },
    save: async (values) => {
      assert.equal(values.cashMovement, "-700.00");
      operations.push("save buy");
      return { ...saved, ...values, id: "backdated", entryOrder: 3n };
    },
  }, "2000.00");

  const result = await service.recordTrade(owner, {
    ...input, date: "2026-11-03", executionPrice: "70.00", fee: "0.00",
  });
  assert.equal(result.status, "saved");
  assert.equal(result.trade.canChangeFinancialDetails, false);
  assert.deepEqual(operations, ["update sale", "save buy"]);
});
