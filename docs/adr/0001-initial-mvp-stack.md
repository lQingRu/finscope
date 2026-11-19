---
status: accepted
---

# Initial MVP technology stack and deployment architecture

FinScope targets US$0/month for the hobby MVP and accepts free-hosting cold starts and inactivity pauses. Financial correctness, security and data recovery take precedence over cost savings. Revisit these decisions when a concrete requirement or technical limitation warrants a change.

## Application

- Use a TypeScript monorepo with pnpm workspaces. Deploy a React single-page application and a separate Node.js LTS Fastify REST API. Organise the API as a modular monolith with domain-oriented modules.
- Build the frontend with Vite, TanStack Router, TanStack Query, Tailwind CSS and shadcn/ui. Use React Hook Form and Zod for forms.
- Share API contracts, validate requests and responses with Zod, and document the API with OpenAPI.
- Store financial records in PostgreSQL using Drizzle ORM and migrations. Isolate financial calculation logic and use decimal.js for precise arithmetic.
- Use Supabase Auth with Google OAuth. The API independently verifies authentication tokens and enforces workspace-level authorisation on every financial read and write. The initial workspace admits the designated owner.

## Deployment and verification

- Deploy the frontend to Cloudflare Pages, the containerised API to a Render Free Web Service, and PostgreSQL and Auth to Supabase Free. Use GitHub Actions for CI/CD and Docker for reproducible API deployments and local PostgreSQL development.
- Use Pino for structured logs and Sentry for error monitoring. Verify data recovery by restoring a backup to a separate database.
- Verify this milestone manually through the deployed application and direct API requests. In a later increment, use Vitest for unit and integration tests, real PostgreSQL for database integration tests, and Playwright for end-to-end tests.

## Portability

Keep the static frontend, containerised API and PostgreSQL database portable. AWS provisioning is deferred. The future AWS direction is ECS Fargate for the API, RDS PostgreSQL, S3 and CloudFront for the frontend, CloudWatch for observability, Secrets Manager for credentials, and GitHub Actions with AWS OIDC for deployment. Introducing microservices, Kubernetes, Redis, Kafka or other infrastructure requires a demonstrated need.
