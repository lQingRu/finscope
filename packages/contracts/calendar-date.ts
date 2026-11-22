import { z } from "zod";

export function calendarDateSchema(invalidDate: string, invalidYear: string) {
  return z.iso.date(invalidDate).refine((date) => !date.startsWith("0000-"), invalidYear);
}
