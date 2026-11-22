import { singaporeCalendarDate } from "@finscope/contracts/financial-accounts";
import type { FinancialAccount } from "@finscope/contracts/financial-accounts";
import { transferAccountFields, transferBeforeOpeningMessage, transferInput } from "@finscope/contracts/transfers";
import type { Transfer, TransferInput } from "@finscope/contracts/transfers";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { useForm } from "react-hook-form";
import { isAccessError } from "./account-api";
import { Button } from "./components/ui/button";
import { FormField } from "./form-field";
import { saveTransfer, TransferApiError } from "./transfer-api";

const editableFields = [...transferAccountFields, "amount", "date"] as const;
const accountSelectors = [
  { field: "sourceAccountId", other: "destinationAccountId", label: "Source financial account" },
  { field: "destinationAccountId", other: "sourceAccountId", label: "Destination financial account" },
] as const;

function blankTransfer(): TransferInput {
  return { sourceAccountId: "", destinationAccountId: "", amount: "", date: singaporeCalendarDate() };
}

function minimumTransferDate(accounts: FinancialAccount[], sourceAccountId: string, destinationAccountId: string) {
  const source = accounts.find(({ id }) => id === sourceAccountId);
  const destination = accounts.find(({ id }) => id === destinationAccountId);
  return [source?.openingDate, destination?.openingDate].filter((date) => date !== undefined).sort().pop();
}

type TransferFormProps = {
  accounts: FinancialAccount[];
  token: string;
  queryKey: readonly string[];
  onCancel: () => void;
} & (
  | { transfer?: undefined; onCorrected?: never }
  | { transfer: Transfer; onCorrected: (saved: Transfer) => void }
);

export function TransferForm({ accounts, token, queryKey, transfer, onCancel, onCorrected }: TransferFormProps) {
  const client = useQueryClient();
  const id = useId();
  const [notice, setNotice] = useState("");
  const { register, handleSubmit, reset, setError, setFocus, watch, formState: { errors } } = useForm<TransferInput>({
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
      const minimumDate = minimumTransferDate(accounts, sourceAccountId, destinationAccountId);
      if (minimumDate && date < minimumDate) {
        context.addIssue({ code: "custom", path: ["date"], message: transferBeforeOpeningMessage(minimumDate) });
      }
    })),
  });
  const selected = watch(["sourceAccountId", "destinationAccountId"]);
  const choices = { sourceAccountId: selected[0], destinationAccountId: selected[1] };
  const minimumDate = minimumTransferDate(accounts, ...selected);
  const editing = Boolean(transfer);
  useEffect(() => { setFocus("sourceAccountId"); }, [setFocus]);

  const save = useMutation({
    mutationFn: (input: TransferInput) => saveTransfer(token, input, transfer?.id),
    onMutate: () => setNotice(""),
    onSuccess: async (saved) => {
      if (onCorrected) {
        onCorrected(saved);
      } else {
        reset({ ...blankTransfer(), sourceAccountId: saved.sourceAccountId, destinationAccountId: saved.destinationAccountId });
        setNotice("Transfer recorded.");
      }
      await client.invalidateQueries({ queryKey });
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
  const fieldErrors = save.error instanceof TransferApiError ? save.error.fieldErrors : undefined;
  const headingId = editing ? id : "record-transfer-heading";
  const submitLabel = editing
    ? (save.isPending ? "Saving changes…" : "Save transfer")
    : (save.isPending ? "Recording transfer…" : "Record transfer");

  return (
    <section id={editing ? undefined : "record-transfer-form"} aria-labelledby={headingId} className={editing
      ? "mt-4 border-t border-[#e0e8e2] pt-4"
      : "min-w-0 rounded-xl border border-[#d8e4db] bg-white p-5 shadow-sm sm:p-6"}
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
                  {accounts.map(({ id, name }) => <option key={id} value={id} disabled={id === choices[other]}>{name}</option>)}
                </select>
              )}
            </FormField>
          ))}
          <FormField label="Amount (SGD)" error={errors.amount?.message}>
            {(attributes) => <input {...attributes} required inputMode="decimal" autoComplete="off" placeholder="0.00" {...register("amount")} />}
          </FormField>
          <FormField label="Transfer date" error={errors.date?.message}>
            {(attributes) => <input {...attributes} type="date" required
              min={minimumDate ?? "0001-01-01"} max="9999-12-31" {...register("date")} />}
          </FormField>
          <div className="grid gap-2 sm:flex sm:justify-end">
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
            <Button type="submit">{submitLabel}</Button>
          </div>
        </fieldset>
        {save.isError && !editableFields.some((name) => fieldErrors?.[name]) && (
          <p role="alert" className="mt-3 text-sm text-[#8f3023]">
            {isAccessError(save.error)
              ? "Your session no longer has access. Sign out and try again."
              : save.error instanceof TransferApiError && save.error.status === 404
                ? "This transfer is no longer available."
                : "FinScope couldn’t confirm the save. Check the account history before trying again."}
          </p>
        )}
        {notice && <p role="status" className="mt-3 text-sm text-[#286347]">{notice}</p>}
      </form>
    </section>
  );
}
