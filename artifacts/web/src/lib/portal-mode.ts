/**
 * Which portal this tab belongs to: the VS2000 Writers app, or the office.
 *
 * The Writers APK is a Trusted Web Activity - the live site in the phone's
 * Chrome. It must never show the office login (Director, Administrator,
 * Cashier...), which has no Writer role: a writer who lands there has no way
 * back except killing the app. So once a tab is known to be the Writers app,
 * every road to a login screen leads to /writer/login.
 *
 * How the tab is recognised:
 *  - `?app=writers` on the URL the Writers APK opens (current builds);
 *  - the referrer Android gives a TWA, `android-app://com.vision2000.writers`
 *    (so phones still on the older APK are covered too, with no reinstall).
 *
 * It is remembered in sessionStorage, which belongs to this one tab: Chrome
 * on the same phone shares localStorage with the app, so localStorage would
 * leak "writers" into an ordinary browser tab opened on the office site.
 */

const KEY = "vs2000.portal";
const WRITERS_APP_PACKAGE = "com.vision2000.writers";

export type Portal = "writers" | "office";

function safeSession<T>(fn: (s: Storage) => T): T | null {
  try {
    return fn(window.sessionStorage);
  } catch {
    return null;
  }
}

function detectFromLaunch(): Portal | null {
  if (typeof window === "undefined") return null;
  const app = new URLSearchParams(window.location.search).get("app");
  if (app === "writers") return "writers";
  if (document.referrer.startsWith(`android-app://${WRITERS_APP_PACKAGE}`)) return "writers";
  return null;
}

/** Run once at start-up, before the router decides anything. */
export function initPortalMode(): void {
  const detected = detectFromLaunch();
  if (detected) safeSession((s) => s.setItem(KEY, detected));
  // Drop the marker from the address so it is not carried into shares or
  // bookmarks; the tab already remembers it.
  if (new URLSearchParams(window.location.search).get("app") === "writers") {
    const url = new URL(window.location.href);
    url.searchParams.delete("app");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }
}

export function isWritersApp(): boolean {
  return safeSession((s) => s.getItem(KEY)) === "writers" || detectFromLaunch() === "writers";
}

export const WRITER_LOGIN = "/writer/login";
export const OFFICE_LOGIN = "/login";

/**
 * Where to sign in again. The Writers app always goes to the writer login;
 * elsewhere a writer goes there too, and everyone else to the office login.
 */
export function loginPathFor(role?: string | null, routeRoles?: string[]): string {
  if (isWritersApp()) return WRITER_LOGIN;
  if (role === "writer") return WRITER_LOGIN;
  if (routeRoles && routeRoles.length > 0 && routeRoles.every((r) => r === "writer")) return WRITER_LOGIN;
  return OFFICE_LOGIN;
}
