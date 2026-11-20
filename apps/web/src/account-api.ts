import { financialAccountResponses } from "@finscope/contracts/financial-accounts";
import type { OpenFinancialAccount } from "@finscope/contracts/financial-accounts";

const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3000";
const endpoint = new URL("/financial-accounts", apiUrl);

export class AccountApiError extends Error {
  constructor(readonly status: number) {
    super(`Account API returned ${status}`);
  }
}

export async function listAccounts(token: string, signal: AbortSignal) {
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (response.status !== 200) {
    throw new AccountApiError(response.status);
  }
  return financialAccountResponses.list[200].parse(await response.json());
}

export async function openAccount(token: string, input: OpenFinancialAccount) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.status !== 201) {
    throw new AccountApiError(response.status);
  }
  return financialAccountResponses.open[201].parse(await response.json());
}

export function isAccessError(error: unknown) {
  return error instanceof AccountApiError && [401, 403].includes(error.status);
}
