export class AppError extends Error {
  constructor(public status: number, message: string, public code = "ERROR", public details?: unknown) {
    super(message);
  }
}
export const badRequest = (m: string, d?: unknown) => new AppError(400, m, "BAD_REQUEST", d);
export const forbidden = (m = "No tiene permisos para esta operación") => new AppError(403, m, "FORBIDDEN");
export const notFound = (m = "Registro no encontrado") => new AppError(404, m, "NOT_FOUND");
export const conflict = (m: string, d?: unknown) => new AppError(409, m, "CONFLICT", d);
export const unprocessable = (m: string, d?: unknown) => new AppError(422, m, "BUSINESS_RULE", d);
