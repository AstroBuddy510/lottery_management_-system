import http from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { attachLiveTicker } from "./lib/live-ticker";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// One server for both: the API over HTTP, and the Live Ticker's WebSocket
// upgrading on /api/ticker - the same path the browser uses in production.
const server = http.createServer(app);
attachLiveTicker(server, { path: "/api/ticker" });

server.on("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});

server.listen(port, () => {
  logger.info({ port }, "Server listening");
});
