const amountFormat = new Intl.NumberFormat("en-SG", {
  style: "currency",
  currency: "SGD",
  currencyDisplay: "code",
});

export function formatSgd(amount: string) {
  // The response contract validates the decimal string before it reaches the formatter.
  return amountFormat.format(amount as `${number}`);
}

const dateFormat = new Intl.DateTimeFormat("en-SG", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function formatDate(date: string) {
  return dateFormat.format(new Date(date));
}

const tradeAmountFormat = new Intl.NumberFormat("en-SG", {
  style: "currency",
  currency: "SGD",
  currencyDisplay: "code",
  maximumFractionDigits: 16,
});

export function formatPreciseSgd(amount: string) {
  return tradeAmountFormat.format(amount as `${number}`);
}
