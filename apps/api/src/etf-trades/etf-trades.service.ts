import { tradeBeforeOpeningMessage } from "@finscope/contracts/etf-trades";
import type { BrokerageHoldings, EtfTrade, EtfTradeConflict, EtfTradeInput, PortfolioValuation } from "@finscope/contracts/etf-trades";
import { validateTradeFunding } from "../account-activity/trade-funding.service.ts";
import { SgdDecimal, formatSgd } from "../sgd.ts";
import { calculateTradeAmounts, summarizeHolding } from "./accounting.ts";
import type { EtfTradeRepository, TradeRow } from "./etf-trades.repository.ts";

function presentTrade(row: TradeRow, latest: boolean): EtfTrade {
  const { id, accountId, ticker, exchange, type, date, quantity, executionPrice, fee, purpose, strategy, tags, notes,
    grossAmount, cashMovement, realisedPnl } = row;
  return {
    id, accountId, ticker, exchange, currency: "SGD", type, date,
    quantity: new SgdDecimal(quantity).toFixed(),
    executionPrice: formatSgd(executionPrice), fee: formatSgd(fee),
    purpose, strategy, tags, notes,
    grossAmount: formatSgd(grossAmount), cashMovement: formatSgd(cashMovement),
    realisedPnl: realisedPnl === null ? null : formatSgd(realisedPnl),
    canChangeFinancialDetails: latest,
  };
}

type SaveResult =
  | { status: "saved"; trade: EtfTrade }
  | { status: "not_found" }
  | { status: "invalid_request"; fieldErrors: { accountId?: string; date?: string } }
  | EtfTradeConflict;

const historical = {
  status: "historical_trade",
  message: "Financial details and deletion are available for the latest trade in this brokerage account.",
} as const;

function changesFinancialDetails(saved: TradeRow, input: EtfTradeInput) {
  return saved.type !== input.type || saved.date !== input.date
    || !new SgdDecimal(saved.quantity).eq(input.quantity)
    || !new SgdDecimal(saved.executionPrice).eq(input.executionPrice)
    || !new SgdDecimal(saved.fee).eq(input.fee);
}

export function createEtfTradeService(repository: EtfTradeRepository) {
  function saveTrade(ownerUserId: string, input: EtfTradeInput, tradeId?: string) {
    return repository.withWrite<SaveResult>(ownerUserId, async (write) => {
      const current = tradeId ? await write.find(tradeId) : undefined;
      if (tradeId && !current) return { status: "not_found" };

      const { currency, exchange = "", purpose = "", strategy = "", tags = [], notes = "", ...details } = input;
      const context = { purpose, strategy, tags, notes };
      if (current && (current.accountId !== details.accountId || current.ticker !== details.ticker || current.exchange !== exchange)) {
        return { status: "invalid_request", fieldErrors: { accountId: "The brokerage account and ETF of a saved trade cannot change." } };
      }
      const account = await write.lockAccount(input.accountId);
      if (!account) return { status: "not_found" };
      if (account.type !== "brokerage") {
        return { status: "invalid_request", fieldErrors: { accountId: "Select an account that supports investment trading." } };
      }
      if (input.date < account.openingDate) {
        return { status: "invalid_request", fieldErrors: { date: tradeBeforeOpeningMessage(account.openingDate) } };
      }

      const existing = await write.listTrades(input.accountId);
      if (current && tradeId) {
        const isLatest = existing.at(-1)?.id === current.id;
        if (!changesFinancialDetails(current, input)) {
          const row = await write.updateContext(tradeId, context);
          return { status: "saved", trade: presentTrade(row, isLatest) };
        }
        const prior = existing.at(-2);
        if (!isLatest || (prior && (input.date < prior.date || (input.date === prior.date && current.entryOrder < prior.entryOrder)))) {
          return historical;
        }
      }

      // Stable sorting keeps an ordinary same-day entry after saved trades.
      const pending = { ...details, exchange, ...context };
      const ordered: Array<TradeRow | typeof pending> = [...existing.filter(({ id }) => id !== tradeId), pending]
        .sort((first, second) => first.date.localeCompare(second.date));
      const result = calculateTradeAmounts(ordered);
      if (result.status !== "calculated") return result;

      const cashEntries = await write.readCashEntries(input.accountId);
      const fundingError = validateTradeFunding(account.openingBalance, cashEntries,
        ordered.map((trade, index) => ({ ...trade, cashMovement: result.amounts[index].cashMovement })));
      if (fundingError) return fundingError;

      const pendingIndex = ordered.indexOf(pending);
      for (const [index, trade] of ordered.entries()) {
        if (!("id" in trade)) continue;
        const amounts = result.amounts[index];
        if (trade.costBasisChange === amounts.costBasisChange && trade.realisedPnl === amounts.realisedPnl) continue;
        await write.updateAmounts(input.accountId, trade.id, amounts);
      }
      const values = { ...pending, ...result.amounts[pendingIndex] };
      const row = await write.save(values, tradeId);
      return { status: "saved", trade: presentTrade(row, pendingIndex === ordered.length - 1) };
    });
  }

  return {
    recordTrade: (ownerUserId: string, input: EtfTradeInput) => saveTrade(ownerUserId, input),
    updateTrade: (ownerUserId: string, tradeId: string, input: EtfTradeInput) => saveTrade(ownerUserId, input, tradeId),
    deleteTrade(ownerUserId: string, tradeId: string) {
      return repository.withWrite<"deleted" | "not_found" | EtfTradeConflict>(ownerUserId, async (write) => {
        const current = await write.find(tradeId);
        if (!current) return "not_found";

        const existing = await write.listTrades(current.accountId);
        if (existing.at(-1)?.id !== tradeId) return historical;

        const deleted = await write.remove(tradeId);
        await write.retainDeletion(deleted);
        return "deleted";
      });
    },
    async readHoldings(ownerUserId: string, accountId: string): Promise<BrokerageHoldings | undefined> {
      const snapshot = await repository.readHoldingsSnapshot(ownerUserId, accountId);
      if (!snapshot) return undefined;

      return {
        holdings: snapshot.positions.map(summarizeHolding),
        trades: snapshot.trades.map((row, index) => presentTrade(row, index === 0)),
      };
    },
    async readPortfolio(ownerUserId: string): Promise<PortfolioValuation> {
      const { positions, cash } = await repository.readPortfolioSnapshot(ownerUserId);
      const unpricedHoldings = positions.filter(({ units }) => new SgdDecimal(units).gt(0)).length;
      return {
        currency: "SGD",
        valuation: unpricedHoldings ? "partial" : "complete",
        knownSubtotal: formatSgd(cash),
        unpricedHoldings,
      };
    },
  };
}

export type EtfTradeService = ReturnType<typeof createEtfTradeService>;
