import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { test, vi } from "vitest";
import { createApi } from "../src/app.ts";
import { migrateDatabase } from "../src/database.ts";
import { createOwnerAuthorizer } from "../src/financial-accounts/authorization.ts";
import { createFinancialAccountRepository } from "../src/financial-accounts/repository.ts";
import { createTransferRepository } from "../src/transfers/repository.ts";

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
  const db = drizzle(pool);
  const app = await createApi({
    checkDatabase: async () => {},
    corsOrigin: "https://finscope.pages.dev",
    reportError: assert.fail,
    accounts: {
      authorize,
      repository: createFinancialAccountRepository(db),
      transferRepository: createTransferRepository(db),
    },
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
  return { app, request, openAccount, record, ownerUserId, pool };
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

  const legacy = await restarted.request("GET", "/financial-accounts");
  assert.equal(legacy.statusCode, 200, legacy.body);
  assert.deepEqual(legacy.json(), {
    accounts: [{ ...openingAccount, id: accountId, openingBalance: "3000.00" }],
    summary: { currency: "SGD", balance: "3400.00", income: "500.00", expenses: "100.00" },
  });

  const accounts = await restarted.request("GET", "/financial-accounts?view=overview");
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
  const decemberUrl = "/financial-accounts?view=overview&from=2026-12-01&to=2026-12-31";
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
  const account = (await workspace.request("GET", "/financial-accounts?view=overview")).json().accounts[0];
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

test("an account correction from the previous API cannot invalidate recorded activity", {
  skip: !databaseUrl,
}, async ({ onTestFinished }) => {
  const workspace = await startWorkspace(onTestFinished);
  const accountId = await workspace.openAccount();
  const recorded = await workspace.record(accountId, salary);

  // The previous account repository wrote directly without checking for transactions.
  const previousCorrection = (date: string) => workspace.pool.query(
    `UPDATE finscope_private.financial_accounts SET name = $1, opening_date = $2, opening_balance = $3
     WHERE owner_user_id = $4 AND id = $5`,
    ["Previous API", date, "3000", workspace.ownerUserId, accountId],
  );
  assert.equal((await previousCorrection(salary.date)).rowCount, 1);
  await assert.rejects(previousCorrection("2026-11-04"), { code: "23514" });

  const overview = await workspace.request("GET", "/financial-accounts?view=overview");
  assert.equal(overview.statusCode, 200, overview.body);
  const [account] = overview.json().accounts;
  assert.equal(account.openingDate, salary.date);
  assert.equal(account.balance, "3500.00");
  const history = await workspace.request("GET", `/financial-accounts/${accountId}/transactions`);
  assert.deepEqual(history.json().transactions, [recorded]);
});

test("recording waits for an opening-date correction from the previous API", {
  skip: !databaseUrl,
}, async ({ onTestFinished }) => {
  const workspace = await startWorkspace(onTestFinished);
  const accountId = await workspace.openAccount();
  const previousApi = await workspace.pool.connect();
  const openingDate = "2026-11-04";

  try {
    await previousApi.query("BEGIN");
    const { rows: [{ pid }] } = await previousApi.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    await previousApi.query(
      "UPDATE finscope_private.financial_accounts SET opening_date = $1 WHERE owner_user_id = $2 AND id = $3",
      [openingDate, workspace.ownerUserId, accountId],
    );

    let finished = false;
    const recording = workspace.request("POST", "/transactions", { ...salary, accountId })
      .then((response) => {
        finished = true;
        return response;
      });

    // Release the prior writer once the request has encountered it, with a deadline for unexpected failures.
    const deadline = Date.now() + 2000;
    while (!finished && Date.now() < deadline) {
      const blocked = await workspace.pool.query(
        "SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
        [pid],
      );
      if (blocked.rowCount) break;
      await delay(10);
    }
    await previousApi.query("COMMIT");

    const response = await recording;
    assert.equal(response.statusCode, 400, response.body);
    assert.match(response.json().fieldErrors.date, /2026-11-04/);
    const history = await workspace.request("GET", `/financial-accounts/${accountId}/transactions`);
    assert.deepEqual(history.json().transactions, []);
  } finally {
    previousApi.release(true);
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

test("a recorded and corrected cash transfer updates both account histories and balances together", {
  skip: !databaseUrl,
}, async ({ onTestFinished }) => {
  const workspace = await startWorkspace(onTestFinished);
  const sourceAccountId = await workspace.openAccount();
  const destinationAccountId = await workspace.openAccount({
    name: "Brokerage", type: "brokerage", openingBalance: "0",
  });
  const finalDestination = await workspace.openAccount({ name: "Wallet", openingBalance: "0" });
  const historyUrl = (id: string) => `/financial-accounts/${id}/transactions?includeTransfers=true`;
  const overviewUrl = "/financial-accounts?from=2026-11-01&to=2026-11-30";
  const input = { sourceAccountId, destinationAccountId, amount: "2000", date: "2026-11-03" };

  const created = await workspace.request("POST", "/transfers", input);
  assert.equal(created.statusCode, 201, created.body);
  const original = created.json();
  const transferUrl = `/transfers/${original.id}`;
  assert.deepEqual(original, { ...input, id: original.id, amount: "2000.00" });

  async function expectOverview(balances: Record<string, string>) {
    const overview = await workspace.request("GET", overviewUrl);
    assert.equal(overview.statusCode, 200, overview.body);
    assert.deepEqual(overview.json().summary, {
      currency: "SGD", balance: "3000.00", income: "0.00", expenses: "0.00", netCashflow: "0.00",
      from: "2026-11-01", to: "2026-11-30",
    });
    assert.deepEqual(Object.fromEntries(
      overview.json().accounts.map(({ id, balance }: { id: string; balance: string }) => [id, balance]),
    ), balances);
  }

  async function expectHistory(accountId: string, transfers: object[]) {
    const history = await workspace.request("GET", historyUrl(accountId));
    assert.equal(history.statusCode, 200, history.body);
    assert.deepEqual(history.json(), { transactions: [], transfers });
  }

  await expectOverview({ [sourceAccountId]: "1000.00", [destinationAccountId]: "2000.00", [finalDestination]: "0.00" });
  await expectHistory(sourceAccountId, [{ ...original, direction: "outgoing" }]);
  await expectHistory(destinationAccountId, [{ ...original, direction: "incoming" }]);

  const corrected = await workspace.request("PATCH", transferUrl, { ...input, amount: "1800", date: "2026-11-08" });
  assert.equal(corrected.statusCode, 200, corrected.body);
  const updated = { ...original, amount: "1800.00", date: "2026-11-08" };
  assert.deepEqual(corrected.json(), updated);
  await expectOverview({ [sourceAccountId]: "1200.00", [destinationAccountId]: "1800.00", [finalDestination]: "0.00" });
  await expectHistory(sourceAccountId, [{ ...updated, direction: "outgoing" }]);
  await expectHistory(destinationAccountId, [{ ...updated, direction: "incoming" }]);

  const moved = await workspace.request("PATCH", transferUrl, { ...input, amount: updated.amount, date: updated.date, destinationAccountId: finalDestination });
  assert.equal(moved.statusCode, 200, moved.body);
  const rejected = await workspace.request("PATCH", transferUrl, { ...input, destinationAccountId: sourceAccountId.toUpperCase() });
  assert.equal(rejected.statusCode, 400, rejected.body);
  assert.equal(typeof rejected.json().fieldErrors.destinationAccountId, "string");
  await expectOverview({ [sourceAccountId]: "1200.00", [destinationAccountId]: "0.00", [finalDestination]: "1800.00" });
  await expectHistory(sourceAccountId, [{ ...updated, destinationAccountId: finalDestination, direction: "outgoing" }]);
  await expectHistory(destinationAccountId, []);
  await expectHistory(finalDestination, [{ ...updated, destinationAccountId: finalDestination, direction: "incoming" }]);
});

test("transfer validation and workspace rules preserve the saved transfer", {
  skip: !databaseUrl,
}, async ({ onTestFinished }) => {
  const workspace = await startWorkspace(onTestFinished);
  const other = await startWorkspace(onTestFinished);
  const sourceAccountId = await workspace.openAccount({ openingDate: "2026-11-02" });
  const destinationAccountId = await workspace.openAccount({ openingDate: "2026-11-04", openingBalance: "0" });
  const foreignAccountId = await other.openAccount();
  const input = { sourceAccountId, destinationAccountId, amount: "0.01", date: "2026-11-04" };

  const created = await workspace.request("POST", "/transfers", input);
  assert.equal(created.statusCode, 201, created.body);
  const url = `/transfers/${created.json().id}`;
  const historyUrl = `/financial-accounts/${sourceAccountId}/transactions?includeTransfers=true`;
  const overviewUrl = "/financial-accounts?view=overview";
  const originalOverview = (await workspace.request("GET", overviewUrl)).json();
  const originalHistory = (await workspace.request("GET", historyUrl)).json();

  for (const [method, endpoint] of [["POST", "/transfers"], ["PATCH", url]] as const) {
    for (const [field, value] of [
      ["sourceAccountId", "invalid"],
      ["destinationAccountId", sourceAccountId],
      ["date", "2026-11-31"],
      ["date", "2026-11-03"],
      ["amount", "0"],
      ["amount", "-0.01"],
      ["amount", "0.001"],
      ["amount", "1000000000000"],
    ] as const) {
      const response = await workspace.request(method, endpoint, { ...input, [field]: value });
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(typeof response.json().fieldErrors[field], "string", response.body);
    }
    for (const field of ["sourceAccountId", "destinationAccountId"] as const) {
      const response = await workspace.request(method, endpoint, { ...input, [field]: foreignAccountId });
      assert.equal(response.statusCode, 404, response.body);
      assert.equal(typeof response.json().fieldErrors[field], "string", response.body);
    }
  }
  assert.equal((await other.request("PATCH", url, { ...input, sourceAccountId: foreignAccountId })).statusCode, 404);
  assert.equal((await other.request("GET", historyUrl)).statusCode, 404);
  assert.deepEqual((await workspace.request("GET", overviewUrl)).json(), originalOverview);
  assert.deepEqual((await workspace.request("GET", historyUrl)).json(), originalHistory);

  const newSource = await workspace.openAccount({ name: "New source" });
  const moved = await workspace.request("PATCH", url, { ...input, sourceAccountId: newSource });
  assert.equal(moved.statusCode, 200, moved.body);
  assert.deepEqual((await workspace.request("GET", historyUrl)).json().transfers, []);
  const accounts = (await workspace.request("GET", overviewUrl)).json().accounts;
  assert.equal(accounts.find(({ id }: { id: string }) => id === sourceAccountId).balance, "3000.00");
  assert.equal(accounts.find(({ id }: { id: string }) => id === newSource).balance, "2999.99");
});

test("account activity dates, balances and history filters include both kinds of activity", {
  skip: !databaseUrl,
}, async ({ onTestFinished }) => {
  const workspace = await startWorkspace(onTestFinished);
  const sourceAccountId = await workspace.openAccount();
  const destinationAccountId = await workspace.openAccount({ name: "Brokerage", openingBalance: "0" });
  const income = await workspace.record(sourceAccountId, salary);
  const expense = await workspace.record(sourceAccountId, groceries);
  const input = { sourceAccountId, destinationAccountId, amount: "100", date: "2026-11-02" };
  const created = await workspace.request("POST", "/transfers", input);
  assert.equal(created.statusCode, 201, created.body);
  const outgoing = { ...created.json(), direction: "outgoing" };
  const historyPath = `/financial-accounts/${sourceAccountId}/transactions`;

  for (const [query, expected] of [
    ["", { transactions: [expense, income] }],
    ["?includeTransfers=true", { transactions: [expense, income], transfers: [outgoing] }],
    ["?includeTransfers=true&type=income", { transactions: [income], transfers: [] }],
    ["?includeTransfers=true&category=Food", { transactions: [expense], transfers: [] }],
    ["?includeTransfers=true&to=2026-11-02", { transactions: [], transfers: [outgoing] }],
    ["?includeTransfers=true&from=2026-11-03", { transactions: [expense, income], transfers: [] }],
  ] as const) {
    const response = await workspace.request("GET", historyPath + query);
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), expected);
  }

  const overviewUrl = "/financial-accounts?from=2026-11-01&to=2026-11-30";
  const overview = (await workspace.request("GET", overviewUrl)).json();
  assert.equal(overview.summary.netCashflow, "400.00");
  assert.equal(overview.summary.balance, "3400.00");
  assert.deepEqual(Object.fromEntries(
    overview.accounts.map(({ id, balance }: { id: string; balance: string }) => [id, balance]),
  ), { [sourceAccountId]: "3300.00", [destinationAccountId]: "100.00" });

  for (const [accountId, name, openingBalance] of [
    [sourceAccountId, "Savings", "3000"],
    [destinationAccountId, "Brokerage", "0"],
  ]) {
    const accountUrl = `/financial-accounts/${accountId}`;
    assert.equal((await workspace.request("PATCH", accountUrl, {
      name, openingBalance, openingDate: input.date,
    })).statusCode, 200);
    const rejected = await workspace.request("PATCH", accountUrl, {
      name: "Changed", openingBalance: "1", openingDate: "2026-11-03",
    });
    assert.equal(rejected.statusCode, 400, rejected.body);
    assert.match(rejected.json().openingDateError, /2026-11-02/);
    const deletion = await workspace.request("DELETE", accountUrl);
    assert.equal(deletion.statusCode, 409, deletion.body);
    assert.deepEqual(deletion.json(), { status: "linked_activity" });
    // A previously deployed API writes the account directly after checking only transactions.
    await assert.rejects(workspace.pool.query(
      "UPDATE finscope_private.financial_accounts SET opening_date = $1 WHERE owner_user_id = $2 AND id = $3",
      ["2026-11-03", workspace.ownerUserId, accountId],
    ), { code: "23514" });
    const saved = (await workspace.request("GET", overviewUrl)).json().accounts.find(({ id }: { id: string }) => id === accountId);
    assert.equal(saved.name, name);
    assert.equal(saved.openingDate, input.date);
    assert.equal(saved.earliestActivityDate, input.date);
    assert.equal(saved.openingBalance, openingBalance + ".00");
  }

  assert.deepEqual((await workspace.request("GET", historyPath + "?includeTransfers=true")).json().transfers, [outgoing]);
});

test("concurrent transfer writes preserve opening-date and account deletion invariants", {
  skip: !databaseUrl,
}, async ({ onTestFinished }) => {
  const workspace = await startWorkspace(onTestFinished);
  const sourceAccountId = await workspace.openAccount();
  const destinationAccountId = await workspace.openAccount({ name: "Brokerage", openingBalance: "0" });
  const input = { sourceAccountId, destinationAccountId, amount: "10", date: "2026-11-02" };
  const destinationUrl = `/financial-accounts/${destinationAccountId}`;
  const olderAccountWriter = await workspace.pool.connect();

  try {
    await olderAccountWriter.query("BEGIN");
    const { rows: [{ pid }] } = await olderAccountWriter.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    await olderAccountWriter.query(
      "UPDATE finscope_private.financial_accounts SET opening_date = $1 WHERE owner_user_id = $2 AND id = $3",
      ["2026-11-03", workspace.ownerUserId, destinationAccountId],
    );

    let finished = false;
    const recording = workspace.request("POST", "/transfers", input)
      .then((response) => {
        finished = true;
        return response;
      });
    const deadline = Date.now() + 2000;
    let waitedForOpeningDate = false;
    while (!finished && Date.now() < deadline) {
      const blocked = await workspace.pool.query(
        "SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [pid],
      );
      if (blocked.rowCount) {
        waitedForOpeningDate = true;
        break;
      }
      await delay(10);
    }
    await olderAccountWriter.query("COMMIT");

    const response = await recording;
    assert.equal(waitedForOpeningDate, true);
    assert.equal(response.statusCode, 400, response.body);
    assert.match(response.json().fieldErrors.date, /2026-11-03/);
  } finally {
    olderAccountWriter.release(true);
  }

  const [recorded, deleted] = await Promise.all([
    workspace.request("POST", "/transfers", { ...input, date: "2026-11-03" }),
    workspace.request("DELETE", destinationUrl),
  ]);
  assert.deepEqual([recorded.statusCode, deleted.statusCode], recorded.statusCode === 201 ? [201, 409] : [404, 204]);
  const remaining = await workspace.request("GET", `/financial-accounts/${sourceAccountId}/transactions?includeTransfers=true`);
  assert.equal(remaining.statusCode, 200, remaining.body);
  assert.deepEqual(remaining.json().transfers, recorded.statusCode === 201
    ? [{ ...recorded.json(), direction: "outgoing" }] : []);
});
