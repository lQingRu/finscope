import { transactionHistoryQuery, transactionInput, transactionResponses } from "@finscope/contracts/transactions";
import { z } from "zod";
import { accountParams, firstLevelFieldErrors } from "../app/request-validation.ts";

const transactionParams = z.object({ transactionId: z.uuid() });
const config = {
  invalidBody: (issues: z.ZodError["issues"]) => transactionResponses.record[400].parse({
    status: "invalid_request",
    fieldErrors: firstLevelFieldErrors(issues),
  }),
};

export const transactionSchemas = {
  list: { schema: { params: accountParams, querystring: transactionHistoryQuery } },
  record: { schema: { body: transactionInput }, config },
  correct: { schema: { params: transactionParams, body: transactionInput }, config },
  delete: { schema: { params: transactionParams } },
};
