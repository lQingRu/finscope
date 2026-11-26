import assert from "node:assert/strict";
import { test } from "vitest";
import { createApi } from "../src/app/create-api.ts";

test("Fastify request validation preserves error shapes and passes normalized values to handlers", async ({ onTestFinished }) => {
  const id = "b13ea6d0-f915-4d8d-9998-48084e0cd60d";
  const ownerUserId = "3f2e88dc-5439-44b8-9d4d-4ef801e47781";
  const invalidRequest = { status: "invalid_request" };
  const account = {
    id, name: "Savings", type: "bank", currency: "SGD", openingDate: "2026-01-01", openingBalance: "100.00",
  } as const;
  const summary = { currency: "SGD", balance: "100.00", income: "0.00", expenses: "0.00" } as const;
  const validTransaction = {
    accountId: id, type: "expense", category: "Food", amount: "10.00", date: "2026-11-01", description: "Groceries",
  } as const;
  const unexpectedRepositoryCall = async () => assert.fail("Invalid request reached the repository");
  const app = await createApi({
    checkDatabase: async () => {},
    corsOrigin: "https://finscope.pages.dev",
    reportError: assert.fail,
    workspace: {
      authorize: async () => ({ status: "authorized", ownerUserId }),
      financialAccountService: {
        list: async (_owner, period = { from: "2026-01-01", to: "2026-01-31" }) => ({
          accounts: [{ ...account, balance: "100.00", earliestActivityDate: null }],
          summary: { ...summary, ...period, netCashflow: "0.00" },
        }),
        open: unexpectedRepositoryCall,
        correct: unexpectedRepositoryCall,
        delete: unexpectedRepositoryCall,
      },
      transactionService: {
        recordTransaction: async (owner, input) => {
          assert.equal(owner, ownerUserId);
          assert.deepEqual(input, validTransaction);
          return { status: "saved", transaction: { ...input, id, description: input.description ?? null } };
        },
        listTransactions: unexpectedRepositoryCall,
        correctTransaction: unexpectedRepositoryCall,
        deleteTransaction: unexpectedRepositoryCall,
      },
      transferService: {
        recordTransfer: unexpectedRepositoryCall,
        correctTransfer: unexpectedRepositoryCall,
        deleteTransfer: unexpectedRepositoryCall,
      },
      etfTradeService: {
        recordTrade: unexpectedRepositoryCall,
        updateTrade: unexpectedRepositoryCall,
        deleteTrade: unexpectedRepositoryCall,
        readHoldings: unexpectedRepositoryCall,
        readPortfolio: unexpectedRepositoryCall,
      },
    },
  });
  onTestFinished(() => app.close());

  const badTransaction = { ...validTransaction, category: "Salary" };
  const badCategory = await app.inject({ method: "POST", url: "/transactions", payload: badTransaction });
  assert.equal(badCategory.statusCode, 400);
  assert.deepEqual(badCategory.json(), {
    ...invalidRequest, fieldErrors: { category: "Select a category for this transaction type." },
  });

  const badParamAndBody = await app.inject({ method: "PATCH", url: "/transactions/invalid", payload: badTransaction });
  assert.equal(badParamAndBody.statusCode, 400);
  assert.deepEqual(badParamAndBody.json(), invalidRequest);

  for (const url of ["/transactions", "/transfers", "/etf-trades"]) {
    const missingBody = await app.inject({ method: "POST", url });
    assert.equal(missingBody.statusCode, 400, url);
    assert.deepEqual(missingBody.json(), { ...invalidRequest, fieldErrors: {} }, url);
  }

  const textBody = await app.inject({
    method: "POST", url: "/transactions", headers: { "content-type": "text/plain" }, payload: "text",
  });
  assert.equal(textBody.statusCode, 400);
  assert.deepEqual(textBody.json(), { ...invalidRequest, fieldErrors: {} });

  const malformedJson = await app.inject({
    method: "POST", url: "/transactions", headers: { "content-type": "application/json" }, payload: "{",
  });
  assert.equal(malformedJson.statusCode, 400);
  assert.deepEqual(malformedJson.json(), invalidRequest);

  const invalidQuery = await app.inject({ method: "GET", url: "/financial-accounts?from=2026-11-01" });
  assert.equal(invalidQuery.statusCode, 400);
  assert.deepEqual(invalidQuery.json(), invalidRequest);

  const recorded = await app.inject({
    method: "POST", url: "/transactions", payload: { ...validTransaction, description: "  Groceries  " },
  });
  assert.equal(recorded.statusCode, 201);
  assert.deepEqual(recorded.json(), { ...validTransaction, id });

  const legacy = await app.inject({ method: "GET", url: "/financial-accounts" });
  assert.equal(legacy.statusCode, 200);
  assert.deepEqual(legacy.json(), { accounts: [account], summary });

  const period = { from: "2026-11-01", to: "2026-11-30" };
  const overview = await app.inject({ method: "GET", url: "/financial-accounts", query: period });
  assert.equal(overview.statusCode, 200);
  assert.deepEqual(overview.json(), {
    accounts: [{ ...account, balance: "100.00", earliestActivityDate: null }],
    summary: { ...summary, ...period, netCashflow: "0.00" },
  });
});
