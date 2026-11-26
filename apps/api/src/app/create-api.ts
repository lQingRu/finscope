import cors from "@fastify/cors";
import Fastify, { LogController } from "fastify";
import { healthRoutes } from "../health/health.routes.ts";
import { registerErrorHandler } from "./error-handler.ts";
import { workspacePlugin, type WorkspaceOptions } from "./workspace.plugin.ts";

type ApiOptions = {
  checkDatabase: () => Promise<void>;
  corsOrigin: string;
  reportError: (error: Error) => void;
  workspace?: WorkspaceOptions;
};

export async function createApi({ checkDatabase, corsOrigin, reportError, workspace }: ApiOptions) {
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

  registerErrorHandler(api, reportError);

  await api.register(healthRoutes, { checkDatabase });

  if (workspace) {
    await api.register(workspacePlugin, workspace);
  }

  return api;
}
