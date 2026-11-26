import { and, desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { withOwnerActivityWrite } from "../account-activity/activity-lock.ts";
import { readCashEntries, readKnownPortfolioCash } from "../account-activity/cash.repository.ts";
import { retainDeletedActivity } from "../audit/activity-deletions.ts";
import { accounts } from "../financial-accounts/table.ts";
import type { TradeAmounts } from "./accounting.ts";
import { etfTrades, tradeChronology } from "./table.ts";

export type TradeRow = typeof etfTrades.$inferSelect;
type TradeValues = Omit<typeof etfTrades.$inferInsert, "id" | "ownerUserId">;
type TradeContext = Pick<TradeRow, "purpose" | "strategy" | "tags" | "notes">;

function readPositions(db: Pick<NodePgDatabase, "select">, ownerUserId: string, accountId?: string) {
  return db.select({
    ticker: etfTrades.ticker,
    exchange: etfTrades.exchange,
    units: sql<string>`sum(case when ${etfTrades.type} = 'buy' then ${etfTrades.quantity} else -${etfTrades.quantity} end)`,
    cost: sql<string>`sum(${etfTrades.costBasisChange})`,
    fees: sql<string>`sum(${etfTrades.fee})`,
    realised: sql<string>`coalesce(sum(${etfTrades.realisedPnl}), 0)`,
  }).from(etfTrades).where(and(
    eq(etfTrades.ownerUserId, ownerUserId), accountId ? eq(etfTrades.accountId, accountId) : undefined,
  )).groupBy(etfTrades.accountId, etfTrades.ticker, etfTrades.exchange).orderBy(etfTrades.ticker, etfTrades.exchange);
}

function tradeScope(ownerUserId: string, accountId: string) {
  return and(eq(etfTrades.ownerUserId, ownerUserId), eq(etfTrades.accountId, accountId));
}

function tradeWrites(write: NodePgDatabase, ownerUserId: string) {
  const byId = (id: string) => and(eq(etfTrades.ownerUserId, ownerUserId), eq(etfTrades.id, id));

  return {
    async find(id: string): Promise<TradeRow | undefined> {
      const [current] = await write.select().from(etfTrades).where(byId(id));
      return current;
    },
    async lockAccount(accountId: string): Promise<Pick<typeof accounts.$inferSelect, "type" | "openingDate" | "openingBalance"> | undefined> {
      // Coordinate with account opening-date changes from older API versions.
      const [account] = await write.select({
        type: accounts.type, openingDate: accounts.openingDate, openingBalance: accounts.openingBalance,
      }).from(accounts).where(and(eq(accounts.ownerUserId, ownerUserId), eq(accounts.id, accountId))).for("share");
      return account;
    },
    async listTrades(accountId: string) {
      return write.select().from(etfTrades).where(tradeScope(ownerUserId, accountId)).orderBy(...tradeChronology());
    },
    readCashEntries: (accountId: string) => readCashEntries(write, ownerUserId, accountId),
    async updateContext(id: string, context: TradeContext) {
      const [row] = await write.update(etfTrades).set(context).where(byId(id)).returning();
      return row;
    },
    async updateAmounts(accountId: string, id: string, amounts: TradeAmounts) {
      await write.update(etfTrades).set(amounts)
        .where(and(tradeScope(ownerUserId, accountId), eq(etfTrades.id, id)));
    },
    async save(details: TradeValues, id?: string) {
      const values = { ...details, ownerUserId };
      const [row] = id
        ? await write.update(etfTrades).set(values).where(byId(id)).returning()
        : await write.insert(etfTrades).values(values).returning();
      return row;
    },
    async remove(id: string) {
      const [row] = await write.delete(etfTrades).where(byId(id)).returning();
      return row;
    },
    retainDeletion(row: TradeRow) {
      const record = { ...row, entryOrder: row.entryOrder.toString() };
      return retainDeletedActivity(write, "etf_trade", record);
    },
  };
}

export type EtfTradeWrites = ReturnType<typeof tradeWrites>;

export function createEtfTradeRepository(db: NodePgDatabase) {
  return {
    withWrite<T>(ownerUserId: string, run: (write: EtfTradeWrites) => Promise<T>) {
      return withOwnerActivityWrite(db, ownerUserId, (write) => run(tradeWrites(write, ownerUserId)));
    },
    async readHoldingsSnapshot(ownerUserId: string, accountId: string) {
      return db.transaction(async (snapshot) => {
        const scope = and(eq(accounts.ownerUserId, ownerUserId), eq(accounts.id, accountId), eq(accounts.type, "brokerage"));
        const [account] = await snapshot.select({ id: accounts.id }).from(accounts).where(scope);
        if (!account) return undefined;

        const positions = await readPositions(snapshot, ownerUserId, accountId);
        const rows = await snapshot.select().from(etfTrades)
          .where(tradeScope(ownerUserId, accountId))
          .orderBy(...tradeChronology(desc));
        return { positions, trades: rows };
      }, { isolationLevel: "repeatable read", accessMode: "read only" });
    },
    async readPortfolioSnapshot(ownerUserId: string) {
      return db.transaction(async (snapshot) => {
        const positions = await readPositions(snapshot, ownerUserId);
        const cash = await readKnownPortfolioCash(snapshot, ownerUserId);
        return { positions, cash };
      }, { isolationLevel: "repeatable read", accessMode: "read only" });
    },
  };
}

export type EtfTradeRepository = ReturnType<typeof createEtfTradeRepository>;
