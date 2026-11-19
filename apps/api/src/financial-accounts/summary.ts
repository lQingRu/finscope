import { zeroSgd } from "@finscope/contracts/financial-accounts";
import type { FinancialAccount } from "@finscope/contracts/financial-accounts";
import { Decimal } from "decimal.js";

export function summarizeFinancialAccounts(accounts: readonly FinancialAccount[]) {
  const balance = accounts.reduce(
    (total, account) => total.plus(account.openingBalance),
    new Decimal(0),
  );

  return { currency: "SGD", balance: balance.toFixed(2), income: zeroSgd, expenses: zeroSgd } as const;
}
