import type { FinancialAccount } from "@finscope/contracts/financial-accounts";
import { asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { date, numeric, pgSchema, text, uuid, varchar } from "drizzle-orm/pg-core";
import type { FinancialAccountRepository } from "./routes.ts";

const accounts = pgSchema("finscope_private").table("financial_accounts", {
  id: uuid().defaultRandom().primaryKey(),
  ownerUserId: uuid("owner_user_id").notNull(),
  name: varchar({ length: 100 }).notNull(),
  type: text({ enum: ["bank", "brokerage"] }).notNull(),
  openingDate: date("opening_date").notNull(),
  openingBalance: numeric("opening_balance", { precision: 14, scale: 2 }).notNull(),
});

const publicColumns = {
  id: accounts.id,
  name: accounts.name,
  type: accounts.type,
  openingDate: accounts.openingDate,
  openingBalance: accounts.openingBalance,
};

export function createFinancialAccountRepository(db: NodePgDatabase): FinancialAccountRepository {
  return {
    async list(ownerUserId) {
      const rows = await db.select(publicColumns).from(accounts)
        .where(eq(accounts.ownerUserId, ownerUserId))
        .orderBy(asc(accounts.openingDate), asc(accounts.name), asc(accounts.id));
      return rows.map((row): FinancialAccount => ({ ...row, currency: "SGD" }));
    },
    async open(ownerUserId, { name, type, openingDate, openingBalance }) {
      const [row] = await db.insert(accounts).values({
        ownerUserId, name, type, openingDate, openingBalance,
      }).returning(publicColumns);
      return { ...row, currency: "SGD" };
    },
  };
}
