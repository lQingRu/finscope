import {
  defaultTransactionCategory,
  transactionBeforeOpeningMessage,
  transactionCategories,
  transactionInput,
} from "@finscope/contracts/transactions";
import type { Transaction, TransactionInput } from "@finscope/contracts/transactions";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import type { LabeledAccount } from "../../financial-accounts/account-labels";
import { isAccessError } from "../../../shared/lib/api-error";
import { Button } from "../../../shared/ui/button";
import { FormField } from "../../../shared/ui/form-field";
import { ActivityFundingError, saveTransaction, TransactionApiError } from "../api/activity-api";
import { useSingaporeToday } from "../../../shared/hooks/use-singapore-today";

const transactionFields = ["accountId", "type", "amount", "date", "category", "description"] as const;

function blankTransaction(accountId: string, date: string): TransactionInput {
  return {
    accountId, type: "expense", category: defaultTransactionCategory.expense,
    amount: "", date, description: "",
  };
}

type TransactionFormProps = {
  accounts: LabeledAccount[];
  token: string;
  queryKey: readonly string[];
  onStatusChange?: (dirty: boolean, saving: boolean) => void;
} & (
  | { transaction?: undefined; onCancel: () => void; onCorrected?: never; onRecorded: () => void }
  | { transaction: Transaction; onCancel: () => void; onCorrected: (saved: Transaction) => void; onRecorded?: never }
);

export function TransactionForm({ accounts, token, queryKey, transaction, onCancel, onCorrected, onRecorded, onStatusChange }: TransactionFormProps) {
  const client = useQueryClient();
  const id = useId();
  const { today } = useSingaporeToday();
  const dateChanged = useRef(false);
  const automaticDate = useRef(today);
  const dateInput = useRef<HTMLInputElement>(null);
  const initialAccount = accounts.length === 1 ? accounts[0].id : "";
  const {
    control, register, handleSubmit, resetField, setError, setFocus, setValue, watch, formState: { errors, isDirty },
  } = useForm<TransactionInput>({
    defaultValues: transaction
      ? {
        accountId: transaction.accountId, type: transaction.type, amount: transaction.amount, date: transaction.date,
        category: transaction.category, description: transaction.description ?? "",
      }
      : blankTransaction(initialAccount, automaticDate.current),
    resolver: zodResolver(transactionInput.superRefine(({ accountId, date }, context) => {
      const account = accounts.find(({ id }) => id === accountId);
      if (!account) {
        context.addIssue({ code: "custom", path: ["accountId"], message: "Select an available financial account." });
      } else if (date < account.openingDate) {
        context.addIssue({ code: "custom", path: ["date"], message: transactionBeforeOpeningMessage(account.openingDate) });
      }
    })),
  });
  function markDateChanged() {
    dateChanged.current = true;
  }
  const { ref: registerDate, ...dateField } = register("date", { onChange: markDateChanged });
  const selectedAccount = accounts.find(({ id }) => id === watch("accountId"));
  const type = watch("type");
  const editing = Boolean(transaction);
  useEffect(() => {
    setFocus("accountId");
  }, [setFocus]);

  useEffect(() => {
    if (editing || dateChanged.current || dateInput.current?.value !== automaticDate.current) return;
    automaticDate.current = today;
    resetField("date", { defaultValue: today });
  }, [editing, resetField, today]);

  const save = useMutation({
    mutationFn: (input: TransactionInput) => saveTransaction(token, input, transaction?.id),
    onSuccess: async (saved) => {
      if (onCorrected) onCorrected(saved);
      await client.invalidateQueries({ queryKey });
      onRecorded?.();
    },
    onError: async (error) => {
      if (error instanceof TransactionApiError && error.fieldErrors) {
        const firstField = transactionFields.find((name) => error.fieldErrors?.[name]);
        for (const name of transactionFields) {
          const message = error.fieldErrors[name];
          if (message) setError(name, { message });
        }
        if (firstField) requestAnimationFrame(() => setFocus(firstField));
      }
      if (isAccessError(error) || (error instanceof TransactionApiError && [400, 404].includes(error.status))) {
        await client.invalidateQueries({ queryKey });
      }
    },
  });
  useEffect(() => {
    onStatusChange?.(isDirty, save.isPending);
  }, [isDirty, onStatusChange, save.isPending]);

  const fieldErrors = save.error instanceof TransactionApiError ? save.error.fieldErrors : undefined;
  const errorHasField = transactionFields.some((name) => fieldErrors?.[name]);
  const headingId = editing ? id : "record-transaction-heading";
  const submitLabel = editing
    ? (save.isPending ? "Saving changes…" : "Save transaction")
    : (save.isPending ? "Recording transaction…" : "Record transaction");

  return (
    <section id={editing ? undefined : "record-transaction-form"} aria-labelledby={headingId} className={editing
      ? "mt-4 border-t border-line pt-4"
      : "ui-card p-5 sm:p-6"}
    >
      {editing
        ? <h4 id={headingId} className="font-semibold">Edit transaction</h4>
        : <h2 id={headingId} tabIndex={-1} className="text-lg font-semibold">Record a transaction</h2>}
      <form className="mt-4" noValidate onSubmit={handleSubmit((input) => save.mutate(input))}>
        <fieldset disabled={save.isPending} className="grid min-w-0 gap-4">
          <FormField label="Financial account" error={errors.accountId?.message}>
            {(attributes) => (
              <select {...attributes} required {...register("accountId")}>
                <option value="">Select an account</option>
                {accounts.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
              </select>
            )}
          </FormField>
          <FormField label="Transaction type" error={errors.type?.message}>
            {(attributes) => (
              <select {...attributes} required {...register("type", {
                onChange: (event) => {
                  const selected = event.target.value as TransactionInput["type"];
                  setValue("category", defaultTransactionCategory[selected], { shouldDirty: true, shouldValidate: true });
                },
              })}>
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            )}
          </FormField>
          <FormField label="Amount (SGD)" error={errors.amount?.message}>
            {(attributes) => <input {...attributes} required inputMode="decimal" autoComplete="off" placeholder="0.00" {...register("amount")} />}
          </FormField>
          <FormField label="Transaction date" error={errors.date?.message}>
            {(attributes) => (
              <input {...attributes} {...dateField} required type="date"
                min={selectedAccount?.openingDate ?? "0001-01-01"} max="9999-12-31"
                onInput={markDateChanged} ref={(element) => {
                  dateInput.current = element;
                  registerDate(element);
                }} />
            )}
          </FormField>
          <FormField label="Category" error={errors.category?.message}>
            {(attributes) => (
              <Controller name="category" control={control} render={({ field }) => (
                <select {...attributes} {...field} required>
                  {transactionCategories[type].map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              )} />
            )}
          </FormField>
          <FormField label="Description (optional)" error={errors.description?.message}>
            {(attributes) => <textarea {...attributes} rows={2} {...register("description")} />}
          </FormField>
          <div className="grid gap-2 sm:flex sm:justify-end">
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
            <Button type="submit">{submitLabel}</Button>
          </div>
        </fieldset>
        {save.isError && !errorHasField && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {isAccessError(save.error)
              ? "Your session no longer has access. Sign out and try again."
              : save.error instanceof ActivityFundingError && save.error.fundingError
                ? save.error.fundingError
                : save.error instanceof TransactionApiError && save.error.status === 404
                  ? "This transaction is no longer available."
                  : "FinScope couldn’t confirm the save. Check the account history before trying again."}
          </p>
        )}
      </form>
    </section>
  );
}
