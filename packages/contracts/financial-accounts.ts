import { apiErrorResponses } from "@finscope/contracts/api-errors";
import { z } from "zod";

export const accountTypes = ["bank", "brokerage"] as const;
export const zeroSgd = "0.00";

const singaporeDate = new Intl.DateTimeFormat("en", {
  timeZone: "Asia/Singapore",
  calendar: "gregory",
  numberingSystem: "latn",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function singaporeCalendarDate(now = new Date()) {
  const { year, month, day } = Object.fromEntries(
    singaporeDate.formatToParts(now).map(({ type, value }) => [type, value]),
  );
  return `${year}-${month}-${day}`;
}

const calendarDate = z.iso.date("Enter a valid opening date.").refine(
  (date) => !date.startsWith("0000-"),
  "Enter an opening date in year 1 or later.",
);

const accountDetails = z.strictObject({
  name: z.string().trim().min(1, "Enter an account name.").max(100),
  openingDate: calendarDate,
  // PostgreSQL numeric(14, 2) stores twelve whole digits and two fractional digits.
  openingBalance: z.string().regex(
    /^-?[0-9]{1,12}(?:\.[0-9]{1,2})?$/,
    "Enter an SGD amount with up to 12 whole digits and 2 decimal places.",
  ),
});
const accountKind = {
  type: z.enum(accountTypes),
  currency: z.literal("SGD"),
};

export const correctFinancialAccount = accountDetails.extend({
  openingDate: calendarDate.refine((date) => {
    return date <= singaporeCalendarDate();
  }, "Enter an opening date on or before today in Singapore."),
});
export const openFinancialAccount = correctFinancialAccount.extend(accountKind);

const sgdAmount = z.string().regex(/^-?(?:0|[1-9][0-9]*)\.[0-9]{2}$/);
const financialAccount = accountDetails.extend({
  ...accountKind,
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
  400: apiErrorResponses[400].extend({ openingDateError: z.string().optional() }),
  401: z.object({ status: z.literal("unauthenticated") }),
  403: z.object({ status: z.literal("forbidden") }),
  503: z.object({ status: z.literal("unavailable") }),
};

export const financialAccountResponses = {
  list: { 200: financialAccounts, ...financialAccountErrors },
  delete: { ...financialAccountErrors, 404: z.object({ status: z.literal("not_found") }) },
  open: { 201: financialAccount, ...financialAccountErrors },
  correct: {
    200: financialAccount,
    ...financialAccountErrors,
    404: z.object({ status: z.literal("not_found") }),
  },
};

export type OpenFinancialAccount = z.infer<typeof openFinancialAccount>;
export type FinancialAccount = z.infer<typeof financialAccount>;
export type CorrectFinancialAccount = z.infer<typeof correctFinancialAccount>;
