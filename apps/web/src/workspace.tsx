import { OpeningDateCalendar } from "./opening-date-calendar";
import { accountOpeningAfterActivityMessage, accountTypes, correctFinancialAccount, currentSingaporeMonth, customReportingPeriod, zeroSgd } from "@finscope/contracts/financial-accounts";
import type { AccountWithBalance, CorrectFinancialAccount, FinancialAccount, ReportingPeriod } from "@finscope/contracts/financial-accounts";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Session } from "@supabase/supabase-js";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { AccountApiError, correctAccount, deleteAccount, isAccessError, listAccounts, openAccount } from "./account-api";
import { accountTypeLabels, labelFinancialAccounts } from "./account-labels";
import type { LabeledAccount } from "./account-labels";
import { BrokerageHoldings } from "./brokerage-holdings";
import { getPortfolioValuation } from "./etf-trade-api";
import { EtfTradeForm } from "./etf-trade-form";
import { Button } from "./components/ui/button";
import { HeaderDisclosure } from "./components/ui/header-disclosure";
import { Metric, StateMessage } from "./components/ui/workspace-primitives";

import { formatDate, formatSgd, formatPreciseSgd } from "./financial-format";
import { FormField, inputStyle } from "./form-field";
import { TransactionForm } from "./transaction-form";
import { TransactionHistory } from "./transaction-history";
import { TransferForm } from "./transfer-form";
import { SignedInShell } from "./signed-in-shell";

const emptyForm = { name: "", openingDate: "", openingBalance: "" };
const defaultAccountType = "bank";

export const accountsQueryKey = ["financial-accounts"] as const;

type AccountFormContext = { token: string; queryKey: readonly string[] };

type HistoryControl = {
  historyId?: string;
  onHistory: (accountId: string) => void;
  holdingsId?: string;
  onHoldings: (accountId: string) => void;
};

function AccountRow({ account, token, queryKey, historyId, onHistory, holdingsId, onHoldings }: AccountFormContext & HistoryControl & { account: LabeledAccount<AccountWithBalance> }) {
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const editButton = useRef<HTMLButtonElement>(null);

  const deleteDialog = useRef<HTMLDialogElement>(null);
  const deleteTitle = useId();
  const queryClient = useQueryClient();
  const removal = useMutation({
    mutationFn: () => deleteAccount(token, account.id),
    onSuccess: async () => {
      deleteDialog.current?.close();
      await queryClient.invalidateQueries({ queryKey });
      document.getElementById("accounts-heading")?.focus();
    },
    onError: async (error) => {
      if (isAccessError(error) || (error instanceof AccountApiError && [404, 409].includes(error.status))) {
        await queryClient.invalidateQueries({ queryKey });
      }
    },
  });

  function finishEditing() {
    setEditing(false);
    editButton.current?.focus();
  }

  return (
    <>
      <tr role="row">
        <th scope="row" role="rowheader" className="account-name-cell">
          <h3>{account.label}</h3>
          <p className="account-detail">
            {accountTypeLabels[account.type]} · Opened{" "}
            <time dateTime={account.openingDate}>{formatDate(account.openingDate)}</time>
          </p>
          <p className="account-detail">Opening balance {formatSgd(account.openingBalance)}</p>
        </th>
        <td role="cell" className="account-balance-cell">
          <span aria-hidden="true" className="table-mobile-label">Current balance</span>
          <span className="font-semibold tabular-nums">{formatPreciseSgd(account.balance)}</span>
        </td>
        <td role="cell">
          <div className="account-row-actions">
            <Button id={`history-${account.id}`} variant="outline" aria-label={`View history for ${account.label}`}
              aria-expanded={historyId === account.id}
              aria-controls={historyId === account.id ? "account-transaction-history" : undefined}
              onClick={() => onHistory(account.id)}
            >View history</Button>
            {account.type === "brokerage" && (
              <Button id={`holdings-${account.id}`} variant="outline" aria-label={`View holdings for ${account.label}`}
                aria-expanded={holdingsId === account.id}
                aria-controls={holdingsId === account.id ? "brokerage-holdings" : undefined}
                onClick={() => onHoldings(account.id)}>View holdings</Button>
            )}
            <Button
              ref={editButton}
              variant="outline"
              aria-label={`Edit ${account.label}`}
              aria-expanded={editing}
              onClick={() => {
                setNotice("");
                setEditing(true);
              }}
            >
              Edit
            </Button>
            <Button type="button" variant="outline" aria-label={`Delete ${account.label}`} disabled={editing || Boolean(account.earliestActivityDate)}
              aria-describedby={account.earliestActivityDate ? `linked-activity-${account.id}` : undefined}
              onClick={() => {
                removal.reset();
                deleteDialog.current?.showModal();
              }}>Delete</Button>
          </div>
          {account.earliestActivityDate && (
            <p id={`linked-activity-${account.id}`} className="account-detail">Accounts with recorded activity cannot be deleted.</p>
          )}
          {notice && <p role="status" className="mt-2 text-sm text-positive">{notice}</p>}
          <dialog ref={deleteDialog} aria-labelledby={deleteTitle} className="ui-dialog"
            onCancel={(event) => { if (removal.isPending) event.preventDefault(); }}>
            <h2 id={deleteTitle} className="font-semibold [overflow-wrap:anywhere]">Delete {account.label}?</h2>
            <p className="my-3 text-sm">This permanently deletes the account and removes its opening balance from total cash.</p>
            {removal.isError && <p role="alert" className="mb-3 text-sm text-danger">{removal.error instanceof AccountApiError && removal.error.status === 409
              ? "This account has recorded activity and cannot be deleted."
              : "The deletion could not be confirmed. Check the account list before trying again."}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" autoFocus disabled={removal.isPending} onClick={() => deleteDialog.current?.close()}>Cancel</Button>
              <Button type="button" disabled={removal.isPending || Boolean(account.earliestActivityDate)} onClick={() => removal.mutate()}>
                {removal.isPending ? "Deleting…" : "Delete account"}
              </Button>
            </div>
          </dialog>
        </td>
      </tr>
      {editing && (
        <tr role="row">
          <td role="cell" colSpan={3}>
            <AccountForm
              account={account}
              token={token}
              queryKey={queryKey}
              onCancel={finishEditing}
              onCorrected={(saved) => {
                setNotice(`${saved.name} was updated.`);
                finishEditing();
              }}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function AccountList({ accounts, token, queryKey, historyId, onHistory, holdingsId, onHoldings }: AccountFormContext & HistoryControl & { accounts: LabeledAccount<AccountWithBalance>[] }) {
  return (
    <section aria-labelledby="accounts-heading">
      <h2 id="accounts-heading" tabIndex={-1} className="mb-3 text-lg font-semibold">Financial accounts</h2>
      {accounts.length === 0 ? (
        <StateMessage kind="empty" className="ui-card px-5 py-7">
          No financial accounts yet. Open a bank or brokerage account to start tracking your balances.
        </StateMessage>
      ) : (
        <div className="ui-card account-table-card">
          <table aria-labelledby="accounts-heading" role="table" className="ui-table">
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader" className="account-name-column">Account</th>
                <th scope="col" role="columnheader" className="account-balance-column">Current balance</th>
                <th scope="col" role="columnheader">Actions</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {accounts.map((account) => (
                <AccountRow key={account.id} account={account} token={token} queryKey={queryKey} historyId={historyId} onHistory={onHistory}
                  holdingsId={holdingsId} onHoldings={onHoldings} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type AccountFormProps = AccountFormContext & (
  | { account?: undefined; onCancel: () => void; onCorrected?: never }
  | { account: AccountWithBalance; onCancel: () => void; onCorrected: (saved: FinancialAccount) => void }
);

function AccountForm({ token, queryKey, account, onCancel, onCorrected }: AccountFormProps) {
  const queryClient = useQueryClient();
  const id = useId();
  const [notice, setNotice] = useState("");
  const [accountType, setAccountType] = useState<FinancialAccount["type"]>(defaultAccountType);
  const {
    register, handleSubmit, reset, setError, setFocus, setValue, watch, formState: { errors },
  } = useForm<CorrectFinancialAccount>({
    defaultValues: account ? {
      name: account.name,
      openingDate: account.openingDate,
      openingBalance: account.openingBalance,
    } : emptyForm,
    resolver: zodResolver(correctFinancialAccount.superRefine(({ openingDate }, context) => {
      if (account?.earliestActivityDate && openingDate > account.earliestActivityDate) {
        context.addIssue({
          code: "custom", path: ["openingDate"], message: accountOpeningAfterActivityMessage(account.earliestActivityDate),
        });
      }
    })),
  });

  useEffect(() => {
    setFocus("name");
  }, [setFocus]);

  const save = useMutation({
    mutationFn: (input: CorrectFinancialAccount) => account
      ? correctAccount(token, account.id, input)
      : openAccount(token, { ...input, type: accountType, currency: "SGD" }),
    onSuccess: async (saved) => {
      if (!account) {
        reset(emptyForm);
        setAccountType(defaultAccountType);
        setNotice(`${saved.name} was opened.`);
      }
      await queryClient.invalidateQueries({ queryKey });
      onCorrected?.(saved);
    },
    onError: async (error) => {
      if (error instanceof AccountApiError && error.openingDateError) {
        setError("openingDate", { message: error.openingDateError }, { shouldFocus: true });
      }
      if (isAccessError(error)) {
        await queryClient.invalidateQueries({ queryKey });
      }
      setNotice("");
    },
  });

  const heading = account ? "Edit financial account" : "Open a financial account";
  const headingId = account ? `${id}-heading` : "open-account-heading";
  const submitLabel = account
    ? (save.isPending ? "Saving changes…" : "Save changes")
    : (save.isPending ? "Opening account…" : "Open account");
  const saveError = save.isError && !(save.error instanceof AccountApiError && save.error.openingDateError);

  return (
    <section
      className={account
        ? "min-w-0"
        : "ui-card p-5 sm:p-6"}
      aria-labelledby={headingId}
      id={account ? undefined : "open-account-form"}
    >
      {account
        ? <h4 id={headingId} className="text-base font-semibold">{heading}</h4>
        : <h2 id={headingId} tabIndex={-1} className="text-lg font-semibold">{heading}</h2>}
      <form className="mt-5 grid gap-4" noValidate onSubmit={handleSubmit((input) => save.mutate(input))}>
        <FormField label="Account name" error={errors.name?.message}>
          {(attributes) => <input {...attributes} autoComplete="off" {...register("name")} />}
        </FormField>
        {!account && (
          <div className="grid gap-1.5">
            <label htmlFor={`${id}-account-type`} className="text-sm font-semibold">Account type</label>
            <select
              id={`${id}-account-type`}
              className={inputStyle}
              value={accountType}
              onChange={(event) => {
                const type = accountTypes.find((type) => type === event.currentTarget.value);
                if (type) setAccountType(type);
              }}
            >
              {accountTypes.map((type) => (
                <option key={type} value={type}>{accountTypeLabels[type]}</option>
              ))}
            </select>
          </div>
        )}
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-opening-date`} className="text-sm font-semibold">Opening date</label>
          <input
            id={`${id}-opening-date`}
            type="text"
            placeholder="YYYY-MM-DD"
            className={inputStyle}
            aria-invalid={Boolean(errors.openingDate)}
            aria-describedby={errors.openingDate ? `${id}-opening-date-error` : undefined}
            {...register("openingDate")}
          />
          <OpeningDateCalendar value={watch("openingDate")} earliestActivityDate={account?.earliestActivityDate} onSelect={(date) => {
            setValue("openingDate", date, { shouldDirty: true, shouldValidate: true });
          }} />
          {errors.openingDate && <p id={`${id}-opening-date-error`} className="text-sm text-danger">{errors.openingDate.message}</p>}
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-opening-balance`} className="text-sm font-semibold">Opening balance (SGD)</label>
          <input
            id={`${id}-opening-balance`}
            inputMode="decimal"
            autoComplete="off"
            className={inputStyle}
            placeholder="0.00"
            aria-invalid={Boolean(errors.openingBalance)}
            aria-describedby={errors.openingBalance ? `${id}-opening-balance-error` : undefined}
            {...register("openingBalance")}
          />
          {errors.openingBalance && <p id={`${id}-opening-balance-error`} className="text-sm text-danger">{errors.openingBalance.message}</p>}
        </div>
        <div className="grid gap-2 sm:flex sm:justify-end">
          <Button variant="outline" disabled={save.isPending} onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>{submitLabel}</Button>
        </div>
        {saveError && (
          <p role="alert" className="text-sm text-danger">
            {isAccessError(save.error)
              ? "Your session no longer has access. Sign out and try again."
              : save.error instanceof AccountApiError && save.error.fundingError
                ? save.error.fundingError
                : account
                  ? "We couldn’t confirm the changes were saved. Refresh the account list before trying again."
                  : "We couldn’t confirm the account was opened. Refresh the account list before trying again."}
          </p>
        )}
        {notice && <p role="status" className="text-sm text-positive">{notice}</p>}
      </form>
    </section>
  );
}

export function Workspace({ session, signingOut, onSignOut, signOutError }: {
  session: Session;
  signingOut: boolean;
  onSignOut: () => void;
  signOutError: string;
}) {
  const [period, setPeriod] = useState<ReportingPeriod>();
  const [historyId, setHistoryId] = useState<string>();
  const [holdingsId, setHoldingsId] = useState<string>();
  const [showTradeForm, setShowTradeForm] = useState(false);
  const [tradeNotice, setTradeNotice] = useState("");
  const [showTransactionForm, setShowTransactionForm] = useState(false);
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const quickActionsButton = useRef<HTMLButtonElement>(null);
  const queryKey = [...accountsQueryKey, session.user.id];
  const accounts = useQuery({
    queryKey: [...queryKey, "overview", period],
    queryFn: ({ signal }) => listAccounts(session.access_token, period, signal),
    placeholderData: keepPreviousData,
    retry: (failureCount, error) => !isAccessError(error) && failureCount < 1,
  });
  const portfolio = useQuery({
    queryKey: [...queryKey, "portfolio"],
    queryFn: ({ signal }) => getPortfolioValuation(session.access_token, signal),
    enabled: accounts.isSuccess,
    retry: (count, error) => !isAccessError(error) && count < 1,
  });
  const canRecordTrade = Boolean(accounts.data?.accounts.some(({ type }) => type === "brokerage"));
  const canRecordTransaction = Boolean(accounts.data?.accounts.length);
  const canRecordTransfer = (accounts.data?.accounts.length ?? 0) >= 2;

  useEffect(() => {
    if (!canRecordTransaction) setShowTransactionForm(false);
    if (!canRecordTransfer) setShowTransferForm(false);
    if (!canRecordTrade) setShowTradeForm(false);
  }, [canRecordTransaction, canRecordTransfer, canRecordTrade]);

  const shell = {
    title: "Overview",
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
              {period && <Button variant="outline" onClick={() => setPeriod(undefined)}>Use this month</Button>}
            </div>
          )}
        </section>
      </SignedInShell>
    );
  }

  const { summary } = accounts.data;
  const ownedAccounts = labelFinancialAccounts(accounts.data.accounts);
  const selectedAccount = ownedAccounts.find(({ id }) => id === historyId);
  const brokerageAccounts = ownedAccounts.filter(({ type }) => type === "brokerage");
  const selectedBrokerage = brokerageAccounts.find(({ id }) => id === holdingsId);
  const token = session.access_token;
  const transactionFormVisible = canRecordTransaction && showTransactionForm;
  const transferFormVisible = canRecordTransfer && showTransferForm;
  const tradeFormVisible = canRecordTrade && showTradeForm;
  const hasOpenForm = transactionFormVisible || transferFormVisible || tradeFormVisible || showAccountForm;

  function openForm(closeActions: () => void, headingId: string, setVisible: (visible: boolean) => void) {
    closeActions();
    const heading = document.getElementById(headingId);
    if (heading) heading.focus();
    else setVisible(true);
  }

  function closeForm(setVisible: (visible: boolean) => void) {
    setVisible(false);
    quickActionsButton.current?.focus();
  }

  const quickActions = (
    <HeaderDisclosure label="Quick actions" triggerRef={quickActionsButton} triggerClassName="quick-actions-trigger" trigger={
      <>
        <span aria-hidden="true" className="quick-actions-plus">+</span>
        Quick actions
      </>
    }>
      {(close) => (
        <>
          {canRecordTransaction && (
            <button type="button" className="header-popover-action"
              onClick={() => openForm(close, "record-transaction-heading", setShowTransactionForm)}>Record a transaction</button>
          )}
          {canRecordTransfer && (
            <button type="button" className="header-popover-action"
              onClick={() => openForm(close, "record-transfer-heading", setShowTransferForm)}>Transfer cash</button>
          )}
          {canRecordTrade && (
            <button type="button" className="header-popover-action"
              onClick={() => {
                setTradeNotice("");
                openForm(close, "record-etf-trade-heading", setShowTradeForm);
              }}>Record an ETF trade</button>
          )}
          <button type="button" className="header-popover-action"
            onClick={() => openForm(close, "open-account-heading", setShowAccountForm)}>Open a financial account</button>
        </>
      )}
    </HeaderDisclosure>
  );

  return (
    <SignedInShell {...shell} quickActions={quickActions}>
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
        {canRecordTrade && (
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
      {tradeNotice && <StateMessage kind="success" className="mb-4">{tradeNotice}</StateMessage>}
      <div className={`grid items-start gap-6${hasOpenForm ? " lg:grid-cols-[minmax(0,1fr)_22rem]" : ""}`}>
        <div className="grid min-w-0 gap-6">
          <AccountList accounts={ownedAccounts} token={token} queryKey={queryKey} historyId={historyId} onHistory={(id) => {
            if (id === historyId) {
              document.querySelector<HTMLElement>("#account-transaction-history h2")?.focus();
            } else {
              setHistoryId(id);
            }
          }} holdingsId={holdingsId} onHoldings={(id) => {
            if (id === holdingsId) document.getElementById("brokerage-holdings-heading")?.focus();
            else setHoldingsId(id);
          }} />
          {selectedBrokerage && (
            <BrokerageHoldings key={`holdings-${selectedBrokerage.id}`} account={selectedBrokerage} token={token} queryKey={queryKey}
              onClose={() => {
                setHoldingsId(undefined);
                document.getElementById(`holdings-${selectedBrokerage.id}`)?.focus();
              }} />
          )}
          {selectedAccount && (
            <TransactionHistory key={`history-${selectedAccount.id}`} account={selectedAccount} accounts={ownedAccounts}
              token={token} queryKey={queryKey}
              onClose={() => {
                setHistoryId(undefined);
                document.getElementById(`history-${selectedAccount.id}`)?.focus();
              }}
            />
          )}
        </div>
        {hasOpenForm && (
          <div className="grid min-w-0 gap-6">
            {transactionFormVisible && <TransactionForm accounts={ownedAccounts} token={token} queryKey={queryKey}
              onCancel={() => closeForm(setShowTransactionForm)} />}
            {transferFormVisible && <TransferForm accounts={ownedAccounts} token={token} queryKey={queryKey}
              onCancel={() => closeForm(setShowTransferForm)} />}
            {tradeFormVisible && <EtfTradeForm accounts={brokerageAccounts} token={token} queryKey={queryKey}
              onCancel={() => closeForm(setShowTradeForm)}
              onSaved={(trade) => {
                setShowTradeForm(false);
                setTradeNotice(`${trade.ticker} ${trade.type} recorded.`);
                setHoldingsId(trade.accountId);
                if (trade.accountId === holdingsId) document.getElementById("brokerage-holdings-heading")?.focus();
              }} />}
            {showAccountForm && <AccountForm token={token} queryKey={queryKey} onCancel={() => closeForm(setShowAccountForm)} />}
          </div>
        )}
      </div>
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
