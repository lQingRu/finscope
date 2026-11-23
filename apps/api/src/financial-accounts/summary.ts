import type { AccountWithBalance, FinancialAccountOverview, ReportingPeriod } from "@finscope/contracts/financial-accounts";
import { SgdDecimal, formatSgd } from "../sgd.ts";

type AccountActivity = Omit<AccountWithBalance, "balance"> & { net: string; income: string; expenses: string };

export function summarizeFinancialAccounts(rows: AccountActivity[], period: ReportingPeriod): FinancialAccountOverview {
  let balance = new SgdDecimal(0);
  let income = new SgdDecimal(0);
  let expenses = new SgdDecimal(0);
  const accounts = rows.map(({ net, income: accountIncome, expenses: accountExpenses, ...account }) => {
    const accountBalance = new SgdDecimal(account.openingBalance).plus(net);
    balance = balance.plus(accountBalance);
    income = income.plus(accountIncome);
    expenses = expenses.plus(accountExpenses);
    return { ...account, balance: formatSgd(accountBalance) };
  });
  return {
    accounts,
    summary: {
      currency: "SGD", ...period,
      balance: formatSgd(balance), income: income.toFixed(2), expenses: expenses.toFixed(2),
      netCashflow: income.minus(expenses).toFixed(2),
    },
  };
}
