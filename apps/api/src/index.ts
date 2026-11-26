import { composeApi } from "./app/compose.ts";
import { apiEnvSchema } from "./config/env.ts";
import { migrateDatabase } from "./infrastructure/postgres.ts";
import { configureTelemetry, flushTelemetry, reportError } from "./infrastructure/telemetry.ts";

const env = apiEnvSchema.safeParse(process.env);
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

const { api, pool } = await composeApi(config);

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
