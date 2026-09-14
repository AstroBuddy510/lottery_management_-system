/**
 * Talking to the API from the writer portal.
 *
 * Writers are on phones, on mobile data, and are the least able of anyone to
 * interpret a developer's error. Two failures in particular were reaching
 * them raw:
 *
 *   "Failed to fetch"  - the browser's words when a request never got a
 *                        reply at all. It happens on a dropped connection,
 *                        and it happens when the portal is opened on a
 *                        preview deployment URL, whose /api calls are
 *                        redirected to a Vercel login the browser then
 *                        blocks. Neither is something a writer can fix by
 *                        retyping their PIN.
 *
 *   "Unexpected token" - what JSON.parse says when the server returned a
 *                        gateway error page instead of JSON. The old code
 *                        parsed the body before checking the status, so any
 *                        non-JSON response surfaced as a parser message.
 */

export class WriterApiError extends Error {}

const OFFLINE =
  "Could not reach the server. Check your internet connection and try again.";

const WRONG_ADDRESS =
  "This link cannot sign you in. Open the portal at vs2000smartportal.com and try again.";

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // A preview deployment sends /api to a login on another origin, which the
    // browser blocks before we ever see a status.
    const onPreview = /\.vercel\.app$/i.test(window.location.hostname);
    throw new WriterApiError(onPreview ? WRONG_ADDRESS : OFFLINE);
  }

  const text = await response.text();
  let data: { error?: string } | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new WriterApiError(
      data?.error ??
        (response.status >= 500
          ? "The server had a problem. Please try again in a moment."
          : `Request failed (${response.status}).`),
    );
  }

  if (data === null) {
    throw new WriterApiError("The server sent an unexpected reply. Please try again.");
  }

  return data as T;
}
