import { and, eq, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { etfTrades, tradeChronology } from "../etf-trades/table.ts";
import { accounts } from "../financial-accounts/table.ts";
import { transactions } from "../transactions/table.ts";
import { transfers } from "../transfers/table.ts";

export const transactionCashMovement = sql`case when ${transactions.type} = 'income'
  then ${transactions.amount} else -${transactions.amount} end`;

const incomingTransferCash = transfers.amount;
const outgoingTransferCash = sql`-${transfers.amount}`;

export function transferCashMovement(account: SQL) {
  return sql`case when ${transfers.destinationAccountId} = ${account}
    then ${incomingTransferCash} else ${outgoingTransferCash} end`;
}

type CashEntry = { date: string; amount: string };
function everydayCash(owner: string, account?: string) {
  return sql`
    select ${transactions.date}, ${transactionCashMovement} as amount
    from ${transactions} where owner_user_id = ${owner} ${account ? sql`and account_id = ${account}` : sql``}
    union all
    select ${transfers.date}, ${incomingTransferCash} from ${transfers}
    where owner_user_id = ${owner} ${account ? sql`and destination_account_id = ${account}` : sql``}
    union all
    select ${transfers.date}, ${outgoingTransferCash} from ${transfers}
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

export async function readKnownPortfolioCash(db: Pick<NodePgDatabase, "execute">, owner: string) {
  const { rows: [amount] } = await db.execute<{ total: string }>(sql`
    select coalesce(sum(amount), 0) as total from (
      select opening_balance as amount from ${accounts} where owner_user_id = ${owner}
      union all
      select amount from (${everydayCash(owner)}) activity
      union all
      select ${etfTrades.cashMovement} from ${etfTrades} where ${etfTrades.ownerUserId} = ${owner}
    ) cash
  `);
  return amount.total;
}

export async function readSavedTradeFunding(write: Pick<NodePgDatabase, "select" | "execute">, owner: string, accountId: string) {
  const trades = await write.select({
    id: etfTrades.id, ticker: etfTrades.ticker, date: etfTrades.date, cashMovement: etfTrades.cashMovement, type: etfTrades.type,
  }).from(etfTrades).where(and(eq(etfTrades.ownerUserId, owner), eq(etfTrades.accountId, accountId)))
    .orderBy(...tradeChronology());
  if (!trades.length) return undefined;

  const [account] = await write.select({ openingBalance: accounts.openingBalance }).from(accounts)
    .where(and(eq(accounts.ownerUserId, owner), eq(accounts.id, accountId)));
  const cash = await readCashEntries(write, owner, accountId);
  return { openingBalance: account.openingBalance, cash, trades };
}
