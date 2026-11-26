import cors from "@fastify/cors";
import { apiErrorResponses } from "@finscope/contracts/api-errors";
import { tradeFundingConflict } from "@finscope/contracts/etf-trades";
import { healthResponses } from "@finscope/contracts/health";
import Fastify, { LogController } from "fastify";
import { z } from "zod";
import { TradeFundingError } from "../etf-trades/cash.ts";
import { financialAccountRoutes } from "../financial-accounts/routes.ts";
import type { FinancialAccountsOptions } from "../financial-accounts/routes.ts";

type ApiOptions = {
  checkDatabase: () => Promise<void>;
  corsOrigin: string;
  reportError: (error: Error) => void;
  accounts?: FinancialAccountsOptions;
};

export async function createApi({ checkDatabase, corsOrigin, reportError, accounts }: ApiOptions) {
  const api = Fastify({
    logger: true,
    logController: new LogController({ disableRequestLogging: true }),
  });

  await api.register(cors, {
    origin: [corsOrigin],
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type"],
  });

  api.addHook("onResponse", async (request, reply) => {
    request.log.info(
      {
        method: request.method,
        route: request.routeOptions.url,
        statusCode: reply.statusCode,
        durationMs: reply.elapsedTime,
      },
      "Request completed",
    );
  });

  api.setErrorHandler((error, request, reply) => {
    if (error instanceof TradeFundingError) {
      return reply.code(409).send(tradeFundingConflict.parse(error.conflict));
    }
    if (error instanceof Error && "statusCode" in error) {
      const status = error.statusCode;
      if (typeof status === "number" && status >= 400 && status < 500) {
        return reply.code(status).send(apiErrorResponses[400].parse({ status: "invalid_request" }));
      }
    }

    request.log.error({ route: request.routeOptions.url }, "Unexpected API error");
    reportError(error instanceof Error ? error : new Error("Unexpected API error"));
    return reply.code(500).send(apiErrorResponses[500].parse({ status: "error" }));
  });

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

  if (accounts) {
    await api.register(financialAccountRoutes, accounts);
  }

  return api;
}
