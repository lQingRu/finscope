import assert from "node:assert/strict";
import { correctFinancialAccount, openFinancialAccount } from "@finscope/contracts/financial-accounts";
import { test, vi } from "vitest";
import type { FinancialAccountRepository } from "../src/financial-accounts/financial-accounts.repository.ts";
import { createFinancialAccountService } from "../src/financial-accounts/financial-accounts.service.ts";

test("account opening and correction validate opening dates against the Singapore calendar", ({ onTestFinished }) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-19T16:10:00.000Z"));
  onTestFinished(() => { vi.useRealTimers(); });

  const details = { name: "Savings", openingBalance: "3000.00" };
  for (const [operation, schema, input] of [
    ["open", openFinancialAccount, { ...details, type: "bank", currency: "SGD" }],
    ["correct", correctFinancialAccount, details],
  ] as const) {
    for (const openingDate of ["0001-01-01", "2026-11-19", "2026-11-20"]) {
      assert.equal(schema.parse({ ...input, openingDate }).openingDate, openingDate);
    }
    for (const openingDate of ["0000-02-29", "2026-11-21", "2026-11-31"]) {
      const result = schema.safeParse({ ...input, openingDate });
      assert.equal(result.success, false, `${operation} accepted ${openingDate}`);
      assert.deepEqual(result.error.issues[0].path, ["openingDate"]);
      assert.match(result.error.issues[0].message, /opening date/i);
    }
  }
});

const owner = "owner";
const id = "account";
const input = { name: "Savings", openingDate: "2026-11-02", openingBalance: "100.00" };
const account = { ...input, id, type: "bank", currency: "SGD" } as const;
const unexpected = async () => assert.fail("Unexpected repository call");

function serviceWithRepository(overrides: Partial<FinancialAccountRepository>) {
  return createFinancialAccountService({
    listActivity: unexpected,
    open: unexpected,
    delete: unexpected,
    withCorrection: unexpected,
    ...overrides,
  });
}

test("reporting defaults to the current Singapore month and summarizes activity", async ({ onTestFinished }) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T16:10:00Z"));
  onTestFinished(() => { vi.useRealTimers(); });

  const november = { from: "2026-11-01", to: "2026-11-30" };
  const { currency, ...accountColumns } = account;
  const service = serviceWithRepository({
    listActivity: async (ownerUserId, period) => {
      assert.equal(ownerUserId, owner);
      assert.deepEqual(period, november);
      return [{ ...accountColumns, earliestActivityDate: "2026-11-03", net: "15.25", income: "20.00", expenses: "5.00" }];
    },
  });

  assert.deepEqual(await service.list(owner), {
    accounts: [{ ...account, earliestActivityDate: "2026-11-03", balance: "115.25" }],
    summary: { currency, ...november, balance: "115.25", income: "20.00", expenses: "5.00", netCashflow: "15.00" },
  });
});

test("account correction rejects an opening date after recorded activity before updating", async () => {
  const activityDate = "2026-11-01";
  const service = serviceWithRepository({
    withCorrection: async (ownerUserId, accountId, run) => {
      assert.equal(ownerUserId, owner);
      assert.equal(accountId, id);
      return run({
        findEarliestActivityDate: async () => activityDate,
        update: unexpected,
        readTradeFunding: unexpected,
      });
    },
  });

  assert.deepEqual(await service.correct(owner, id, input), { status: "after_activity", activityDate });
});

test("account correction allows the earliest activity date and propagates funding failure after updating", async () => {
  let updated = false;
  const service = serviceWithRepository({
    withCorrection: async (_owner, _account, run) => run({
      findEarliestActivityDate: async () => input.openingDate,
      update: async (details) => {
        assert.deepEqual(details, input);
        updated = true;
        return account;
      },
      readTradeFunding: async () => {
        assert.equal(updated, true);
        return {
          openingBalance: "100.00", cash: [],
          trades: [{ id: "trade", ticker: "ES3", date: input.openingDate, type: "buy", cashMovement: "-110.00" }],
        };
      },
    }),
  });

  await assert.rejects(service.correct(owner, id, input), {
    conflict: {
      status: "insufficient_cash", shortfall: "10.00", affectedTradeId: "trade",
      message: "Purchase of ES3 on 2026-11-02 needs 10.00 SGD more brokerage cash.",
    },
  });
});
