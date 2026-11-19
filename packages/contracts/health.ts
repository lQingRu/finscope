import { z } from "zod";

export const healthResponses = {
  200: z.strictObject({ status: z.literal("ok") }),
  503: z.strictObject({ status: z.literal("unavailable") }),
};
