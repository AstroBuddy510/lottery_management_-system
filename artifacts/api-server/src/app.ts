import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { originAllowed } from "./lib/origins";

export { originAllowed };

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

/**
 * The last handler. Nothing internal goes out in a response.
 *
 * There was none at all, which meant Express's own default handler answered
 * every unhandled throw - and its answer is an HTML page carrying err.message.
 * For anything thrown by the database driver that message is the full SQL
 * statement, so a single malformed id in a URL returned the writers table's
 * entire column list to whoever asked. Production only removes the stack
 * trace; the message, and so the schema, still went out.
 *
 * Four arguments, and the unused `next`, are what makes Express treat this as
 * an error handler rather than ordinary middleware. It must be registered
 * after the routes.
 */
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error(
    { err, method: req.method, path: req.path },
    "Unhandled error",
  );
  if (res.headersSent) return;
  res.status(500).json({ error: "Something went wrong" });
});

export default app;
