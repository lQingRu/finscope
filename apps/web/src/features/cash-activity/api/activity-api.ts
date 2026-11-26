import { tradeFundingConflict } from "@finscope/contracts/etf-trades";
import { transactionResponses } from "@finscope/contracts/transactions";
import type { TransactionFieldErrors, TransactionHistoryQuery, TransactionInput } from "@finscope/contracts/transactions";
import { transferResponses } from "@finscope/contracts/transfers";
import type { TransferFieldErrors, TransferInput } from "@finscope/contracts/transfers";
import { apiUrl } from "../../../config/env";
import { ApiError } from "../../../shared/lib/api-error";

export class TransactionApiError extends ApiError {
  constructor(status: number, readonly fieldErrors?: TransactionFieldErrors) {
    super(status);
  }
}

export class TransferApiError extends ApiError {
  constructor(status: number, readonly fieldErrors?: TransferFieldErrors) {
    super(status);
  }
}

export class ActivityFundingError extends ApiError {
  constructor(readonly fundingError?: string) {
    super(409);
  }
}

async function readFundingError(response: Response) {
  const body = tradeFundingConflict.safeParse(await response.json().catch(() => null));
  return new ActivityFundingError(body.data?.message);
}

export async function listTransactions(token: string, accountId: string, filters: TransactionHistoryQuery, signal: AbortSignal) {
  const url = new URL(`/financial-accounts/${encodeURIComponent(accountId)}/transactions`, apiUrl);
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  url.searchParams.set("includeTransfers", "true");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
  if (response.status !== 200) throw new TransactionApiError(response.status);
  return transactionResponses.list[200].parse(await response.json());
}

export async function saveTransaction(token: string, input: TransactionInput, transactionId?: string) {
  const url = new URL(transactionId ? `/transactions/${encodeURIComponent(transactionId)}` : "/transactions", apiUrl);
  const response = await fetch(url, {
    method: transactionId ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.status === 409) throw await readFundingError(response);
  if (response.status === 400 || response.status === 404) {
    const body = transactionResponses.record[response.status].safeParse(await response.json().catch(() => null));
    throw new TransactionApiError(response.status, body.data?.fieldErrors);
  }
  if (transactionId && response.status === 200) return transactionResponses.correct[200].parse(await response.json());
  if (!transactionId && response.status === 201) return transactionResponses.record[201].parse(await response.json());
  throw new TransactionApiError(response.status);
}

export async function deleteActivity(token: string, kind: "transaction" | "transfer", id: string) {
  const url = new URL(`/${kind}s/${encodeURIComponent(id)}`, apiUrl);
  const response = await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 409) throw await readFundingError(response);
  if (response.status !== 204) throw new ApiError(response.status);
}

export async function saveTransfer(token: string, input: TransferInput, transferId?: string) {
  const url = new URL(transferId ? `/transfers/${encodeURIComponent(transferId)}` : "/transfers", apiUrl);
  const response = await fetch(url, {
    method: transferId ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.status === 409) throw await readFundingError(response);
  if (response.status === 400 || response.status === 404) {
    const body = transferResponses.record[response.status].safeParse(await response.json().catch(() => null));
    throw new TransferApiError(response.status, body.data?.fieldErrors);
  }
  if (transferId && response.status === 200) return transferResponses.correct[200].parse(await response.json());
  if (!transferId && response.status === 201) return transferResponses.record[201].parse(await response.json());
  throw new TransferApiError(response.status);
}
