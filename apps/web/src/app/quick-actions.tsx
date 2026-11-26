import { useBlocker, useLocation } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { LabeledAccount } from "../features/financial-accounts/account-labels";
import { Button } from "../shared/ui/button";
import { HeaderDisclosure } from "./layouts/header-disclosure";
import { EtfTradeForm } from "../features/investments/components/etf-trade-form";
import { TransactionForm } from "../features/cash-activity/components/transaction-form";
import { TransferForm } from "../features/cash-activity/components/transfer-form";

const actions = {
  transaction: { label: "Record a transaction", headingId: "record-transaction-heading" },
  transfer: { label: "Transfer cash", headingId: "record-transfer-heading" },
  trade: { label: "Record an ETF trade", headingId: "record-etf-trade-heading" },
};

type Action = keyof typeof actions;

function ActionDialog({ headingId, className, onDismiss, children }: {
  headingId: string;
  className: string;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => element.close();
  }, []);

  function keepFocusInside(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const stops = [...event.currentTarget.querySelectorAll<HTMLElement>(
      "button, input:not([type=hidden]), select, textarea, a[href]",
    )].filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length);
    const first = stops[0];
    const last = stops.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <dialog ref={dialog} className={className} aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
      }}
      onKeyDown={keepFocusInside}>
      {children}
    </dialog>
  );
}

export function QuickActions({ accounts, token, queryKey, onOpenAccount, onRecorded }: {
  accounts: LabeledAccount[];
  token: string;
  queryKey: readonly string[];
  onOpenAccount: () => void;
  onRecorded: (message: string, holdings?: string) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreTrigger = useRef(false);
  const [action, setAction] = useState<Action>();
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const href = useLocation({ select: (location) => location.href });
  const previousHref = useRef(href);
  const blocker = useBlocker({
    shouldBlockFn: () => Boolean(action && (dirty || saving)),
    enableBeforeUnload: Boolean(action && (dirty || saving)),
    withResolver: true,
  });

  useLayoutEffect(() => {
    if (action || !restoreTrigger.current) return;
    restoreTrigger.current = false;
    trigger.current?.focus();
  }, [action]);

  useEffect(() => {
    if (previousHref.current === href) return;
    previousHref.current = href;
    setAction(undefined);
    setConfirmClose(false);
  }, [href]);

  useEffect(() => {
    if (saving && blocker.status === "blocked") blocker.reset();
  }, [blocker, saving]);

  const updateStatus = useCallback((hasEdits: boolean, inProgress: boolean) => {
    setDirty(hasEdits);
    setSaving(inProgress);
  }, []);

  function dismiss(restoreFocus: boolean) {
    restoreTrigger.current = restoreFocus;
    setAction(undefined);
    setConfirmClose(false);
  }

  function requestDismiss() {
    if (saving) return;
    if (dirty) setConfirmClose(true);
    else dismiss(true);
  }

  function keepEditing() {
    if (blocker.status === "blocked") blocker.reset();
    setConfirmClose(false);
  }

  function discardChanges() {
    const navigation = blocker.status === "blocked" ? blocker.proceed : undefined;
    dismiss(!navigation);
    navigation?.();
  }

  function recorded(message: string, holdings?: string) {
    dismiss(true);
    onRecorded(message, holdings);
  }

  const brokerage = accounts.filter(({ type }) => type === "brokerage");
  const available = {
    transaction: accounts.length > 0,
    transfer: accounts.length > 1,
    trade: brokerage.length > 0,
  };
  const formProps = { token, queryKey, onCancel: requestDismiss, onStatusChange: updateStatus };

  return (
    <>
      <HeaderDisclosure label="Quick actions" triggerRef={trigger} triggerClassName="quick-actions-trigger" trigger={
        <><span aria-hidden="true" className="quick-actions-plus">+</span>Quick actions</>
      }>
        {(close) => (
          <>
            {(Object.keys(actions) as Action[]).filter((item) => available[item]).map((item) => (
              <button type="button" className="header-popover-action" key={item} onClick={() => {
                close();
                updateStatus(false, false);
                setAction(item);
              }}>{actions[item].label}</button>
            ))}
            <button type="button" className="header-popover-action" onClick={() => {
              close();
              onOpenAccount();
            }}>Open a financial account</button>
          </>
        )}
      </HeaderDisclosure>
      {action && (
        <ActionDialog headingId={actions[action].headingId} className="ui-dialog quick-action-dialog" onDismiss={requestDismiss}>
          <Button variant="outline" className="quick-action-close" aria-label="Close form" disabled={saving} onClick={requestDismiss}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </Button>
          {action === "transaction" && <TransactionForm {...formProps} accounts={accounts} onRecorded={() => recorded("Transaction recorded.")} />}
          {action === "transfer" && <TransferForm {...formProps} accounts={accounts} onRecorded={() => recorded("Transfer recorded.")} />}
          {action === "trade" && <EtfTradeForm {...formProps} accounts={brokerage}
            onSaved={(trade) => recorded(`${trade.ticker} ${trade.type} recorded.`, trade.accountId)} />}
        </ActionDialog>
      )}
      {action && (confirmClose || (blocker.status === "blocked" && !saving)) && (
        <ActionDialog headingId="discard-action-heading" className="ui-dialog" onDismiss={keepEditing}>
          <h2 id="discard-action-heading" className="text-lg font-semibold">Discard unsaved changes?</h2>
          <p className="mt-2 text-sm text-muted">Your entries will be lost if you leave this form.</p>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="outline" autoFocus onClick={keepEditing}>Keep editing</Button>
            <Button onClick={discardChanges}>Discard changes</Button>
          </div>
        </ActionDialog>
      )}
    </>
  );
}
