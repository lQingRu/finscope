import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { z } from "zod";
import { createApi } from "./app.ts";
import { configureTelemetry, flushTelemetry, reportError } from "./telemetry.ts";

const envSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, hostname: /./ }),
  CORS_ORIGIN: z
    .url({ protocol: /^https?$/ })
    .refine((value) => URL.parse(value)?.origin === value),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SENTRY_DSN: z.union([z.url({ protocol: /^https?$/ }), z.literal("")]).optional(),
  NODE_ENV: z.string().default("development"),
  RELEASE: z.string().optional(),
  RENDER_GIT_COMMIT: z.string().optional(),
});

const env = envSchema.safeParse(process.env);
if (!env.success) {
  const fields = new Set(env.error.issues.map(({ path }) => path.join(".")));
  console.error("Invalid API environment variables: %s", Array.from(fields).join(", "));
  process.exit(1);
}

const config = env.data;
configureTelemetry({
  dsn: config.SENTRY_DSN,
  environment: config.NODE_ENV,
  release: config.RELEASE ?? config.RENDER_GIT_COMMIT,
});

const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 2_000,
  query_timeout: 2_500,
});
const db = drizzle(pool);

const api = await createApi({
  checkDatabase: async () => {
    await db.execute(sql`select 1`);
  },
  corsOrigin: config.CORS_ORIGIN,
  reportError,
});

pool.on("error", () => {
  api.log.warn("Idle PostgreSQL connection closed unexpectedly");
});

try {
  await api.listen({ host: "0.0.0.0", port: config.PORT });
} catch (error) {
  api.log.error("API startup failed");
  if (error instanceof Error) {
    reportError(error);
  }
  await pool.end();
  await flushTelemetry();
  process.exit(1);
}

async function shutDown() {
  try {
    await api.close();
    await pool.end();
  } catch (error) {
    api.log.error("API shutdown failed");
    if (error instanceof Error) {
      reportError(error);
    }
    process.exitCode = 1;
  } finally {
    await flushTelemetry();
  }
}

process.once("SIGINT", shutDown);
process.once("SIGTERM", shutDown);
