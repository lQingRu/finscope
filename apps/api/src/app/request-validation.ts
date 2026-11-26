import type { FastifySchemaCompiler, FastifyTypeProvider } from "fastify";
import { z } from "zod";

type ValidationIssues = z.ZodError["issues"];

declare module "fastify" {
  interface FastifyContextConfig {
    invalidBody?: (issues: ValidationIssues) => object;
  }
}

export interface ZodRequestTypeProvider extends FastifyTypeProvider {
  validator: this["schema"] extends z.ZodType ? z.output<this["schema"]> : unknown;
}

export class RequestValidationError extends Error {
  readonly isBody: boolean;
  readonly issues: ValidationIssues;

  constructor(isBody: boolean, issues: ValidationIssues) {
    super("Invalid request");
    this.isBody = isBody;
    this.issues = issues;
  }
}

export const compileRequestSchema: FastifySchemaCompiler<z.ZodType> = ({ schema, httpPart }) => (value) => {
  const result = schema.safeParse(value);
  return result.success
    ? { value: result.data }
    : { error: new RequestValidationError(httpPart === "body", result.error.issues) };
};

export const accountParams = z.object({ accountId: z.uuid() });

export function firstLevelFieldErrors(issues: ValidationIssues) {
  return Object.fromEntries(issues.filter(({ path }) => path.length > 0).map(({ path, message }) => [path[0], message]));
}
