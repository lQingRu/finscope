import type { EtfHolding, EtfTrade } from "@finscope/contracts/etf-trades";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { isAccessError } from "./account-api";
import type { LabeledAccount } from "./account-labels";
import { Button } from "./components/ui/button";
import { deleteEtfTrade, EtfTradeApiError, getBrokerageHoldings } from "./etf-trade-api";
import { EtfTradeForm } from "./etf-trade-form";
import { formatDate, formatSgd, formatPreciseSgd } from "./financial-format";

type HoldingProps = {
  account: LabeledAccount;
  token: string;
  queryKey: readonly string[];
};

function securityName({ ticker, exchange }: Pick<EtfHolding, "ticker" | "exchange">) {
  return exchange ? `${ticker} · ${exchange}` : ticker;
}

function Metrics({ entries }: { entries: Array<[string, string]> }) {
  return (
    <dl className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-3">
      {entries.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-[#495e55]">{label}</dt>
          <dd className="mt-1 break-words text-sm font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function TradeHistoryEntry({ account, token, queryKey, trade, onDeleted }: HoldingProps & {
  trade: EtfTrade;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const editButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const deleteTitle = useId();
  const client = useQueryClient();
  const remove = useMutation({
    mutationFn: () => deleteEtfTrade(token, trade.id),
    onSuccess: async () => {
      dialog.current?.close();
      await client.invalidateQueries({ queryKey });
      onDeleted();
    },
  });
  const title = trade.type === "buy" ? "Buy" : "Sell";
  const metrics: Array<[string, string]> = [
    ["Quantity", trade.quantity],
    ["Execution price", formatPreciseSgd(trade.executionPrice)],
    ["Gross amount", formatPreciseSgd(trade.grossAmount)],
    ["Fee", formatSgd(trade.fee)],
    ["Brokerage cash movement", formatPreciseSgd(trade.cashMovement)],
  ];
  if (trade.realisedPnl !== null) metrics.push(["Realised P&L", formatPreciseSgd(trade.realisedPnl)]);

  function finishEditing() {
    setEditing(false);
    editButton.current?.focus();
  }

  return (
    <li className="min-w-0 py-4">
      <h5 className="mb-3 font-semibold">{title} · <time dateTime={trade.date}>{formatDate(trade.date)}</time></h5>
      <Metrics entries={metrics} />
      {(trade.purpose || trade.strategy || trade.tags.length > 0 || trade.notes) && (
        <dl className="mt-3 grid min-w-0 gap-2 text-sm">
          {([
            ["Purpose", trade.purpose],
            ["Strategy", trade.strategy],
            ["Tags", trade.tags.join(", ")],
            ["Notes", trade.notes],
          ] as const).filter(([, value]) => value).map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="font-medium text-[#495e55]">{label}</dt>
              <dd className="break-words whitespace-pre-wrap">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button ref={editButton} variant="outline" aria-expanded={editing} onClick={() => setEditing(true)}>
          {trade.canChangeFinancialDetails ? "Edit trade" : "Edit context"}
        </Button>
        {trade.canChangeFinancialDetails && (
          <Button variant="outline" disabled={editing} onClick={() => {
            remove.reset();
            dialog.current?.showModal();
          }}>Delete trade</Button>
        )}
      </div>
      {editing && (
        <EtfTradeForm trade={trade} accounts={[account]} token={token} queryKey={queryKey}
          onCancel={finishEditing} onSaved={() => { setNotice("Trade updated."); finishEditing(); }} />
      )}
      {notice && <p role="status" className="mt-3 text-sm text-[#286347]">{notice}</p>}
      <dialog ref={dialog} aria-labelledby={deleteTitle}
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl p-5 shadow-lg backdrop:bg-black/40"
        onCancel={(event) => { if (remove.isPending) event.preventDefault(); }}>
        <h4 id={deleteTitle} className="font-semibold">Delete this ETF trade?</h4>
        <p className="my-3 text-sm">This removes the {securityName(trade)} trade and reverses its effect on the holding and brokerage cash.</p>
        {remove.isError && <p role="alert" className="mb-3 text-sm text-[#8f3023]">
          {isAccessError(remove.error) ? "Your session no longer has access. Sign out and try again."
            : remove.error instanceof EtfTradeApiError && remove.error.detail
              ? remove.error.detail : "FinScope couldn’t confirm the deletion. Check the trade history before trying again."}
        </p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" autoFocus disabled={remove.isPending} onClick={() => dialog.current?.close()}>Cancel</Button>
          <Button disabled={remove.isPending} onClick={() => remove.mutate()}>{remove.isPending ? "Deleting…" : "Delete trade"}</Button>
        </div>
      </dialog>
    </li>
  );
}

export function BrokerageHoldings({ account, token, queryKey, onClose }: HoldingProps & { onClose: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => { heading.current?.focus(); }, []);
  const holdings = useQuery({
    queryKey: [...queryKey, "holdings", account.id],
    queryFn: ({ signal }) => getBrokerageHoldings(token, account.id, signal),
    retry: (count, error) => !isAccessError(error) && count < 1,
  });
  return (
    <section id="brokerage-holdings" aria-labelledby="brokerage-holdings-heading"
      className="min-w-0 rounded-xl border border-[#d8e4db] bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="brokerage-holdings-heading" ref={heading} tabIndex={-1} className="break-words text-lg font-semibold">
          {account.label} holdings
        </h2>
        <Button variant="outline" onClick={onClose}>Close holdings</Button>
      </div>
      {notice && <p role="status" className="mb-3 text-sm text-[#286347]">{notice}</p>}
      {holdings.isPending && <p role="status" className="text-sm text-[#495e55]">Loading holdings…</p>}
      {holdings.isError && <p role="alert" className="text-sm text-[#8f3023]">{isAccessError(holdings.error)
        ? "Your session no longer has access. Sign out and try again."
        : "FinScope couldn’t load these holdings."}</p>}
      {holdings.data?.holdings.length === 0 && <p className="text-sm text-[#495e55]">No ETF trades recorded in this brokerage account.</p>}
      <div className="grid gap-3">
        {holdings.data?.holdings.map((holding) => (
          <article key={JSON.stringify([holding.ticker, holding.exchange])} className="min-w-0 rounded-lg border border-[#e0e8e2] p-4">
            <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="break-words font-semibold">{securityName(holding)}</h3>
              <span className="text-sm text-[#495e55]">{holding.valuation === "awaiting_price" ? "Awaiting price" : "Closed position"}</span>
            </header>
            <Metrics entries={[
              ["Units", holding.units],
              ["Remaining cost basis", formatPreciseSgd(holding.costBasis)],
              ["Average cost per unit", holding.averageCost === null ? "—" : formatPreciseSgd(holding.averageCost)],
              ["Total fees", formatSgd(holding.fees)],
              ["Realised P&L", formatPreciseSgd(holding.realisedPnl)],
              ["Market value", holding.marketValue === null ? "—" : formatPreciseSgd(holding.marketValue)],
              ["Unrealised P&L", holding.unrealisedPnl === null ? "—" : formatPreciseSgd(holding.unrealisedPnl)],
            ]} />
            <details className="mt-4 border-t border-[#e0e8e2] pt-3">
              <summary className="min-h-9 cursor-pointer text-sm font-semibold">Trades and cash movements</summary>
              <ul className="divide-y divide-[#e0e8e2]">
                {holdings.data.trades.filter((trade) => trade.ticker === holding.ticker && trade.exchange === holding.exchange)
                  .map((trade) => <TradeHistoryEntry key={trade.id} account={account} token={token} queryKey={queryKey} trade={trade}
                    onDeleted={() => { setNotice("Trade deleted."); heading.current?.focus(); }} />)}
              </ul>
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}
