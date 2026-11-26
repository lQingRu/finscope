import {
  transactionBeforeOpeningMessage,
  transactionResponses,
} from "@finscope/contracts/transactions";
import type { TransactionInput } from "@finscope/contracts/transactions";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { ZodRequestTypeProvider } from "../app/request-validation.ts";
import type { TransactionService } from "./transactions.service.ts";
import { transactionSchemas } from "./transactions.schema.ts";

export const transactionRoutes: FastifyPluginAsync<{ service: TransactionService }> = async (instance, { service }) => {
  const api = instance.withTypeProvider<ZodRequestTypeProvider>();

  api.get("/financial-accounts/:accountId/transactions", transactionSchemas.list, async (request, reply) => {
    const history = await service.listTransactions(
      request.getDecorator<string>("workspaceOwnerId"), request.params.accountId, request.query,
    );
    if (!history) {
      return reply.code(404).send(transactionResponses.list[404].parse({ status: "not_found" }));
    }
    return reply.send(transactionResponses.list[200].parse(history));
  });

  async function saveTransaction(owner: string, input: TransactionInput, reply: FastifyReply, transactionId?: string) {
    const invalid = transactionResponses.record[400];
    const result = transactionId
      ? await service.correctTransaction(owner, transactionId, input)
      : await service.recordTransaction(owner, input);
    if (result.status === "not_found") {
      return reply.code(404).send(transactionResponses.correct[404].parse({ status: "not_found" }));
    }
    if (result.status === "missing_account") {
      return reply.code(404).send(transactionResponses.record[404].parse({
        status: "not_found", fieldErrors: { accountId: "Select an available financial account." },
      }));
    }
    if (result.status === "before_opening") {
      return reply.code(400).send(invalid.parse({
        status: "invalid_request", fieldErrors: { date: transactionBeforeOpeningMessage(result.openingDate) },
      }));
    }
    return transactionId
      ? reply.send(transactionResponses.correct[200].parse(result.transaction))
      : reply.code(201).send(transactionResponses.record[201].parse(result.transaction));
  }

  api.post("/transactions", transactionSchemas.record, (request, reply) =>
    saveTransaction(request.getDecorator<string>("workspaceOwnerId"), request.body, reply));
  api.patch("/transactions/:transactionId", transactionSchemas.correct, (request, reply) =>
    saveTransaction(request.getDecorator<string>("workspaceOwnerId"), request.body, reply, request.params.transactionId));
  api.delete("/transactions/:transactionId", transactionSchemas.delete, async (request, reply) => {
    const result = await service.deleteTransaction(request.getDecorator<string>("workspaceOwnerId"), request.params.transactionId);
    if (result === "not_found") {
      return reply.code(404).send(transactionResponses.delete[404].parse({ status: "not_found" }));
    }
    return reply.code(204).send();
  });
};
