import { transferBeforeOpeningMessage, transferInput, transferResponses } from "@finscope/contracts/transfers";
import type { Transfer, TransferAccountField, TransferInput } from "@finscope/contracts/transfers";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

export type TransferWriteResult =
  | { status: "saved"; transfer: Transfer }
  | { status: "missing_account"; field: TransferAccountField }
  | { status: "not_found" }
  | { status: "before_opening"; openingDate: string };

export type TransferRepository = {
  recordTransfer: (ownerUserId: string, input: TransferInput) => Promise<TransferWriteResult>;
  correctTransfer: (ownerUserId: string, transferId: string, input: TransferInput) => Promise<TransferWriteResult>;
};

const transferParams = z.object({ transferId: z.uuid() });

export function registerTransferRoutes(api: FastifyInstance, repository: TransferRepository) {
  async function saveTransfer(request: FastifyRequest, reply: FastifyReply, transferId?: string) {
    const input = transferInput.safeParse(request.body);
    const invalid = transferResponses.record[400];
    if (!input.success) {
      const fieldErrors = Object.fromEntries(input.error.issues.map(({ path, message }) => [path[0], message]));
      return reply.code(400).send(invalid.parse({ status: "invalid_request", fieldErrors }));
    }

    const owner = request.getDecorator<string>("workspaceOwnerId");
    const result = transferId
      ? await repository.correctTransfer(owner, transferId, input.data)
      : await repository.recordTransfer(owner, input.data);
    if (result.status === "not_found") {
      return reply.code(404).send(transferResponses.correct[404].parse({ status: "not_found" }));
    }
    if (result.status === "missing_account") {
      return reply.code(404).send(transferResponses.record[404].parse({
        status: "not_found", fieldErrors: { [result.field]: "Select an available financial account." },
      }));
    }
    if (result.status === "before_opening") {
      return reply.code(400).send(invalid.parse({
        status: "invalid_request", fieldErrors: { date: transferBeforeOpeningMessage(result.openingDate) },
      }));
    }
    return transferId
      ? reply.send(transferResponses.correct[200].parse(result.transfer))
      : reply.code(201).send(transferResponses.record[201].parse(result.transfer));
  }

  api.post("/transfers", (request, reply) => saveTransfer(request, reply));
  api.patch("/transfers/:transferId", async (request, reply) => {
    const params = transferParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send(transferResponses.correct[400].parse({ status: "invalid_request" }));
    }
    return saveTransfer(request, reply, params.data.transferId);
  });
}
