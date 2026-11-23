import { accountOpeningAfterActivityMessage, accountTypes, correctFinancialAccount } from "@finscope/contracts/financial-accounts";
import type { AccountWithBalance, CorrectFinancialAccount, FinancialAccount } from "@finscope/contracts/financial-accounts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { AccountApiError, correctAccount, deleteAccount, isAccessError, openAccount } from "./account-api";
import { accountTypeLabels } from "./account-labels";
import type { LabeledAccount } from "./account-labels";
import { Button } from "./components/ui/button";
import { StateMessage } from "./components/ui/workspace-primitives";
import { formatDate, formatSgd, formatPreciseSgd } from "./financial-format";
import { FormField, inputStyle } from "./form-field";
import { OpeningDateCalendar } from "./opening-date-calendar";

const emptyForm = { name: "", openingDate: "", openingBalance: "" };
const defaultAccountType = "bank";

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
              onSaved={(saved) => {
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

export function AccountList({ accounts, token, queryKey, historyId, onHistory, holdingsId, onHoldings, onOpenAccount }: AccountFormContext & HistoryControl & {
  accounts: LabeledAccount<AccountWithBalance>[];
  onOpenAccount: () => void;
}) {
  return (
    <section aria-labelledby="accounts-heading">
      <h2 id="accounts-heading" tabIndex={-1} className="mb-3 text-lg font-semibold">Financial accounts</h2>
      {accounts.length === 0 ? (
        <div className="ui-card p-5">
          <StateMessage kind="empty">No financial accounts yet. Open a bank or brokerage account to start tracking your balances.</StateMessage>
          <Button className="mt-4" onClick={onOpenAccount}>Open your first financial account</Button>
        </div>
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

type AccountFormProps = AccountFormContext & {
  account?: AccountWithBalance;
  onCancel: () => void;
  onSaved: (saved: FinancialAccount) => void;
};

export function AccountForm({ token, queryKey, account, onCancel, onSaved }: AccountFormProps) {
  const queryClient = useQueryClient();
  const id = useId();
  const [accountType, setAccountType] = useState<FinancialAccount["type"]>(defaultAccountType);
  const {
    register, handleSubmit, setError, setFocus, setValue, watch, formState: { errors },
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
      await queryClient.invalidateQueries({ queryKey });
      onSaved(saved);
    },
    onError: async (error) => {
      if (error instanceof AccountApiError && error.openingDateError) {
        setError("openingDate", { message: error.openingDateError }, { shouldFocus: true });
      }
      if (isAccessError(error)) {
        await queryClient.invalidateQueries({ queryKey });
      }
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
      </form>
    </section>
  );
}
