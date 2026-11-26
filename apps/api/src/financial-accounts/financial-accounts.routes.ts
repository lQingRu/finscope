import {
  accountOpeningAfterActivityMessage,
  financialAccountResponses,
} from "@finscope/contracts/financial-accounts";
import type { FastifyPluginAsync } from "fastify";
import type { ZodRequestTypeProvider } from "../app/request-validation.ts";
import type { FinancialAccountService } from "./financial-accounts.service.ts";
import { financialAccountSchemas } from "./financial-accounts.schema.ts";

export const financialAccountRoutes: FastifyPluginAsync<{ service: FinancialAccountService }> = async (
  instance,
  { service },
) => {
  const api = instance.withTypeProvider<ZodRequestTypeProvider>();

  api.get("/financial-accounts", financialAccountSchemas.list, async (request, reply) => {
    const { view, from, to } = request.query;
    const period = from && to ? { from, to } : undefined;
    const overview = await service.list(request.getDecorator<string>("workspaceOwnerId"), period);
    if (view || from) {
      return reply.send(financialAccountResponses.overview[200].parse(overview));
    }
    const accounts = overview.accounts.map(({ balance, earliestActivityDate, ...account }) => account);
    const { from: firstDate, to: lastDate, netCashflow, ...summary } = overview.summary;
    return reply.send(financialAccountResponses.list[200].parse({ accounts, summary }));
  });

  api.post("/financial-accounts", financialAccountSchemas.open, async (request, reply) => {
    const account = await service.open(request.getDecorator<string>("workspaceOwnerId"), request.body);
    return reply.code(201).send(financialAccountResponses.open[201].parse(account));
  });

  api.delete("/financial-accounts/:accountId", financialAccountSchemas.delete, async (request, reply) => {
    const removed = await service.delete(request.getDecorator<string>("workspaceOwnerId"), request.params.accountId);
    if (removed === "not_found") {
      return reply.code(404).send(financialAccountResponses.delete[404].parse({ status: "not_found" }));
    }
    if (removed === "linked_activity") {
      return reply.code(409).send(financialAccountResponses.delete[409].parse({ status: "linked_activity" }));
    }
    return reply.code(204).send();
  });

  api.patch("/financial-accounts/:accountId", financialAccountSchemas.correct, async (request, reply) => {
    const result = await service.correct(
      request.getDecorator<string>("workspaceOwnerId"), request.params.accountId, request.body,
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
