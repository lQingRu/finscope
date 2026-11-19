import { z } from "zod";
import { apiErrorResponses } from "./api-errors.ts";

export const accountTypes = ["bank", "brokerage"] as const;
export const zeroSgd = "0.00";

// PostgreSQL numeric(14, 2) stores twelve whole digits and two fractional digits.
export const openFinancialAccount = z.strictObject({
  name: z.string().trim().min(1, "Enter an account name.").max(100),
  type: z.enum(accountTypes),
  currency: z.literal("SGD"),
  openingDate: z.iso.date("Enter a valid opening date.").refine(
    (date) => !date.startsWith("0000-"),
    "Enter an opening date in year 1 or later.",
  ),
  openingBalance: z.string().regex(
    /^-?[0-9]{1,12}(?:\.[0-9]{1,2})?$/,
    "Enter an SGD amount with up to 12 whole digits and 2 decimal places.",
  ),
});

const sgdAmount = z.string().regex(/^-?(?:0|[1-9][0-9]*)\.[0-9]{2}$/);
const financialAccount = openFinancialAccount.extend({
  id: z.uuid(),
  openingBalance: sgdAmount,
});

const financialAccounts = z.strictObject({
  accounts: z.array(financialAccount),
  summary: z.strictObject({
    currency: z.literal("SGD"),
    balance: sgdAmount,
    income: sgdAmount,
    expenses: sgdAmount,
  }),
});

export const financialAccountErrors = {
  ...apiErrorResponses,
  401: z.object({ status: z.literal("unauthenticated") }),
  403: z.object({ status: z.literal("forbidden") }),
  503: z.object({ status: z.literal("unavailable") }),
};

export const financialAccountResponses = {
  list: { 200: financialAccounts, ...financialAccountErrors },
  open: { 201: financialAccount, ...financialAccountErrors },
};

export type OpenFinancialAccount = z.infer<typeof openFinancialAccount>;
export type FinancialAccount = z.infer<typeof financialAccount>;
