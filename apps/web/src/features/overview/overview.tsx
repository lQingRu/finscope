import type { PortfolioValuation } from "@finscope/contracts/etf-trades";
import { currentSingaporeMonth, customReportingPeriod, zeroSgd } from "@finscope/contracts/financial-accounts";
import type { AccountWithBalance, FinancialAccountOverview, ReportingPeriod } from "@finscope/contracts/financial-accounts";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Button } from "../../shared/ui/button";
import { FormField } from "../../shared/ui/form-field";
import { StateMessage } from "../../shared/ui/state-message";
import { formatDate, formatSgd, formatPreciseSgd } from "../../shared/utils/financial-format";

type OverviewProps = {
  summary: FinancialAccountOverview["summary"];
  accounts: readonly (Pick<AccountWithBalance, "id" | "type" | "balance"> & { label: string })[];
  period?: ReportingPeriod;
  isReportingPeriodLoading: boolean;
  onPeriodChange: (period?: ReportingPeriod) => void;
  portfolio: { data: PortfolioValuation | undefined; isPending: boolean; isError: boolean };
  manageAccountsLink: ReactNode;
};

export function Overview({
  summary,
  accounts,
  period,
  isReportingPeriodLoading,
  onPeriodChange,
  portfolio,
  manageAccountsLink,
}: OverviewProps) {
  return (
    <>
      <section className="summary-section" aria-labelledby="summary-heading">
        <div className="summary-header">
          <div>
            <h2 id="summary-heading" className="text-lg font-semibold">Financial summary</h2>
            <p role="status" className="mt-1 text-sm text-muted">
              {isReportingPeriodLoading
                ? "Loading reporting period…"
                : <>Reporting period <time dateTime={summary.from}>{formatDate(summary.from)}</time> to <time dateTime={summary.to}>{formatDate(summary.to)}</time></>}
            </p>
          </div>
          <ReportingPeriodForm period={period} onChange={onPeriodChange} />
        </div>
        <dl className="summary-metrics">
          <Metric label="Total cash balance" featured>{formatPreciseSgd(summary.balance)}</Metric>
          <Metric label="Income" tone={summary.income === zeroSgd ? undefined : "positive"}>{formatSgd(summary.income)}</Metric>
          <Metric label="Expenses" tone={summary.expenses === zeroSgd ? undefined : "negative"}>{formatSgd(summary.expenses)}</Metric>
          <Metric label="Net cashflow" tone={summary.netCashflow === zeroSgd ? undefined : summary.netCashflow.startsWith("-") ? "negative" : "positive"}>
            {formatSgd(summary.netCashflow)}
          </Metric>
        </dl>
        {accounts.some(({ type }) => type === "brokerage") && (
          <div className="ui-card p-4">
            <h2 className="text-sm font-semibold">Portfolio valuation</h2>
            {portfolio.isPending && <StateMessage kind="loading" className="mt-1">Loading portfolio valuation…</StateMessage>}
            {portfolio.isError && <StateMessage kind="error" className="mt-1">Portfolio valuation unavailable.</StateMessage>}
            {portfolio.data && (
              <>
                <p className="mt-1 break-words text-lg font-semibold tabular-nums">{formatPreciseSgd(portfolio.data.knownSubtotal)}</p>
                {portfolio.data.valuation === "partial" && <p className="mt-1 text-sm text-warning">
                  Partial valuation · {portfolio.data.unpricedHoldings} {portfolio.data.unpricedHoldings === 1
                    ? "holding awaiting a price" : "holdings awaiting prices"}
                </p>}
              </>
            )}
          </div>
        )}
      </section>
      <section className="ui-card p-5" aria-labelledby="overview-accounts-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="overview-accounts-heading" className="text-lg font-semibold">Financial accounts</h2>
          {manageAccountsLink}
        </div>
        {accounts.length ? (
          <ul className="mt-3 divide-y divide-line">
            {accounts.map((account) => (
              <li key={account.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 text-sm">
                <span className="[overflow-wrap:anywhere]">{account.label}</span>
                <span className="font-semibold tabular-nums [overflow-wrap:anywhere]">{formatPreciseSgd(account.balance)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <StateMessage kind="empty" className="mt-3">No financial accounts yet.</StateMessage>
        )}
      </section>
    </>
  );
}

function ReportingPeriodForm({ period, onChange }: {
  period?: ReportingPeriod;
  onChange: (period?: ReportingPeriod) => void;
}) {
  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<ReportingPeriod>({
    defaultValues: period ?? currentSingaporeMonth(),
    resolver: zodResolver(customReportingPeriod),
  });
  const [from, to] = watch(["from", "to"]);

  return (
    <form aria-label="Select reporting period" onSubmit={handleSubmit((input) => onChange(input))} noValidate>
      <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,13rem)_minmax(0,13rem)_auto] sm:justify-start">
        <FormField label="Reporting start date" error={errors.from?.message}>
          {(attributes) => (
            <input {...attributes} required type="date" min="0001-01-01" max={to || "9999-12-31"} {...register("from")} />
          )}
        </FormField>
        <FormField label="Reporting end date" error={errors.to?.message}>
          {(attributes) => (
            <input {...attributes} required type="date" min={from || "0001-01-01"} max="9999-12-31" {...register("to")} />
          )}
        </FormField>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="outline">Apply period</Button>
          {period && (
            <Button variant="outline" onClick={() => {
              reset(currentSingaporeMonth());
              onChange(undefined);
            }}>This month</Button>
          )}
        </div>
      </div>
    </form>
  );
}

function Metric({ label, children, featured, tone }: {
  label: string;
  children: ReactNode;
  featured?: boolean;
  tone?: "positive" | "negative";
}) {
  return (
    <div className="ui-card ui-metric" data-featured={featured}>
      <dt>{label}</dt>
      <dd data-tone={tone}>{children}</dd>
    </div>
  );
}
