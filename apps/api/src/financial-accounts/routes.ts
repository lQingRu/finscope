import {
  correctFinancialAccount,
  financialAccountErrors,
  financialAccountResponses,
  openFinancialAccount,
} from "@finscope/contracts/financial-accounts";
import type {
  CorrectFinancialAccount,
  FinancialAccount,
  OpenFinancialAccount,
} from "@finscope/contracts/financial-accounts";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AuthorizeOwner } from "./authorization.ts";
import { summarizeFinancialAccounts } from "./summary.ts";

export type FinancialAccountRepository = {
  list: (ownerUserId: string) => Promise<FinancialAccount[]>;
  open: (ownerUserId: string, account: OpenFinancialAccount) => Promise<FinancialAccount>;
  correct: (ownerUserId: string, accountId: string, input: CorrectFinancialAccount) => Promise<FinancialAccount | undefined>;
};

export type FinancialAccountsOptions = {
  authorize: AuthorizeOwner;
  repository: FinancialAccountRepository;
};

const accountParams = z.object({ accountId: z.uuid() });

function invalidAccountInput(error: z.ZodError) {
  const dateIssue = error.issues.find(({ path }) => path[0] === "openingDate");
  return financialAccountErrors[400].parse({
    status: "invalid_request",
    openingDateError: dateIssue?.message,
  });
}

export const financialAccountRoutes: FastifyPluginAsync<FinancialAccountsOptions> = async (
  api,
  { authorize, repository },
) => {
  api.decorateRequest("workspaceOwnerId", null);
  api.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");

    const authorization = await authorize(request.headers.authorization);
    if (authorization.status !== "authorized") {
      const status = { unauthenticated: 401, forbidden: 403, unavailable: 503 } as const;
      const code = status[authorization.status];
      return reply.code(code).send(financialAccountErrors[code].parse(authorization));
    }

    request.setDecorator("workspaceOwnerId", authorization.ownerUserId);
  });

  api.get("/financial-accounts", async (request, reply) => {
    const accounts = await repository.list(request.getDecorator<string>("workspaceOwnerId"));
    return reply.send(financialAccountResponses.list[200].parse({
      accounts,
      summary: summarizeFinancialAccounts(accounts),
    }));
  });

  api.post("/financial-accounts", async (request, reply) => {
    const input = openFinancialAccount.safeParse(request.body);
    if (!input.success) {
      return reply.code(400).send(invalidAccountInput(input.error));
    }

    const account = await repository.open(request.getDecorator<string>("workspaceOwnerId"), input.data);
    return reply.code(201).send(financialAccountResponses.open[201].parse(account));
  });

  api.patch("/financial-accounts/:accountId", async (request, reply) => {
    const params = accountParams.safeParse(request.params);
    const input = correctFinancialAccount.safeParse(request.body);
    if (!params.success) {
      return reply.code(400).send(financialAccountResponses.correct[400].parse({ status: "invalid_request" }));
    }
    if (!input.success) {
      return reply.code(400).send(invalidAccountInput(input.error));
    }

    const account = await repository.correct(
      request.getDecorator<string>("workspaceOwnerId"), params.data.accountId, input.data,
    );
    if (!account) {
      return reply.code(404).send(financialAccountResponses.correct[404].parse({ status: "not_found" }));
    }

    return reply.send(financialAccountResponses.correct[200].parse(account));
  });
};
