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
app.use(cors());
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
