import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { test } from "vitest";
import { createApi } from "../src/app/create-api.ts";
import { migrateDatabase } from "../src/infrastructure/postgres.ts";
import { createEtfTradeRepository } from "../src/etf-trades/repository.ts";
import { createFinancialAccountRepository } from "../src/financial-accounts/repository.ts";
import { createTransferRepository } from "../src/transfers/repository.ts";

const databaseUrl = process.env.FINSCOPE_TEST_DATABASE_URL;
const tradeDetails = {
  ticker: "ES3", exchange: "SGX", currency: "SGD", type: "buy",
  date: "2026-11-02", quantity: "10", executionPrice: "50", fee: "2",
};

async function startWorkspace(onFinish: (cleanup: () => Promise<void>) => void) {
  const pool = new Pool({ connectionString: databaseUrl });
  onFinish(() => pool.end());
  await migrateDatabase(pool);
  const db = drizzle(pool);
  const ownerUserId = randomUUID();
  const app = await createApi({
    checkDatabase: async () => {},
    corsOrigin: "https://finscope.pages.dev",
    reportError: assert.fail,
    accounts: {
      authorize: async (header) => {
        if (header === "Bearer owner") return { status: "authorized", ownerUserId };
        return { status: header ? "forbidden" : "unauthenticated" };
      },
      repository: createFinancialAccountRepository(db),
      transferRepository: createTransferRepository(db),
      etfTradeRepository: createEtfTradeRepository(db),
    },
  });
  onFinish(() => app.close());
  function request(method: "POST" | "GET" | "PATCH" | "DELETE", url: string, payload?: object) {
    return app.inject({ method, url, headers: { authorization: "Bearer owner" }, payload });
  }
  async function openAccount(overrides = {}) {
    const response = await request("POST", "/financial-accounts", {
      name: "Brokerage", type: "brokerage", currency: "SGD", openingDate: "2026-11-01", openingBalance: "2000",
      ...overrides,
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().id as string;
  }
  async function trade(accountId: string, overrides = {}) {
    const response = await request("POST", "/etf-trades", { ...tradeDetails, accountId, ...overrides });
    assert.equal(response.statusCode, 201, response.body);
    return response.json();
  }
  async function holdings(accountId: string) {
    const response = await request("GET", `/financial-accounts/${accountId}/holdings`);
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  }
  async function overview() {
    const response = await request("GET", "/financial-accounts?view=overview&from=2026-11-01&to=2026-11-30");
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  }
  return { app, request, openAccount, trade, holdings, overview };
}

test("ETF buys use cash and fees to build a brokerage holding without creating an everyday expense", {
  skip: !databaseUrl,
}, async ({ onTestFinished }) => {
  const workspace = await startWorkspace(onTestFinished);
  const accountId = await workspace.openAccount();
  const context = { purpose: "Singapore equity exposure", strategy: "Core index", tags: ["core", "SG"], notes: "First lot" };
  const first = await workspace.trade(accountId, context);
  await workspace.trade(accountId, { executionPrice: "60" });

  const { summary, accounts } = await workspace.overview();
  assert.equal(accounts[0].balance, "896.00");
  assert.equal(summary.expenses, "0.00");
  assert.equal(summary.income, "0.00");
  const { holdings: [holding], trades } = await workspace.holdings(accountId);
  assert.equal(holding.units, "20");
  assert.equal(holding.costBasis, "1104.00");
  assert.equal(holding.averageCost, "55.20");
  assert.equal(holding.fees, "4.00");
  assert.equal(holding.valuation, "awaiting_price");
  assert.equal(holding.marketValue, null);
  assert.equal(holding.unrealisedPnl, null);
  const saved = trades.find(({ id }: { id: string }) => id === first.id);
  assert.equal(saved.cashMovement, "-502.00");
  assert.equal(saved.executionPrice, "50.00");
  for (const [field, value] of Object.entries(context)) assert.deepEqual(saved[field], value);

  const portfolio = await workspace.request("GET", "/portfolio");
  assert.equal(portfolio.statusCode, 200, portfolio.body);
  assert.deepEqual(portfolio.json(), { currency: "SGD", valuation: "partial", knownSubtotal: "896.00", unpricedHoldings: 1 });
});

test("ETF sales use prior same-day entry order and realise proceeds over weighted-average cost", {
  skip: !databaseUrl,
}, async ({ onTestFinished }) => {
  const workspace = await startWorkspace(onTestFinished);
  const accountId = await workspace.openAccount();
  const other = await workspace.openAccount({ name: "Other broker" });
  const first = await workspace.trade(accountId);
  await workspace.trade(accountId, { executionPrice: "60" });
  await workspace.trade(other, { quantity: "2", executionPrice: "65", fee: "0" });
  const sold = await workspace.trade(accountId, { type: "sell", quantity: "5", executionPrice: "70" });

  assert.equal(sold.grossAmount, "350.00");
  assert.equal(sold.cashMovement, "348.00");
  assert.equal(sold.realisedPnl, "72.00");
  const { holdings: [holding], trades } = await workspace.holdings(accountId);
  assert.equal(holding.units, "15");
  assert.equal(holding.costBasis, "828.00");
  assert.equal(holding.averageCost, "55.20");
  assert.equal(holding.realisedPnl, "72.00");
  assert.equal(holding.fees, "6.00");
  assert.equal(trades[0].id, sold.id);
  assert.equal(trades[2].id, first.id);
  assert.equal(trades[2].executionPrice, "50.00");
  assert.equal(trades[2].fee, "2.00");

  const { summary, accounts } = await workspace.overview();
  assert.equal(accounts.find(({ id }: { id: string }) => id === accountId).balance, "1244.00");
  assert.equal(summary.expenses, "0.00");
  assert.equal(summary.income, "0.00");
  const { holdings: [separate] } = await workspace.holdings(other);
  assert.equal(separate.units, "2");
  assert.equal(separate.costBasis, "130.00");
  assert.equal(separate.realisedPnl, "0.00");
});

test("invalid trades leave the complete ledger unchanged and concurrent buys share available cash", {
  skip: !databaseUrl,
}, async ({ onTestFinished }) => {
  const workspace = await startWorkspace(onTestFinished);
  const accountId = await workspace.openAccount({ openingBalance: "600" });
  const bank = await workspace.openAccount({ type: "bank", openingBalance: "9000" });
  const starting = await workspace.overview();
  for (const fields of [
    { quantity: "0" }, { executionPrice: "-1" }, { fee: "-0.01" }, { currency: "USD" },
    { date: "2026-10-31" }, { accountId: bank },
  ]) {
    const response = await workspace.request("POST", "/etf-trades", { ...tradeDetails, accountId, ...fields });
    assert.equal(response.statusCode, 400, response.body);
  }
  const oversale = await workspace.request("POST", "/etf-trades", { ...tradeDetails, accountId, type: "sell" });
  assert.equal(oversale.statusCode, 409, oversale.body);
  assert.equal(oversale.json().shortfall, "10");
  assert.deepEqual(await workspace.overview(), starting);
  assert.deepEqual(await workspace.holdings(accountId), { holdings: [], trades: [] });

  const concurrent = await Promise.all(Array.from({ length: 2 }, () =>
    workspace.request("POST", "/etf-trades", { ...tradeDetails, accountId })));
  assert.deepEqual(concurrent.map(({ statusCode }) => statusCode).sort(), [201, 409]);
  assert.equal(concurrent.find(({ statusCode }) => statusCode === 409)?.json().status, "insufficient_cash");
  const result = await workspace.holdings(accountId);
  assert.equal(result.trades.length, 1);
  assert.equal(result.holdings[0].costBasis, "502.00");
});

test("a trade applies dated funding and preserves downstream buys if a new backdated trade would overdraw cash", {
  skip: !databaseUrl,
}, async ({ onTestFinished }) => {
  const workspace = await startWorkspace(onTestFinished);
  const accountId = await workspace.openAccount({ openingBalance: "100" });
  const bank = await workspace.openAccount({ type: "bank" });
  const funding = await workspace.request("POST", "/transfers", {
    sourceAccountId: bank, destinationAccountId: accountId, date: "2026-11-05", amount: "500",
  });
  assert.equal(funding.statusCode, 201, funding.body);
  const tooEarly = await workspace.request("POST", "/etf-trades", { ...tradeDetails, accountId });
  assert.equal(tooEarly.statusCode, 409, tooEarly.body);
  assert.equal(tooEarly.json().shortfall, "402.00");
  const later = await workspace.trade(accountId, { date: "2026-11-06" });
  const backdated = await workspace.trade(accountId, { date: "2026-11-02", quantity: "1", fee: "0" });
  const before = await workspace.holdings(accountId);
  const conflict = await workspace.request("POST", "/etf-trades", {
    ...tradeDetails, accountId, date: "2026-11-03", quantity: "1", fee: "0",
  });
  assert.equal(conflict.statusCode, 409, conflict.body);
  assert.equal(conflict.json().affectedTradeId, later.id);
  assert.equal(conflict.json().shortfall, "2.00");
  assert.equal(before.trades[1].id, backdated.id);
  assert.deepEqual(await workspace.holdings(accountId), before);
});

test("the owner can update and delete trades while historical financial details and other workspaces stay protected", {
  skip: !databaseUrl,
}, async ({ onTestFinished }) => {
  const workspace = await startWorkspace(onTestFinished);
  const outsider = await startWorkspace(onTestFinished);
  const accountId = await workspace.openAccount();
  const original = await workspace.trade(accountId);
  const latest = await workspace.trade(accountId, { type: "sell", quantity: "2", executionPrice: "60" });

  const privateReads = [
    { method: "GET", url: "/portfolio" },
    { method: "GET", url: `/financial-accounts/${accountId}/holdings` },
    { method: "POST", url: "/etf-trades", payload: { ...tradeDetails, accountId } },
    { method: "PATCH", url: `/etf-trades/${latest.id}`, payload: { ...tradeDetails, accountId } },
    { method: "DELETE", url: `/etf-trades/${latest.id}` },
  ] as const;
  for (const request of privateReads) {
    assert.equal((await workspace.app.inject(request)).statusCode, 401);
    assert.equal((await workspace.app.inject({ ...request, headers: { authorization: "Bearer other" } })).statusCode, 403);
  }
  assert.equal((await outsider.request("GET", `/financial-accounts/${accountId}/holdings`)).statusCode, 404);
  assert.equal((await outsider.request("POST", "/etf-trades", { ...tradeDetails, accountId })).statusCode, 404);
  assert.equal((await outsider.request("PATCH", `/etf-trades/${latest.id}`, { ...tradeDetails, accountId })).statusCode, 404);
  assert.equal((await outsider.request("DELETE", `/etf-trades/${latest.id}`)).statusCode, 404);

  const past = `/etf-trades/${original.id}`;
  const historical = await workspace.request("PATCH", past, { ...tradeDetails, accountId, quantity: "3" });
  assert.equal(historical.statusCode, 409, historical.body);
  assert.equal((await workspace.request("DELETE", past)).statusCode, 409);
  const context = await workspace.request("PATCH", past, { ...tradeDetails, accountId, notes: "Reviewed build-up" });
  assert.equal(context.statusCode, 200, context.body);
  assert.equal(context.json().notes, "Reviewed build-up");

  const latestUrl = `/etf-trades/${latest.id}`;
  const edited = await workspace.request("PATCH", latestUrl, {
    ...tradeDetails, accountId, type: "sell", quantity: "4", executionPrice: "60",
  });
  assert.equal(edited.statusCode, 200, edited.body);
  assert.equal(edited.json().realisedPnl, "37.20");
  assert.equal((await workspace.holdings(accountId)).holdings[0].units, "6");
  assert.equal((await workspace.overview()).accounts[0].balance, "1736.00");
  assert.equal((await workspace.request("DELETE", latestUrl)).statusCode, 204);
  assert.equal((await workspace.request("DELETE", latestUrl)).statusCode, 404);
  assert.equal((await workspace.holdings(accountId)).holdings[0].units, "10");
  assert.equal((await workspace.overview()).accounts[0].balance, "1498.00");
});

test("account, transfer, and everyday activity changes preserve cash funding of saved ETF buys", {
  skip: !databaseUrl,
}, async ({ onTestFinished }) => {
  const workspace = await startWorkspace(onTestFinished);
  const accountId = await workspace.openAccount({ openingBalance: "100" });
  const bank = await workspace.openAccount({ type: "bank" });
  const transfer = await workspace.request("POST", "/transfers", {
    sourceAccountId: bank, destinationAccountId: accountId, date: "2026-11-01", amount: "300",
  });
  const income = await workspace.request("POST", "/transactions", {
    accountId, type: "income", amount: "102", date: "2026-11-01", category: "Other Income",
  });
  assert.equal(transfer.statusCode, 201, transfer.body);
  assert.equal(income.statusCode, 201, income.body);
  const purchase = await workspace.trade(accountId);
  const before = await workspace.overview();
  const operations = [
    workspace.request("PATCH", `/financial-accounts/${accountId}`, {
      name: "Brokerage", openingDate: "2026-11-01", openingBalance: "99",
    }),
    workspace.request("DELETE", `/transfers/${transfer.json().id}`),
    workspace.request("DELETE", `/transactions/${income.json().id}`),
    workspace.request("POST", "/transactions", {
      accountId, type: "expense", amount: "1", date: "2026-11-01", category: "Other Expense",
    }),
  ];
  for (const response of await Promise.all(operations)) {
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json().affectedTradeId, purchase.id);
  }
  assert.deepEqual(await workspace.overview(), before);
  const expenseAfterBuy = await workspace.request("POST", "/transactions", {
    accountId, type: "expense", amount: "1", date: "2026-11-03", category: "Other Expense",
  });
  assert.equal(expenseAfterBuy.statusCode, 201, expenseAfterBuy.body);
  assert.equal((await workspace.request("DELETE", `/financial-accounts/${accountId}`)).statusCode, 409);
  const newAccount = await workspace.openAccount({ name: "No other activity" });
  await workspace.trade(newAccount);
  const openingAfterTrade = await workspace.request("PATCH", `/financial-accounts/${newAccount}`, {
    name: "No other activity", openingDate: "2026-11-03", openingBalance: "2000",
  });
  assert.match(openingAfterTrade.json().openingDateError, /earliest recorded entry/);
});

test("sales that consume cash require funding while sales that add cash remain available", {
  skip: !databaseUrl,
}, async ({ onTestFinished }) => {
  const workspace = await startWorkspace(onTestFinished);
  const accountId = await workspace.openAccount({ openingBalance: "502" });
  await workspace.trade(accountId);
  const sale = { ...tradeDetails, accountId, type: "sell", date: "2026-11-05", quantity: "1", executionPrice: "1.50" };
  const before = await workspace.holdings(accountId);

  const unfunded = await workspace.request("POST", "/etf-trades", sale);
  assert.equal(unfunded.statusCode, 409, unfunded.body);
  assert.equal(unfunded.json().status, "insufficient_cash");
  assert.equal(unfunded.json().shortfall, "0.50");
  assert.match(unfunded.json().message, /sale.*fee/i);
  assert.deepEqual(await workspace.holdings(accountId), before);

  const bank = await workspace.openAccount({ type: "bank" });
  const funding = await workspace.request("POST", "/transfers", {
    sourceAccountId: bank, destinationAccountId: accountId, date: sale.date, amount: "0.50",
  });
  assert.equal(funding.statusCode, 201, funding.body);
  const saved = await workspace.trade(accountId, sale);
  assert.equal(saved.cashMovement, "-0.50");
  const removal = await workspace.request("DELETE", `/transfers/${funding.json().id}`);
  assert.equal(removal.statusCode, 409, removal.body);
  assert.equal(removal.json().affectedTradeId, saved.id);
  assert.equal(removal.json().shortfall, "0.50");

  const expense = await workspace.request("POST", "/transactions", {
    accountId, type: "expense", date: "2026-11-06", amount: "3", category: "Other Expense",
  });
  assert.equal(expense.statusCode, 201, expense.body);
  await workspace.trade(accountId, { ...sale, date: "2026-11-06", executionPrice: "3" });
  assert.equal((await workspace.overview()).accounts.find(({ id }: { id: string }) => id === accountId).balance, "-2.00");
});

test("ordinary backdated trades recalculate later sales while retaining entered details and exact fractional amounts", {
  skip: !databaseUrl,
}, async ({ onTestFinished }) => {
  const workspace = await startWorkspace(onTestFinished);
  const accountId = await workspace.openAccount();
  await workspace.trade(accountId, { date: "2026-11-02", fee: "0" });
  const sale = await workspace.trade(accountId, {
    date: "2026-11-04", type: "sell", quantity: "5", executionPrice: "80", fee: "0",
  });
  assert.equal(sale.realisedPnl, "150.00");
  await workspace.trade(accountId, { date: "2026-11-03", executionPrice: "70", fee: "0" });

  const saved = await workspace.holdings(accountId);
  assert.equal(saved.holdings[0].costBasis, "900.00");
  assert.equal(saved.trades[0].id, sale.id);
  assert.equal(saved.trades[0].executionPrice, "80.00");
  assert.equal(saved.trades[0].quantity, "5");
  assert.equal(saved.trades[0].realisedPnl, "100.00");

  const tooMany = await workspace.request("POST", "/etf-trades", {
    ...tradeDetails, accountId, date: "2026-11-03", type: "sell", quantity: "16",
  });
  assert.equal(tooMany.statusCode, 409, tooMany.body);
  assert.equal(tooMany.json().affectedTradeId, sale.id);
  assert.equal(tooMany.json().shortfall, "1");
  assert.deepEqual(await workspace.holdings(accountId), saved);

  const fractional = await workspace.trade(accountId, {
    ticker: "G3B", date: "2026-11-05", quantity: "0.125", executionPrice: "1.2345", fee: "0",
  });
  assert.equal(fractional.grossAmount, "0.1543125");
  assert.equal(fractional.cashMovement, "-0.1543125");
  const close = await workspace.trade(accountId, {
    ticker: "G3B", date: "2026-11-05", type: "sell", quantity: "0.125", executionPrice: "1.55", fee: "0",
  });
  assert.equal(close.realisedPnl, "0.0394375");
  const { holdings: [, closed] } = await workspace.holdings(accountId);
  assert.equal(closed.units, "0");
  assert.equal(closed.costBasis, "0.00");
  assert.equal(closed.valuation, "closed");
});

test("brokerage and portfolio cash balances retain the full precision of fractional trades", {
  skip: !databaseUrl,
}, async ({ onTestFinished }) => {
  const workspace = await startWorkspace(onTestFinished);
  const accountId = await workspace.openAccount();
  const bank = await workspace.openAccount({ type: "bank", openingBalance: "4.25" });
  const trade = await workspace.trade(accountId, {
    quantity: "0.00000001", executionPrice: "0.00000001", fee: "0",
  });
  assert.equal(trade.cashMovement, "-0.0000000000000001");

  const { summary, accounts } = await workspace.overview();
  assert.equal(accounts.find(({ id }: { id: string }) => id === accountId).balance, "1999.9999999999999999");
  assert.equal(accounts.find(({ id }: { id: string }) => id === bank).balance, "4.25");
  assert.deepEqual(
    { balance: summary.balance, income: summary.income, expenses: summary.expenses, netCashflow: summary.netCashflow },
    { balance: "2004.2499999999999999", income: "0.00", expenses: "0.00", netCashflow: "0.00" },
  );

  const list = await workspace.request("GET", "/financial-accounts");
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(list.json().summary.balance, "2004.2499999999999999");

  const portfolio = await workspace.request("GET", "/portfolio");
  assert.equal(portfolio.statusCode, 200, portfolio.body);
  assert.equal(portfolio.json().knownSubtotal, "2004.2499999999999999");
});
