import type { EtfHolding, EtfTradeConflict, EtfTradeInput } from "@finscope/contracts/etf-trades";
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

export type TradeAmounts = {
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
