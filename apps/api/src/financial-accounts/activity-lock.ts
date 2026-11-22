import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export async function lockOwnerActivity(write: Pick<NodePgDatabase, "execute">, ownerUserId: string) {
  // Coordinate date checks and deletion across all API processes for this workspace.
  await write.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ownerUserId}::text, 20261122))`);
}
