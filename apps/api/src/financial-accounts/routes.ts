import {
  accountOpeningAfterActivityMessage,
  correctFinancialAccount,
  currentSingaporeMonth,
  financialAccountErrors,
  financialAccountResponses,
  openFinancialAccount,
  reportingPeriodQuery,
} from "@finscope/contracts/financial-accounts";
import type {
  CorrectFinancialAccount,
  FinancialAccount,
  FinancialAccountOverview,
  OpenFinancialAccount,
  ReportingPeriod,
} from "@finscope/contracts/financial-accounts";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AuthorizeOwner } from "./authorization.ts";
import { registerTransactionRoutes } from "../transactions/routes.ts";
import type { TransactionRepository } from "../transactions/routes.ts";
import { registerTransferRoutes } from "../transfers/routes.ts";
import type { TransferRepository } from "../transfers/routes.ts";

type AccountCorrection =
  | { status: "saved"; account: FinancialAccount }
  | { status: "not_found" }
  | { status: "after_activity"; activityDate: string };

export type FinancialAccountRepository = TransactionRepository & {
  list: (ownerUserId: string, period: ReportingPeriod) => Promise<FinancialAccountOverview>;
  open: (ownerUserId: string, account: OpenFinancialAccount) => Promise<FinancialAccount>;
  delete: (ownerUserId: string, accountId: string) => Promise<"deleted" | "not_found" | "linked_activity">;
  correct: (ownerUserId: string, accountId: string, input: CorrectFinancialAccount) => Promise<AccountCorrection>;
};

export type FinancialAccountsOptions = {
  authorize: AuthorizeOwner;
  repository: FinancialAccountRepository;
  transferRepository: TransferRepository;
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
  { authorize, repository, transferRepository },
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
    const query = reportingPeriodQuery.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send(financialAccountResponses.list[400].parse({ status: "invalid_request" }));
    }
    const { view, from, to } = query.data;
    const period = from && to ? { from, to } : currentSingaporeMonth();
    const overview = await repository.list(request.getDecorator<string>("workspaceOwnerId"), period);
    if (view || from) {
      return reply.send(financialAccountResponses.overview[200].parse(overview));
    }
    const accounts = overview.accounts.map(({ balance, earliestActivityDate, ...account }) => account);
    const { from: firstDate, to: lastDate, netCashflow, ...summary } = overview.summary;
    return reply.send(financialAccountResponses.list[200].parse({ accounts, summary }));
  });

  registerTransactionRoutes(api, repository);
  registerTransferRoutes(api, transferRepository);

  api.post("/financial-accounts", async (request, reply) => {
    const input = openFinancialAccount.safeParse(request.body);
    if (!input.success) {
      return reply.code(400).send(invalidAccountInput(input.error));
    }

    const account = await repository.open(request.getDecorator<string>("workspaceOwnerId"), input.data);
    return reply.code(201).send(financialAccountResponses.open[201].parse(account));
  });

  api.delete("/financial-accounts/:accountId", async (request, reply) => {
    const params = accountParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send(financialAccountResponses.delete[400].parse({ status: "invalid_request" }));
    }

    const removed = await repository.delete(request.getDecorator<string>("workspaceOwnerId"), params.data.accountId);
    if (removed === "not_found") {
      return reply.code(404).send(financialAccountResponses.delete[404].parse({ status: "not_found" }));
    }
    if (removed === "linked_activity") {
      return reply.code(409).send(financialAccountResponses.delete[409].parse({ status: "linked_activity" }));
    }
    return reply.code(204).send();
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

    const result = await repository.correct(
      request.getDecorator<string>("workspaceOwnerId"), params.data.accountId, input.data,
    );
    if (result.status === "not_found") {
      return reply.code(404).send(financialAccountResponses.correct[404].parse({ status: "not_found" }));
    }

    if (result.status === "after_activity") {
      return reply.code(400).send(financialAccountResponses.correct[400].parse({
        status: "invalid_request",
        openingDateError: accountOpeningAfterActivityMessage(result.activityDate),
      }));
    }
    return reply.send(financialAccountResponses.correct[200].parse(result.account));
  });
};
