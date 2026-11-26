import { z } from "zod";

export const apiEnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, hostname: /./ }),
  CORS_ORIGIN: z
    .url({ protocol: /^https?$/ })
    .refine((value) => URL.parse(value)?.origin === value),
  SUPABASE_URL: z.url({ protocol: /^https$/ }).refine((value) => URL.parse(value)?.origin === value),
  SUPABASE_PUBLISHABLE_KEY: z.string().regex(/^sb_publishable_[a-zA-Z0-9_-]+$/),
  FINSCOPE_OWNER_USER_ID: z.uuid().toLowerCase(),
  FINSCOPE_OWNER_GOOGLE_SUB: z.string().regex(/^[0-9]+$/),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SENTRY_DSN: z.union([
    z.url({ protocol: /^https?$/, normalize: true }).refine((value) => {
      const dsn = URL.parse(value);
      return (
        dsn !== null &&
        /^\w+$/.test(dsn.username) &&
        /^\w*$/.test(dsn.password) &&
        /\/\d+$/.test(dsn.pathname) &&
        !dsn.search &&
        !dsn.hash
      );
    }),
    z.literal(""),
  ]).optional(),
  RENDER: z.string().optional(),
  NODE_ENV: z.string().default("development"),
  RELEASE: z.string().optional(),
  RENDER_GIT_COMMIT: z.string().optional(),
}).refine((config) => config.RENDER !== "true" || Boolean(config.SENTRY_DSN), {
  path: ["SENTRY_DSN"],
});

export type ApiConfig = z.infer<typeof apiEnvSchema>;
