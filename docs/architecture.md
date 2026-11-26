# FinScope architecture

[ADR 0001](adr/0001-initial-mvp-stack.md) records the initial stack and deployment decisions. The current runtime is Node.js 26 with pnpm 11.3.0, as pinned in [.node-version](../.node-version), the [workspace manifest](../package.json), and the [Dockerfile](../Dockerfile). The repository now contains Vitest and browser checks. [Testing and verification](standards/testing.md)

## Runtime and boundaries

```mermaid
flowchart TD
    accTitle: FinScope deployment and request paths
    accDescr: The React app runs in the owner's browser after loading from Cloudflare Pages. The browser signs in through Supabase Auth with Google and calls the Fastify API on Render. The API verifies the session and accesses PostgreSQL.
    Browser["Owner's browser (React app)"]
    Pages["Cloudflare Pages"]
    Auth["Supabase Auth"]
    Google["Google"]
    API["Render (Fastify API)"]
    Database[("Supabase PostgreSQL")]

    Browser -->|Loads app files from| Pages
    Browser -->|Signs in through| Auth
    Auth -->|Uses Google OAuth| Google
    Browser -->|Sends API requests with access token| API
    API -->|Verifies session with| Auth
    API -->|Reads and writes financial records| Database
```

| Boundary | Responsibility |
| --- | --- |
| [Web app](../apps/web/src/main.tsx) | Vite builds a React single-page app for Cloudflare Pages. TanStack Router selects the workspace view, TanStack Query owns cached server data, and forms use React Hook Form and Zod. |
| [API](../apps/api/src/index.ts) | The containerised Fastify process on Render validates environment settings and starts the HTTP app after migrations. The composition module wires authorization, repositories, and PostgreSQL into Fastify. Domain routes validate requests and call the repositories and accounting code. The API reports readiness at `/health` and uses Pino for request logs and Sentry for unexpected errors. [API composition](../apps/api/src/app/compose.ts) · [Fastify assembly](../apps/api/src/app/create-api.ts) · [Deployment](deployment.md) |
| [Shared contracts](../packages/contracts/package.json) | The web app and API consume shared Zod schemas. Keep HTTP contract changes aligned across both callers and the [OpenAPI document](openapi.json). |
| [PostgreSQL](../apps/api/drizzle) | Supabase hosts the financial tables in `finscope_private`. Drizzle runs migrations under a database lock before the API starts listening. [Migration entry point](../apps/api/src/infrastructure/postgres.ts) · [Local PostgreSQL configuration](../compose.yaml) |

The browser signs in with Google through Supabase Auth and sends its access token to the API. The API looks up the authenticated user and checks the configured Supabase user UUID and Google subject before granting financial access. Keep `finscope_private` outside the Supabase Data API's exposed schemas. The [deployment runbook](deployment.md) covers provider configuration, secrets, backup, and recovery. [Browser auth](../apps/web/src/app/session/auth.ts) · [API owner authorization](../apps/api/src/infrastructure/supabase-owner-auth.ts)

## Frontend module ownership

- [Application composition](../apps/web/src/app) owns routing, the shell, the session lifecycle, and providers. The workspace coordinates cross-feature flows, route state, and the user-scoped query prefix for refresh and sign-out. [Workspace](../apps/web/src/app/routes/workspace.tsx) · [Session gate](../apps/web/src/app/session/session-gate.tsx)
- [Features](../apps/web/src/features) own their workflows. Financial Accounts owns account management and labeling. Cash Activity owns transactions, transfers, and their combined history. Investments owns ETF trades, holdings, and portfolio valuation reads. Overview renders reporting and valuation data supplied by the workspace. Keep feature UI, validation, and HTTP operations with their owners.
- The app composes features through named exports from their owning files. Features may consume shared code, configuration, and workspace contracts. Cash Activity and Investments use the Financial Accounts `LabeledAccount` type. Runtime coordination across features belongs in the app.
- [Shared code](../apps/web/src/shared) holds reusable UI, hooks, formatting, and HTTP status handling. [Configuration](../apps/web/src/config) owns Vite environment reads. Keep theme tokens and shared rules in [global styles](../apps/web/src/app/styles/globals.css), and colocate feature rules with their views. The [Vite entry point](../apps/web/src/main.tsx) loads feature CSS after the global stylesheet.

## Financial records and invariants

- A financial account belongs to the owner and starts with a dated opening balance. Everyday transactions reference one account. A transfer references both accounts and appears in both histories while leaving everyday income and expenses unchanged. [Account repository](../apps/api/src/financial-accounts/repository.ts) · [Transfer repository](../apps/api/src/transfers/repository.ts) · [Cashflow summary](../apps/api/src/financial-accounts/summary.ts)
- An ETF trade belongs to a brokerage account. Trades update cash, units, and running weighted-average cost with decimal arithmetic. A correction must preserve valid cash funding and units for affected later trades. Missing market prices leave open holdings unpriced. [ETF accounting](../apps/api/src/etf-trades/accounting.ts) · [ETF repository](../apps/api/src/etf-trades/repository.ts)
- Storage constraints protect ownership and opening dates. Transactions and an owner-scoped advisory lock coordinate competing changes that affect recorded activity. Deleting an everyday transaction, transfer, or ETF trade writes a retained deletion record in the same transaction. [Migrations](../apps/api/drizzle) · [Activity lock](../apps/api/src/financial-accounts/activity-lock.ts) · [Deletion records](../apps/api/src/audit/activity-deletions.ts)

Use the [glossary](../GLOSSARY.md) for project terms and the [product requirements](product-requirements.md) for future capabilities. The [playbook index](standards/playbook/README.md) routes boundary, contract, and data changes to the applicable standards.
