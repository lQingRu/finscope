import type { TradeFundingConflict } from "@finscope/contracts/etf-trades";
import { and, asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { accounts } from "../financial-accounts/table.ts";
import { transactions } from "../transactions/table.ts";
import { transfers } from "../transfers/table.ts";
import { TradeDecimal, tradeMoney } from "./accounting.ts";
import { etfTrades } from "./table.ts";

type CashEntry = { date: string; amount: string };
type TradeCashEntry = {
  id?: string;
  ticker: string;
  date: string;
  type: "buy" | "sell";
  cashMovement: string;
};

function everydayCash(owner: string, account?: string) {
  return sql`
    select date, case when type = 'income' then amount else -amount end as amount
    from ${transactions} where owner_user_id = ${owner} ${account ? sql`and account_id = ${account}` : sql``}
    union all
    select date, amount from ${transfers}
    where owner_user_id = ${owner} ${account ? sql`and destination_account_id = ${account}` : sql``}
    union all
    select date, -amount from ${transfers}
    where owner_user_id = ${owner} ${account ? sql`and source_account_id = ${account}` : sql``}
  `;
}

export async function readCashEntries(db: Pick<NodePgDatabase, "execute">, owner: string, accountId: string) {
  const { rows } = await db.execute<CashEntry>(sql`
    select date::text, sum(amount) as amount from (${everydayCash(owner, accountId)}) activity
    group by date order by date
  `);
  return rows;
}

export async function readKnownPortfolioValue(db: Pick<NodePgDatabase, "execute">, owner: string) {
  const { rows: [amount] } = await db.execute<{ total: string }>(sql`
    select coalesce(sum(amount), 0) as total from (
      select opening_balance as amount from ${accounts} where owner_user_id = ${owner}
      union all
      select amount from (${everydayCash(owner)}) activity
      union all
      select cash_movement from ${etfTrades} where owner_user_id = ${owner}
    ) cash
  `);
  return new TradeDecimal(amount.total).toFixed(2);
}

export function validateTradeFunding(openingBalance: string, pendingCash: CashEntry[], trades: TradeCashEntry[]):
  TradeFundingConflict | undefined {
  let cash = new TradeDecimal(openingBalance);
  let cashIndex = 0;
  for (const trade of trades) {
    // Everyday entries carry only a calendar date, so they fund trades from that date.
    while (cashIndex < pendingCash.length && pendingCash[cashIndex].date <= trade.date) {
      cash = cash.plus(pendingCash[cashIndex].amount);
      cashIndex += 1;
    }
    cash = cash.plus(trade.cashMovement);
    if (trade.type === "buy" && cash.lt(0)) {
      const shortfall = tradeMoney(cash.negated());
      return {
        status: "insufficient_cash", shortfall, affectedTradeId: trade.id,
        message: `Purchase of ${trade.ticker} on ${trade.date} needs ${shortfall} SGD more brokerage cash.`,
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

export async function assertSavedBuysFunded(
  write: Pick<NodePgDatabase, "select" | "execute">,
  owner: string,
  accountIds: string[],
) {
  for (const accountId of new Set(accountIds)) {
    const trades = await write.select({
      id: etfTrades.id, ticker: etfTrades.ticker, date: etfTrades.date, cashMovement: etfTrades.cashMovement, type: etfTrades.type,
    }).from(etfTrades).where(and(eq(etfTrades.ownerUserId, owner), eq(etfTrades.accountId, accountId)))
      .orderBy(asc(etfTrades.date), asc(etfTrades.entryOrder));
    if (!trades.some(({ type }) => type === "buy")) continue;

    const [account] = await write.select({ openingBalance: accounts.openingBalance }).from(accounts)
      .where(and(eq(accounts.ownerUserId, owner), eq(accounts.id, accountId)));
    const cash = await readCashEntries(write, owner, accountId);
    const conflict = validateTradeFunding(account.openingBalance, cash, trades);
    // Throw inside the write transaction so a funding conflict rolls back the activity change.
    if (conflict) throw new TradeFundingError(conflict);
  }
}
