import { healthResponses } from "@finscope/contracts/health";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3000";
const queryClient = new QueryClient();

function ServiceStatus() {
  const health = useQuery({
    queryKey: ["service-health"],
    queryFn: async ({ signal }) => {
      const response = await fetch(new URL("/health", apiUrl), { signal });
      if (response.status === 200) {
        return healthResponses[200].parse(await response.json());
      }
      if (response.status === 503) {
        healthResponses[503].parse(await response.json());
      }
      throw new Error("API unavailable");
    },
    retry: 1,
    retryDelay: 2_000,
  });

  const ready = health.isSuccess;
  const status = health.isFetching ? "Checking connection…" : ready ? "Operational" : "Unavailable";
  const statusColor = health.isFetching ? "bg-slate-500" : ready ? "bg-emerald-700" : "bg-amber-700";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-12 sm:px-8">
      <h1 className="text-5xl font-semibold tracking-tight">FinScope</h1>
      <section
        className="mt-8 rounded-2xl border border-[#d5e0dc] bg-white p-6 shadow-sm sm:p-8"
        aria-labelledby="status-heading"
      >
        <h2 id="status-heading" className="text-lg font-semibold">Service status</h2>
        <p role="status" className="mt-4 flex items-center gap-3 text-sm">
          <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${statusColor}`} />
          {status}
        </p>
        {!health.isFetching && !ready && (
          <button
            type="button"
            onClick={() => void health.refetch()}
            className="mt-5 rounded-lg bg-[#16302c] px-4 py-2 text-sm font-medium text-white hover:bg-[#234e45] focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            Check again
          </button>
        )}
      </section>
    </main>
  );
}

const rootRoute = createRootRoute({ component: Outlet });
const statusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: ServiceStatus,
});
const router = createRouter({ routeTree: rootRoute.addChildren([statusRoute]) });

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
