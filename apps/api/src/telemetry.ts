import * as Sentry from "@sentry/node";

export function configureTelemetry(options: {
  dsn: string;
  environment: string;
  release: string | undefined;
}) {
  const client = Sentry.init({
    ...options,
    serverName: "finscope-api",
    defaultIntegrations: false,
    registerEsmLoaderHooks: false,
    skipOpenTelemetrySetup: true,
    sendDefaultPii: false,
    maxBreadcrumbs: 0,
    beforeSend(event) {
      return {
        type: event.type,
        event_id: event.event_id,
        timestamp: event.timestamp,
        platform: event.platform,
        level: event.level,
        release: event.release,
        environment: event.environment,
        exception: {
          values: event.exception?.values?.map(({ stacktrace }) => ({
            type: "Error",
            value: "Unexpected API error",
            stacktrace,
          })),
        },
      };
    },
  });
  return Boolean(client?.getDsn() && client.getTransport());
}

export function reportError(error: Error) {
  Sentry.captureException(error);
}

export function flushTelemetry() {
  return Sentry.flush(2_000);
}
