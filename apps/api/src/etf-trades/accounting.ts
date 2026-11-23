import type { EtfHolding, EtfTradeConflict, EtfTradeInput, TradeFundingConflict } from "@finscope/contracts/etf-trades";
import type { Decimal } from "decimal.js";
import { SgdDecimal, formatSgd } from "../sgd.ts";

const costDecimalPlaces = 16;

export function securityKey({ ticker, exchange }: { ticker: string; exchange: string }) {
  return JSON.stringify([ticker, exchange]);
}

type LedgerTrade = Pick<EtfTradeInput, "date" | "quantity" | "executionPrice" | "fee" | "type" | "ticker"> & {
  id?: string;
  exchange: string;
};

type TradeAmounts = {
  grossAmount: string;
  cashMovement: string;
  costBasisChange: string;
  realisedPnl: string | null;
};

export function calculateTradeAmounts(trades: LedgerTrade[]):
  { status: "calculated"; amounts: TradeAmounts[] } | EtfTradeConflict {
  const positions = new Map<string, { units: Decimal; cost: Decimal }>();
  const amounts: TradeAmounts[] = [];
  for (const trade of trades) {
    const { ticker, date, type } = trade;
    const key = securityKey(trade);
    const position = positions.get(key) ?? { units: new SgdDecimal(0), cost: new SgdDecimal(0) };
    const quantity = new SgdDecimal(trade.quantity);
    const gross = quantity.times(trade.executionPrice);

    if (type === "sell" && quantity.gt(position.units)) {
      const shortfall = quantity.minus(position.units).toFixed();
      return {
        status: "insufficient_units", shortfall, affectedTradeId: trade.id,
        message: `Sale of ${ticker} on ${date} exceeds available units by ${shortfall}.`,
      };
    }

    const buying = type === "buy";
    const unitsChange = buying ? quantity : quantity.negated();
    const cashMovement = buying ? gross.plus(trade.fee).negated() : gross.minus(trade.fee);
    // Relieve the full residual basis on close. Otherwise keep 16 fractional SGD digits for cost allocation.
    let relievedCost = new SgdDecimal(0);
    if (!buying) {
      relievedCost = quantity.eq(position.units)
        ? position.cost
        : position.cost.times(quantity).dividedBy(position.units).toDecimalPlaces(costDecimalPlaces);
    }
    const costBasisChange = buying ? cashMovement.negated() : relievedCost.negated();
    amounts.push({
      grossAmount: formatSgd(gross),
      cashMovement: formatSgd(cashMovement),
      costBasisChange: formatSgd(costBasisChange),
      realisedPnl: buying ? null : formatSgd(cashMovement.minus(relievedCost)),
    });
    positions.set(key, { units: position.units.plus(unitsChange), cost: position.cost.plus(costBasisChange) });
  }
  return { status: "calculated", amounts };
}

type CashEntry = { date: string; amount: string };
type TradeCashEntry = {
  id?: string;
  ticker: string;
  date: string;
  type: "buy" | "sell";
  cashMovement: string;
};

export function validateTradeFunding(openingBalance: string, pendingCash: CashEntry[], trades: TradeCashEntry[]):
  TradeFundingConflict | undefined {
  let cash = new SgdDecimal(openingBalance);
  let cashIndex = 0;
  for (const trade of trades) {
    // Everyday entries carry only a calendar date, so they fund trades from that date.
    while (cashIndex < pendingCash.length && pendingCash[cashIndex].date <= trade.date) {
      cash = cash.plus(pendingCash[cashIndex].amount);
      cashIndex += 1;
    }
    const movement = new SgdDecimal(trade.cashMovement);
    cash = cash.plus(movement);
    if (movement.lt(0) && cash.lt(0)) {
      const shortfall = formatSgd(cash.negated());
      const action = trade.type === "buy" ? "Purchase" : "Sale";
      const reason = trade.type === "sell" ? " to cover its fees" : "";
      return {
        status: "insufficient_cash", shortfall, affectedTradeId: trade.id,
        message: `${action} of ${trade.ticker} on ${trade.date} needs ${shortfall} SGD more brokerage cash${reason}.`,
      };
    }
  }
}

type HoldingTotals = { ticker: string; exchange: string; units: string; cost: string; fees: string; realised: string };

export function summarizeHolding({ ticker, exchange, units, cost, fees, realised }: HoldingTotals): EtfHolding {
  const amount = new SgdDecimal(units);
  const open = amount.gt(0);
  return {
    ticker, exchange, currency: "SGD", units: amount.toFixed(), costBasis: formatSgd(cost),
    averageCost: open ? formatSgd(new SgdDecimal(cost).dividedBy(amount).toDecimalPlaces(costDecimalPlaces)) : null,
    fees: formatSgd(fees), realisedPnl: formatSgd(realised),
    valuation: open ? "awaiting_price" : "closed",
    marketValue: open ? null : "0.00", unrealisedPnl: open ? null : "0.00",
  };
}
