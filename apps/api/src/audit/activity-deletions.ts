import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { jsonb, pgSchema, text, uuid } from "drizzle-orm/pg-core";

const activityDeletions = pgSchema("finscope_private").table("activity_deletions", {
  activityKind: text("activity_kind", { enum: ["transaction", "transfer"] }).notNull(),
  activityId: uuid("activity_id").notNull(),
  ownerUserId: uuid("owner_user_id").notNull(),
  record: jsonb().notNull(),
});

export async function retainDeletedActivity(
  write: Pick<NodePgDatabase, "insert">,
  activityKind: "transaction" | "transfer",
  record: { id: string; ownerUserId: string },
) {
  await write.insert(activityDeletions).values({
    activityKind,
    activityId: record.id,
    ownerUserId: record.ownerUserId,
    record,
  });
}
