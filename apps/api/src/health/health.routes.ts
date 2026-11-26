import { healthResponses } from "@finscope/contracts/health";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

export const healthRoutes: FastifyPluginAsync<{ checkDatabase: () => Promise<void> }> = async (api, { checkDatabase }) => {
  api.get("/health", {
    schema: {
      response: {
        200: z.toJSONSchema(healthResponses[200], { target: "openapi-3.0" }),
        503: z.toJSONSchema(healthResponses[503], { target: "openapi-3.0" }),
      },
    },
    async handler(_request, reply) {
      reply.header("Cache-Control", "no-store");
      try {
        await checkDatabase();
      } catch {
        return reply.code(503).send(healthResponses[503].parse({ status: "unavailable" }));
      }

      return reply.send(healthResponses[200].parse({ status: "ok" }));
    },
  });
};
