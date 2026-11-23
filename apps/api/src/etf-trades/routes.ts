import { etfTradeInput, etfTradeResponses } from "@finscope/contracts/etf-trades";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { EtfTradeRepository } from "./repository.ts";

const accountParams = z.object({ accountId: z.uuid() });
const tradeParams = z.object({ tradeId: z.uuid() });

export function registerEtfTradeRoutes(api: FastifyInstance, repository: EtfTradeRepository) {
  async function saveTrade(request: FastifyRequest, reply: FastifyReply, tradeId?: string) {
    const input = etfTradeInput.safeParse(request.body);
    const responses = etfTradeResponses.record;
    if (!input.success) {
      const fieldErrors = Object.fromEntries(input.error.issues.filter(({ path }) => path.length > 0)
        .map(({ path, message }) => [path[0], message]));
      return reply.code(400).send(responses[400].parse({ status: "invalid_request", fieldErrors }));
    }
    const owner = request.getDecorator<string>("workspaceOwnerId");
    const result = tradeId
      ? await repository.updateTrade(owner, tradeId, input.data)
      : await repository.recordTrade(owner, input.data);
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

  api.post("/etf-trades", (request, reply) => saveTrade(request, reply));
  api.patch("/etf-trades/:tradeId", async (request, reply) => {
    const params = tradeParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send(etfTradeResponses.update[400].parse({ status: "invalid_request" }));
    }
    return saveTrade(request, reply, params.data.tradeId);
  });
  api.delete("/etf-trades/:tradeId", async (request, reply) => {
    const params = tradeParams.safeParse(request.params);
    const responses = etfTradeResponses.delete;
    if (!params.success) return reply.code(400).send(responses[400].parse({ status: "invalid_request" }));
    const result = await repository.deleteTrade(request.getDecorator<string>("workspaceOwnerId"), params.data.tradeId);
    if (result === "not_found") return reply.code(404).send(responses[404].parse({ status: "not_found" }));
    if (result !== "deleted") return reply.code(409).send(responses[409].parse(result));
    return reply.code(204).send();
  });

  api.get("/financial-accounts/:accountId/holdings", async (request, reply) => {
    const params = accountParams.safeParse(request.params);
    const responses = etfTradeResponses.holdings;
    if (!params.success) {
      return reply.code(400).send(responses[400].parse({ status: "invalid_request" }));
    }
    const result = await repository.readHoldings(request.getDecorator<string>("workspaceOwnerId"), params.data.accountId);
    return result
      ? reply.send(responses[200].parse(result))
      : reply.code(404).send(responses[404].parse({ status: "not_found" }));
  });

  api.get("/portfolio", async (request, reply) => {
    const result = await repository.readPortfolio(request.getDecorator<string>("workspaceOwnerId"));
    return reply.send(etfTradeResponses.portfolio[200].parse(result));
  });
}
