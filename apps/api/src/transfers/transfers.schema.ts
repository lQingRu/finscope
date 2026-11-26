import { transferInput, transferResponses } from "@finscope/contracts/transfers";
import { z } from "zod";
import { firstLevelFieldErrors } from "../app/request-validation.ts";

const transferParams = z.object({ transferId: z.uuid() });
const config = {
  invalidBody: (issues: z.ZodError["issues"]) => transferResponses.record[400].parse({
    status: "invalid_request",
    fieldErrors: firstLevelFieldErrors(issues),
  }),
};

export const transferSchemas = {
  record: { schema: { body: transferInput }, config },
  correct: { schema: { params: transferParams, body: transferInput }, config },
  delete: { schema: { params: transferParams } },
};
