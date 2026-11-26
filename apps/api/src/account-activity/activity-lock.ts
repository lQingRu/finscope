import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

async function lockOwnerActivity(write: Pick<NodePgDatabase, "execute">, ownerUserId: string) {
  // Coordinate date checks and deletion across all API processes for this workspace.
  await write.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ownerUserId}::text, 20261122))`);
}

export function withOwnerActivityWrite<T>(db: NodePgDatabase, ownerUserId: string, run: (write: NodePgDatabase) => Promise<T>) {
  return db.transaction(async (write) => {
    await lockOwnerActivity(write, ownerUserId);
    return run(write);
  }, { isolationLevel: "read committed" });
}
