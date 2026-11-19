import { z } from "zod";

export const apiErrorResponses = {
  400: z.object({ status: z.literal("invalid_request") }),
  500: z.object({ status: z.literal("error") }),
};
