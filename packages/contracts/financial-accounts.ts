import { preciseSgdAmount, tradeFundingConflict } from "@finscope/contracts/etf-trades";
import { apiErrorResponses } from "@finscope/contracts/api-errors";
import { z } from "zod";
import { calendarDateSchema } from "@finscope/contracts/calendar-date";

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
  return `${year.padStart(4, "0")}-${month}-${day}`;
}

const openingDateSchema = calendarDateSchema(
  "Enter a valid opening date.",
  "Enter an opening date in year 1 or later.",
);

const accountDetails = z.strictObject({
  name: z.string().trim().min(1, "Enter an account name.").max(100),
  openingDate: openingDateSchema,
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
  openingDate: openingDateSchema.refine((date) => {
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

const accountWithBalance = financialAccount.extend({ balance: preciseSgdAmount, earliestActivityDate: openingDateSchema.nullable() });
const reportingDate = calendarDateSchema(
  "Enter a valid reporting date.",
  "Enter a reporting date in year 1 or later.",
);
const summary = z.strictObject({
  currency: z.literal("SGD"),
  balance: preciseSgdAmount,
  income: sgdAmount,
  expenses: sgdAmount,
});
const financialAccounts = z.strictObject({ accounts: z.array(financialAccount), summary });
const overview = z.strictObject({
  accounts: z.array(accountWithBalance),
  summary: summary.extend({
    netCashflow: sgdAmount,
    from: reportingDate,
    to: reportingDate,
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
  overview: { 200: overview, ...financialAccountErrors },
  delete: {
    ...financialAccountErrors,
    404: z.object({ status: z.literal("not_found") }),
    409: z.object({ status: z.literal("linked_activity") }),
  },
  open: { 201: financialAccount, ...financialAccountErrors },
  correct: {
    200: financialAccount,
    ...financialAccountErrors,
    409: tradeFundingConflict,
    404: z.object({ status: z.literal("not_found") }),
  },
};

export type OpenFinancialAccount = z.infer<typeof openFinancialAccount>;
export type FinancialAccount = z.infer<typeof financialAccount>;
export type CorrectFinancialAccount = z.infer<typeof correctFinancialAccount>;

export function currentSingaporeMonth(now = new Date()) {
  const [year, month] = singaporeCalendarDate(now).split("-");
  const lastDay = new Date(now);
  lastDay.setUTCFullYear(Number(year), Number(month), 0);
  return { from: `${year}-${month}-01`, to: `${year}-${month}-${lastDay.getUTCDate()}` };
}

export type FinancialAccountOverview = z.infer<typeof overview>;
export type AccountWithBalance = z.infer<typeof accountWithBalance>;

export const customReportingPeriod = z.strictObject({ from: reportingDate, to: reportingDate })
  .refine(({ from, to }) => from <= to, { path: ["to"], error: "The start date must be on or before the end date." });
export const reportingPeriodQuery = z.strictObject({
  view: z.literal("overview").optional(),
  from: reportingDate.optional(),
  to: reportingDate.optional(),
}).refine(({ from, to }) => (!from && !to) || Boolean(from && to && from <= to));
export type ReportingPeriod = z.infer<typeof customReportingPeriod>;

export function accountOpeningAfterActivityMessage(activityDate: string) {
  return `Enter an opening date on or before the earliest recorded entry (${activityDate}).`;
}
