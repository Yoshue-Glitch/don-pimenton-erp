export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public body?: any) {
    super(message);
  }
}

/** Cliente HTTP del ERP: cookies de sesión same-origin + cabecera anti-CSRF. */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; idempotencyKey?: string; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { "X-Requested-With": "DonPimentonERP" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body !== undefined || opts.form ? "POST" : "GET"),
    headers, credentials: "same-origin", cache: "no-store",
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/")) window.location.href = "/login";
    // Los endpoints de blockchain devuelven 422 con el detalle de la transacción fallida
    if (data && data.ok === false) return data as T;
    throw new ApiError(res.status, data?.error ?? `Error ${res.status}`, data?.code, data);
  }
  return data as T;
}

export const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now() + Math.random()));

export async function download(path: string, filename: string) {
  const res = await fetch(`/api${path}`, { credentials: "same-origin", headers: { "X-Requested-With": "DonPimentonERP" } });
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try { msg = (await res.json()).error ?? msg; } catch { /* binario */ }
    throw new ApiError(res.status, msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
