/**
 * The two calls the hand-written screens make, with the session token and the
 * server's own error message. Screens generated from the API spec use the
 * typed client instead; this is for the ones that are not.
 */

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("accessToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  }
  return body as T;
}

export async function apiGet<T>(url: string): Promise<T> {
  return parse<T>(await fetch(url, { headers: authHeaders() }));
}

export async function apiSend<T>(method: "POST" | "PUT" | "PATCH", url: string, body?: unknown): Promise<T> {
  return parse<T>(
    await fetch(url, {
      method,
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
}
