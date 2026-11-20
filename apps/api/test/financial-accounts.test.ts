import assert from "node:assert/strict";
import { test } from "vitest";
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
      repository: {
        list: async () => assert.fail("Unauthorized request reached storage"),
        open: async () => assert.fail("Unauthorized request reached storage"),
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
    assert.equal(read.statusCode, status);
    assert.equal(read.headers["cache-control"], "no-store");
    assert.equal(write.statusCode, status);
    assert.equal(write.headers["cache-control"], "no-store");
  }
});

test("an owner can open dated SGD accounts that survive an API restart without creating income or expenses", {
  skip: !process.env.FINSCOPE_TEST_DATABASE_URL,
}, async ({ onTestFinished }) => {
  const { randomUUID } = await import("node:crypto");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { Pool } = await import("pg");
  const { migrateDatabase } = await import("../src/database.ts");
  const { createFinancialAccountRepository } = await import("../src/financial-accounts/repository.ts");
  const workspaceOwner = randomUUID();
  const token = `test.${Buffer.from(JSON.stringify({
    sub: workspaceOwner,
    aud: "authenticated",
    role: "authenticated",
    amr: [{ method: "oauth" }],
  })).toString("base64url")}.signature`;
  const headers = { authorization: `Bearer ${token}`, origin: "https://finscope.pages.dev" };

  async function startApi() {
    const pool = new Pool({ connectionString: process.env.FINSCOPE_TEST_DATABASE_URL });
    onTestFinished(() => pool.end());
    await migrateDatabase(pool);
    const authorize = createOwnerAuthorizer({
      supabaseUrl: "https://project.example",
      supabasePublishableKey: "sb_publishable_test",
      ownerUserId: workspaceOwner,
      ownerGoogleSubject,
    }, async () => Response.json(providerUser(workspaceOwner, ownerGoogleSubject)));

    const app = await createApi({
      checkDatabase: async () => {},
      corsOrigin: "https://finscope.pages.dev",
      reportError: assert.fail,
      accounts: { authorize, repository: createFinancialAccountRepository(drizzle(pool)) },
    });
    onTestFinished(() => app.close());
    return app;
  }

  const first = await startApi();
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
  await first.close();

  const second = await startApi();
  const response = await second.inject({ method: "GET", url: "/financial-accounts", headers });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    accounts: [
      { ...openingAccount, id: ids[0] },
      { ...brokerage, id: ids[1], openingBalance: "0.00" },
    ],
    summary: { currency: "SGD", balance: "3000.00", income: "0.00", expenses: "0.00" },
  });
});
