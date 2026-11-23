import { etfTradeInput, tradeBeforeOpeningMessage } from "@finscope/contracts/etf-trades";
import type { EtfTrade } from "@finscope/contracts/etf-trades";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { isAccessError } from "./account-api";
import type { LabeledAccount } from "./account-labels";
import { Button } from "./components/ui/button";
import { EtfTradeApiError, saveEtfTrade } from "./etf-trade-api";
import { FormField } from "./form-field";
import { useSingaporeToday } from "./use-singapore-today";

const formSchema = etfTradeInput.omit({ tags: true }).extend({
  tags: z.string().refine((text) => etfTradeInput.shape.tags.safeParse(parseTags(text)).success,
    "Enter up to 20 comma-separated tags of 40 characters each."),
});

function parseTags(text: string) {
  return text.split(",").map((tag) => tag.trim()).filter(Boolean);
}

type FormValues = z.infer<typeof formSchema>;

const numericFields = [
  { name: "quantity", label: "Quantity" },
  { name: "executionPrice", label: "Execution price per unit (SGD)" },
  { name: "fee", label: "Fee (SGD)" },
] as const;
const optionalFields = [
  { name: "purpose", label: "Purpose or investment thesis", maxLength: 500 },
  { name: "strategy", label: "Investment strategy", maxLength: 100 },
  { name: "tags", label: "Tags (comma-separated)", maxLength: 840 },
] as const;

type TradeFormProps = {
  accounts: LabeledAccount[];
  token: string;
  queryKey: readonly string[];
  trade?: EtfTrade;
  onCancel: () => void;
  onSaved: (trade: EtfTrade) => void;
  onStatusChange?: (dirty: boolean, saving: boolean) => void;
};

export function EtfTradeForm({ accounts, token, queryKey, trade, onCancel, onSaved, onStatusChange }: TradeFormProps) {
  const client = useQueryClient();
  const { today } = useSingaporeToday();
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const { register, control, handleSubmit, formState: { errors, isDirty }, setError, setFocus } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      currency: "SGD", accountId: trade?.accountId ?? (accounts.length === 1 ? accounts[0].id : ""),
      ticker: trade?.ticker ?? "", exchange: trade?.exchange ?? "", type: trade?.type ?? "buy",
      date: trade?.date ?? today, quantity: trade?.quantity ?? "", executionPrice: trade?.executionPrice ?? "",
      fee: trade?.fee ?? "0", purpose: trade?.purpose ?? "", strategy: trade?.strategy ?? "",
      tags: trade?.tags.join(", ") ?? "", notes: trade?.notes ?? "",
    },
  });
  const selectedAccount = useWatch({ control, name: "accountId" });
  const openingDate = accounts.find(({ id: accountId }) => accountId === selectedAccount)?.openingDate;
  const contextOnly = trade && !trade.canChangeFinancialDetails;
  useEffect(() => {
    if (trade) heading.current?.focus();
    else setFocus("accountId");
  }, [setFocus, trade]);

  const save = useMutation({
    mutationFn: (values: FormValues) => saveEtfTrade(token, { ...values, tags: parseTags(values.tags) }, trade?.id),
    onSuccess: async (saved) => {
      await client.invalidateQueries({ queryKey });
      onSaved(saved);
    },
    onError: (error) => {
      if (!(error instanceof EtfTradeApiError) || !error.fieldErrors) return;
      for (const [key, message] of Object.entries(error.fieldErrors)) {
        if (message) setError(key as keyof FormValues, { message });
      }
    },
  });
  useEffect(() => {
    onStatusChange?.(isDirty, save.isPending);
  }, [isDirty, onStatusChange, save.isPending]);

  const saveError = save.error instanceof EtfTradeApiError ? save.error : undefined;
  const title = trade ? (contextOnly ? "Edit investment context" : "Edit ETF trade") : "Record an ETF trade";
  const headingId = trade ? id : "record-etf-trade-heading";

  return (
    <section id={trade ? undefined : "record-etf-trade-form"} aria-labelledby={headingId}
      className={trade ? "mt-4 border-t border-line pt-4" : "ui-card p-5 sm:p-6"}>
      <h3 ref={heading} tabIndex={-1} id={headingId} className="text-lg font-semibold">{title}</h3>
      <form noValidate className="mt-4" onSubmit={handleSubmit((values) => {
        if (openingDate && values.date < openingDate) {
          setError("date", { message: tradeBeforeOpeningMessage(openingDate) });
          setFocus("date");
          return;
        }
        save.mutate(values);
      })}>
        <fieldset disabled={save.isPending} className="grid min-w-0 gap-4">
          <input type="hidden" {...register("currency")} />
          {trade ? (
            <>
              <input type="hidden" {...register("accountId")} />
              <input type="hidden" {...register("ticker")} />
              <input type="hidden" {...register("exchange")} />
            </>
          ) : (
            <>
              <FormField label="Brokerage account" error={errors.accountId?.message}>
                {(attributes) => <select {...attributes} required {...register("accountId")}>
                  <option value="">Select a brokerage account</option>
                  {accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
                </select>}
              </FormField>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <FormField label="ETF ticker" error={errors.ticker?.message}>
                  {(attributes) => <input {...attributes} required maxLength={24} autoCapitalize="characters" {...register("ticker")} />}
                </FormField>
                <FormField label="Exchange (optional)" error={errors.exchange?.message}>
                  {(attributes) => <input {...attributes} maxLength={20} autoCapitalize="characters" {...register("exchange")} />}
                </FormField>
              </div>
            </>
          )}
          {contextOnly ? (
            <>
              <input type="hidden" {...register("type")} />
              <input type="hidden" {...register("date")} />
              {numericFields.map(({ name }) => <input key={name} type="hidden" {...register(name)} />)}
            </>
          ) : (
            <>
              <FormField label="Trade type" error={errors.type?.message}>
                {(attributes) => <select {...attributes} {...register("type")}>
                  <option value="buy">Buy</option>
                  <option value="sell">Sell</option>
                </select>}
              </FormField>
              <FormField label="Trade date" error={errors.date?.message}>
                {(attributes) => <input {...attributes} required type="date" min={openingDate ?? "0001-01-01"}
                  max="9999-12-31" {...register("date")} />}
              </FormField>
              {numericFields.map(({ name, label }) => (
                <FormField key={name} label={label} error={errors[name]?.message}>
                  {(attributes) => <input {...attributes} required inputMode="decimal" autoComplete="off" {...register(name)} />}
                </FormField>
              ))}
            </>
          )}
          {optionalFields.map(({ name, label, maxLength }) => (
            <FormField key={name} label={label} error={errors[name]?.message}>
              {(attributes) => <input {...attributes} maxLength={maxLength} {...register(name)} />}
            </FormField>
          ))}
          <FormField label="Notes" error={errors.notes?.message}>
            {(attributes) => <textarea {...attributes} rows={3} maxLength={2000} {...register("notes")} />}
          </FormField>
          {save.isError && !Object.keys(saveError?.fieldErrors ?? {}).length && (
            <p role="alert" className="text-sm text-danger">
              {isAccessError(save.error) ? "Your session no longer has access. Sign out and try again."
                : saveError?.detail ?? (saveError?.status === 404
                  ? "This trade or brokerage account is no longer available."
                  : "FinScope couldn’t confirm the save. Check the brokerage holdings before trying again.")}
            </p>
          )}
          <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
            <Button type="submit">{save.isPending ? "Saving…" : trade ? "Save changes" : "Record trade"}</Button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
