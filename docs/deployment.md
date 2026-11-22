# Deploy FinScope

[ADR 0001](adr/0001-initial-mvp-stack.md) places the React site on Cloudflare Pages, the containerised Fastify API on Render, and PostgreSQL on Supabase. [Issue #9](https://github.com/lQingRu/finscope/issues/9) tracks one-time platform setup. These instructions use the provider-assigned HTTPS domains.

## Local development

Install Node.js 26, pnpm 11.3.0, and Docker with Compose. From the repository root, run:

```sh
pnpm install --frozen-lockfile
docker compose up -d --wait db
test -e apps/api/.env || cp apps/api/.env.example apps/api/.env
test -e apps/web/.env || cp apps/web/.env.example apps/web/.env
```

Follow [Configure Google and bootstrap the owner](#configure-google-and-bootstrap-the-owner) with a development Supabase Auth project. Fill in the project values and owner IDs in the local environment files.

Start `pnpm --filter @finscope/api dev` and `pnpm --filter @finscope/web dev` in separate terminals. Open [the local site](http://localhost:5173) or check the API at `http://localhost:3000/health`. The health endpoint returns HTTP 200 with `{"status":"ok"}` when the API can query PostgreSQL and HTTP 503 with `{"status":"unavailable"}` when the database is unavailable. The API applies Drizzle migrations before it listens. See the [OpenAPI contract](openapi.json). Run the API and PostgreSQL integration checks against the local database with:

```sh
FINSCOPE_TEST_DATABASE_URL=postgresql://finscope:finscope@127.0.0.1:5432/finscope pnpm check
```

## Provision production

1. Create a Supabase Free project. Under **Connect**, copy the **Session pooler** connection URI and download the CA certificate. Substitute the URL-encoded PostgreSQL password and set `sslmode=verify-full&sslrootcert=/etc/secrets/supabase-ca.crt` in the URI query string. The shared session pooler can be reached over IPv4. [Supabase database connection options](https://supabase.com/docs/guides/database/connecting-to-postgres) · [Supabase connection examples with TLS](https://supabase.com/docs/guides/database/psql)
2. Create a Cloudflare Pages **Direct Upload** project with production branch `main`. Record its HTTPS origin and account ID. Create an API token with **Account → Cloudflare Pages → Edit** for that account. For CLI project creation, use `npx wrangler pages project create <project-name> --production-branch main`. [Cloudflare Direct Upload and CI](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)
3. Create a Sentry Node.js project and copy the project's DSN. [Sentry for Node.js](https://docs.sentry.io/platforms/javascript/guides/node/)
4. Once the application is on `main`, create a Render Free Web Service connected to the repository. Select branch `main`, Docker runtime, repository-root build context, the root `Dockerfile`, and `/health` as the health check path. Disable automatic deployments so GitHub Actions controls releases. Record the HTTPS origin and service ID. Create an API key with access to deploy the service. [Render Docker deployments](https://render.com/docs/docker)
5. Configure Google and bootstrap the owner as described below.
6. Create a GitHub Actions environment named `production`. Limit its deployment branches to `main`, and add the secrets and variables below. [GitHub deployment environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

| Location | Name | Value |
| --- | --- | --- |
| Render environment | `DATABASE_URL` | Supabase session pooler URI |
| Render environment | `CORS_ORIGIN` | Pages production HTTPS origin |
| Render environment | `SENTRY_DSN` | Sentry Node.js project DSN |
| Render environment | `SUPABASE_URL` | Supabase project HTTPS origin |
| Render environment | `SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key with the `sb_publishable_` prefix |
| Render environment | `FINSCOPE_OWNER_USER_ID` | Designated owner's Supabase Auth user UUID |
| Render environment | `FINSCOPE_OWNER_GOOGLE_SUB` | Designated owner's Google identity `provider_id` |
| Render secret file | `supabase-ca.crt` | Supabase CA certificate text |
| GitHub production secret | `RENDER_API_KEY` | Render API key |
| GitHub production secret | `CLOUDFLARE_API_TOKEN` | Cloudflare Pages token |
| GitHub production variable | `RENDER_SERVICE_ID` | Render web service identifier |
| GitHub production variable | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier |
| GitHub production variable | `CLOUDFLARE_PAGES_PROJECT` | Direct Upload project name |
| GitHub production variable | `API_ORIGIN` | Render HTTPS origin |
| GitHub production variable | `WEB_ORIGIN` | Pages production HTTPS origin, matching `CORS_ORIGIN` |
| GitHub production variable | `SUPABASE_URL` | Same Supabase project origin as Render |
| GitHub production variable | `SUPABASE_PUBLISHABLE_KEY` | Same Supabase publishable key as Render |

Use origins without paths or trailing slashes. Render provides `PORT` and sets `RENDER=true`. The API requires `SENTRY_DSN` on Render and verifies that the SDK can configure a client at startup. The DSN is optional for local development and the GitHub Actions smoke test. The workflow passes `VITE_API_URL`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to Vite at build time. These values are public. Keep the Google client secret in Supabase and the database connection and owner configuration in Render.

## Configure Google and bootstrap the owner

1. Create a Web application OAuth client in Google Auth Platform. Add the exact Supabase callback URL shown on the Supabase Google provider page to **Authorized redirect URIs**. Add the Pages origin and the temporary development origin `http://localhost:5173` to **Authorized JavaScript origins**. If Google consent is in Testing, add the owner and the second Google account used for the access check as test users. [Supabase Google sign-in setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google)
2. In Supabase Auth, enable Google with the client ID and secret. Keep Google as the only enabled sign-in provider. Disable anonymous sign-in, manual identity linking, the OAuth 2.1 server and unneeded providers including email and phone. Under URL Configuration, set **Site URL** to the Pages HTTPS URL and add the exact redirect URLs `https://<pages-project>.pages.dev/` and `http://localhost:5173/`. Leave new user signup enabled while creating the owner and the separate verification identity. Keep `finscope_private` outside the Data API's exposed schemas. [Supabase redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls) · [Supabase Data API security](https://supabase.com/docs/guides/api/securing-your-api)
3. Make the first Google sign-in using only the frontend. Copy `apps/web/.env.example` to `apps/web/.env` if needed and fill in the target project's `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Start `pnpm --filter @finscope/web dev`, open `http://localhost:5173/` and sign in as the owner. Supabase creates the Auth user even if the financial API is offline during this step.
4. In Supabase Authentication → Users, find the user created by the designated owner and copy its UUID into `FINSCOPE_OWNER_USER_ID`. In the project's SQL editor, retrieve the verified Google identifier for that UUID and set it as `FINSCOPE_OWNER_GOOGLE_SUB`. Use the decimal string exactly as stored. Confirm the query returns one row and the owner has only the Google identity. [Supabase user identities](https://supabase.com/docs/guides/auth/identities)

   ```sql
   SELECT provider_id
     FROM auth.identities
    WHERE provider = 'google' AND user_id = '<owner-auth-user-uuid>'::uuid;
   ```

5. Sign out of the local session. Remove the temporary development redirect from the production Supabase project and the Google client after bootstrapping. The production Pages URL serves subsequent sign-ins.

## Release and verify

The [Verify and deploy workflow](../.github/workflows/deployment.yml) runs different jobs depending on how it starts.

| Trigger | Jobs that run |
| --- | --- |
| Open or update a pull request | `verify` checks the change before merge. Find the result in the pull request's **Checks** tab. |
| Push or merge into `main` | `verify` checks the resulting commit on `main`. |
| Run the workflow manually on a feature branch | `verify` checks the selected branch. |
| Run the workflow manually on `main` | `verify` runs first, then `deploy` releases the selected commit to production if verification passes. |

### Before merge

Open a pull request and wait for the **verify** job to pass before merging. The job installs dependencies from the lockfile, starts PostgreSQL on the runner, runs `pnpm check` to type-check the frontend and API and run the API tests, and builds the application. It also builds and starts the API Docker image and checks that `/health` reports a working database connection.

CI uses a disposable PostgreSQL database and test authentication fixtures. The current workflow provides verification on the runner and a separate production deployment. Testing real Google sign-in against a deployed branch before merge would require a separate staging environment.

### Deploy from main

After merging, open **Actions → Verify and deploy → Run workflow**, select `main`, and wait for **deploy** to succeed. The job builds the frontend with production settings and deploys the selected commit to Render. It checks API readiness, CORS for the production Pages origin, and HTTP 401 responses for signed-out account-list and account-creation requests. It then publishes the frontend to Cloudflare Pages and checks that the site responds. Releases run one at a time.

### After deployment

Run any issue-specific live checks after **deploy** succeeds. Use the test results recorded on the implementation issue for behaviour already verified. Follow the linked owner checklist for remaining checks that require live access, such as real Google sign-in, persistence across a new session, or direct API requests with real identities. Record the workflow run link and results in the verification issue.

Open the production Pages URL and confirm it offers **Continue with Google**. Open the Render service logs and verify the readiness requests produced structured Pino logs. Confirm that Render's `SENTRY_DSN` matches the intended Sentry project. To verify event delivery from FinScope, check that an unexpected API error recorded in the Render logs has a corresponding event in Sentry for the deployed release.

If the API stays unavailable, inspect Render logs and confirm the Supabase project is active and the session pooler URI is valid. If CORS fails, compare the Pages origin with `CORS_ORIGIN` and `WEB_ORIGIN`. After correcting configuration, rerun the workflow on `main`.

### Owner walkthrough

1. On a desktop viewport, open the Pages URL and confirm the sign-in screen appears while signed out. Sign in with the designated Google account and open a bank account with SGD 3,000. Switch to a narrow mobile viewport and open a brokerage account with SGD 0. Use distinct names and record both opening dates.
2. On both viewport sizes, verify that the form is usable and that **Financial accounts** shows the two dated balances, SGD 3,000 total balance, and SGD 0 for income and expenses on a fresh workspace. Sign out, refresh, and sign in again to confirm the entries remain. Rerun the deployment workflow and confirm the same entries and amounts are still present.
3. Sign in from a private browser as the second Google identity. Verify the page says **Access restricted**. Check both direct API methods while signed out and using each Google identity. The expected responses are below. Browser DevTools shows the Supabase access token in the finance request's Authorization header after sign-in. Keep it in your own terminal session and clear it after the checks.

| Caller | GET `/financial-accounts` | POST `/financial-accounts` |
| --- | --- | --- |
| Signed out | 401 | 401 |
| Different Google identity | 403 | 403 |
| Configured owner | 200 | 201 with a valid body |

Use the Render origin in `API_ORIGIN`. This Bash example prompts for the token without echoing it. Press Enter for a signed-out request. Run the signed-out and non-owner POST checks with the body below, then verify the owner’s account list contains no account named `Access check`. Before repeating the POST with the owner token, replace the example body with the details of an account you intend to save.

```bash
read -r -s -p 'Supabase access token (blank if signed out): ' FINSCOPE_ACCESS_TOKEN
printf '\n'
auth_header=()
if [[ -n "$FINSCOPE_ACCESS_TOKEN" ]]; then
  auth_header=(--header "Authorization: Bearer $FINSCOPE_ACCESS_TOKEN")
fi
curl --silent --show-error --include "${auth_header[@]}" "$API_ORIGIN/financial-accounts"
curl --silent --show-error --include "${auth_header[@]}" \
  --header 'Content-Type: application/json' \
  --data '{"name":"Access check","type":"bank","currency":"SGD","openingDate":"2026-11-19","openingBalance":"0.00"}' \
  "$API_ORIGIN/financial-accounts"
unset FINSCOPE_ACCESS_TOKEN auth_header
```

### Roll back or roll forward

Restrict owner access and pause writes during recovery. Keep the database and applied migrations in place. Use the provider dashboards to restore a compatible API and Pages deployment. Before restoring a release that predates cash transfers, confirm that the database has no recorded transfers. Once a transfer exists, use a prior API and Pages release that both support transfers or roll forward with a fix. A pre-transfer API can pass `/health` while omitting recorded transfers from account balances and histories. Once an ETF trade exists, restore only an API and Pages release that supports ETF trades as well. Earlier releases omit the trade cash movements and can allow funding changes that invalidate recorded buys.

Before reopening access, check API readiness and open the Pages site. If there are recorded transfers, use a known transfer and compare with the last known correct figures for the same reporting period:

- Check both account histories for the same amount and date, with an outgoing entry in the source account and an incoming entry in the destination account.
- Check that the source and destination balances reflect the debit and credit and that the transfer leaves total balance unchanged.
- Check that income, expenses and net cashflow for the same period exclude the transfer and match the expected amounts.

If there are recorded ETF trades, reconcile brokerage cash against opening cash, transactions, transfers, and recorded trade movements. Compare a known holding's units, remaining cost and realised profit or loss with the last correct figures. Verify that unpriced open holdings produce a partial portfolio valuation and that trades are excluded from everyday income and spending.

Keep access restricted if any financial check fails and verify again after a compatible release is deployed.

## Back up and restore financial data

Use PostgreSQL client tools at least as new as the source server. Use the source database connection URI including its TLS options. Provision a fresh, separate PostgreSQL database for the drill and use its URL as the restore target. Set `FINSCOPE_BACKUP_SOURCE_URL` and `FINSCOPE_RESTORE_TARGET_URL` in a private shell. Confirm the target is the separate database and restore it before starting FinScope against it. [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html) · [PostgreSQL pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html)

```bash
: "${FINSCOPE_BACKUP_SOURCE_URL:?Set the source database URL}"
: "${FINSCOPE_RESTORE_TARGET_URL:?Set the separate restore database URL}"
test "$FINSCOPE_BACKUP_SOURCE_URL" != "$FINSCOPE_RESTORE_TARGET_URL" || exit 1
umask 077
pg_dump --dbname="$FINSCOPE_BACKUP_SOURCE_URL" --format=custom \
  --schema=finscope_private --file=finscope-private.dump
pg_restore --exit-on-error --single-transaction --no-owner \
  --dbname="$FINSCOPE_RESTORE_TARGET_URL" finscope-private.dump
psql "$FINSCOPE_RESTORE_TARGET_URL" -v ON_ERROR_STOP=1 -c '
  SELECT name, type, opening_date, opening_balance
    FROM finscope_private.financial_accounts
   ORDER BY opening_date, name, id;
'
```

Compare the restored names, dates and amounts with the source, including the SGD 3,000 bank opening balance and SGD 0 brokerage opening balance. Start a separate API against the restored database using the same Supabase Auth project and owner values. Check `/health` and the owner's `GET /financial-accounts` response, including zero income and expenses. Record the restore date, backup timestamp and results without including account data or connection credentials. Store the dump with restricted access and encryption.

The backup includes financial accounts, active transactions, transfers and ETF trades, retained deletion records, and the migration history. Supabase Auth is managed separately. Recovery into a replacement Auth project requires bootstrapping the same Google identity, checking its provider ID against the recorded owner value and remapping the old owner UUID to the new UUID in the restored database before starting the API. Keep the production connection pointed at the current data until a replacement has passed verification.
