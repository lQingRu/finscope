import { z } from "zod";
import { apiErrorResponses } from "@finscope/contracts/api-errors";
import { calendarDateSchema } from "@finscope/contracts/calendar-date";
import { positiveSgdInput, savedPositiveSgd } from "@finscope/contracts/positive-sgd";

const transferFields = z.strictObject({
  sourceAccountId: z.uuid("Select a source financial account.").toLowerCase(),
  destinationAccountId: z.uuid("Select a destination financial account.").toLowerCase(),
  amount: positiveSgdInput,
  date: calendarDateSchema("Enter a valid transfer date.", "Enter a transfer date in year 1 or later."),
});
export const transferInput = transferFields.refine(
  ({ sourceAccountId, destinationAccountId }) => sourceAccountId !== destinationAccountId,
  { path: ["destinationAccountId"], error: "Select a destination different from the source account." },
);

const savedTransfer = transferFields.extend({ id: z.uuid(), amount: savedPositiveSgd });
export const transferHistoryEntry = savedTransfer.extend({ direction: z.enum(["incoming", "outgoing"]) });

const transferFieldErrors = z.object({
  sourceAccountId: z.string().optional(),
  destinationAccountId: z.string().optional(),
  amount: z.string().optional(),
  date: z.string().optional(),
});
const transferErrors = {
  ...apiErrorResponses,
  400: apiErrorResponses[400].extend({ fieldErrors: transferFieldErrors.optional() }),
  401: z.object({ status: z.literal("unauthenticated") }),
  403: z.object({ status: z.literal("forbidden") }),
  404: z.object({
    status: z.literal("not_found"),
    fieldErrors: transferFieldErrors.pick({ sourceAccountId: true, destinationAccountId: true }).optional(),
  }),
  503: z.object({ status: z.literal("unavailable") }),
};
export const transferResponses = {
  record: { ...transferErrors, 201: savedTransfer },
  correct: { ...transferErrors, 200: savedTransfer },
};

export const transferAccountFields = ["sourceAccountId", "destinationAccountId"] as const;
export type TransferAccountField = (typeof transferAccountFields)[number];

export function minimumTransferDate(sourceOpeningDate = "", destinationOpeningDate = "") {
  return sourceOpeningDate > destinationOpeningDate ? sourceOpeningDate : destinationOpeningDate;
}

export function transferBeforeOpeningMessage(openingDate: string) {
  return `Enter a date on or after both accounts’ opening dates (earliest allowed date: ${openingDate}).`;
}

export type TransferInput = z.infer<typeof transferInput>;
export type Transfer = z.infer<typeof savedTransfer>;
export type TransferHistoryEntry = z.infer<typeof transferHistoryEntry>;
export type TransferFieldErrors = z.infer<typeof transferFieldErrors>;
