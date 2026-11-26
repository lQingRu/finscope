import type { FinancialAccount } from "@finscope/contracts/financial-accounts";

export const accountTypeLabels = { bank: "Bank", brokerage: "Brokerage" };

export type LabeledAccount<T extends FinancialAccount = FinancialAccount> = T & { label: string };

export function labelFinancialAccounts<T extends FinancialAccount>(accounts: T[]): LabeledAccount<T>[] {
  return accounts.map((account) => {
    const sameName = accounts.filter(({ name }) => name === account.name);
    if (sameName.length === 1) return { ...account, label: account.name };

    const label = `${account.name} · ${accountTypeLabels[account.type]}`;
    const sameType = sameName.filter(({ type }) => type === account.type);
    if (sameType.length === 1) return { ...account, label };

    const suffix = account.id.slice(-6);
    const repeatsSuffix = sameType.some(({ id }) => id !== account.id && id.endsWith(suffix));
    return { ...account, label: `${label} · ${repeatsSuffix ? account.id : suffix}` };
  });
}
