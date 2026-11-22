import { date, numeric, pgSchema, text, uuid, varchar } from "drizzle-orm/pg-core";

export const accounts = pgSchema("finscope_private").table("financial_accounts", {
  id: uuid().defaultRandom().primaryKey(),
  ownerUserId: uuid("owner_user_id").notNull(),
  name: varchar({ length: 100 }).notNull(),
  type: text({ enum: ["bank", "brokerage"] }).notNull(),
  openingDate: date("opening_date").notNull(),
  openingBalance: numeric("opening_balance", { precision: 14, scale: 2 }).notNull(),
});
