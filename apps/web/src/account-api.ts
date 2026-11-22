import { tradeFundingConflict } from "@finscope/contracts/etf-trades";
import { financialAccountErrors, financialAccountResponses } from "@finscope/contracts/financial-accounts";
import type { CorrectFinancialAccount, OpenFinancialAccount, ReportingPeriod } from "@finscope/contracts/financial-accounts";

export const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3000";
const endpoint = new URL("/financial-accounts", apiUrl);

export class AccountApiError extends Error {
  constructor(readonly status: number, readonly openingDateError?: string, readonly fundingError?: string) {
    super(`Account API returned ${status}`);
  }
}

export async function tradeFundingApiError(response: Response) {
  const body = tradeFundingConflict.safeParse(await response.json().catch(() => null));
  return new AccountApiError(response.status, undefined, body.data?.message);
}

export async function listAccounts(token: string, period: ReportingPeriod | undefined, signal: AbortSignal) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ view: "overview", ...period }).toString();
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (response.status !== 200) {
    throw new AccountApiError(response.status);
  }
  return financialAccountResponses.overview[200].parse(await response.json());
}

async function saveAccount(
  token: string,
  url: URL,
  method: "POST" | "PATCH",
  input: OpenFinancialAccount | CorrectFinancialAccount,
) {
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.status === 409) throw await tradeFundingApiError(response);
  if (response.status === 400) {
    const body = financialAccountErrors[400].safeParse(await response.json().catch(() => null));
    throw new AccountApiError(400, body.data?.openingDateError);
  }
  if (method === "POST" && response.status === 201) {
    return financialAccountResponses.open[201].parse(await response.json());
  }
  if (method === "PATCH" && response.status === 200) {
    return financialAccountResponses.correct[200].parse(await response.json());
  }
  throw new AccountApiError(response.status);
}

export function openAccount(token: string, input: OpenFinancialAccount) {
  return saveAccount(token, endpoint, "POST", input);
}

export function correctAccount(token: string, accountId: string, input: CorrectFinancialAccount) {
  const url = new URL(`${endpoint.pathname}/${encodeURIComponent(accountId)}`, endpoint);
  return saveAccount(token, url, "PATCH", input);
}

export async function deleteAccount(token: string, accountId: string) {
  const url = new URL(`${endpoint.pathname}/${encodeURIComponent(accountId)}`, endpoint);
  const response = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status !== 204) throw new AccountApiError(response.status);
}

export function isAccessError(error: unknown) {
  return error instanceof AccountApiError && [401, 403].includes(error.status);
}
