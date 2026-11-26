import assert from "node:assert/strict";
import { correctFinancialAccount, openFinancialAccount } from "@finscope/contracts/financial-accounts";
import { test, vi } from "vitest";

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
