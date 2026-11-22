import type { FinancialAccount } from "@finscope/contracts/financial-accounts";
import { transactionCategories, transactionHistoryQuery } from "@finscope/contracts/transactions";
import type { Transaction, TransactionHistoryQuery } from "@finscope/contracts/transactions";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { isAccessError } from "./account-api";
import { Button } from "./components/ui/button";
import { formatDate, formatSgd } from "./financial-format";
import { FormField } from "./form-field";
import { listTransactions, TransactionApiError } from "./transaction-api";
import { TransactionForm } from "./transaction-form";

const emptyFilters = { type: "", category: "", from: "", to: "" };

export function TransactionHistory({ account, accounts, token, queryKey, onClose }: {
  account: FinancialAccount;
  accounts: FinancialAccount[];
  token: string;
  queryKey: readonly string[];
  onClose: () => void;
}) {
  const [input, setInput] = useState(emptyFilters);
  const [filters, setFilters] = useState<TransactionHistoryQuery>({});
  const [filterError, setFilterError] = useState("");
  const [editingId, setEditingId] = useState<string>();
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

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = transactionHistoryQuery.safeParse(Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== ""),
    ));
    if (!parsed.success) {
      setFilterError(parsed.error.issues[0].message);
      return;
    }
    setFilterError("");
    setEditingId(undefined);
    setNotice("");
    setFilters(parsed.data);
  }

  const categories = input.type === "income" || input.type === "expense"
    ? transactionCategories[input.type]
    : [...transactionCategories.income, ...transactionCategories.expense];

  function finishEditing(transaction?: Transaction) {
    setEditingId(undefined);
    if (transaction) {
      const destination = accounts.find(({ id }) => id === transaction.accountId);
      setNotice(destination && destination.id !== account.id
        ? `Transaction moved to ${destination.name}.`
        : "Transaction updated.");
      heading.current?.focus();
    } else if (editingId) {
      document.getElementById(`edit-transaction-${editingId}`)?.focus();
    }
  }

  return (
    <section id="account-transaction-history" aria-labelledby={headingId} className="min-w-0 rounded-xl border border-[#d8e4db] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} ref={heading} tabIndex={-1} className="text-lg font-semibold">Transaction history</h2>
          <p className="mt-1 break-words text-sm text-[#495e55]">{account.name}</p>
        </div>
        <Button variant="outline" onClick={onClose}>Close history</Button>
      </div>
      <form className="mt-4 grid gap-3" aria-label="Filter transaction history" onSubmit={applyFilters} noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Filter by type">
            {(attributes) => (
              <select {...attributes} value={input.type} onChange={(event) => {
                setInput({ ...input, type: event.currentTarget.value, category: "" });
              }}>
                <option value="">All types</option>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </select>
            )}
          </FormField>
          <FormField label="Filter by category">
            {(attributes) => (
              <select {...attributes} value={input.category} onChange={(event) => {
                setInput({ ...input, category: event.currentTarget.value });
              }}>
                <option value="">All categories</option>
                {categories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            )}
          </FormField>
          <FormField label="History start date">
            {(attributes) => (
              <input {...attributes} type="date" min="0001-01-01" max={input.to || "9999-12-31"} value={input.from}
                onChange={(event) => setInput({ ...input, from: event.currentTarget.value })} />
            )}
          </FormField>
          <FormField label="History end date">
            {(attributes) => (
              <input {...attributes} type="date" min={input.from || "0001-01-01"} max="9999-12-31" value={input.to}
                onChange={(event) => setInput({ ...input, to: event.currentTarget.value })} />
            )}
          </FormField>
        </div>
        {filterError && <p role="alert" className="text-sm text-[#8f3023]">{filterError}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" type="submit">Apply filters</Button>
          {Object.keys(filters).length > 0 && (
            <Button variant="outline" onClick={() => {
              setInput(emptyFilters);
              setFilters({});
              setFilterError("");
              setNotice("");
              setEditingId(undefined);
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
      {history.data?.length === 0 && (
        <p className="mt-4 border-t border-[#e0e8e2] pt-4 text-sm text-[#495e55]">
          {Object.keys(filters).length ? "No transactions match these filters." : "No transactions recorded for this account."}
        </p>
      )}
      {history.data && history.data.length > 0 && (
        <ul className="mt-4 divide-y divide-[#e0e8e2] border-t border-[#e0e8e2]">
          {history.data.map((transaction) => {
            const editing = editingId === transaction.id;
            const income = transaction.type === "income";
            return (
              <li key={transaction.id} className="py-4 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{transaction.category}</p>
                    <p className="mt-1 text-sm text-[#495e55]">
                      <time dateTime={transaction.date}>{formatDate(transaction.date)}</time> · {income ? "Income" : "Expense"}
                    </p>
                    {transaction.description && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{transaction.description}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className={`font-semibold tabular-nums ${income ? "text-[#286347]" : "text-[#8f3023]"}`}>
                      {income ? "+" : "−"}{formatSgd(transaction.amount)}
                    </span>
                    <Button variant="outline" id={`edit-transaction-${transaction.id}`}
                      aria-label={`Edit ${transaction.category} transaction on ${formatDate(transaction.date)}`} aria-expanded={editing}
                      onClick={() => { setNotice(""); setEditingId(transaction.id); }}
                    >Edit</Button>
                  </div>
                </div>
                {editing && (
                  <TransactionForm accounts={accounts} token={token} queryKey={queryKey}
                    transaction={transaction} onCancel={() => finishEditing()} onCorrected={finishEditing} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
