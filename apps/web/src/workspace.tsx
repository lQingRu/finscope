import { currentSingaporeMonth, customReportingPeriod, zeroSgd } from "@finscope/contracts/financial-accounts";
import type { ReportingPeriod } from "@finscope/contracts/financial-accounts";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Session } from "@supabase/supabase-js";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useMatch, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { AccountApiError, isAccessError, listAccounts } from "./account-api";
import { labelFinancialAccounts } from "./account-labels";
import { AccountForm, AccountList } from "./accounts";
import { BrokerageHoldings } from "./brokerage-holdings";
import { Button } from "./components/ui/button";
import { Metric, StateMessage } from "./components/ui/workspace-primitives";
import { getPortfolioValuation } from "./etf-trade-api";
import { formatDate, formatSgd, formatPreciseSgd } from "./financial-format";
import { FormField } from "./form-field";
import { QuickActions } from "./quick-actions";
import { SignedInShell } from "./signed-in-shell";
import { TransactionHistory } from "./transaction-history";

export const accountsQueryKey = ["financial-accounts"] as const;

export function Workspace({ session, signingOut, onSignOut, signOutError }: {
  session: Session;
  signingOut: boolean;
  onSignOut: () => void;
  signOutError: string;
}) {
  const [period, setPeriod] = useState<ReportingPeriod>();
  const [historyId, setHistoryId] = useState<string>();
  const accountsMatch = useMatch({ from: "/workspace/accounts", shouldThrow: false });
  const navigate = useNavigate();
  const isAccounts = Boolean(accountsMatch);
  const accountFormOpen = accountsMatch?.search.open === true;
  const holdingsId = accountsMatch?.search.holdings;
  const [accountNotice, setAccountNotice] = useState("");
  const [activityNotice, setActivityNotice] = useState<{ message: string; holdings?: string }>();
  const previousView = useRef(isAccounts);

  useEffect(() => {
    if (previousView.current === isAccounts) return;
    previousView.current = isAccounts;
    setHistoryId(undefined);
    setAccountNotice("");
    if (!accountFormOpen) document.getElementById("workspace-title")?.focus();
  }, [isAccounts, accountFormOpen]);
  const queryKey = [...accountsQueryKey, session.user.id];
  const reportingPeriod = isAccounts ? undefined : period;
  const accounts = useQuery({
    queryKey: [...queryKey, "overview", reportingPeriod],
    queryFn: ({ signal }) => listAccounts(session.access_token, reportingPeriod, signal),
    placeholderData: keepPreviousData,
    retry: (failureCount, error) => !isAccessError(error) && failureCount < 1,
  });
  const portfolio = useQuery({
    queryKey: [...queryKey, "portfolio"],
    queryFn: ({ signal }) => getPortfolioValuation(session.access_token, signal),
    enabled: !isAccounts && accounts.isSuccess,
    retry: (count, error) => !isAccessError(error) && count < 1,
  });
  const shell = {
    title: isAccounts ? "Accounts" : "Overview",
    profile: session.user.email || "FinScope profile",
    signingOut,
    onSignOut,
    error: signOutError,
  };

  if (accounts.isPending) {
    return (
      <SignedInShell {...shell}>
        <StateMessage kind="loading" className="ui-card p-5">Loading your financial accounts…</StateMessage>
      </SignedInShell>
    );
  }

  if (accounts.isError) {
    if (accounts.error instanceof AccountApiError && accounts.error.status === 403) {
      return (
        <SignedInShell {...shell}>
          <section className="max-w-lg ui-card p-6">
            <h2 className="text-lg font-semibold">Access restricted</h2>
            <StateMessage kind="error" className="mt-2">Sign in with the designated owner’s Google account to open this workspace.</StateMessage>
          </section>
        </SignedInShell>
      );
    }
    return (
      <SignedInShell {...shell}>
        <section className="max-w-lg ui-card p-6">
          <h2 className="text-lg font-semibold">Accounts unavailable</h2>
          <StateMessage kind="error" className="mt-2">
            {isAccessError(accounts.error)
              ? "Your session could not be verified. Sign out and sign in again."
              : "FinScope couldn’t load your financial accounts."}
          </StateMessage>
          {!isAccessError(accounts.error) && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void accounts.refetch()}>Try again</Button>
              {reportingPeriod && <Button variant="outline" onClick={() => setPeriod(undefined)}>Use this month</Button>}
            </div>
          )}
        </section>
      </SignedInShell>
    );
  }

  const { summary } = accounts.data;
  const ownedAccounts = labelFinancialAccounts(accounts.data.accounts);
  const selectedAccount = ownedAccounts.find(({ id }) => id === historyId);
  const selectedBrokerage = ownedAccounts.find(({ id, type }) => id === holdingsId && type === "brokerage");
  const token = session.access_token;

  function openAccountForm() {
    setAccountNotice("");
    void navigate({ to: "/accounts", search: { open: true } });
  }

  function closeAccountForm() {
    void navigate({ to: "/accounts", search: {}, replace: true }).then(() => {
      document.getElementById("open-account-action")?.focus();
    });
  }

  function showHoldings(id?: string) {
    void navigate({ to: "/accounts", search: { holdings: id } });
  }

  const quickActions = (
    <QuickActions accounts={ownedAccounts} token={token} queryKey={queryKey}
      onOpenAccount={openAccountForm} onRecorded={(message, holdings) => setActivityNotice({ message, holdings })} />
  );

  return (
    <SignedInShell {...shell} quickActions={quickActions} contextualActions={isAccounts && !accountFormOpen && (
      <Button id="open-account-action" onClick={openAccountForm}>Open a financial account</Button>
    )}>
      {activityNotice && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <StateMessage kind="success">{activityNotice.message}</StateMessage>
          {activityNotice.holdings && (
            <Link to="/accounts" search={{ holdings: activityNotice.holdings }} className="text-sm font-semibold text-accent underline">
              View brokerage holdings
            </Link>
          )}
        </div>
      )}
      {isAccounts ? (
        accountFormOpen ? (
          <div className="mx-auto max-w-xl">
            <AccountForm token={token} queryKey={queryKey} onCancel={closeAccountForm} onSaved={(saved) => {
              setAccountNotice(`${saved.name} was opened.`);
              closeAccountForm();
            }} />
          </div>
        ) : (
          <div className="grid min-w-0 gap-6">
            {accountNotice && <StateMessage kind="success">{accountNotice}</StateMessage>}
            <AccountList accounts={ownedAccounts} token={token} queryKey={queryKey} onOpenAccount={openAccountForm}
              historyId={historyId} onHistory={(id) => {
                if (id === historyId) document.querySelector<HTMLElement>("#account-transaction-history h2")?.focus();
                else setHistoryId(id);
              }} holdingsId={holdingsId} onHoldings={(id) => {
                if (id === holdingsId) document.getElementById("brokerage-holdings-heading")?.focus();
                else showHoldings(id);
              }} />
            {selectedBrokerage && (
              <BrokerageHoldings key={`holdings-${selectedBrokerage.id}`} account={selectedBrokerage} token={token} queryKey={queryKey}
                onClose={() => {
                  showHoldings();
                  document.getElementById(`holdings-${selectedBrokerage.id}`)?.focus();
                }} />
            )}
            {selectedAccount && (
              <TransactionHistory key={`history-${selectedAccount.id}`} account={selectedAccount} accounts={ownedAccounts}
                token={token} queryKey={queryKey} onClose={() => {
                  setHistoryId(undefined);
                  document.getElementById(`history-${selectedAccount.id}`)?.focus();
                }} />
            )}
          </div>
        )
      ) : (
        <>
          <section className="summary-section" aria-labelledby="summary-heading">
            <div className="summary-header">
              <div>
                <h2 id="summary-heading" className="text-lg font-semibold">Financial summary</h2>
                <p role="status" className="mt-1 text-sm text-muted">
                  {accounts.isPlaceholderData
                    ? "Loading reporting period…"
                    : <>Reporting period <time dateTime={summary.from}>{formatDate(summary.from)}</time> to <time dateTime={summary.to}>{formatDate(summary.to)}</time></>}
                </p>
              </div>
              <ReportingPeriodForm period={period} onChange={setPeriod} />
            </div>
            <dl className="summary-metrics">
              <Metric label="Total cash balance" featured>{formatPreciseSgd(summary.balance)}</Metric>
              <Metric label="Income" tone={summary.income === zeroSgd ? undefined : "positive"}>{formatSgd(summary.income)}</Metric>
              <Metric label="Expenses" tone={summary.expenses === zeroSgd ? undefined : "negative"}>{formatSgd(summary.expenses)}</Metric>
              <Metric label="Net cashflow" tone={summary.netCashflow === zeroSgd ? undefined : summary.netCashflow.startsWith("-") ? "negative" : "positive"}>
                {formatSgd(summary.netCashflow)}
              </Metric>
            </dl>
            {ownedAccounts.some(({ type }) => type === "brokerage") && (
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
              <Link to="/accounts" className="text-sm font-semibold text-accent underline">Manage accounts</Link>
            </div>
            {ownedAccounts.length ? (
              <ul className="mt-3 divide-y divide-line">
                {ownedAccounts.map((account) => (
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
      )}
    </SignedInShell>
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
