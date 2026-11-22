import type { EtfTradeConflict, EtfTradeInput } from "@finscope/contracts/etf-trades";
import { Decimal } from "decimal.js";

export const TradeDecimal = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP });

export function tradeMoney(amount: string | Decimal) {
  const value = new TradeDecimal(amount);
  return value.toFixed(Math.max(2, value.decimalPlaces()));
}

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
    const position = positions.get(key) ?? { units: new TradeDecimal(0), cost: new TradeDecimal(0) };
    const quantity = new TradeDecimal(trade.quantity);
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
    let relievedCost = new TradeDecimal(0);
    if (!buying) {
      relievedCost = quantity.eq(position.units)
        ? position.cost
        : position.cost.times(quantity).dividedBy(position.units).toDecimalPlaces(16);
    }
    const costBasisChange = buying ? cashMovement.negated() : relievedCost.negated();
    amounts.push({
      grossAmount: tradeMoney(gross),
      cashMovement: tradeMoney(cashMovement),
      costBasisChange: tradeMoney(costBasisChange),
      realisedPnl: buying ? null : tradeMoney(cashMovement.minus(relievedCost)),
    });
    positions.set(key, { units: position.units.plus(unitsChange), cost: position.cost.plus(costBasisChange) });
  }
  return { status: "calculated", amounts };
}
