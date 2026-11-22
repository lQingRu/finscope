import { tradeBeforeOpeningMessage } from "@finscope/contracts/etf-trades";
import type { BrokerageHoldings, EtfTrade, EtfTradeConflict, EtfTradeInput, PortfolioValuation } from "@finscope/contracts/etf-trades";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { retainDeletedActivity } from "../audit/activity-deletions.ts";
import { lockOwnerActivity } from "../financial-accounts/activity-lock.ts";
import { accounts } from "../financial-accounts/table.ts";
import { TradeDecimal, calculateTradeAmounts, tradeMoney } from "./accounting.ts";
import { readCashEntries, readKnownPortfolioValue, validateTradeFunding } from "./cash.ts";
import { etfTrades } from "./table.ts";

type TradeRow = typeof etfTrades.$inferSelect;

function presentTrade(row: TradeRow, latest: boolean): EtfTrade {
  const { id, accountId, ticker, exchange, type, date, quantity, executionPrice, fee, purpose, strategy, tags, notes,
    grossAmount, cashMovement, realisedPnl } = row;
  return {
    id, accountId, ticker, exchange, currency: "SGD", type, date,
    quantity: new TradeDecimal(quantity).toFixed(),
    executionPrice: tradeMoney(executionPrice), fee: tradeMoney(fee),
    purpose, strategy, tags, notes,
    grossAmount: tradeMoney(grossAmount), cashMovement: tradeMoney(cashMovement),
    realisedPnl: realisedPnl === null ? null : tradeMoney(realisedPnl),
    canChangeFinancialDetails: latest,
  };
}

type SaveResult =
  | { status: "saved"; trade: EtfTrade }
  | { status: "not_found" }
  | { status: "invalid_request"; fieldErrors: { accountId?: string; date?: string } }
  | EtfTradeConflict;

export type EtfTradeRepository = {
  recordTrade: (ownerUserId: string, input: EtfTradeInput) => Promise<SaveResult>;
  updateTrade: (ownerUserId: string, tradeId: string, input: EtfTradeInput) => Promise<SaveResult>;
  deleteTrade: (ownerUserId: string, tradeId: string) => Promise<"deleted" | "not_found" | EtfTradeConflict>;
  readHoldings: (ownerUserId: string, accountId: string) => Promise<BrokerageHoldings | undefined>;
  readPortfolio: (ownerUserId: string) => Promise<PortfolioValuation>;
};

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

const historical = {
  status: "historical_trade",
  message: "Financial details and deletion are available for the latest trade in this brokerage account.",
} as const;

function orderedTrades(db: Pick<NodePgDatabase, "select">, ownerUserId: string, accountId: string) {
  return db.select().from(etfTrades).where(tradeScope(ownerUserId, accountId))
    .orderBy(asc(etfTrades.date), asc(etfTrades.entryOrder));
}

function changesFinancialDetails(saved: TradeRow, input: EtfTradeInput) {
  return saved.type !== input.type || saved.date !== input.date
    || !new TradeDecimal(saved.quantity).eq(input.quantity)
    || !new TradeDecimal(saved.executionPrice).eq(input.executionPrice)
    || !new TradeDecimal(saved.fee).eq(input.fee);
}

export function createEtfTradeRepository(db: NodePgDatabase): EtfTradeRepository {
  async function saveTrade(ownerUserId: string, input: EtfTradeInput, tradeId?: string): Promise<SaveResult> {
    return db.transaction(async (write) => {
      await lockOwnerActivity(write, ownerUserId);
      const scope = tradeId && and(eq(etfTrades.ownerUserId, ownerUserId), eq(etfTrades.id, tradeId));
      const [current] = scope ? await write.select().from(etfTrades).where(scope) : [];
      if (scope && !current) return { status: "not_found" };

      const { currency, exchange = "", purpose = "", strategy = "", tags = [], notes = "", ...details } = input;
      const context = { purpose, strategy, tags, notes };
      if (current && (current.accountId !== details.accountId || current.ticker !== details.ticker || current.exchange !== exchange)) {
        return { status: "invalid_request", fieldErrors: { accountId: "The brokerage account and ETF of a saved trade cannot change." } };
      }
      // Coordinate with account opening-date changes from older API versions.
      const [account] = await write.select({
        type: accounts.type, openingDate: accounts.openingDate, openingBalance: accounts.openingBalance,
      }).from(accounts).where(and(eq(accounts.ownerUserId, ownerUserId), eq(accounts.id, input.accountId))).for("share");
      if (!account) return { status: "not_found" };
      if (account.type !== "brokerage") {
        return { status: "invalid_request", fieldErrors: { accountId: "Select an account that supports investment trading." } };
      }
      if (input.date < account.openingDate) {
        return { status: "invalid_request", fieldErrors: { date: tradeBeforeOpeningMessage(account.openingDate) } };
      }

      const existing = await orderedTrades(write, ownerUserId, input.accountId);
      if (current && scope) {
        const isLatest = existing.at(-1)?.id === current.id;
        if (!changesFinancialDetails(current, input)) {
          const [row] = await write.update(etfTrades).set(context).where(scope).returning();
          return { status: "saved", trade: presentTrade(row, isLatest) };
        }
        const prior = existing.at(-2);
        if (!isLatest || (prior && (input.date < prior.date || (input.date === prior.date && current.entryOrder < prior.entryOrder)))) {
          return historical;
        }
      }

      // Stable sorting keeps an ordinary same-day entry after saved trades.
      const pending = { ...details, ownerUserId, exchange, ...context };
      const ordered: Array<TradeRow | typeof pending> = [...existing.filter(({ id }) => id !== tradeId), pending]
        .sort((first, second) => first.date.localeCompare(second.date));
      const result = calculateTradeAmounts(ordered);
      if (result.status !== "calculated") return result;

      const cashEntries = await readCashEntries(write, ownerUserId, input.accountId);
      const fundingError = validateTradeFunding(account.openingBalance, cashEntries,
        ordered.map((trade, index) => ({ ...trade, cashMovement: result.amounts[index].cashMovement })));
      if (fundingError) return fundingError;

      const pendingIndex = ordered.indexOf(pending);
      for (const [index, trade] of ordered.entries()) {
        if (!("id" in trade)) continue;
        const amounts = result.amounts[index];
        if (trade.costBasisChange === amounts.costBasisChange && trade.realisedPnl === amounts.realisedPnl) continue;
        await write.update(etfTrades).set(amounts)
          .where(and(tradeScope(ownerUserId, input.accountId), eq(etfTrades.id, trade.id)));
      }
      const values = { ...pending, ...result.amounts[pendingIndex] };
      const [row] = scope
        ? await write.update(etfTrades).set(values).where(scope).returning()
        : await write.insert(etfTrades).values(values).returning();
      return { status: "saved", trade: presentTrade(row, pendingIndex === ordered.length - 1) };
    }, { isolationLevel: "read committed" });
  }

  return {
    recordTrade: (ownerUserId, input) => saveTrade(ownerUserId, input),
    updateTrade: (ownerUserId, tradeId, input) => saveTrade(ownerUserId, input, tradeId),
    async deleteTrade(ownerUserId, tradeId) {
      return db.transaction(async (write) => {
        await lockOwnerActivity(write, ownerUserId);
        const scope = and(eq(etfTrades.ownerUserId, ownerUserId), eq(etfTrades.id, tradeId));
        const [current] = await write.select().from(etfTrades).where(scope);
        if (!current) return "not_found";

        const existing = await orderedTrades(write, ownerUserId, current.accountId);
        if (existing.at(-1)?.id !== tradeId) return historical;

        const [deleted] = await write.delete(etfTrades).where(scope).returning();
        const record = { ...deleted, entryOrder: deleted.entryOrder.toString() };
        await retainDeletedActivity(write, "etf_trade", record);
        return "deleted";
      }, { isolationLevel: "read committed" });
    },
    async readHoldings(ownerUserId, accountId) {
      return db.transaction(async (snapshot) => {
        const scope = and(eq(accounts.ownerUserId, ownerUserId), eq(accounts.id, accountId), eq(accounts.type, "brokerage"));
        const [account] = await snapshot.select({ id: accounts.id }).from(accounts).where(scope);
        if (!account) return undefined;

        const positions = await readPositions(snapshot, ownerUserId, accountId);
        const rows = await snapshot.select().from(etfTrades)
          .where(tradeScope(ownerUserId, accountId))
          .orderBy(desc(etfTrades.date), desc(etfTrades.entryOrder));
        return {
          holdings: positions.map(({ ticker, exchange, units, cost, fees, realised }) => {
            const amount = new TradeDecimal(units);
            const open = amount.gt(0);
            return {
              ticker, exchange, currency: "SGD", units: amount.toFixed(), costBasis: tradeMoney(cost),
              averageCost: open ? tradeMoney(new TradeDecimal(cost).dividedBy(amount).toDecimalPlaces(16)) : null,
              fees: tradeMoney(fees), realisedPnl: tradeMoney(realised),
              valuation: open ? "awaiting_price" : "closed",
              marketValue: open ? null : "0.00", unrealisedPnl: open ? null : "0.00",
            };
          }),
          trades: rows.map((row, index) => presentTrade(row, index === 0)),
        };
      }, { isolationLevel: "repeatable read", accessMode: "read only" });
    },
    async readPortfolio(ownerUserId) {
      return db.transaction(async (snapshot) => {
        const positions = await readPositions(snapshot, ownerUserId);
        const unpricedHoldings = positions.filter(({ units }) => new TradeDecimal(units).gt(0)).length;
        const knownSubtotal = await readKnownPortfolioValue(snapshot, ownerUserId);
        return { currency: "SGD", valuation: unpricedHoldings ? "partial" : "complete", knownSubtotal, unpricedHoldings };
      }, { isolationLevel: "repeatable read", accessMode: "read only" });
    },
  };
}
