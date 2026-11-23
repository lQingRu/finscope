import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { auth } from "./auth";
import { Button } from "./components/ui/button";
import { Brand } from "./signed-in-shell";
import { accountsQueryKey, Workspace } from "./workspace";
import "./index.css";

const queryClient = new QueryClient();

function FinScope() {
  const cache = useQueryClient();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!auth) return;
    let active = true;
    let userId: string | undefined;

    const { data: { subscription } } = auth.onAuthStateChange((_event, nextSession) => {
      const nextUserId = nextSession?.user.id;
      if (!nextUserId || (userId && userId !== nextUserId)) {
        cache.removeQueries({ queryKey: accountsQueryKey });
      }
      userId = nextUserId;
      setSession(nextSession);
    });

    void auth.initialize().then((result) => {
      if (active && result.error) {
        setError("Google sign-in couldn’t be completed. Try again.");
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [cache]);

  async function signIn() {
    if (!auth) return;
    setWorking(true);
    setError("");
    try {
      const { error: signInError } = await auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/`,
          queryParams: { prompt: "select_account" },
        },
      });
      if (signInError) throw signInError;
    } catch {
      setError("Google sign-in couldn’t be started. Try again.");
      setWorking(false);
    }
  }

  async function signOut() {
    if (!auth) return;
    setWorking(true);
    setError("");
    try {
      const { error: signOutError } = await auth.signOut({ scope: "local" });
      if (signOutError) throw signOutError;
    } catch {
      setError("Sign-out couldn’t be completed. Try again.");
    } finally {
      setWorking(false);
    }
  }

  if (session) {
    return <Workspace key={session.user.id} session={session} signingOut={working}
      onSignOut={() => void signOut()} signOutError={error} />;
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex min-h-[4.25rem] max-w-6xl items-center px-4 sm:px-8">
          <Brand />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-11">
        {error && <p role="alert" className="mb-4 text-sm text-danger">{error}</p>}
        {!auth ? (
          <section className="mx-auto mt-12 max-w-md ui-card p-6 sm:p-8">
            <h1 className="text-2xl font-semibold">Sign-in unavailable</h1>
            <p className="mt-3 text-sm text-muted">FinScope’s authentication configuration is missing or invalid.</p>
          </section>
        ) : session === undefined ? (
          <p role="status" className="text-sm text-muted">Checking your session…</p>
        ) : (
          <section className="mx-auto mt-12 max-w-md ui-card p-6 sm:mt-20 sm:p-8">
            <h1 className="text-2xl font-semibold tracking-tight">Sign in to FinScope</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted">Open your private financial workspace with the designated Google account.</p>
            <Button className="mt-6 w-full" disabled={working} onClick={() => void signIn()}>
              {working ? "Opening Google…" : "Continue with Google"}
            </Button>
          </section>
        )}
      </main>
    </div>
  );
}

const rootRoute = createRootRoute({ component: Outlet });
const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: FinScope,
});
const router = createRouter({ routeTree: rootRoute.addChildren([workspaceRoute]) });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Application root is missing");
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
