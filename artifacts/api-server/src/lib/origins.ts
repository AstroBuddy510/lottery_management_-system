/**
 * Who may call this API from a browser.
 *
 * cors() with no arguments reflects whatever Origin asks, which means any
 * page on the internet could call this API with a victim's browser. The app
 * and the API are served from the same origin, so that permissiveness was
 * never buying anything - same-origin requests do not consult CORS at all.
 *
 * Requests with no Origin header are allowed through: that covers Paystack's
 * webhooks, health checks and anything else that is not a browser. CORS is a
 * browser mechanism and was never what protected those - the webhook
 * signature and requireAuth are.
 *
 * Preview deployments get their own vercel.app hostname per build, so those
 * are matched by shape rather than listed. EXTRA_CORS_ORIGINS takes a comma
 * separated list if a new domain is ever added without a deploy of this file.
 */
const STATIC_ORIGINS = new Set(
  [
    "https://vs2000smartportal.com",
    "https://www.vs2000smartportal.com",
    "http://localhost:5173",
    "http://localhost:3000",
    ...(process.env["EXTRA_CORS_ORIGINS"] ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  ],
);

const PREVIEW_ORIGIN = /^https:\/\/[a-z0-9-]+\.vercel\.app$/;

export function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  return STATIC_ORIGINS.has(origin) || PREVIEW_ORIGIN.test(origin);
}
