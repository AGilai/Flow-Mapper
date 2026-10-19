// Errors that map to HTTP responses (and MCP tool errors).

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what: string) => new HttpError(404, 'NOT_FOUND', `${what} not found`);
export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'BAD_REQUEST', message, details);
export const invalid = (message: string, details?: unknown) => new HttpError(422, 'INVALID', message, details);
export const conflict = (code: string, message: string, details?: unknown) => new HttpError(409, code, message, details);
