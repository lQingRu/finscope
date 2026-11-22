import {
  transactionBeforeOpeningMessage,
  transactionHistoryQuery,
  transactionInput,
  transactionResponses,
} from "@finscope/contracts/transactions";
import type { AccountHistory, Transaction, TransactionHistoryQuery, TransactionInput } from "@finscope/contracts/transactions";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

export type TransactionWriteResult =
  | { status: "saved"; transaction: Transaction }
  | { status: "missing_account" }
  | { status: "not_found" }
  | { status: "before_opening"; openingDate: string };

export type TransactionRepository = {
  listTransactions: (ownerUserId: string, accountId: string, filters: TransactionHistoryQuery) => Promise<AccountHistory | undefined>;
  correctTransaction: (ownerUserId: string, transactionId: string, input: TransactionInput) => Promise<TransactionWriteResult>;
  recordTransaction: (ownerUserId: string, input: TransactionInput) => Promise<TransactionWriteResult>;
};

const accountParams = z.object({ accountId: z.uuid() });
const transactionParams = z.object({ transactionId: z.uuid() });

export function registerTransactionRoutes(api: FastifyInstance, repository: TransactionRepository) {
  api.get("/financial-accounts/:accountId/transactions", async (request, reply) => {
    const params = accountParams.safeParse(request.params);
    const query = transactionHistoryQuery.safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.code(400).send(transactionResponses.list[400].parse({ status: "invalid_request" }));
    }

    const history = await repository.listTransactions(
      request.getDecorator<string>("workspaceOwnerId"), params.data.accountId, query.data,
    );
    if (!history) {
      return reply.code(404).send(transactionResponses.list[404].parse({ status: "not_found" }));
    }
    return reply.send(transactionResponses.list[200].parse(history));
  });

  async function saveTransaction(request: FastifyRequest, reply: FastifyReply, transactionId?: string) {
    const input = transactionInput.safeParse(request.body);
    const invalid = transactionResponses.record[400];
    if (!input.success) {
      const fieldErrors = Object.fromEntries(input.error.issues.map(({ path, message }) => [path[0], message]));
      return reply.code(400).send(invalid.parse({ status: "invalid_request", fieldErrors }));
    }

    const owner = request.getDecorator<string>("workspaceOwnerId");
    const result = transactionId
      ? await repository.correctTransaction(owner, transactionId, input.data)
      : await repository.recordTransaction(owner, input.data);
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

  api.post("/transactions", (request, reply) => saveTransaction(request, reply));
  api.patch("/transactions/:transactionId", async (request, reply) => {
    const params = transactionParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send(transactionResponses.correct[400].parse({ status: "invalid_request" }));
    }
    return saveTransaction(request, reply, params.data.transactionId);
  });
}
