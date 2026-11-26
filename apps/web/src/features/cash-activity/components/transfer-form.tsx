import { singaporeCalendarDate } from "@finscope/contracts/financial-accounts";
import { minimumTransferDate, transferAccountFields, transferBeforeOpeningMessage, transferInput } from "@finscope/contracts/transfers";
import type { Transfer, TransferInput } from "@finscope/contracts/transfers";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId } from "react";
import { useForm } from "react-hook-form";
import type { LabeledAccount } from "../../financial-accounts/account-labels";
import { isAccessError } from "../../../shared/lib/api-error";
import { Button } from "../../../shared/ui/button";
import { FormField } from "../../../shared/ui/form-field";
import { ActivityFundingError, saveTransfer, TransferApiError } from "../api/activity-api";

const editableFields = [...transferAccountFields, "amount", "date"] as const;
const accountSelectors = [
  { field: "sourceAccountId", other: "destinationAccountId", label: "Source financial account" },
  { field: "destinationAccountId", other: "sourceAccountId", label: "Destination financial account" },
] as const;

function blankTransfer(): TransferInput {
  return { sourceAccountId: "", destinationAccountId: "", amount: "", date: singaporeCalendarDate() };
}

function earliestDateForSelection(accounts: LabeledAccount[], sourceAccountId: string, destinationAccountId: string) {
  const source = accounts.find(({ id }) => id === sourceAccountId);
  const destination = accounts.find(({ id }) => id === destinationAccountId);
  return minimumTransferDate(source?.openingDate, destination?.openingDate);
}

type TransferFormProps = {
  accounts: LabeledAccount[];
  token: string;
  queryKey: readonly string[];
  onStatusChange?: (dirty: boolean, saving: boolean) => void;
  onCancel: () => void;
} & (
  | { transfer?: undefined; onCorrected?: never; onRecorded: () => void }
  | { transfer: Transfer; onCorrected: (saved: Transfer) => void; onRecorded?: never }
);

export function TransferForm({ accounts, token, queryKey, transfer, onCancel, onCorrected, onRecorded, onStatusChange }: TransferFormProps) {
  const client = useQueryClient();
  const id = useId();
  const { register, handleSubmit, setError, setFocus, watch, formState: { errors, isDirty } } = useForm<TransferInput>({
    defaultValues: transfer ? {
      sourceAccountId: transfer.sourceAccountId,
      destinationAccountId: transfer.destinationAccountId,
      amount: transfer.amount,
      date: transfer.date,
    } : blankTransfer(),
    resolver: zodResolver(transferInput.superRefine(({ sourceAccountId, destinationAccountId, date }, context) => {
      for (const [field, accountId] of [["sourceAccountId", sourceAccountId], ["destinationAccountId", destinationAccountId]] as const) {
        if (!accounts.some(({ id }) => id === accountId)) {
          context.addIssue({ code: "custom", path: [field], message: "Select an available financial account." });
        }
      }
      const minimumDate = earliestDateForSelection(accounts, sourceAccountId, destinationAccountId);
      if (minimumDate && date < minimumDate) {
        context.addIssue({ code: "custom", path: ["date"], message: transferBeforeOpeningMessage(minimumDate) });
      }
    })),
  });
  const selected = watch(["sourceAccountId", "destinationAccountId"]);
  const choices = { sourceAccountId: selected[0], destinationAccountId: selected[1] };
  const minimumDate = earliestDateForSelection(accounts, ...selected);
  const editing = Boolean(transfer);
  useEffect(() => { setFocus("sourceAccountId"); }, [setFocus]);

  const save = useMutation({
    mutationFn: (input: TransferInput) => saveTransfer(token, input, transfer?.id),
    onSuccess: async (saved) => {
      if (onCorrected) onCorrected(saved);
      await client.invalidateQueries({ queryKey });
      onRecorded?.();
    },
    onError: async (error) => {
      if (error instanceof TransferApiError && error.fieldErrors) {
        const firstField = editableFields.find((name) => error.fieldErrors?.[name]);
        for (const name of editableFields) {
          const message = error.fieldErrors[name];
          if (message) setError(name, { message });
        }
        if (firstField) requestAnimationFrame(() => setFocus(firstField));
      }
      if (isAccessError(error) || (error instanceof TransferApiError && [400, 404].includes(error.status))) {
        await client.invalidateQueries({ queryKey });
      }
    },
  });
  useEffect(() => {
    onStatusChange?.(isDirty, save.isPending);
  }, [isDirty, onStatusChange, save.isPending]);

  const fieldErrors = save.error instanceof TransferApiError ? save.error.fieldErrors : undefined;
  const headingId = editing ? id : "record-transfer-heading";
  const submitLabel = editing
    ? (save.isPending ? "Saving changes…" : "Save transfer")
    : (save.isPending ? "Recording transfer…" : "Record transfer");

  return (
    <section id={editing ? undefined : "record-transfer-form"} aria-labelledby={headingId} className={editing
      ? "mt-4 border-t border-line pt-4"
      : "ui-card p-5 sm:p-6"}
    >
      {editing
        ? <h4 id={headingId} className="font-semibold">Edit transfer</h4>
        : <h2 id={headingId} tabIndex={-1} className="text-lg font-semibold">Record a transfer</h2>}
      <form className="mt-4" noValidate onSubmit={handleSubmit((input) => save.mutate(input))}>
        <fieldset disabled={save.isPending} className="grid min-w-0 gap-4">
          {accountSelectors.map(({ field, other, label }) => (
            <FormField key={field} label={label} error={errors[field]?.message}>
              {(attributes) => (
                <select {...attributes} required {...register(field)}>
                  <option value="">Select an account</option>
                  {accounts.map(({ id, label }) => <option key={id} value={id} disabled={id === choices[other]}>{label}</option>)}
                </select>
              )}
            </FormField>
          ))}
          <FormField label="Amount (SGD)" error={errors.amount?.message}>
            {(attributes) => <input {...attributes} required inputMode="decimal" autoComplete="off" placeholder="0.00" {...register("amount")} />}
          </FormField>
          <FormField label="Transfer date" error={errors.date?.message}>
            {(attributes) => <input {...attributes} type="date" required
              min={minimumDate || "0001-01-01"} max="9999-12-31" {...register("date")} />}
          </FormField>
          <div className="grid gap-2 sm:flex sm:justify-end">
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
            <Button type="submit">{submitLabel}</Button>
          </div>
        </fieldset>
        {save.isError && !editableFields.some((name) => fieldErrors?.[name]) && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {isAccessError(save.error)
              ? "Your session no longer has access. Sign out and try again."
              : save.error instanceof ActivityFundingError && save.error.fundingError
                ? save.error.fundingError
                : save.error instanceof TransferApiError && save.error.status === 404
                  ? "This transfer is no longer available."
                  : "FinScope couldn’t confirm the save. Check the account history before trying again."}
          </p>
        )}
      </form>
    </section>
  );
}
