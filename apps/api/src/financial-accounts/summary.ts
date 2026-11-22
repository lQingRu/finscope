import type { AccountWithBalance, FinancialAccountOverview, ReportingPeriod } from "@finscope/contracts/financial-accounts";
import { Decimal } from "decimal.js";

type AccountActivity = Omit<AccountWithBalance, "balance"> & { net: string; income: string; expenses: string };
const Money = Decimal.clone({ precision: 40 });

export function summarizeFinancialAccounts(rows: AccountActivity[], period: ReportingPeriod): FinancialAccountOverview {
  let balance = new Money(0);
  let income = new Money(0);
  let expenses = new Money(0);
  const accounts = rows.map(({ net, income: accountIncome, expenses: accountExpenses, ...account }) => {
    const accountBalance = new Money(account.openingBalance).plus(net);
    balance = balance.plus(accountBalance);
    income = income.plus(accountIncome);
    expenses = expenses.plus(accountExpenses);
    return { ...account, balance: accountBalance.toFixed(2) };
  });
  return {
    accounts,
    summary: {
      currency: "SGD", ...period,
      balance: balance.toFixed(2), income: income.toFixed(2), expenses: expenses.toFixed(2),
      netCashflow: income.minus(expenses).toFixed(2),
    },
  };
}
