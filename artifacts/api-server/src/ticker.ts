import http from "node:http";
import { attachLiveTicker } from "./lib/live-ticker";

/**
 * The Live Ticker as a Vercel function of its own (api/ticker.mjs).
 *
 * Vercel serves a WebSocket from a function that exports a Node HTTP server
 * with the upgrade handled on it. It is kept apart from the main API function
 * because a socket holds its instance for as long as it is open - mixing the
 * two would let a room full of open tickers keep the request-serving
 * instances busy, and a deploy of either would drop the other's work.
 *
 * Plain HTTP to this path is answered 426: there is nothing to GET here, the
 * snapshot lives on the ordinary API at /api/live-ticker/snapshot.
 */
const server = http.createServer((_req, res) => {
  res.writeHead(426, {
    "Content-Type": "application/json",
    Upgrade: "websocket",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify({ error: "This endpoint speaks WebSocket only" }));
});

attachLiveTicker(server);

export default server;
