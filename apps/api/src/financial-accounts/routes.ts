import {
  financialAccountResponses,
  openFinancialAccount,
  zeroSgd,
} from "@finscope/contracts/financial-accounts";
import type { FinancialAccount, OpenFinancialAccount } from "@finscope/contracts/financial-accounts";
import { Decimal } from "decimal.js";
import type { FastifyPluginAsync } from "fastify";
import type { AuthorizeOwner } from "./authorization.ts";

export type FinancialAccountRepository = {
  list: (ownerUserId: string) => Promise<FinancialAccount[]>;
  open: (ownerUserId: string, account: OpenFinancialAccount) => Promise<FinancialAccount>;
};

export type FinancialAccountsOptions = {
  authorize: AuthorizeOwner;
  repository: FinancialAccountRepository;
};

export const financialAccountRoutes: FastifyPluginAsync<FinancialAccountsOptions> = async (
  api,
  { authorize, repository },
) => {
  api.decorateRequest("workspaceOwnerId", null);
  api.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");

    const authorization = await authorize(request.headers.authorization);
    if (authorization.status !== "authorized") {
      const status = authorization.status;
      return reply.code({ unauthenticated: 401, forbidden: 403, unavailable: 503 }[status]).send({ status });
    }

    request.setDecorator("workspaceOwnerId", authorization.ownerUserId);
  });

  api.get("/financial-accounts", async (request, reply) => {
    const accounts = await repository.list(request.getDecorator<string>("workspaceOwnerId"));
    const balance = accounts.reduce(
      (total, account) => total.plus(account.openingBalance),
      new Decimal(0),
    );
    return reply.send(financialAccountResponses.list[200].parse({
      accounts,
      summary: { currency: "SGD", balance: balance.toFixed(2), income: zeroSgd, expenses: zeroSgd },
    }));
  });

  api.post("/financial-accounts", async (request, reply) => {
    const input = openFinancialAccount.safeParse(request.body);
    if (!input.success) {
      return reply.code(400).send(financialAccountResponses.open[400].parse({ status: "invalid_request" }));
    }

    const account = await repository.open(request.getDecorator<string>("workspaceOwnerId"), input.data);
    return reply.code(201).send(financialAccountResponses.open[201].parse(account));
  });
};
