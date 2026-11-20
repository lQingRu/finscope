import { accountTypes, correctFinancialAccount } from "@finscope/contracts/financial-accounts";
import type { CorrectFinancialAccount, FinancialAccount } from "@finscope/contracts/financial-accounts";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Session } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { AccountApiError, correctAccount, isAccessError, listAccounts, openAccount } from "./account-api";
import { Button } from "./components/ui/button";

const amountFormat = new Intl.NumberFormat("en-SG", {
  style: "currency",
  currency: "SGD",
  currencyDisplay: "code",
});
function formatSgd(amount: string) {
  // The response contract validates the decimal string before it reaches the formatter.
  return amountFormat.format(amount as `${number}`);
}

const dateFormat = new Intl.DateTimeFormat("en-SG", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const accountTypeLabels = { bank: "Bank", brokerage: "Brokerage" };
const emptyForm = { name: "", openingDate: "", openingBalance: "" };
const defaultAccountType = "bank";

export const accountsQueryKey = ["financial-accounts"] as const;

type AccountFormContext = { token: string; queryKey: readonly string[] };

function AccountRow({ account, token, queryKey }: AccountFormContext & { account: FinancialAccount }) {
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const editButton = useRef<HTMLButtonElement>(null);

  function finishEditing() {
    setEditing(false);
    editButton.current?.focus();
  }

  return (
    <li className="px-5 py-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
        <div className="min-w-0">
          <h3 className="font-semibold break-words">{account.name}</h3>
          <p className="mt-1 text-sm text-[#495e55]">
            {accountTypeLabels[account.type]} · Opened{" "}
            <time dateTime={account.openingDate}>{dateFormat.format(new Date(account.openingDate))}</time>
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 sm:justify-end">
          <span className="font-semibold tabular-nums">{formatSgd(account.openingBalance)}</span>
          <Button
            ref={editButton}
            variant="outline"
            aria-label={`Edit ${account.name}`}
            aria-expanded={editing}
            onClick={() => {
              setNotice("");
              setEditing(true);
            }}
          >
            Edit
          </Button>
        </div>
      </div>
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

function AccountList({ accounts, token, queryKey }: AccountFormContext & { accounts: FinancialAccount[] }) {
  return (
    <section aria-labelledby="accounts-heading">
      <h2 id="accounts-heading" className="mb-3 text-lg font-semibold">Financial accounts</h2>
      {accounts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#c6d5cc] px-5 py-7 text-sm text-[#495e55]">
          No financial accounts yet. Open a bank or brokerage account to start tracking your balances.
        </p>
      ) : (
        <ul className="divide-y divide-[#e0e8e2] overflow-hidden rounded-xl border border-[#d8e4db] bg-white">
          {accounts.map((account) => (
            <AccountRow key={account.id} account={account} token={token} queryKey={queryKey} />
          ))}
        </ul>
      )}
    </section>
  );
}

const inputStyle = "min-h-11 w-full min-w-0 rounded-lg border border-[#c5d3ca] bg-white px-3 py-2 text-base text-[#16302c] outline-none focus-visible:border-[#3f705e] focus-visible:ring-2 focus-visible:ring-[#b8d5c5] aria-invalid:border-[#a63624]";

type AccountFormProps = AccountFormContext & (
  | { account?: undefined; onCancel?: never; onCorrected?: never }
  | { account: FinancialAccount; onCancel: () => void; onCorrected: (saved: FinancialAccount) => void }
);

function AccountForm({ token, queryKey, account, onCancel, onCorrected }: AccountFormProps) {
  const queryClient = useQueryClient();
  const id = useId();
  const [notice, setNotice] = useState("");
  const [accountType, setAccountType] = useState<FinancialAccount["type"]>(defaultAccountType);
  const {
    register, handleSubmit, reset, setError, setFocus, formState: { errors },
  } = useForm<CorrectFinancialAccount>({
    defaultValues: account ? {
      name: account.name,
      openingDate: account.openingDate,
      openingBalance: account.openingBalance,
    } : emptyForm,
    resolver: zodResolver(correctFinancialAccount),
  });

  const editing = Boolean(account);
  useEffect(() => {
    if (editing) setFocus("name");
  }, [editing, setFocus]);

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
  const submitLabel = account
    ? (save.isPending ? "Saving changes…" : "Save changes")
    : (save.isPending ? "Opening account…" : "Open account");
  const saveError = save.isError && !(save.error instanceof AccountApiError && save.error.openingDateError);

  return (
    <section
      className={account
        ? "mt-4 border-t border-[#e0e8e2] pt-4"
        : "rounded-xl border border-[#d8e4db] bg-white p-5 shadow-sm sm:p-6"}
      aria-labelledby={`${id}-heading`}
    >
      {account
        ? <h4 id={`${id}-heading`} className="text-base font-semibold">{heading}</h4>
        : <h2 id={`${id}-heading`} className="text-lg font-semibold">{heading}</h2>}
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
            type="date"
            className={inputStyle}
            aria-invalid={Boolean(errors.openingDate)}
            aria-describedby={errors.openingDate ? `${id}-opening-date-error` : undefined}
            {...register("openingDate")}
          />
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
        <div className={account ? "grid gap-2 sm:flex sm:justify-end" : "grid"}>
          {onCancel && <Button variant="outline" disabled={save.isPending} onClick={onCancel}>Cancel</Button>}
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
  const queryKey = [...accountsQueryKey, session.user.id];
  const accounts = useQuery({
    queryKey,
    queryFn: ({ signal }) => listAccounts(session.access_token, signal),
    retry: (failureCount, error) => !isAccessError(error) && failureCount < 1,
  });

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
        {!isAccessError(accounts.error) && <Button variant="outline" className="mt-4" onClick={() => void accounts.refetch()}>Try again</Button>}
      </section>
    );
  }

  const { summary } = accounts.data;
  return (
    <>
      <h1 className="mb-6 text-3xl font-semibold tracking-tight sm:text-4xl">Account overview</h1>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-6">
          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-[#17382f] p-4 text-white">
              <dt className="text-sm text-[#d4e9df]">Total balance</dt>
              <dd className="mt-2 text-lg font-semibold break-words tabular-nums">{formatSgd(summary.balance)}</dd>
            </div>
            <div className="rounded-xl border border-[#d8e4db] bg-white p-4">
              <dt className="text-sm text-[#495e55]">Income</dt>
              <dd className="mt-2 text-lg font-semibold break-words tabular-nums">{formatSgd(summary.income)}</dd>
            </div>
            <div className="rounded-xl border border-[#d8e4db] bg-white p-4">
              <dt className="text-sm text-[#495e55]">Expenses</dt>
              <dd className="mt-2 text-lg font-semibold break-words tabular-nums">{formatSgd(summary.expenses)}</dd>
            </div>
          </dl>
          <AccountList accounts={accounts.data.accounts} token={session.access_token} queryKey={queryKey} />
        </div>
        <AccountForm token={session.access_token} queryKey={queryKey} />
      </div>
    </>
  );
}
