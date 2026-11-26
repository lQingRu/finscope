import { financialAccountErrors } from "@finscope/contracts/financial-accounts";
import type { FastifyPluginAsync } from "fastify";
import type { EtfTradeService } from "../etf-trades/etf-trades.service.ts";
import { etfTradeRoutes } from "../etf-trades/etf-trades.routes.ts";
import type { FinancialAccountService } from "../financial-accounts/financial-accounts.service.ts";
import { financialAccountRoutes } from "../financial-accounts/financial-accounts.routes.ts";
import type { AuthorizeOwner } from "../infrastructure/supabase-owner-auth.ts";
import type { TransactionService } from "../transactions/transactions.service.ts";
import { transactionRoutes } from "../transactions/transactions.routes.ts";
import type { TransferService } from "../transfers/transfers.service.ts";
import { transferRoutes } from "../transfers/transfers.routes.ts";
import { compileRequestSchema } from "./request-validation.ts";

export type WorkspaceOptions = {
  authorize: AuthorizeOwner;
  financialAccountService: FinancialAccountService;
  transactionService: TransactionService;
  transferService: TransferService;
  etfTradeService?: EtfTradeService;
};

export const workspacePlugin: FastifyPluginAsync<WorkspaceOptions> = async (api, options) => {
  api.setValidatorCompiler(compileRequestSchema);
  api.decorateRequest("workspaceOwnerId", null);
  api.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");

    const authorization = await options.authorize(request.headers.authorization);
    if (authorization.status !== "authorized") {
      const status = { unauthenticated: 401, forbidden: 403, unavailable: 503 } as const;
      const code = status[authorization.status];
      return reply.code(code).send(financialAccountErrors[code].parse(authorization));
    }

    request.setDecorator("workspaceOwnerId", authorization.ownerUserId);
  });

  await api.register(financialAccountRoutes, { service: options.financialAccountService });
  await api.register(transactionRoutes, { service: options.transactionService });
  await api.register(transferRoutes, { service: options.transferService });
  if (options.etfTradeService) {
    await api.register(etfTradeRoutes, { service: options.etfTradeService });
  }
};
