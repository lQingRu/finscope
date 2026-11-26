import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { SessionGate } from "../session/session-gate";

const rootRoute = createRootRoute({ component: Outlet });
const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "workspace",
  component: SessionGate,
});
const overviewRoute = createRoute({ getParentRoute: () => workspaceRoute, path: "/" });
const accountsRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/accounts",
  validateSearch: (search: Record<string, unknown>): { open?: boolean; holdings?: string } => ({
    open: search.open === true || undefined,
    holdings: typeof search.holdings === "string" ? search.holdings : undefined,
  }),
});
export const router = createRouter({
  routeTree: rootRoute.addChildren([workspaceRoute.addChildren([overviewRoute, accountsRoute])]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
