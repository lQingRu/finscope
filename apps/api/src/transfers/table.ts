import { and, eq, or } from "drizzle-orm";
import { date, numeric, pgSchema, timestamp, uuid } from "drizzle-orm/pg-core";
import type { accounts } from "../financial-accounts/table.ts";

export const transfers = pgSchema("finscope_private").table("transfers", {
  id: uuid().defaultRandom().primaryKey(),
  ownerUserId: uuid("owner_user_id").notNull(),
  sourceAccountId: uuid("source_account_id").notNull(),
  destinationAccountId: uuid("destination_account_id").notNull(),
  amount: numeric({ precision: 14, scale: 2 }).notNull(),
  date: date().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const transferColumns = {
  id: transfers.id,
  sourceAccountId: transfers.sourceAccountId,
  destinationAccountId: transfers.destinationAccountId,
  amount: transfers.amount,
  date: transfers.date,
};

export function linkedTransfers(ownerUserId: string | typeof accounts.ownerUserId, accountId: string | typeof accounts.id) {
  return and(
    eq(transfers.ownerUserId, ownerUserId),
    or(eq(transfers.sourceAccountId, accountId), eq(transfers.destinationAccountId, accountId)),
  );
}
