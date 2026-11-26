import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { healthResponses } from "@finscope/contracts/health";
import { test } from "vitest";
import { z } from "zod";
import { createApi } from "../src/app/create-api.ts";

test("GET /health reports ready when PostgreSQL responds", async ({ onTestFinished }) => {
  const app = await createApi({
    checkDatabase: async () => {},
    corsOrigin: "https://finscope.pages.dev",
    reportError: () => {},
  });
  onTestFinished(() => app.close());

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

test("GET /health returns a sanitized 503 when PostgreSQL is unavailable", async ({ onTestFinished }) => {
  const app = await createApi({
    checkDatabase: async () => {
      throw new Error("database password is sensitive");
    },
    corsOrigin: "https://finscope.pages.dev",
    reportError: () => {},
  });
  onTestFinished(() => app.close());

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

test("OpenAPI documents the health response schemas", async () => {
  const spec = JSON.parse(await readFile(new URL("../../../docs/openapi.json", import.meta.url), "utf8"));
  const responses = spec.paths["/health"].get.responses;

  for (const [status, schema] of Object.entries(healthResponses)) {
    assert.deepEqual(
      responses[status].content["application/json"].schema,
      z.toJSONSchema(schema, { target: "openapi-3.0" }),
    );
  }
});
