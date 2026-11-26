import { etfTradeResponses } from "@finscope/contracts/etf-trades";
import type { EtfTradeFieldErrors, EtfTradeInput } from "@finscope/contracts/etf-trades";
import { apiUrl } from "../../../config/env";
import { ApiError } from "../../../shared/lib/api-error";

export class EtfTradeApiError extends ApiError {
  constructor(status: number, readonly fieldErrors?: EtfTradeFieldErrors, readonly detail?: string) {
    super(status);
  }
}

async function throwTradeError(response: Response): Promise<never> {
  if (response.status === 400) {
    const body = etfTradeResponses.record[400].safeParse(await response.json().catch(() => null));
    throw new EtfTradeApiError(400, body.data?.fieldErrors);
  }
  if (response.status === 409) {
    const body = etfTradeResponses.record[409].safeParse(await response.json().catch(() => null));
    throw new EtfTradeApiError(409, undefined, body.data?.message);
  }
  throw new EtfTradeApiError(response.status);
}

export async function getBrokerageHoldings(token: string, accountId: string, signal: AbortSignal) {
  const response = await fetch(new URL(`/financial-accounts/${encodeURIComponent(accountId)}/holdings`, apiUrl), {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (response.status !== 200) throw new EtfTradeApiError(response.status);
  return etfTradeResponses.holdings[200].parse(await response.json());
}

export async function getPortfolioValuation(token: string, signal: AbortSignal) {
  const response = await fetch(new URL("/portfolio", apiUrl), {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (response.status !== 200) throw new EtfTradeApiError(response.status);
  return etfTradeResponses.portfolio[200].parse(await response.json());
}

export async function saveEtfTrade(token: string, input: EtfTradeInput, tradeId?: string) {
  const url = new URL(tradeId ? `/etf-trades/${encodeURIComponent(tradeId)}` : "/etf-trades", apiUrl);
  const response = await fetch(url, {
    method: tradeId ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (tradeId && response.status === 200) return etfTradeResponses.update[200].parse(await response.json());
  if (!tradeId && response.status === 201) return etfTradeResponses.record[201].parse(await response.json());
  return throwTradeError(response);
}

export async function deleteEtfTrade(token: string, tradeId: string) {
  const response = await fetch(new URL(`/etf-trades/${encodeURIComponent(tradeId)}`, apiUrl), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status !== 204) await throwTradeError(response);
}
