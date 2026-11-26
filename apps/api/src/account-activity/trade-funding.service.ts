import type { TradeFundingConflict } from "@finscope/contracts/etf-trades";
import { SgdDecimal, formatSgd } from "../sgd.ts";

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

export class TradeFundingError extends Error {
  readonly conflict: TradeFundingConflict;

  constructor(conflict: TradeFundingConflict) {
    super(conflict.message);
    this.conflict = conflict;
  }
}

type SavedTradeFunding = { openingBalance: string; cash: CashEntry[]; trades: TradeCashEntry[] };

export async function assertSavedTradesFunded(
  load: (accountId: string) => Promise<SavedTradeFunding | undefined>,
  accountIds: string[],
) {
  for (const accountId of new Set(accountIds)) {
    const funding = await load(accountId);
    if (!funding) continue;

    const conflict = validateTradeFunding(funding.openingBalance, funding.cash, funding.trades);
    // Throw inside the write transaction so a funding conflict rolls back the activity change.
    if (conflict) throw new TradeFundingError(conflict);
  }
}
