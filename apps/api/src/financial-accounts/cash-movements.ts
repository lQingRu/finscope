import { sql, type SQL } from "drizzle-orm";
import { transactions } from "../transactions/table.ts";
import { transfers } from "../transfers/table.ts";

export const transactionCashMovement = sql`case when ${transactions.type} = 'income'
  then ${transactions.amount} else -${transactions.amount} end`;

export const incomingTransferCash = transfers.amount;
export const outgoingTransferCash = sql`-${transfers.amount}`;

export function transferCashMovement(account: SQL) {
  return sql`case when ${transfers.destinationAccountId} = ${account}
    then ${incomingTransferCash} else ${outgoingTransferCash} end`;
}
