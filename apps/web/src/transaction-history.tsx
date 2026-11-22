import { transactionCategories, transactionHistoryQuery } from "@finscope/contracts/transactions";
import type { Transaction, TransactionHistoryQuery } from "@finscope/contracts/transactions";
import type { Transfer } from "@finscope/contracts/transfers";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { isAccessError } from "./account-api";
import type { LabeledAccount } from "./account-labels";
import { Button } from "./components/ui/button";
import { formatDate, formatSgd } from "./financial-format";
import { FormField } from "./form-field";
import { listTransactions, TransactionApiError } from "./transaction-api";
import { TransactionForm } from "./transaction-form";
import { TransferForm } from "./transfer-form";

const emptyFilters = { type: "", category: "", from: "", to: "" };
const historyFilterForm = z.preprocess(
  (input: typeof emptyFilters) => Object.fromEntries(Object.entries(input).filter(([, value]) => value !== "")),
  transactionHistoryQuery,
);
type HistoryEditor = { kind: "transaction" | "transfer"; id: string };

export function TransactionHistory({ account, accounts, token, queryKey, onClose }: {
  account: LabeledAccount;
  accounts: LabeledAccount[];
  token: string;
  queryKey: readonly string[];
  onClose: () => void;
}) {
  const [filters, setFilters] = useState<TransactionHistoryQuery>({});
  const [editor, setEditor] = useState<HistoryEditor>();
  const activeEditor = useRef<HistoryEditor | undefined>(undefined);
  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm({
    defaultValues: emptyFilters,
    resolver: zodResolver(historyFilterForm),
  });
  const [type, from, to] = watch(["type", "from", "to"]);
  const [notice, setNotice] = useState("");
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const history = useQuery({
    queryKey: [...queryKey, "transactions", account.id, filters],
    queryFn: ({ signal }) => listTransactions(token, account.id, filters, signal),
    retry: (count, error) => !isAccessError(error)
      && !(error instanceof TransactionApiError && error.status === 404) && count < 1,
  });
  useEffect(() => { heading.current?.focus(); }, []);

  function changeEditor(next?: HistoryEditor) {
    activeEditor.current = next;
    setEditor(next);
  }

  function applyFilters(filters: TransactionHistoryQuery) {
    changeEditor();
    setNotice("");
    setFilters(filters);
  }

  const categories = type === "income" || type === "expense"
    ? transactionCategories[type]
    : [...transactionCategories.income, ...transactionCategories.expense];

  const entries = history.data && [...history.data.transactions, ...(history.data.transfers ?? [])]
    .sort((first, second) => second.date.localeCompare(first.date));

  function finishEditing(editor: HistoryEditor, saved?: Transaction | Transfer) {
    if (activeEditor.current !== editor) return;
    changeEditor();
    if (!saved) {
      document.getElementById(`edit-${editor.kind}-${editor.id}`)?.focus();
      return;
    }
    if ("accountId" in saved) {
      const destination = accounts.find(({ id }) => id === saved.accountId);
      setNotice(destination && destination.id !== account.id
        ? `Transaction moved to ${destination.label}.`
        : "Transaction updated.");
    } else {
      setNotice("Transfer updated.");
    }
    heading.current?.focus();
  }

  return (
    <section id="account-transaction-history" aria-labelledby={headingId} className="min-w-0 rounded-xl border border-[#d8e4db] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} ref={heading} tabIndex={-1} className="text-lg font-semibold">Transaction history</h2>
          <p className="mt-1 break-words text-sm text-[#495e55]">{account.label}</p>
        </div>
        <Button variant="outline" onClick={onClose}>Close history</Button>
      </div>
      <form className="mt-4 grid gap-3" aria-label="Filter transaction history" onSubmit={handleSubmit(applyFilters)} noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Filter by type" error={errors.type?.message}>
            {(attributes) => (
              <select {...attributes} {...register("type", {
                onChange: () => setValue("category", ""),
              })}>
                <option value="">All types</option>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </select>
            )}
          </FormField>
          <FormField label="Filter by category" error={errors.category?.message}>
            {(attributes) => (
              <select {...attributes} {...register("category")}>
                <option value="">All categories</option>
                {categories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            )}
          </FormField>
          <FormField label="History start date" error={errors.from?.message}>
            {(attributes) => (
              <input {...attributes} type="date" min="0001-01-01" max={to || "9999-12-31"} {...register("from")} />
            )}
          </FormField>
          <FormField label="History end date" error={errors.to?.message}>
            {(attributes) => (
              <input {...attributes} type="date" min={from || "0001-01-01"} max="9999-12-31" {...register("to")} />
            )}
          </FormField>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" type="submit">Apply filters</Button>
          {Object.keys(filters).length > 0 && (
            <Button variant="outline" onClick={() => {
              reset(emptyFilters);
              applyFilters({});
            }}>Clear filters</Button>
          )}
        </div>
      </form>
      {history.isPending && <p role="status" className="mt-4 text-sm text-[#495e55]">Loading transactions…</p>}
      {history.isError && (
        <div className="mt-4">
          <p role="alert" className="text-sm text-[#8f3023]">
            {isAccessError(history.error)
              ? "Your session no longer has access. Sign out and try again."
              : history.error instanceof TransactionApiError && history.error.status === 404
                ? "This financial account is no longer available."
                : "FinScope couldn’t load the transaction history."}
          </p>
          {!isAccessError(history.error) && !(history.error instanceof TransactionApiError && history.error.status === 404)
            && <Button variant="outline" className="mt-3" onClick={() => void history.refetch()}>Try again</Button>}
        </div>
      )}
      {notice && <p role="status" className="mt-4 text-sm text-[#286347]">{notice}</p>}
      {entries?.length === 0 && (
        <p className="mt-4 border-t border-[#e0e8e2] pt-4 text-sm text-[#495e55]">
          {Object.keys(filters).length ? "No transactions match these filters." : "No transactions recorded for this account."}
        </p>
      )}
      {entries && entries.length > 0 && (
        <ul className="mt-4 divide-y divide-[#e0e8e2] border-t border-[#e0e8e2]">
          {entries.map((entry) => {
            const isTransfer = "direction" in entry;
            const kind = isTransfer ? "transfer" : "transaction";
            const editing = editor?.kind === kind && editor.id === entry.id;
            const credit = isTransfer ? entry.direction === "incoming" : entry.type === "income";
            const description = !isTransfer && entry.description;
            let label: string;
            let typeLabel: string;
            if (isTransfer) {
              const otherAccountId = credit ? entry.sourceAccountId : entry.destinationAccountId;
              const otherAccount = accounts.find(({ id }) => id === otherAccountId);
              label = otherAccount ? `Transfer ${credit ? "from" : "to"} ${otherAccount.label}` : "Cash transfer";
              typeLabel = credit ? "Incoming transfer" : "Outgoing transfer";
            } else {
              label = entry.category;
              typeLabel = credit ? "Income" : "Expense";
            }
            const editLabel = isTransfer ? typeLabel.toLowerCase() : `${entry.category} transaction`;
            return (
              <li key={`${kind}-${entry.id}`} className="py-4 last:pb-0">
                <div className="grid items-start gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <p className="font-semibold break-words">{label}</p>
                    <p className="mt-1 text-sm text-[#495e55]">
                      <time dateTime={entry.date}>{formatDate(entry.date)}</time> · {typeLabel}
                    </p>
                    {description && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{description}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className={`font-semibold tabular-nums ${credit ? "text-[#286347]" : "text-[#8f3023]"}`}>
                      {credit ? "+" : "−"}{formatSgd(entry.amount)}
                    </span>
                    <Button variant="outline" id={`edit-${kind}-${entry.id}`}
                      aria-label={`Edit ${editLabel} on ${formatDate(entry.date)}`} aria-expanded={editing}
                      onClick={() => {
                        if (editing) return;
                        setNotice("");
                        changeEditor({ kind, id: entry.id });
                      }}
                    >Edit</Button>
                  </div>
                </div>
                {editing && (isTransfer
                  ? <TransferForm accounts={accounts} token={token} queryKey={queryKey}
                    transfer={entry} onCancel={() => finishEditing(editor)}
                    onCorrected={(saved) => finishEditing(editor, saved)} />
                  : <TransactionForm accounts={accounts} token={token} queryKey={queryKey}
                    transaction={entry} onCancel={() => finishEditing(editor)}
                    onCorrected={(saved) => finishEditing(editor, saved)} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
