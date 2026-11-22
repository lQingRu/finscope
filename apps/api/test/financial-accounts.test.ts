import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { correctFinancialAccount, currentSingaporeMonth, openFinancialAccount } from "@finscope/contracts/financial-accounts";
import { test, vi } from "vitest";
import { createApi } from "../src/app.ts";
import { createOwnerAuthorizer } from "../src/financial-accounts/authorization.ts";

const ownerUserId = "3f2e88dc-5439-44b8-9d4d-4ef801e47781";
const ownerGoogleSubject = "123456789012345678901";
const anotherUserId = "7ef58723-a18a-47c5-bb72-3597c1918cf5";

function providerUser(id: string, providerId: string) {
  return {
    id,
    identities: [{
      id: providerId,
      identity_id: "15d277d9-fce2-4936-9b36-ee6f6fccae62",
      user_id: id,
      provider: "google",
    }],
  };
}

const openingAccount = {
  name: "Savings",
  type: "bank",
  currency: "SGD",
  openingDate: "2026-11-19",
  openingBalance: "3000.00",
};

test("direct reads and writes reject missing and unverified tokens and another Google identity", async ({ onTestFinished }) => {
  const authorize = createOwnerAuthorizer({
    supabaseUrl: "https://project.example",
    supabasePublishableKey: "sb_publishable_test",
    ownerUserId,
    ownerGoogleSubject,
  }, async (resource, options) => {
    assert.equal(String(resource), "https://project.example/auth/v1/user");
    const headers = new Headers(options?.headers);
    assert.equal(headers.get("apikey"), "sb_publishable_test");
    switch (headers.get("authorization")) {
      case "Bearer another.token.signature":
        return Response.json(providerUser(anotherUserId, "987654321098765432109"));
      case "Bearer linked.token.signature":
        return Response.json(providerUser(ownerUserId, "987654321098765432109"));
      default:
        return new Response(null, { status: 401 });
    }
  });
  const app = await createApi({
    checkDatabase: async () => {},
    corsOrigin: "https://finscope.pages.dev",
    reportError: assert.fail,
    accounts: {
      authorize,
      transferRepository: {
        recordTransfer: async () => assert.fail("Unexpected transfer reached storage"),
        correctTransfer: async () => assert.fail("Unexpected transfer correction reached storage"),
      },
      repository: {
        listTransactions: async () => assert.fail("Unexpected transaction history reached storage"),
        correctTransaction: async () => assert.fail("Unexpected transaction correction reached storage"),
        recordTransaction: async () => assert.fail("Unexpected transaction reached storage"),
        delete: async () => assert.fail("Unexpected deletion reached storage"),
        list: async () => assert.fail("Unauthorized request reached storage"),
        open: async () => assert.fail("Unauthorized request reached storage"),
        correct: async () => assert.fail("Unauthorized request reached storage"),
      },
    },
  });
  onTestFinished(() => app.close());

  for (const [authorization, status] of [
    [undefined, 401],
    ["Bearer forged.token.signature", 401],
    ["Bearer another.token.signature", 403],
    ["Bearer linked.token.signature", 403],
  ] as const) {
    const headers = authorization ? { authorization } : {};
    const read = await app.inject({ method: "GET", url: "/financial-accounts", headers });
    const write = await app.inject({
      method: "POST",
      url: "/financial-accounts",
      headers,
      payload: openingAccount,
    });
    const removal = await app.inject({
      method: "DELETE",
      url: "/financial-accounts/b13ea6d0-f915-4d8d-9998-48084e0cd60d",
      headers,
    });
    for (const [method, url] of [
      ["GET", "/financial-accounts/b13ea6d0-f915-4d8d-9998-48084e0cd60d/transactions"],
      ["GET", "/financial-accounts/b13ea6d0-f915-4d8d-9998-48084e0cd60d/transactions?includeTransfers=true"],
      ["POST", "/transfers"],
      ["PATCH", "/transfers/b13ea6d0-f915-4d8d-9998-48084e0cd60d"],
      ["POST", "/transactions"],
      ["PATCH", "/transactions/b13ea6d0-f915-4d8d-9998-48084e0cd60d"],
    ] as const) {
      const response = await app.inject({ method, url, headers });
      assert.equal(response.statusCode, status);
      assert.equal(response.headers["cache-control"], "no-store");
    }
    assert.equal(removal.statusCode, status);
    const correction = await app.inject({
      method: "PATCH",
      url: "/financial-accounts/b13ea6d0-f915-4d8d-9998-48084e0cd60d",
      headers,
      payload: { name: "Emergency savings", openingDate: "2026-11-18", openingBalance: "3250" },
    });
    assert.equal(correction.statusCode, status);
    assert.equal(correction.headers["cache-control"], "no-store");
    assert.equal(read.statusCode, status);
    assert.equal(read.headers["cache-control"], "no-store");
    assert.equal(write.statusCode, status);
    assert.equal(write.headers["cache-control"], "no-store");
  }
});

test("an owner can correct an account in place and see the new opening balance after an API restart", {
  skip: !process.env.FINSCOPE_TEST_DATABASE_URL,
}, async ({ onTestFinished }) => {
  const { randomUUID } = await import("node:crypto");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { Pool } = await import("pg");
  const { migrateDatabase } = await import("../src/database.ts");
  const { createFinancialAccountRepository } = await import("../src/financial-accounts/repository.ts");
  const { createTransferRepository } = await import("../src/transfers/repository.ts");
  const workspaceOwner = randomUUID();
  function sessionHeaders(userId: string) {
    const token = `test.${Buffer.from(JSON.stringify({
      sub: userId,
      aud: "authenticated",
      role: "authenticated",
      amr: [{ method: "oauth" }],
    })).toString("base64url")}.signature`;
    return { authorization: `Bearer ${token}`, origin: "https://finscope.pages.dev" };
  }

  const headers = sessionHeaders(workspaceOwner);

  async function startApi(userId = workspaceOwner) {
    const pool = new Pool({ connectionString: process.env.FINSCOPE_TEST_DATABASE_URL });
    onTestFinished(() => pool.end());
    await migrateDatabase(pool);
    const authorize = createOwnerAuthorizer({
      supabaseUrl: "https://project.example",
      supabasePublishableKey: "sb_publishable_test",
      ownerUserId: userId,
      ownerGoogleSubject,
    }, async () => Response.json(providerUser(userId, ownerGoogleSubject)));

    const db = drizzle(pool);
    const repository = createFinancialAccountRepository(db);
    const app = await createApi({
      checkDatabase: async () => {},
      corsOrigin: "https://finscope.pages.dev",
      reportError: assert.fail,
      accounts: { authorize, repository, transferRepository: createTransferRepository(db) },
    });
    onTestFinished(() => app.close());
    return { app, repository };
  }

  const { app: first, repository } = await startApi();
  const brokerage = {
    name: "Brokerage",
    type: "brokerage",
    currency: "SGD",
    openingDate: "2026-11-20",
    openingBalance: "0",
  };
  const invalid = await first.inject({
    method: "POST",
    url: "/financial-accounts",
    headers,
    payload: { ...openingAccount, openingBalance: "3000.001" },
  });
  assert.equal(invalid.statusCode, 400);

  const ids: string[] = [];
  for (const payload of [openingAccount, brokerage]) {
    const response = await first.inject({ method: "POST", url: "/financial-accounts", headers, payload });
    assert.equal(response.statusCode, 201);
    ids.push(response.json().id);
  }
  const correction = await first.inject({
    method: "PATCH",
    url: `/financial-accounts/${ids[0]}`,
    headers,
    payload: { name: "  Emergency savings  ", openingDate: "2026-11-18", openingBalance: "3250" },
  });
  assert.equal(correction.statusCode, 200);
  const corrected = {
    ...openingAccount,
    id: ids[0],
    name: "Emergency savings",
    openingDate: "2026-11-18",
    openingBalance: "3250.00",
  };
  assert.deepEqual(correction.json(), corrected);
  const withImmutableFields = { ...corrected, id: randomUUID(), ownerUserId: randomUUID(), type: "brokerage" };
  assert.deepEqual(await repository.correct(workspaceOwner, ids[0], withImmutableFields), { status: "saved", account: corrected });

  const rejectedCorrection = await first.inject({
    method: "PATCH",
    url: `/financial-accounts/${ids[0]}`,
    headers,
    payload: { name: "Future savings", openingDate: "9999-12-31", openingBalance: "4000.00" },
  });
  assert.equal(rejectedCorrection.statusCode, 400);
  await first.close();

  const otherUserId = randomUUID();
  const { app: otherWorkspace } = await startApi(otherUserId);
  const otherCorrection = await otherWorkspace.inject({
    method: "PATCH",
    url: `/financial-accounts/${ids[0]}`,
    headers: sessionHeaders(otherUserId),
    payload: { name: "Other workspace", openingDate: "2026-11-18", openingBalance: "0" },
  });
  assert.equal(otherCorrection.statusCode, 404);
  assert.deepEqual(otherCorrection.json(), { status: "not_found" });
  const removalUrl = `/financial-accounts/${ids[0]}`;
  const foreignRemoval = await otherWorkspace.inject({
    method: "DELETE", url: removalUrl, headers: sessionHeaders(otherUserId),
  });
  assert.equal(foreignRemoval.statusCode, 404);


  const { app: second } = await startApi();
  const response = await second.inject({ method: "GET", url: "/financial-accounts?view=overview", headers });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    accounts: [
      { ...corrected, balance: "3250.00", earliestActivityDate: null },
      { ...brokerage, id: ids[1], openingBalance: "0.00", balance: "0.00", earliestActivityDate: null },
    ],
    summary: { currency: "SGD", balance: "3250.00", income: "0.00", expenses: "0.00", netCashflow: "0.00", ...currentSingaporeMonth() },
  });
  const remove = () => second.inject({ method: "DELETE", url: removalUrl, headers });
  assert.equal((await remove()).statusCode, 204);
  assert.equal((await remove()).statusCode, 404);
  const afterRemoval = await second.inject({ method: "GET", url: "/financial-accounts?view=overview", headers });
  assert.deepEqual(afterRemoval.json(), {
    accounts: [{ ...brokerage, id: ids[1], openingBalance: "0.00", balance: "0.00", earliestActivityDate: null }],
    summary: { currency: "SGD", balance: "0.00", income: "0.00", expenses: "0.00", netCashflow: "0.00", ...currentSingaporeMonth() },
  });

});

test("opening and correcting accounts use the Singapore calendar date", async ({ onTestFinished }) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-19T16:10:00.000Z"));
  onTestFinished(() => { vi.useRealTimers(); });

  const accountId = "b13ea6d0-f915-4d8d-9998-48084e0cd60d";
  const app = await createApi({
    checkDatabase: async () => {},
    corsOrigin: "https://finscope.pages.dev",
    reportError: assert.fail,
    accounts: {
      authorize: async () => ({ status: "authorized", ownerUserId }),
      transferRepository: {
        recordTransfer: async () => assert.fail("Unexpected transfer reached storage"),
        correctTransfer: async () => assert.fail("Unexpected transfer correction reached storage"),
      },
      repository: {
        listTransactions: async () => assert.fail("Unexpected transaction history reached storage"),
        correctTransaction: async () => assert.fail("Unexpected transaction correction reached storage"),
        recordTransaction: async () => assert.fail("Unexpected transaction reached storage"),
        delete: async () => assert.fail("Unexpected deletion reached storage"),
        list: async () => assert.fail("Unexpected list reached storage"),
        open: async (_owner, input) => ({ ...input, id: accountId }),
        correct: async (_owner, id, input) => ({ status: "saved", account: { ...openingAccount, ...input, id, type: "bank", currency: "SGD" } }),
      },
    },
  });
  onTestFinished(() => app.close());

  const corrected = { name: "Savings", openingBalance: "3000.00" };
  for (const [method, url, fields, successStatus] of [
    ["POST", "/financial-accounts", openingAccount, 201],
    ["PATCH", `/financial-accounts/${accountId}`, corrected, 200],
  ] as const) {
    for (const openingDate of ["0001-01-01", "2026-11-19", "2026-11-20"]) {
      const response = await app.inject({ method, url, payload: { ...fields, openingDate } });
      assert.equal(response.statusCode, successStatus);
      assert.equal(response.json().openingDate, openingDate);
    }
    for (const openingDate of ["0000-02-29", "2026-11-21", "2026-11-31"]) {
      const response = await app.inject({ method, url, payload: { ...fields, openingDate } });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().status, "invalid_request");
      assert.match(response.json().openingDateError, /opening date/i);
    }
  }
});

test("OpenAPI reflects the account name and calendar date validation", async () => {
  const spec = JSON.parse(await readFile(new URL("../../../docs/openapi.json", import.meta.url), "utf8"));
  const correction = { name: "Savings", openingBalance: "3000.00", openingDate: "2000-01-01" };
  for (const [key, schema, input] of [
    ["OpenFinancialAccount", openFinancialAccount, { ...openingAccount, ...correction }],
    ["CorrectFinancialAccount", correctFinancialAccount, correction],
  ] as const) {
    const fields = spec.components.schemas[key].properties;
    for (const [field, values] of [
      ["name", [" \t ", " A ", ` ${"A".repeat(100)} `, "A".repeat(101)]],
      ["openingDate", ["0000-02-29", "0001-01-01", "1900-02-29", "2000-02-29"]],
    ] as const) {
      const { pattern, minLength = 0, maxLength = Infinity } = fields[field];
      for (const value of values) {
        const documented = new RegExp(pattern).test(value) && value.length >= minLength && value.length <= maxLength;
        assert.equal(documented, schema.safeParse({ ...input, [field]: value }).success, `${key}.${field} ${JSON.stringify(value)}`);
      }
    }
  }
});

test("the web origin can send an authenticated account correction", async ({ onTestFinished }) => {
  const origin = "https://finscope.pages.dev";
  const app = await createApi({
    checkDatabase: async () => {},
    corsOrigin: origin,
    reportError: assert.fail,
  });
  onTestFinished(() => app.close());

  const preflight = await app.inject({
    method: "OPTIONS",
    url: "/financial-accounts/b13ea6d0-f915-4d8d-9998-48084e0cd60d",
    headers: {
      origin,
      "access-control-request-method": "PATCH",
      "access-control-request-headers": "authorization,content-type",
    },
  });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], origin);
  assert.match(String(preflight.headers["access-control-allow-methods"]), /\bPATCH\b/);
});
