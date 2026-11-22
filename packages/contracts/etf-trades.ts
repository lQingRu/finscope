import { z } from "zod";
import { apiErrorResponses } from "@finscope/contracts/api-errors";
import { calendarDateSchema } from "@finscope/contracts/calendar-date";

const tradeDate = calendarDateSchema("Enter a valid trade date.", "Enter a trade date in year 1 or later.");
const positiveDecimal = /^(?=.*[1-9])[0-9]{1,12}(?:\.[0-9]{1,8})?$/;
const tradeMoney = z.string().regex(/^-?(?:0|[1-9][0-9]*)\.[0-9]{2,16}$/);
const units = z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/);
const ticker = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._/-]{0,23}$/, "Enter an ETF ticker.");
const exchange = z.string().trim().toUpperCase().regex(/^[A-Z0-9._-]{0,20}$/, "Enter a valid exchange code.");
const security = { ticker, exchange, currency: z.literal("SGD") };
const tags = z.array(z.string().trim().min(1).max(40).regex(/^[^,\0]+$/, "Use a separate tag for each value.")).max(20);
function contextText(maxLength: number) {
  return z.string().trim().max(maxLength).regex(/^[^\0]*$/, "Remove null characters.");
}

const purpose = contextText(500);
const strategy = contextText(100);
const notes = contextText(2000);

export const etfTradeInput = z.strictObject({
  ...security,
  exchange: exchange.optional(),
  accountId: z.uuid("Select a brokerage account.").toLowerCase(),
  type: z.enum(["buy", "sell"]),
  date: tradeDate,
  quantity: z.string().trim().regex(positiveDecimal, "Enter a positive quantity with up to 12 whole digits and 8 decimal places."),
  executionPrice: z.string().trim().regex(positiveDecimal, "Enter a positive SGD price with up to 12 whole digits and 8 decimal places."),
  fee: z.string().trim().regex(/^[0-9]{1,12}(?:\.[0-9]{1,2})?$/, "Enter a nonnegative SGD fee with up to 12 whole digits and 2 decimal places."),
  purpose: purpose.optional(),
  strategy: strategy.optional(),
  tags: tags.optional(),
  notes: notes.optional(),
});

const etfTrade = etfTradeInput.extend({
  ...security,
  id: z.uuid(),
  quantity: units,
  executionPrice: tradeMoney,
  fee: tradeMoney,
  purpose,
  strategy,
  tags,
  notes,
  grossAmount: tradeMoney,
  cashMovement: tradeMoney,
  realisedPnl: tradeMoney.nullable(),
  canChangeFinancialDetails: z.boolean(),
});

const etfHolding = z.strictObject({
  ...security,
  units,
  costBasis: tradeMoney,
  averageCost: tradeMoney.nullable(),
  fees: tradeMoney,
  realisedPnl: tradeMoney,
  valuation: z.enum(["awaiting_price", "closed"]),
  marketValue: tradeMoney.nullable(),
  unrealisedPnl: tradeMoney.nullable(),
});

const fieldErrors = z.partialRecord(etfTradeInput.keyof(), z.string());
const etfTradeErrors = {
  ...apiErrorResponses,
  400: apiErrorResponses[400].extend({ fieldErrors: fieldErrors.optional() }),
  401: z.object({ status: z.literal("unauthenticated") }),
  403: z.object({ status: z.literal("forbidden") }),
  404: z.object({ status: z.literal("not_found") }),
  409: z.object({
    status: z.enum(["historical_trade", "insufficient_cash", "insufficient_units"]),
    message: z.string(),
    affectedTradeId: z.uuid().optional(),
    shortfall: z.string().optional(),
  }),
  503: z.object({ status: z.literal("unavailable") }),
};

export const etfTradeResponses = {
  record: { ...etfTradeErrors, 201: etfTrade },
  update: { ...etfTradeErrors, 200: etfTrade },
  delete: etfTradeErrors,
  holdings: { ...etfTradeErrors, 200: z.strictObject({ holdings: z.array(etfHolding), trades: z.array(etfTrade) }) },
  portfolio: {
    ...etfTradeErrors,
    200: z.strictObject({
      currency: z.literal("SGD"),
      valuation: z.enum(["complete", "partial"]),
      knownSubtotal: tradeMoney,
      unpricedHoldings: z.number().int().nonnegative(),
    }),
  },
};

export const tradeFundingConflict = etfTradeErrors[409].extend({ status: z.literal("insufficient_cash") });
export type TradeFundingConflict = z.infer<typeof tradeFundingConflict>;

export type EtfTradeInput = z.infer<typeof etfTradeInput>;
export type EtfTrade = z.infer<typeof etfTrade>;
export type EtfHolding = z.infer<typeof etfHolding>;
export type EtfTradeFieldErrors = z.infer<typeof fieldErrors>;
export type EtfTradeConflict = z.infer<typeof etfTradeErrors[409]>;
export type BrokerageHoldings = z.infer<typeof etfTradeResponses.holdings[200]>;
export type PortfolioValuation = z.infer<typeof etfTradeResponses.portfolio[200]>;

export function tradeBeforeOpeningMessage(openingDate: string) {
  return `Enter a date on or after the brokerage account’s opening date (${openingDate}).`;
}
