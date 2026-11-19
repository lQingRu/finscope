import { openFinancialAccount } from "@finscope/contracts/financial-accounts";
import type { FinancialAccount, OpenFinancialAccount } from "@finscope/contracts/financial-accounts";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Session } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { AccountApiError, isAccessError, listAccounts, openAccount } from "./account-api";
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
const emptyForm = { name: "", type: "bank", currency: "SGD", openingDate: "", openingBalance: "" } as const;

export const accountsQueryKey = ["financial-accounts"] as const;

function AccountList({ accounts }: { accounts: FinancialAccount[] }) {
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
            <li key={account.id} className="grid gap-1 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
              <div className="min-w-0">
                <h3 className="font-semibold break-words">{account.name}</h3>
                <p className="mt-1 text-sm text-[#495e55]">
                  {accountTypeLabels[account.type]} · Opened{" "}
                  <time dateTime={account.openingDate}>{dateFormat.format(new Date(account.openingDate))}</time>
                </p>
              </div>
              <span className="font-semibold tabular-nums sm:text-right">
                {formatSgd(account.openingBalance)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const inputStyle = "min-h-11 w-full min-w-0 rounded-lg border border-[#c5d3ca] bg-white px-3 py-2 text-base text-[#16302c] outline-none focus-visible:border-[#3f705e] focus-visible:ring-2 focus-visible:ring-[#b8d5c5] aria-invalid:border-[#a63624]";

function OpenAccountForm({ token, queryKey }: { token: string; queryKey: readonly string[] }) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState("");
  const {
    register, handleSubmit, reset, formState: { errors },
  } = useForm<OpenFinancialAccount>({
    defaultValues: emptyForm,
    resolver: zodResolver(openFinancialAccount),
  });

  const save = useMutation({
    mutationFn: (input: OpenFinancialAccount) => openAccount(token, input),
    onSuccess: async (account) => {
      reset(emptyForm);
      setNotice(`${account.name} was opened.`);
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: async (error) => {
      if (isAccessError(error)) {
        await queryClient.invalidateQueries({ queryKey });
      }
      setNotice("");
    },
  });

  return (
    <section className="rounded-xl border border-[#d8e4db] bg-white p-5 shadow-sm sm:p-6" aria-labelledby="open-heading">
      <h2 id="open-heading" className="text-lg font-semibold">Open a financial account</h2>
      <form className="mt-5 grid gap-4" noValidate onSubmit={handleSubmit((input) => save.mutate(input))}>
        <input type="hidden" {...register("currency")} />
        <div className="grid gap-1.5">
          <label htmlFor="account-name" className="text-sm font-semibold">Account name</label>
          <input
            id="account-name"
            className={inputStyle}
            maxLength={100}
            autoComplete="off"
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? "account-name-error" : undefined}
            {...register("name")}
          />
          {errors.name && <p id="account-name-error" className="text-sm text-[#8f3023]">{errors.name.message}</p>}
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="account-type" className="text-sm font-semibold">Account type</label>
          <select id="account-type" className={inputStyle} {...register("type")}>
            <option value="bank">Bank</option>
            <option value="brokerage">Brokerage</option>
          </select>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="opening-date" className="text-sm font-semibold">Opening date</label>
          <input
            id="opening-date"
            type="date"
            className={inputStyle}
            aria-invalid={Boolean(errors.openingDate)}
            aria-describedby={errors.openingDate ? "opening-date-error" : undefined}
            {...register("openingDate")}
          />
          {errors.openingDate && <p id="opening-date-error" className="text-sm text-[#8f3023]">{errors.openingDate.message}</p>}
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="opening-balance" className="text-sm font-semibold">Opening balance (SGD)</label>
          <input
            id="opening-balance"
            inputMode="decimal"
            autoComplete="off"
            className={inputStyle}
            placeholder="0.00"
            aria-invalid={Boolean(errors.openingBalance)}
            aria-describedby={errors.openingBalance ? "opening-balance-error" : undefined}
            {...register("openingBalance")}
          />
          {errors.openingBalance && <p id="opening-balance-error" className="text-sm text-[#8f3023]">{errors.openingBalance.message}</p>}
        </div>
        <Button type="submit" disabled={save.isPending} className="w-full">
          {save.isPending ? "Opening account…" : "Open account"}
        </Button>
        {save.isError && (
          <p role="alert" className="text-sm text-[#8f3023]">
            {isAccessError(save.error)
              ? "Your session no longer has access. Sign out and try again."
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
          <AccountList accounts={accounts.data.accounts} />
        </div>
        <OpenAccountForm token={session.access_token} queryKey={queryKey} />
      </div>
    </>
  );
}
