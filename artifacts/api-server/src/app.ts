import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
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

app.use(
  cors({
    origin(origin, callback) {
      callback(null, originAllowed(origin));
    },
    credentials: true,
  }),
);
/**
 * Keep the raw bytes of every request body alongside the parsed one.
 *
 * Paystack signs the EXACT payload it sent. Verifying against a re-serialised
 * `JSON.stringify(req.body)` usually matches and sometimes does not - a
 * non-ASCII character, a number written 1.0, any difference in how the object
 * is rendered back to text, and the signature fails on a payment that was
 * perfectly genuine. Money then sits unconfirmed with nothing in the log to
 * explain it. The raw buffer removes the guesswork.
 */
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
