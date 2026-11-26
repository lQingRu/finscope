import type { ApiConfig } from "../config/env.ts";
import { createEtfTradeRepository } from "../etf-trades/etf-trades.repository.ts";
import { createEtfTradeService } from "../etf-trades/etf-trades.service.ts";
import { createFinancialAccountRepository } from "../financial-accounts/financial-accounts.repository.ts";
import { createFinancialAccountService } from "../financial-accounts/financial-accounts.service.ts";
import { connectPostgres } from "../infrastructure/postgres.ts";
import { createOwnerAuthorizer } from "../infrastructure/supabase-owner-auth.ts";
import { reportError } from "../infrastructure/telemetry.ts";
import { createTransactionRepository } from "../transactions/transactions.repository.ts";
import { createTransactionService } from "../transactions/transactions.service.ts";
import { createTransferRepository } from "../transfers/transfers.repository.ts";
import { createTransferService } from "../transfers/transfers.service.ts";
import { createApi } from "./create-api.ts";

export async function composeApi(config: ApiConfig) {
  const { pool, db, checkDatabase } = connectPostgres(config.DATABASE_URL);
  const api = await createApi({
    checkDatabase,
    workspace: {
      authorize: createOwnerAuthorizer({
        supabaseUrl: config.SUPABASE_URL,
        supabasePublishableKey: config.SUPABASE_PUBLISHABLE_KEY,
        ownerUserId: config.FINSCOPE_OWNER_USER_ID,
        ownerGoogleSubject: config.FINSCOPE_OWNER_GOOGLE_SUB,
      }),
      financialAccountService: createFinancialAccountService(createFinancialAccountRepository(db)),
      transactionService: createTransactionService(createTransactionRepository(db)),
      transferService: createTransferService(createTransferRepository(db)),
      etfTradeService: createEtfTradeService(createEtfTradeRepository(db)),
    },
    corsOrigin: config.CORS_ORIGIN,
    reportError,
  });

  pool.on("error", () => {
    api.log.warn("Idle PostgreSQL connection closed unexpectedly");
  });

  return { api, pool };
}
