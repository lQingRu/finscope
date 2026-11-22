import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { z } from "zod";
import { createApi } from "./app.ts";
import { migrateDatabase } from "./database.ts";
import { createOwnerAuthorizer } from "./financial-accounts/authorization.ts";
import { createFinancialAccountRepository } from "./financial-accounts/repository.ts";
import { configureTelemetry, flushTelemetry, reportError } from "./telemetry.ts";
import { createTransferRepository } from "./transfers/repository.ts";

const envSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, hostname: /./ }),
  CORS_ORIGIN: z
    .url({ protocol: /^https?$/ })
    .refine((value) => URL.parse(value)?.origin === value),
  SUPABASE_URL: z.url({ protocol: /^https$/ }).refine((value) => URL.parse(value)?.origin === value),
  SUPABASE_PUBLISHABLE_KEY: z.string().regex(/^sb_publishable_[a-zA-Z0-9_-]+$/),
  FINSCOPE_OWNER_USER_ID: z.uuid().toLowerCase(),
  FINSCOPE_OWNER_GOOGLE_SUB: z.string().regex(/^[0-9]+$/),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SENTRY_DSN: z.union([
    z.url({ protocol: /^https?$/, normalize: true }).refine((value) => {
      const dsn = URL.parse(value);
      return (
        dsn !== null &&
        /^\w+$/.test(dsn.username) &&
        /^\w*$/.test(dsn.password) &&
        /\/\d+$/.test(dsn.pathname) &&
        !dsn.search &&
        !dsn.hash
      );
    }),
    z.literal(""),
  ]).optional(),
  RENDER: z.string().optional(),
  NODE_ENV: z.string().default("development"),
  RELEASE: z.string().optional(),
  RENDER_GIT_COMMIT: z.string().optional(),
}).refine((config) => config.RENDER !== "true" || Boolean(config.SENTRY_DSN), {
  path: ["SENTRY_DSN"],
});

const env = envSchema.safeParse(process.env);
if (!env.success) {
  const fields = new Set(env.error.issues.map(({ path }) => path.join(".")));
  console.error("Invalid API environment variables: %s", Array.from(fields).join(", "));
  process.exit(1);
}

const config = env.data;
if (config.SENTRY_DSN) {
  const configured = configureTelemetry({
    dsn: config.SENTRY_DSN,
    environment: config.NODE_ENV,
    release: config.RELEASE ?? config.RENDER_GIT_COMMIT,
  });
  if (!configured) {
    console.error("Could not configure Sentry with SENTRY_DSN");
    process.exit(1);
  }
}

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
  accounts: {
    authorize: createOwnerAuthorizer({
      supabaseUrl: config.SUPABASE_URL,
      supabasePublishableKey: config.SUPABASE_PUBLISHABLE_KEY,
      ownerUserId: config.FINSCOPE_OWNER_USER_ID,
      ownerGoogleSubject: config.FINSCOPE_OWNER_GOOGLE_SUB,
    }),
    repository: createFinancialAccountRepository(db),
    transferRepository: createTransferRepository(db),
  },
  corsOrigin: config.CORS_ORIGIN,
  reportError,
});

pool.on("error", () => {
  api.log.warn("Idle PostgreSQL connection closed unexpectedly");
});

try {
  await migrateDatabase(pool);
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
