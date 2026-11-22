import { bigint, date, numeric, pgSchema, text, uuid } from "drizzle-orm/pg-core";

export const etfTrades = pgSchema("finscope_private").table("etf_trades", {
  id: uuid().defaultRandom().primaryKey(),
  ownerUserId: uuid("owner_user_id").notNull(),
  accountId: uuid("account_id").notNull(),
  entryOrder: bigint("entry_order", { mode: "bigint" }).generatedAlwaysAsIdentity(),
  ticker: text().notNull(),
  exchange: text().notNull(),
  type: text({ enum: ["buy", "sell"] }).notNull(),
  date: date().notNull(),
  quantity: numeric({ precision: 20, scale: 8 }).notNull(),
  executionPrice: numeric("execution_price", { precision: 20, scale: 8 }).notNull(),
  fee: numeric({ precision: 14, scale: 2 }).notNull(),
  purpose: text().notNull(),
  strategy: text().notNull(),
  tags: text().array().notNull(),
  notes: text().notNull(),
  grossAmount: numeric("gross_amount").notNull(),
  cashMovement: numeric("cash_movement").notNull(),
  costBasisChange: numeric("cost_basis_change").notNull(),
  realisedPnl: numeric("realised_pnl"),
});
