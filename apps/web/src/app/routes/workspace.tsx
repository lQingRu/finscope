import type { ReportingPeriod } from "@finscope/contracts/financial-accounts";
import type { Session } from "@supabase/supabase-js";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useMatch, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AccountActivityHistory } from "../../features/cash-activity/components/account-activity-history";
import { labelFinancialAccounts } from "../../features/financial-accounts/account-labels";
import { listAccounts } from "../../features/financial-accounts/api/account-api";
import { AccountForm, AccountList } from "../../features/financial-accounts/components/accounts";
import { getPortfolioValuation } from "../../features/investments/api/etf-trade-api";
import { BrokerageHoldings } from "../../features/investments/components/brokerage-holdings";
import { Overview } from "../../features/overview/overview";
import { ApiError, isAccessError } from "../../shared/lib/api-error";
import { Button } from "../../shared/ui/button";
import { StateMessage } from "../../shared/ui/state-message";
import { SignedInShell } from "../layouts/signed-in-shell";
import { QuickActions } from "../quick-actions";

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
    if (accounts.error instanceof ApiError && accounts.error.status === 403) {
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
              <AccountActivityHistory key={`history-${selectedAccount.id}`} account={selectedAccount} accounts={ownedAccounts}
                token={token} queryKey={queryKey} onClose={() => {
                  setHistoryId(undefined);
                  document.getElementById(`history-${selectedAccount.id}`)?.focus();
                }} />
            )}
          </div>
        )
      ) : (
        <Overview
          summary={accounts.data.summary}
          accounts={ownedAccounts}
          period={period}
          isReportingPeriodLoading={accounts.isPlaceholderData}
          onPeriodChange={setPeriod}
          portfolio={portfolio}
          manageAccountsLink={
            <Link to="/accounts" className="text-sm font-semibold text-accent underline">Manage accounts</Link>
          }
        />
      )}
    </SignedInShell>
  );
}
