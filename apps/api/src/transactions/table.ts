import { pgSchema, date, numeric, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { expenseCategories, incomeCategories, transactionTypes } from "@finscope/contracts/transactions";

export const transactions = pgSchema("finscope_private").table("transactions", {
  id: uuid().defaultRandom().primaryKey(),
  ownerUserId: uuid("owner_user_id").notNull(),
  accountId: uuid("account_id").notNull(),
  type: text({ enum: transactionTypes }).notNull(),
  amount: numeric({ precision: 14, scale: 2 }).notNull(),
  date: date().notNull(),
  category: text({ enum: [...incomeCategories, ...expenseCategories] }).notNull(),
  description: text(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
