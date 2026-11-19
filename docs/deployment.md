# Deploy FinScope

[ADR 0001](adr/0001-initial-mvp-stack.md) places the React site on Cloudflare Pages, the containerised Fastify API on Render, and PostgreSQL on Supabase. [Issue #9](https://github.com/lQingRu/finscope/issues/9) tracks one-time platform setup. These instructions use the provider-assigned HTTPS domains.

## Local development

Install Node.js 26, pnpm 11.3.0, and Docker with Compose. From the repository root, run:

```sh
pnpm install --frozen-lockfile
docker compose up -d --wait db
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Start `pnpm --filter @finscope/api dev` and `pnpm --filter @finscope/web dev` in separate terminals. Open [the local site](http://localhost:5173) or check the API at `http://localhost:3000/health`. The health endpoint returns HTTP 200 with `{"status":"ok"}` when the API can query PostgreSQL and HTTP 503 with `{"status":"unavailable"}` when the database is unavailable. See the [OpenAPI contract](openapi.json).

## Provision production

1. Create a Supabase Free project. Under **Connect**, copy the **Session pooler** connection URI and download the CA certificate. Substitute the URL-encoded PostgreSQL password and set `sslmode=verify-full&sslrootcert=/etc/secrets/supabase-ca.crt` in the URI query string. The shared session pooler can be reached over IPv4. [Supabase database connection options](https://supabase.com/docs/guides/database/connecting-to-postgres) · [Supabase connection examples with TLS](https://supabase.com/docs/guides/database/psql)
2. Create a Cloudflare Pages **Direct Upload** project with production branch `main`. Record its HTTPS origin and account ID. Create an API token with **Account → Cloudflare Pages → Edit** for that account. For CLI project creation, use `npx wrangler pages project create <project-name> --production-branch main`. [Cloudflare Direct Upload and CI](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)
3. Create a Sentry Node.js project and copy the project's DSN. [Sentry for Node.js](https://docs.sentry.io/platforms/javascript/guides/node/)
4. Once the application is on `main`, create a Render Free Web Service connected to the repository. Select branch `main`, Docker runtime, repository-root build context, the root `Dockerfile`, and `/health` as the health check path. Disable automatic deployments so GitHub Actions controls releases. Record the HTTPS origin and service ID. Create an API key with access to deploy the service. [Render Docker deployments](https://render.com/docs/docker)
5. Create a GitHub Actions environment named `production`. Limit its deployment branches to `main`, and add the secrets and variables below. [GitHub deployment environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

| Location | Name | Value |
| --- | --- | --- |
| Render environment | `DATABASE_URL` | Supabase session pooler URI |
| Render environment | `CORS_ORIGIN` | Pages production HTTPS origin |
| Render environment | `SENTRY_DSN` | Sentry Node.js project DSN |
| Render secret file | `supabase-ca.crt` | Supabase CA certificate text |
| GitHub production secret | `RENDER_API_KEY` | Render API key |
| GitHub production secret | `CLOUDFLARE_API_TOKEN` | Cloudflare Pages token |
| GitHub production variable | `RENDER_SERVICE_ID` | Render web service identifier |
| GitHub production variable | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier |
| GitHub production variable | `CLOUDFLARE_PAGES_PROJECT` | Direct Upload project name |
| GitHub production variable | `API_ORIGIN` | Render HTTPS origin |
| GitHub production variable | `WEB_ORIGIN` | Pages production HTTPS origin, matching `CORS_ORIGIN` |

Use origins without paths or trailing slashes. Render provides `PORT` and sets `RENDER=true`. The API requires `SENTRY_DSN` on Render and verifies that the SDK can configure a client at startup. The DSN is optional for local development and the GitHub Actions smoke test. The workflow passes the public API origin to Vite as `VITE_API_URL` at build time. Keep credentials in platform settings.

## Release and verify

Open **Actions → Verify and deploy → Run workflow** and select `main`. Pull requests and pushes to `main` run the verification job. A manual run on `main` also builds the production assets, deploys the selected commit on Render, checks API readiness and CORS, publishes the assets to Pages, and checks the production site responds. Releases run one at a time.

Open the production Pages URL and confirm it shows **Operational**. Open the Render service logs and verify the readiness requests produced structured Pino logs. Confirm that Render's `SENTRY_DSN` matches the intended Sentry project. To verify event delivery from FinScope, check that an unexpected API error recorded in the Render logs has a corresponding event in Sentry for the deployed release.

If the API stays unavailable, inspect Render logs and confirm the Supabase project is active and the session pooler URI is valid. If CORS fails, compare the Pages origin with `CORS_ORIGIN` and `WEB_ORIGIN`. After correcting configuration, rerun the workflow on `main`.

To roll back an application release, use the prior deployment in each provider's dashboard. Confirm API readiness and open the Pages site after the rollback. The account-data backup and restore exercise is tracked in [issue #2](https://github.com/lQingRu/finscope/issues/2).
