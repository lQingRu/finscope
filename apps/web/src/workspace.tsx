import { OpeningDateCalendar } from "./opening-date-calendar";
import { accountOpeningAfterActivityMessage, accountTypes, correctFinancialAccount, currentSingaporeMonth, customReportingPeriod } from "@finscope/contracts/financial-accounts";
import type { AccountWithBalance, CorrectFinancialAccount, FinancialAccount, ReportingPeriod } from "@finscope/contracts/financial-accounts";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Session } from "@supabase/supabase-js";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { AccountApiError, correctAccount, deleteAccount, isAccessError, listAccounts, openAccount } from "./account-api";
import { accountTypeLabels, labelFinancialAccounts } from "./account-labels";
import type { LabeledAccount } from "./account-labels";
import { Button } from "./components/ui/button";

import { formatDate, formatSgd } from "./financial-format";
import { FormField, inputStyle } from "./form-field";
import { TransactionForm } from "./transaction-form";
import { TransactionHistory } from "./transaction-history";
import { TransferForm } from "./transfer-form";

const emptyForm = { name: "", openingDate: "", openingBalance: "" };
const defaultAccountType = "bank";

export const accountsQueryKey = ["financial-accounts"] as const;

type AccountFormContext = { token: string; queryKey: readonly string[] };

type HistoryControl = { historyId?: string; onHistory: (accountId: string) => void };

function AccountRow({ account, token, queryKey, historyId, onHistory }: AccountFormContext & HistoryControl & { account: LabeledAccount<AccountWithBalance> }) {
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
    <li className="px-5 py-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
        <div className="min-w-0">
          <h3 className="font-semibold break-words">{account.label}</h3>
          <p className="mt-1 text-sm text-[#495e55]">
            {accountTypeLabels[account.type]} · Opened{" "}
            <time dateTime={account.openingDate}>{formatDate(account.openingDate)}</time>
          </p>
          <p className="mt-1 text-sm text-[#495e55]">Opening balance {formatSgd(account.openingBalance)}</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 sm:justify-end">
          <span className="max-w-full break-words font-semibold tabular-nums">{formatSgd(account.balance)}</span>
          <Button id={`history-${account.id}`} variant="outline" aria-label={`View history for ${account.label}`}
            aria-expanded={historyId === account.id}
            aria-controls={historyId === account.id ? "account-transaction-history" : undefined}
            onClick={() => onHistory(account.id)}
          >View history</Button>
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
      </div>
      {account.earliestActivityDate && (
        <p id={`linked-activity-${account.id}`} className="mt-2 text-sm text-[#495e55]">Accounts with recorded activity cannot be deleted.</p>
      )}
      <dialog ref={deleteDialog} aria-labelledby={deleteTitle} className="m-auto w-full max-w-sm rounded-xl p-5 shadow-lg backdrop:bg-black/40"
        onCancel={(event) => { if (removal.isPending) event.preventDefault(); }}>
        <h4 id={deleteTitle} className="font-semibold">Delete {account.label}?</h4>
        <p className="my-3 text-sm">This permanently deletes the account and removes its opening balance from total cash.</p>
        {removal.isError && <p role="alert" className="mb-3 text-sm">{removal.error instanceof AccountApiError && removal.error.status === 409
          ? "This account has recorded activity and cannot be deleted."
          : "The deletion could not be confirmed. Check the account list before trying again."}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" autoFocus disabled={removal.isPending} onClick={() => deleteDialog.current?.close()}>Cancel</Button>
          <Button type="button" disabled={removal.isPending || Boolean(account.earliestActivityDate)} onClick={() => removal.mutate()}>
            {removal.isPending ? "Deleting…" : "Delete account"}
          </Button>
        </div>
      </dialog>
      {editing && (
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
      )}
      {notice && <p role="status" className="mt-3 text-sm text-[#286347]">{notice}</p>}
    </li>
  );
}

function AccountList({ accounts, token, queryKey, historyId, onHistory }: AccountFormContext & HistoryControl & { accounts: LabeledAccount<AccountWithBalance>[] }) {
  return (
    <section aria-labelledby="accounts-heading">
      <h2 id="accounts-heading" tabIndex={-1} className="mb-3 text-lg font-semibold">Financial accounts</h2>
      {accounts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#c6d5cc] px-5 py-7 text-sm text-[#495e55]">
          No financial accounts yet. Open a bank or brokerage account to start tracking your balances.
        </p>
      ) : (
        <ul className="divide-y divide-[#e0e8e2] overflow-hidden rounded-xl border border-[#d8e4db] bg-white">
          {accounts.map((account) => (
            <AccountRow key={account.id} account={account} token={token} queryKey={queryKey} historyId={historyId} onHistory={onHistory} />
          ))}
        </ul>
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
        ? "mt-4 border-t border-[#e0e8e2] pt-4"
        : "min-w-0 rounded-xl border border-[#d8e4db] bg-white p-5 shadow-sm sm:p-6"}
      aria-labelledby={headingId}
      id={account ? undefined : "open-account-form"}
    >
      {account
        ? <h4 id={headingId} className="text-base font-semibold">{heading}</h4>
        : <h2 id={headingId} tabIndex={-1} className="text-lg font-semibold">{heading}</h2>}
      <form className="mt-5 grid gap-4" noValidate onSubmit={handleSubmit((input) => save.mutate(input))}>
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-account-name`} className="text-sm font-semibold">Account name</label>
          <input
            id={`${id}-account-name`}
            className={inputStyle}
            autoComplete="off"
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? `${id}-account-name-error` : undefined}
            {...register("name")}
          />
          {errors.name && <p id={`${id}-account-name-error`} className="text-sm text-[#8f3023]">{errors.name.message}</p>}
        </div>
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
          {errors.openingDate && <p id={`${id}-opening-date-error`} className="text-sm text-[#8f3023]">{errors.openingDate.message}</p>}
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
          {errors.openingBalance && <p id={`${id}-opening-balance-error`} className="text-sm text-[#8f3023]">{errors.openingBalance.message}</p>}
        </div>
        <div className="grid gap-2 sm:flex sm:justify-end">
          <Button variant="outline" disabled={save.isPending} onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>{submitLabel}</Button>
        </div>
        {saveError && (
          <p role="alert" className="text-sm text-[#8f3023]">
            {isAccessError(save.error)
              ? "Your session no longer has access. Sign out and try again."
              : account
                ? "We couldn’t confirm the changes were saved. Refresh the account list before trying again."
                : "We couldn’t confirm the account was opened. Refresh the account list before trying again."}
          </p>
        )}
        {notice && <p role="status" className="text-sm text-[#286347]">{notice}</p>}
      </form>
    </section>
  );
}

export function Workspace({ session }: { session: Session }) {
  const [period, setPeriod] = useState<ReportingPeriod>();
  const [historyId, setHistoryId] = useState<string>();
  const [showTransactionForm, setShowTransactionForm] = useState(false);
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const recordButton = useRef<HTMLButtonElement>(null);
  const transferButton = useRef<HTMLButtonElement>(null);
  const openAccountButton = useRef<HTMLButtonElement>(null);
  const queryKey = [...accountsQueryKey, session.user.id];
  const accounts = useQuery({
    queryKey: [...queryKey, "overview", period],
    queryFn: ({ signal }) => listAccounts(session.access_token, period, signal),
    placeholderData: keepPreviousData,
    retry: (failureCount, error) => !isAccessError(error) && failureCount < 1,
  });
  const canRecordTransaction = Boolean(accounts.data?.accounts.length);
  const canRecordTransfer = (accounts.data?.accounts.length ?? 0) >= 2;

  useEffect(() => {
    if (!canRecordTransaction) setShowTransactionForm(false);
    if (!canRecordTransfer) setShowTransferForm(false);
  }, [canRecordTransaction, canRecordTransfer]);

  if (accounts.isPending) {
    return <p role="status" className="text-sm text-[#495e55]">Loading your financial accounts…</p>;
  }

  if (accounts.isError) {
    if (accounts.error instanceof AccountApiError && accounts.error.status === 403) {
      return (
        <section className="max-w-lg rounded-xl border border-[#d8e4db] bg-white p-6">
          <h1 className="text-2xl font-semibold">Access restricted</h1>
          <p role="alert" className="mt-2 text-sm text-[#495e55]">Sign in with the designated owner’s Google account to open this workspace.</p>
        </section>
      );
    }
    return (
      <section className="max-w-lg rounded-xl border border-[#d8e4db] bg-white p-6">
        <h1 className="text-2xl font-semibold">Accounts unavailable</h1>
        <p role="alert" className="mt-2 text-sm text-[#495e55]">
          {isAccessError(accounts.error)
            ? "Your session could not be verified. Sign out and sign in again."
            : "FinScope couldn’t load your financial accounts."}
        </p>
        {!isAccessError(accounts.error) && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void accounts.refetch()}>Try again</Button>
            {period && <Button variant="outline" onClick={() => setPeriod(undefined)}>Use this month</Button>}
          </div>
        )}
      </section>
    );
  }

  const { summary } = accounts.data;
  const ownedAccounts = labelFinancialAccounts(accounts.data.accounts);
  const selectedAccount = ownedAccounts.find(({ id }) => id === historyId);
  const token = session.access_token;
  const transactionFormVisible = canRecordTransaction && showTransactionForm;
  const transferFormVisible = canRecordTransfer && showTransferForm;
  const hasOpenForm = transactionFormVisible || transferFormVisible || showAccountForm;
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Account overview</h1>
        <div className="flex flex-wrap gap-2">
          {canRecordTransaction && (
            <Button ref={recordButton} aria-expanded={transactionFormVisible}
              aria-controls={transactionFormVisible ? "record-transaction-form" : undefined}
              onClick={() => {
                if (transactionFormVisible) document.getElementById("record-transaction-heading")?.focus();
                else setShowTransactionForm(true);
              }}>Record a transaction</Button>
          )}
          {canRecordTransfer && (
            <Button ref={transferButton} variant="outline" aria-expanded={transferFormVisible}
              aria-controls={transferFormVisible ? "record-transfer-form" : undefined}
              onClick={() => {
                if (transferFormVisible) document.getElementById("record-transfer-heading")?.focus();
                else setShowTransferForm(true);
              }}>Transfer cash</Button>
          )}
          <Button ref={openAccountButton} variant={canRecordTransaction ? "outline" : "default"}
            aria-expanded={showAccountForm} aria-controls={showAccountForm ? "open-account-form" : undefined}
            onClick={() => {
              if (showAccountForm) document.getElementById("open-account-heading")?.focus();
              else setShowAccountForm(true);
            }}>Open a financial account</Button>
        </div>
      </div>
      <section className="mb-6 grid gap-4" aria-label="Financial summary">
        <ReportingPeriodForm period={period} onChange={setPeriod} />
        <p role="status" className="text-sm text-[#495e55]">
          {accounts.isPlaceholderData
            ? "Loading reporting period…"
            : <>Reporting period <time dateTime={summary.from}>{formatDate(summary.from)}</time> to <time dateTime={summary.to}>{formatDate(summary.to)}</time></>}
        </p>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {([
            ["Total balance", summary.balance],
            ["Income", summary.income],
            ["Expenses", summary.expenses],
            ["Net cashflow", summary.netCashflow],
          ] as const).map(([label, amount], index) => (
            <div key={label} className={index === 0
              ? "min-w-0 rounded-xl bg-[#17382f] p-4 text-white"
              : "min-w-0 rounded-xl border border-[#d8e4db] bg-white p-4"}>
              <dt className={index === 0 ? "text-sm text-[#d4e9df]" : "text-sm text-[#495e55]"}>{label}</dt>
              <dd className="mt-2 text-lg font-semibold break-words tabular-nums">{formatSgd(amount)}</dd>
            </div>
          ))}
        </dl>
      </section>
      <div className={`grid items-start gap-6${hasOpenForm ? " lg:grid-cols-[minmax(0,1fr)_22rem]" : ""}`}>
        <div className="grid min-w-0 gap-6">
          <AccountList accounts={ownedAccounts} token={token} queryKey={queryKey} historyId={historyId} onHistory={(id) => {
            if (id === historyId) {
              document.querySelector<HTMLElement>("#account-transaction-history h2")?.focus();
            } else {
              setHistoryId(id);
            }
          }} />
          {selectedAccount && (
            <TransactionHistory key={selectedAccount.id} account={selectedAccount} accounts={ownedAccounts}
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
              onCancel={() => {
                setShowTransactionForm(false);
                recordButton.current?.focus();
              }} />}
            {transferFormVisible && <TransferForm accounts={ownedAccounts} token={token} queryKey={queryKey}
              onCancel={() => {
                setShowTransferForm(false);
                transferButton.current?.focus();
              }} />}
            {showAccountForm && <AccountForm token={token} queryKey={queryKey} onCancel={() => {
              setShowAccountForm(false);
              openAccountButton.current?.focus();
            }} />}
          </div>
        )}
      </div>
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
