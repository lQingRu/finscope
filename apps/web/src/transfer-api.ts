import { transferResponses } from "@finscope/contracts/transfers";
import type { TransferFieldErrors, TransferInput } from "@finscope/contracts/transfers";
import { AccountApiError, apiUrl } from "./account-api";

export class TransferApiError extends AccountApiError {
  constructor(status: number, readonly fieldErrors?: TransferFieldErrors) {
    super(status);
  }
}

export async function saveTransfer(token: string, input: TransferInput, transferId?: string) {
  const url = new URL(transferId ? `/transfers/${encodeURIComponent(transferId)}` : "/transfers", apiUrl);
  const response = await fetch(url, {
    method: transferId ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.status === 400 || response.status === 404) {
    const body = transferResponses.record[response.status].safeParse(await response.json().catch(() => null));
    throw new TransferApiError(response.status, body.data?.fieldErrors);
  }
  if (transferId && response.status === 200) return transferResponses.correct[200].parse(await response.json());
  if (!transferId && response.status === 201) return transferResponses.record[201].parse(await response.json());
  throw new TransferApiError(response.status);
}
