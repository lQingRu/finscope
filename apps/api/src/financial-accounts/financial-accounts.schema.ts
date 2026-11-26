import {
  correctFinancialAccount,
  financialAccountErrors,
  openFinancialAccount,
  reportingPeriodQuery,
} from "@finscope/contracts/financial-accounts";
import type { z } from "zod";
import { accountParams } from "../app/request-validation.ts";

const config = {
  invalidBody: (issues: z.ZodError["issues"]) => financialAccountErrors[400].parse({
    status: "invalid_request",
    openingDateError: issues.find(({ path }) => path[0] === "openingDate")?.message,
  }),
};

export const financialAccountSchemas = {
  list: { schema: { querystring: reportingPeriodQuery } },
  open: { schema: { body: openFinancialAccount }, config },
  correct: { schema: { params: accountParams, body: correctFinancialAccount }, config },
  delete: { schema: { params: accountParams } },
};
