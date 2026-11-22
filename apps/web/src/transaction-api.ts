import { transactionResponses } from "@finscope/contracts/transactions";
import type { TransactionFieldErrors, TransactionHistoryQuery, TransactionInput } from "@finscope/contracts/transactions";
import { AccountApiError, apiUrl } from "./account-api";

export class TransactionApiError extends AccountApiError {
  constructor(status: number, readonly fieldErrors?: TransactionFieldErrors) {
    super(status);
  }
}

export async function listTransactions(token: string, accountId: string, filters: TransactionHistoryQuery, signal: AbortSignal) {
  const url = new URL(`/financial-accounts/${encodeURIComponent(accountId)}/transactions`, apiUrl);
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
  if (response.status !== 200) throw new TransactionApiError(response.status);
  const { transactions } = transactionResponses.list[200].parse(await response.json());
  return transactions;
}

export async function saveTransaction(token: string, input: TransactionInput, transactionId?: string) {
  const url = new URL(transactionId ? `/transactions/${encodeURIComponent(transactionId)}` : "/transactions", apiUrl);
  const response = await fetch(url, {
    method: transactionId ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.status === 400 || response.status === 404) {
    const body = transactionResponses.record[response.status].safeParse(await response.json().catch(() => null));
    throw new TransactionApiError(response.status, body.data?.fieldErrors);
  }
  if (transactionId && response.status === 200) return transactionResponses.correct[200].parse(await response.json());
  if (!transactionId && response.status === 201) return transactionResponses.record[201].parse(await response.json());
  throw new TransactionApiError(response.status);
}
