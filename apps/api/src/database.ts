import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";

export async function migrateDatabase(pool: Pool) {
  const client = await pool.connect();
  try {
    // Hold a session lock for the ledger and DDL across overlapping API startups.
    await client.query("SELECT pg_advisory_lock(7416050230193::bigint)");
    await migrate(drizzle(client), {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
      migrationsSchema: "finscope_private",
    });
  } finally {
    // Closing this connection releases the lock even when the migration fails.
    client.release(true);
  }
}
