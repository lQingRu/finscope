import { apiErrorResponses } from "@finscope/contracts/api-errors";
import { tradeFundingConflict } from "@finscope/contracts/etf-trades";
import type { FastifyInstance } from "fastify";
import { TradeFundingError } from "../account-activity/trade-funding.service.ts";
import { RequestValidationError } from "./request-validation.ts";

export function registerErrorHandler(api: FastifyInstance, reportError: (error: Error) => void) {
  api.setErrorHandler((error, request, reply) => {
    if (error instanceof RequestValidationError) {
      const response = error.isBody ? request.routeOptions.config.invalidBody?.(error.issues) : undefined;
      return reply.code(400).send(response ?? apiErrorResponses[400].parse({ status: "invalid_request" }));
    }
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
}
