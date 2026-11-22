import { date, numeric, pgSchema, timestamp, uuid } from "drizzle-orm/pg-core";

export const transfers = pgSchema("finscope_private").table("transfers", {
  id: uuid().defaultRandom().primaryKey(),
  ownerUserId: uuid("owner_user_id").notNull(),
  sourceAccountId: uuid("source_account_id").notNull(),
  destinationAccountId: uuid("destination_account_id").notNull(),
  amount: numeric({ precision: 14, scale: 2 }).notNull(),
  date: date().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
