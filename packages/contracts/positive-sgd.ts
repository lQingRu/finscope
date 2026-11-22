import { z } from "zod";

export const positiveSgdInput = z.string().regex(
  /^(?=.*[1-9])[0-9]{1,12}(?:\.[0-9]{1,2})?$/,
  "Enter a positive SGD amount with up to 12 whole digits and 2 decimal places.",
);

export const savedPositiveSgd = z.string().regex(/^(?=.*[1-9])(?:0|[1-9][0-9]*)\.[0-9]{2}$/);
