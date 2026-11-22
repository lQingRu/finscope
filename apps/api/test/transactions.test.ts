import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { test, vi } from "vitest";
import { createApi } from "../src/app.ts";
import { migrateDatabase } from "../src/database.ts";
import { createOwnerAuthorizer } from "../src/financial-accounts/authorization.ts";
import { createFinancialAccountRepository } from "../src/financial-accounts/repository.ts";

const databaseUrl = process.env.FINSCOPE_TEST_DATABASE_URL;
const googleSubject = "123456789012345678901";
const openingAccount = {
  name: "Savings", type: "bank", currency: "SGD", openingDate: "2026-10-01", openingBalance: "3000",
};
const salary = { type: "income", amount: "500", date: "2026-11-03", category: "Salary", description: "November pay" };
const groceries = { type: "expense", amount: "100", date: "2026-11-06", category: "Food" };

async function startWorkspace(onFinish: (cleanup: () => Promise<void>) => void, ownerUserId = randomUUID()) {
  const pool = new Pool({ connectionString: databaseUrl });
  onFinish(() => pool.end());
  await migrateDatabase(pool);
  const authorize = createOwnerAuthorizer({
    supabaseUrl: "https://project.example",
    supabasePublishableKey: "sb_publishable_test",
    ownerUserId,
    ownerGoogleSubject: googleSubject,
  }, async () => Response.json({ id: ownerUserId, identities: [{ provider: "google", id: googleSubject }] }));
  const app = await createApi({
    checkDatabase: async () => {},
    corsOrigin: "https://finscope.pages.dev",
    reportError: assert.fail,
    accounts: { authorize, repository: createFinancialAccountRepository(drizzle(pool)) },
  });
  onFinish(() => app.close());
  const claims = { sub: ownerUserId, aud: "authenticated", role: "authenticated", amr: [{ method: "oauth" }] };
  const authorization = `Bearer test.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
  function request(method: "POST" | "GET" | "PATCH" | "DELETE", url: string, payload?: object) {
    return app.inject({ method, url, headers: { authorization }, payload });
  }
  async function openAccount(overrides: Partial<typeof openingAccount> = {}) {
    const response = await request("POST", "/financial-accounts", { ...openingAccount, ...overrides });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().id as string;
  }
  async function record(accountId: string, input: typeof salary | typeof groceries) {
    const response = await request("POST", "/transactions", { accountId, ...input });
    assert.equal(response.statusCode, 201, response.body);
    return response.json();
  }
  return { app, request, openAccount, record, ownerUserId };
}

test("recording income and expenses updates account balances and the Singapore calendar month summary", {
  skip: !databaseUrl,
}, async ({ onTestFinished }) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T16:10:00.000Z"));
  onTestFinished(() => { vi.useRealTimers(); });
  const workspace = await startWorkspace(onTestFinished);
  const accountId = await workspace.openAccount();
  const income = await workspace.record(accountId, salary);
  const expense = await workspace.record(accountId, groceries);
  const restarted = await startWorkspace(onTestFinished, workspace.ownerUserId);

  const accounts = await restarted.request("GET", "/financial-accounts");
  assert.equal(accounts.statusCode, 200, accounts.body);
  assert.deepEqual(accounts.json().summary, {
    currency: "SGD", balance: "3400.00", income: "500.00", expenses: "100.00", netCashflow: "400.00",
    from: "2026-11-01", to: "2026-11-30",
  });
  assert.equal(accounts.json().accounts[0].openingBalance, "3000.00");
  assert.equal(accounts.json().accounts[0].balance, "3400.00");

  const history = await restarted.request("GET", `/financial-accounts/${accountId}/transactions`);
  assert.equal(history.statusCode, 200, history.body);
  assert.deepEqual(history.json().transactions, [
    { ...groceries, accountId, id: expense.id, amount: "100.00", description: null },
    { ...salary, accountId, id: income.id, amount: "500.00" },
  ]);
});

test("corrections update one saved transaction across account balances and reporting periods", {
  skip: !databaseUrl,
}, async ({ onTestFinished }) => {
  const workspace = await startWorkspace(onTestFinished);
  const primary = await workspace.openAccount();
  const secondary = await workspace.openAccount({ name: "Wallet", openingBalance: "0.10" });
  await workspace.record(primary, salary);
  const expense = await workspace.record(primary, groceries);
  const transactionUrl = `/transactions/${expense.id}`;
  const novemberUrl = "/financial-accounts?from=2026-11-01&to=2026-11-30";
  const decemberUrl = "/financial-accounts?from=2026-12-01&to=2026-12-31";
  const historyUrl = (accountId: string) => `/financial-accounts/${accountId}/transactions`;

  const withinPeriod = await workspace.request("PATCH", transactionUrl, {
    ...groceries, accountId: primary, amount: "125", date: "2026-11-30", description: "Corrected groceries",
  });
  assert.equal(withinPeriod.statusCode, 200, withinPeriod.body);
  assert.equal(withinPeriod.json().id, expense.id);
  assert.deepEqual((await workspace.request("GET", novemberUrl)).json().summary, {
    currency: "SGD", balance: "3375.10", income: "500.00", expenses: "125.00", netCashflow: "375.00",
    from: "2026-11-01", to: "2026-11-30",
  });
  const history = (await workspace.request("GET", historyUrl(primary))).json().transactions;
  assert.equal(history.length, 2);
  assert.deepEqual(history[0], withinPeriod.json());

  const moved = await workspace.request("PATCH", transactionUrl, {
    ...groceries, accountId: secondary, amount: "125", date: "2026-12-01",
  });
  assert.equal(moved.statusCode, 200, moved.body);
  assert.equal(moved.json().id, expense.id);
  const november = (await workspace.request("GET", novemberUrl)).json();
  assert.deepEqual(november.accounts.map(({ balance }: { balance: string }) => balance), ["3500.00", "-124.90"]);
  assert.equal(november.summary.balance, "3375.10");
  assert.equal(november.summary.netCashflow, "500.00");
  const december = (await workspace.request("GET", decemberUrl)).json().summary;
  assert.equal(december.balance, "3375.10");
  assert.equal(december.netCashflow, "-125.00");
  assert.equal((await workspace.request("GET", historyUrl(primary))).json().transactions.length, 1);
  assert.deepEqual((await workspace.request("GET", historyUrl(secondary))).json().transactions, [moved.json()]);

  const reclassified = await workspace.request("PATCH", transactionUrl, {
    type: "income", category: "Other Income", accountId: secondary, amount: "0.20", date: "2026-12-01",
  });
  assert.equal(reclassified.statusCode, 200, reclassified.body);
  const final = (await workspace.request("GET", decemberUrl)).json();
  assert.equal(final.accounts[1].balance, "0.30");
  assert.equal(final.summary.netCashflow, "0.20");
});

test("linked entries protect account deletion and opening dates during concurrent writes", {
  skip: !databaseUrl,
}, async ({ onTestFinished }) => {
  const workspace = await startWorkspace(onTestFinished);
  const otherProcess = await startWorkspace(onTestFinished, workspace.ownerUserId);
  const accountId = await workspace.openAccount();
  const accountUrl = `/financial-accounts/${accountId}`;
  const correction = { name: "Savings", openingDate: salary.date, openingBalance: "3000" };
  await workspace.record(accountId, groceries);
  await workspace.record(accountId, salary);

  assert.equal((await workspace.request("PATCH", accountUrl, correction)).statusCode, 200);
  const rejected = await workspace.request("PATCH", accountUrl, {
    name: "Changed", openingDate: "2026-11-05", openingBalance: "0",
  });
  assert.equal(rejected.statusCode, 400, rejected.body);
  assert.match(rejected.json().openingDateError, /2026-11-03/);
  const rejectedDeletion = await workspace.request("DELETE", accountUrl);
  assert.equal(rejectedDeletion.statusCode, 409, rejectedDeletion.body);
  assert.equal(rejectedDeletion.json().status, "linked_activity");
  const account = (await workspace.request("GET", "/financial-accounts")).json().accounts[0];
  assert.deepEqual({ name: account.name, date: account.openingDate, balance: account.balance }, {
    name: "Savings", date: salary.date, balance: "3400.00",
  });
  assert.equal((await workspace.request("GET", `${accountUrl}/transactions`)).json().transactions.length, 2);

  const dateRaceAccount = await workspace.openAccount({ name: "Date race" });
  const dateRaceUrl = `/financial-accounts/${dateRaceAccount}`;
  const [created, updated] = await Promise.all([
    workspace.request("POST", "/transactions", { ...salary, accountId: dateRaceAccount }),
    otherProcess.request("PATCH", dateRaceUrl, { ...correction, name: "Date race", openingDate: "2026-11-05" }),
  ]);
  assert.ok(
    (created.statusCode === 201 && updated.statusCode === 400)
      || (created.statusCode === 400 && updated.statusCode === 200),
    `${created.statusCode} create / ${updated.statusCode} correct`,
  );

  const deletionRaceAccount = await workspace.openAccount({ name: "Deletion race" });
  const deletionRaceUrl = `/financial-accounts/${deletionRaceAccount}`;
  const [inserted, deleted] = await Promise.all([
    workspace.request("POST", "/transactions", { ...salary, accountId: deletionRaceAccount }),
    otherProcess.request("DELETE", deletionRaceUrl),
  ]);
  assert.ok(
    (inserted.statusCode === 201 && deleted.statusCode === 409)
      || (inserted.statusCode === 404 && deleted.statusCode === 204),
    `${inserted.statusCode} create / ${deleted.statusCode} delete`,
  );
  const remaining = await workspace.request("GET", `${deletionRaceUrl}/transactions`);
  if (inserted.statusCode === 201) {
    assert.equal(remaining.statusCode, 200);
    assert.deepEqual(remaining.json().transactions, [inserted.json()]);
  } else {
    assert.equal(remaining.statusCode, 404);
  }
});

test("history filters by type, category and inclusive date bounds and sorts newest first", {
  skip: !databaseUrl,
}, async ({ onTestFinished }) => {
  const workspace = await startWorkspace(onTestFinished);
  const primary = await workspace.openAccount();
  const otherAccount = await workspace.openAccount({ name: "Wallet" });
  const income = await workspace.record(primary, salary);
  const original = await workspace.record(primary, groceries);
  const sameDate = await workspace.record(primary, { ...groceries, amount: "10" });
  const transit = await workspace.record(primary, { ...groceries, category: "Transport", date: salary.date });
  const future = await workspace.record(primary, { ...groceries, date: "2030-01-01" });
  await workspace.record(otherAccount, groceries);
  const url = `/financial-accounts/${primary}/transactions`;
  for (const [query, expected] of [
    ["", [future, sameDate, original, transit, income]],
    ["?type=income", [income]],
    ["?category=Food", [future, sameDate, original]],
    ["?from=2026-11-03&to=2026-11-03", [transit, income]],
    ["?type=expense&category=Food&from=2026-11-06&to=2026-11-06", [sameDate, original]],
    ["?to=2026-11-03", [transit, income]],
  ] as const) {
    const response = await workspace.request("GET", `${url}${query}`);
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().transactions, expected);
  }
  for (const query of ["?from=2026-11-07&to=2026-11-06", "?type=transfer", "?category=Unknown", "?from=2026-02-30"]) {
    assert.equal((await workspace.request("GET", `${url}${query}`)).statusCode, 400);
  }
  for (const query of ["?from=2026-11-01", "?from=2026-11-30&to=2026-11-01", "?from=0000-01-01&to=2026-11-30"]) {
    assert.equal((await workspace.request("GET", `/financial-accounts${query}`)).statusCode, 400);
  }
});

test("invalid and out-of-workspace writes preserve the saved transactions and financial totals", {
  skip: !databaseUrl,
}, async ({ onTestFinished }) => {
  const workspace = await startWorkspace(onTestFinished);
  const other = await startWorkspace(onTestFinished);
  const accountId = await workspace.openAccount();
  const foreignAccountId = await other.openAccount();
  const original = await workspace.record(accountId, salary);
  const foreign = await other.record(foreignAccountId, groceries);
  const historyUrl = `/financial-accounts/${accountId}/transactions`;
  const transactionUrl = `/transactions/${original.id}`;
  const overviewUrl = "/financial-accounts?from=2026-11-01&to=2026-11-30";
  const originalOverview = (await workspace.request("GET", overviewUrl)).json();

  const invalid = [
    ["accountId", undefined],
    ["accountId", "invalid-id"],
    ["type", "transfer"],
    ["amount", "0"],
    ["amount", "-0.01"],
    ["amount", "0.001"],
    ["amount", "1000000000000"],
    ["date", "2026-11-31"],
    ["date", "2026-09-30"],
    ["category", "Food"],
    ["category", "Unknown"],
    ["description", "invalid\0description"],
  ] as const;
  for (const [field, value] of invalid) {
    const payload = { ...salary, accountId, [field]: value };
    for (const [method, url] of [["POST", "/transactions"], ["PATCH", transactionUrl]] as const) {
      const response = await workspace.request(method, url, payload);
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(typeof response.json().fieldErrors[field], "string", response.body);
    }
  }

  for (const destination of [randomUUID(), foreignAccountId]) {
    const payload = { ...salary, accountId: destination };
    for (const [method, url] of [["POST", "/transactions"], ["PATCH", transactionUrl]] as const) {
      const response = await workspace.request(method, url, payload);
      assert.equal(response.statusCode, 404, response.body);
      assert.deepEqual(response.json(), {
        status: "not_found", fieldErrors: { accountId: "Select an available financial account." },
      });
    }
  }

  assert.equal((await other.request("GET", historyUrl)).statusCode, 404);
  assert.equal((await other.request("PATCH", transactionUrl, { ...salary, accountId: foreignAccountId })).statusCode, 404);
  assert.equal((await workspace.request("PATCH", `/transactions/${foreign.id}`, { ...groceries, accountId })).statusCode, 404);
  assert.equal((await workspace.app.inject({ method: "GET", url: historyUrl })).statusCode, 401);
  for (const [method, url] of [["POST", "/transactions"], ["PATCH", transactionUrl]] as const) {
    assert.equal((await workspace.app.inject({ method, url, payload: { ...salary, accountId } })).statusCode, 401);
  }
  assert.deepEqual((await workspace.request("GET", historyUrl)).json().transactions, [original]);
  assert.deepEqual((await workspace.request("GET", overviewUrl)).json(), originalOverview);
  assert.deepEqual(
    (await other.request("GET", `/financial-accounts/${foreignAccountId}/transactions`)).json().transactions,
    [foreign],
  );
});
