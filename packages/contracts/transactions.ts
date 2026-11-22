import { z } from "zod";
import { apiErrorResponses } from "@finscope/contracts/api-errors";
import { calendarDateSchema } from "@finscope/contracts/calendar-date";
import { positiveSgdInput, savedPositiveSgd } from "@finscope/contracts/positive-sgd";
import { transferHistoryEntry } from "@finscope/contracts/transfers";

export const transactionTypes = ["income", "expense"] as const;
export const incomeCategories = ["Salary", "Other Income"] as const;
export const expenseCategories = ["Food", "Transport", "Shopping", "Bills", "Other Expense"] as const;
export const transactionCategories = { income: incomeCategories, expense: expenseCategories };
export const defaultTransactionCategory = { income: "Other Income", expense: "Other Expense" } as const;

export const transactionDate = calendarDateSchema(
  "Enter a valid transaction date.",
  "Enter a transaction date in year 1 or later.",
);
const transactionType = z.enum(transactionTypes, { error: "Select income or expense." });
const transactionCategory = z.enum([...incomeCategories, ...expenseCategories], {
  error: "Select a category for this transaction type.",
});
const transactionFields = z.strictObject({
  accountId: z.uuid("Select a financial account."),
  type: transactionType,
  amount: positiveSgdInput,
  date: transactionDate,
  category: transactionCategory,
  description: z.string().trim().refine((value) => !value.includes("\0"), "Enter a description without null characters.").optional(),
});

export const transactionHistoryQuery = z.strictObject({
  type: transactionType.optional(),
  includeTransfers: z.literal("true").optional(),
  category: transactionCategory.optional(),
  from: transactionDate.optional(),
  to: transactionDate.optional(),
}).refine(({ from, to }) => !from || !to || from <= to, { path: ["to"], error: "The start date must be on or before the end date." });

export const transactionInput = transactionFields.refine(
  ({ type, category }) => transactionCategories[type].some((allowed) => allowed === category),
  { path: ["category"], error: "Select a category for this transaction type." },
);
const savedTransaction = transactionFields.extend({
  id: z.uuid(),
  amount: savedPositiveSgd,
  description: z.string().nullable(),
});

const transactionFieldErrors = z.object({
  accountId: z.string().optional(),
  type: z.string().optional(),
  amount: z.string().optional(),
  date: z.string().optional(),
  category: z.string().optional(),
  description: z.string().optional(),
});

const transactionErrors = {
  ...apiErrorResponses,
  400: apiErrorResponses[400].extend({
    fieldErrors: transactionFieldErrors.optional(),
  }),
  401: z.object({ status: z.literal("unauthenticated") }),
  403: z.object({ status: z.literal("forbidden") }),
  404: z.object({ status: z.literal("not_found"), fieldErrors: transactionFieldErrors.pick({ accountId: true }).optional() }),
  503: z.object({ status: z.literal("unavailable") }),
};

const transactionHistory = z.strictObject({
  transactions: z.array(savedTransaction),
  transfers: z.array(transferHistoryEntry).optional(),
});

export const transactionResponses = {
  correct: { ...transactionErrors, 200: savedTransaction },
  record: { ...transactionErrors, 201: savedTransaction },
  list: { ...transactionErrors, 200: transactionHistory },
};

export function transactionBeforeOpeningMessage(openingDate: string) {
  return `Enter a date on or after the account opening date (${openingDate}).`;
}

export type TransactionInput = z.infer<typeof transactionInput>;
export type Transaction = z.infer<typeof savedTransaction>;

export type AccountHistory = z.infer<typeof transactionHistory>;
export type TransactionHistoryQuery = z.infer<typeof transactionHistoryQuery>;

export type TransactionFieldErrors = z.infer<typeof transactionFieldErrors>;
