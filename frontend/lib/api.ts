export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { field: string; message: string }[] | null,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  // Outside /auth (where 401 means "wrong password" or "not signed in yet"), a 401 means the session expired or was
  // revoked, e.g. by a password change elsewhere. Send the user to log in, then back to where they were.
  if (res.status === 401 && !path.startsWith("/auth/")) redirectToLogin(true);
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(res.status, err?.code ?? "error", err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return data as T;
}

/** Human-readable message, including per-field validation errors. */
export function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.details?.length) return e.details.map((d) => (d.field ? `${d.field}: ${d.message}` : d.message)).join("; ");
    return e.message;
  }
  return "Something went wrong. Check your connection and try again.";
}

let redirecting = false;

/** Go to the login page, remembering the current page so login can return to it. */
export function redirectToLogin(expired = false) {
  if (redirecting || typeof window === "undefined") return;
  redirecting = true;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.replace(`/login?next=${next}${expired ? "&expired=1" : ""}`);
}

/** The `next` page to return to after login. Only same-site paths, so the link can't send anyone elsewhere. */
export function safeNext(search: string): string {
  const next = new URLSearchParams(search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/dashboard";
}

/** What to say when a page's data never loaded: "not found" only when the API said so. */
export function loadErrorMessage(e: unknown, notFound: string): string {
  return e instanceof ApiError && e.status === 404 ? notFound : describeError(e);
}
