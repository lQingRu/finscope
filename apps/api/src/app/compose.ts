import type { ApiConfig } from "../config/env.ts";
import { createEtfTradeRepository } from "../etf-trades/repository.ts";
import { createFinancialAccountRepository } from "../financial-accounts/repository.ts";
import { connectPostgres } from "../infrastructure/postgres.ts";
import { createOwnerAuthorizer } from "../infrastructure/supabase-owner-auth.ts";
import { reportError } from "../infrastructure/telemetry.ts";
import { createTransferRepository } from "../transfers/repository.ts";
import { createApi } from "./create-api.ts";

export async function composeApi(config: ApiConfig) {
  const { pool, db, checkDatabase } = connectPostgres(config.DATABASE_URL);
  const api = await createApi({
    checkDatabase,
    accounts: {
      authorize: createOwnerAuthorizer({
        supabaseUrl: config.SUPABASE_URL,
        supabasePublishableKey: config.SUPABASE_PUBLISHABLE_KEY,
        ownerUserId: config.FINSCOPE_OWNER_USER_ID,
        ownerGoogleSubject: config.FINSCOPE_OWNER_GOOGLE_SUB,
      }),
      repository: createFinancialAccountRepository(db),
      transferRepository: createTransferRepository(db),
      etfTradeRepository: createEtfTradeRepository(db),
    },
    corsOrigin: config.CORS_ORIGIN,
    reportError,
  });

  pool.on("error", () => {
    api.log.warn("Idle PostgreSQL connection closed unexpectedly");
  });

  return { api, pool };
}
