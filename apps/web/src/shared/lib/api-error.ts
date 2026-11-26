export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`API returned ${status}`);
  }
}

export function isAccessError(error: unknown) {
  return error instanceof ApiError && [401, 403].includes(error.status);
}
