import { etfTradeInput, etfTradeResponses } from "@finscope/contracts/etf-trades";
import { z } from "zod";
import { accountParams, firstLevelFieldErrors } from "../app/request-validation.ts";

const tradeParams = z.object({ tradeId: z.uuid() });
const config = {
  invalidBody: (issues: z.ZodError["issues"]) => etfTradeResponses.record[400].parse({
    status: "invalid_request",
    fieldErrors: firstLevelFieldErrors(issues),
  }),
};

export const etfTradeSchemas = {
  record: { schema: { body: etfTradeInput }, config },
  update: { schema: { params: tradeParams, body: etfTradeInput }, config },
  delete: { schema: { params: tradeParams } },
  holdings: { schema: { params: accountParams } },
};
