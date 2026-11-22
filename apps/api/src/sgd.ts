import { Decimal } from "decimal.js";

export const SgdDecimal = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP });

export function formatSgd(amount: string | Decimal) {
  const value = new SgdDecimal(amount);
  return value.toFixed(Math.max(2, value.decimalPlaces()));
}
