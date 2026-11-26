import { transferBeforeOpeningMessage, transferResponses } from "@finscope/contracts/transfers";
import type { TransferInput } from "@finscope/contracts/transfers";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { ZodRequestTypeProvider } from "../app/request-validation.ts";
import type { TransferService } from "./transfers.service.ts";
import { transferSchemas } from "./transfers.schema.ts";

export const transferRoutes: FastifyPluginAsync<{ service: TransferService }> = async (instance, { service }) => {
  const api = instance.withTypeProvider<ZodRequestTypeProvider>();

  async function saveTransfer(owner: string, input: TransferInput, reply: FastifyReply, transferId?: string) {
    const invalid = transferResponses.record[400];
    const result = transferId
      ? await service.correctTransfer(owner, transferId, input)
      : await service.recordTransfer(owner, input);
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

  api.post("/transfers", transferSchemas.record, (request, reply) =>
    saveTransfer(request.getDecorator<string>("workspaceOwnerId"), request.body, reply));
  api.patch("/transfers/:transferId", transferSchemas.correct, (request, reply) =>
    saveTransfer(request.getDecorator<string>("workspaceOwnerId"), request.body, reply, request.params.transferId));
  api.delete("/transfers/:transferId", transferSchemas.delete, async (request, reply) => {
    const result = await service.deleteTransfer(request.getDecorator<string>("workspaceOwnerId"), request.params.transferId);
    if (result === "not_found") {
      return reply.code(404).send(transferResponses.delete[404].parse({ status: "not_found" }));
    }
    return reply.code(204).send();
  });
};
