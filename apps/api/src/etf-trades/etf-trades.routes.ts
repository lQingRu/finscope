import { etfTradeResponses } from "@finscope/contracts/etf-trades";
import type { EtfTradeInput } from "@finscope/contracts/etf-trades";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { ZodRequestTypeProvider } from "../app/request-validation.ts";
import type { EtfTradeService } from "./etf-trades.service.ts";
import { etfTradeSchemas } from "./etf-trades.schema.ts";

export const etfTradeRoutes: FastifyPluginAsync<{ service: EtfTradeService }> = async (instance, { service }) => {
  const api = instance.withTypeProvider<ZodRequestTypeProvider>();

  async function saveTrade(owner: string, input: EtfTradeInput, reply: FastifyReply, tradeId?: string) {
    const responses = etfTradeResponses.record;
    const result = tradeId
      ? await service.updateTrade(owner, tradeId, input)
      : await service.recordTrade(owner, input);
    if (result.status === "not_found") {
      return reply.code(404).send(responses[404].parse(result));
    }
    if (result.status === "invalid_request") return reply.code(400).send(responses[400].parse(result));
    if (result.status !== "saved") {
      return reply.code(409).send(responses[409].parse(result));
    }
    return tradeId
      ? reply.send(etfTradeResponses.update[200].parse(result.trade))
      : reply.code(201).send(responses[201].parse(result.trade));
  }

  api.post("/etf-trades", etfTradeSchemas.record, (request, reply) =>
    saveTrade(request.getDecorator<string>("workspaceOwnerId"), request.body, reply));
  api.patch("/etf-trades/:tradeId", etfTradeSchemas.update, (request, reply) =>
    saveTrade(request.getDecorator<string>("workspaceOwnerId"), request.body, reply, request.params.tradeId));
  api.delete("/etf-trades/:tradeId", etfTradeSchemas.delete, async (request, reply) => {
    const responses = etfTradeResponses.delete;
    const result = await service.deleteTrade(request.getDecorator<string>("workspaceOwnerId"), request.params.tradeId);
    if (result === "not_found") return reply.code(404).send(responses[404].parse({ status: "not_found" }));
    if (result !== "deleted") return reply.code(409).send(responses[409].parse(result));
    return reply.code(204).send();
  });

  api.get("/financial-accounts/:accountId/holdings", etfTradeSchemas.holdings, async (request, reply) => {
    const responses = etfTradeResponses.holdings;
    const result = await service.readHoldings(request.getDecorator<string>("workspaceOwnerId"), request.params.accountId);
    return result
      ? reply.send(responses[200].parse(result))
      : reply.code(404).send(responses[404].parse({ status: "not_found" }));
  });

  api.get("/portfolio", async (request, reply) => {
    const result = await service.readPortfolio(request.getDecorator<string>("workspaceOwnerId"));
    return reply.send(etfTradeResponses.portfolio[200].parse(result));
  });
};
