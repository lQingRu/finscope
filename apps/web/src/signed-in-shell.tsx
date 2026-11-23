import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { HeaderDisclosure } from "./components/ui/header-disclosure";

export function Brand() {
  return (
    <span className="brand">
      <span aria-hidden="true" className="brand-mark">
        <span />
        <span />
        <span />
      </span>
      <span className="brand-name">FinScope</span>
    </span>
  );
}

function PrimaryNavigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Primary navigation" className="primary-navigation">
      <Link to="/" activeOptions={{ exact: true }} activeProps={{ "aria-current": "page" }} className="primary-link" onClick={onNavigate}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
        </svg>
        <span className="primary-link-label">Overview</span>
      </Link>
    </nav>
  );
}

export function SignedInShell({ title, children, contextualActions, quickActions, profile, signingOut, onSignOut, error }: {
  title: string;
  children: ReactNode;
  contextualActions?: ReactNode;
  quickActions?: ReactNode;
  profile: string;
  signingOut: boolean;
  onSignOut: () => void;
  error: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const sidebarId = useId();
  const drawerId = useId();
  const drawerTitleId = useId();
  const drawer = useRef<HTMLDialogElement>(null);
  const drawerTrigger = useRef<HTMLButtonElement>(null);
  const drawerClose = useRef<HTMLButtonElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 64rem)");
    function resize() {
      if (desktop.matches) drawer.current?.close();
    }
    desktop.addEventListener("change", resize);
    return () => desktop.removeEventListener("change", resize);
  }, []);

  function openDrawer() {
    drawer.current?.showModal();
    setDrawerOpen(true);
    drawerClose.current?.focus();
  }

  return (
    <div className="app-shell" data-collapsed={collapsed}>
      <a className="skip-link" href="#workspace-main">Skip to main content</a>
      <aside id={sidebarId} className="desktop-sidebar">
        <div className="sidebar-brand"><Brand /></div>
        <PrimaryNavigation />
        <button
          type="button"
          className="sidebar-toggle"
          aria-controls={sidebarId}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          onClick={() => setCollapsed((value) => !value)}
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d={collapsed ? "M9 5v14m5-9 2 2-2 2" : "M9 5v14m7-9-2 2 2 2"} />
          </svg>
          <span className="sidebar-toggle-label">{collapsed ? "Expand navigation" : "Collapse navigation"}</span>
        </button>
      </aside>
      <dialog
        id={drawerId}
        ref={drawer}
        className="navigation-drawer"
        aria-labelledby={drawerTitleId}
        onClose={() => {
          setDrawerOpen(false);
          drawerTrigger.current?.focus();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const links = event.currentTarget.querySelectorAll("a[href]");
          const lastLink = links[links.length - 1];
          if (event.shiftKey && document.activeElement === drawerClose.current) {
            event.preventDefault();
            if (lastLink instanceof HTMLElement) lastLink.focus();
          } else if (!event.shiftKey && document.activeElement === lastLink) {
            event.preventDefault();
            drawerClose.current?.focus();
          }
        }}
      >
        <div className="drawer-header">
          <h2 id={drawerTitleId}>Navigation</h2>
          <button ref={drawerClose} type="button" className="icon-button" aria-label="Close navigation"
            onClick={() => drawer.current?.close()}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <PrimaryNavigation onNavigate={() => drawer.current?.close()} />
      </dialog>
      <div className="shell-body">
        <header className="shell-header">
          <div className="shell-title">
            <button
              ref={drawerTrigger}
              type="button"
              className="icon-button mobile-nav-trigger"
              aria-label="Open navigation"
              aria-haspopup="dialog"
              aria-controls={drawerId}
              aria-expanded={drawerOpen}
              onClick={openDrawer}
            >
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <h1>{title}</h1>
          </div>
          <div className="shell-actions">
            {contextualActions}
            {quickActions}
            <HeaderDisclosure label="Profile menu" triggerClassName="profile-trigger" trigger={
              <span aria-hidden="true" className="profile-initial">{[...profile][0]?.toLocaleUpperCase()}</span>
            }>
              {() => (
                <>
                  <p className="profile-name">{profile}</p>
                  <button className="header-popover-action" type="button" disabled={signingOut} onClick={onSignOut}>
                    {signingOut ? "Signing out…" : "Sign out"}
                  </button>
                </>
              )}
            </HeaderDisclosure>
          </div>
        </header>
        <main id="workspace-main" className="shell-main" tabIndex={-1}>
          {error && <p role="alert" className="mb-4 text-sm text-danger">{error}</p>}
          {children}
        </main>
      </div>
    </div>
  );
}
