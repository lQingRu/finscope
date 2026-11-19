import assert from "node:assert/strict";
import { test } from "node:test";
import { createApi } from "../src/app.ts";

test("GET /health reports ready when PostgreSQL responds", async (context) => {
  const app = await createApi({
    checkDatabase: async () => {},
    corsOrigin: "https://finscope.pages.dev",
    reportError: () => {},
  });
  context.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/health",
    headers: { origin: "https://finscope.pages.dev" },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok" });
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["access-control-allow-origin"], "https://finscope.pages.dev");
});

test("GET /health returns a sanitized 503 when PostgreSQL is unavailable", async (context) => {
  const app = await createApi({
    checkDatabase: async () => {
      throw new Error("database password is sensitive");
    },
    corsOrigin: "https://finscope.pages.dev",
    reportError: () => {},
  });
  context.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/health",
    headers: { origin: "https://another.example" },
  });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { status: "unavailable" });
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["access-control-allow-origin"], undefined);
});
