# Testing and verification

## Local checks

Run these commands from the repository root with the versions in [.node-version](../../.node-version) and the [workspace manifest](../../package.json). Install dependencies with `pnpm install --frozen-lockfile`. For PostgreSQL integration tests, use a disposable PostgreSQL 17 database. The sample URL assumes an isolated local setup started with `docker compose up -d --wait db`. Point `FINSCOPE_TEST_DATABASE_URL` at the disposable instance when a workspace database is already in use.

| Check | Command | What it exercises |
| --- | --- | --- |
| Type checks and API tests | `FINSCOPE_TEST_DATABASE_URL=postgresql://finscope:finscope@127.0.0.1:5432/finscope pnpm check` | Web and API type checks. Vitest exercises Fastify HTTP handlers, authorization fixtures, and real PostgreSQL for persistence, migrations, and financial invariants. The tests that require PostgreSQL skip when the URL is unset. |
| Build | `pnpm build` | Builds the API and bundles the web app. |
| Browser suite | `FINSCOPE_BROWSER_CHANNEL=chrome pnpm --filter @finscope/web test:browser` | Uses installed Google Chrome with Playwright Core and a local Vite server. The suite fixtures the Supabase and API responses to exercise the rendered workspace. Omit the channel setting when Playwright's bundled Chromium is available. |
| Documentation | `git diff --check` | Checks whitespace in the diff. Also follow changed links and read the affected agent instructions from the repository root. |

For a targeted API check, pass a spec path such as `pnpm --filter @finscope/api exec vitest run test/etf-trades.test.ts` with the database environment above. Use the supported API or rendered UI as the test seam. In pairing, use `tdd` for observable behaviour changes. [API tests](../../apps/api/test) · [Browser tests](../../apps/web/test/shell.test.mjs) · [Skill dependencies](playbook/README.md#skill-dependencies)

For web UI changes, exercise the affected rendered flow, including relevant error and recovery states. Check keyboard operation, focus, and the affected narrow and desktop layouts. FinScope targets WCAG 2.2 AA for future web UI work. Current conformance is unassessed. [UI/UX standard](playbook/README.md#standards)

## CI and live verification

The `verify` job runs on pull requests, pushes to `main`, and manual workflow runs. It installs from the lockfile, starts disposable PostgreSQL, runs `pnpm check` and `pnpm build`, then builds and starts the API image and checks `/health` against PostgreSQL. Wait for `verify` before merging under the project workflow. The local browser suite runs separately from `verify`. [GitHub Actions workflow](../../.github/workflows/deployment.yml)

A successful manual run on `main` can deploy after `verify` passes. The deploy job checks production API readiness, CORS, signed-out denial on account reads and writes, and the Pages response. Use the linked human-owned checklist for remaining verification that requires real identities or production access. [Release runbook](../deployment.md#release-and-verify) · [Issue tracker handoff](../agents/issue-tracker.md#implementation-and-human-verification)
