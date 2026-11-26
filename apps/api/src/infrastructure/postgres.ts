import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export function connectPostgres(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 2_000,
    query_timeout: 2_500,
  });
  const db = drizzle(pool);

  return {
    pool,
    db,
    async checkDatabase() {
      await db.execute(sql`select 1`);
    },
  };
}

export async function migrateDatabase(pool: Pool) {
  const client = await pool.connect();
  try {
    // Hold a session lock for the ledger and DDL across overlapping API startups.
    await client.query("SELECT pg_advisory_lock(7416050230193::bigint)");
    await migrate(drizzle(client), {
      migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
      migrationsSchema: "finscope_private",
    });
  } finally {
    // Closing this connection releases the lock even when the migration fails.
    client.release(true);
  }
}
