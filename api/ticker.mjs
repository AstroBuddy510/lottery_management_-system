// The Live Ticker's WebSocket, as its own Vercel function.
//
// Vercel accepts WebSocket upgrades on a Node function that default-exports
// an http.Server. The server and its upgrade handling live in the API build;
// this file only hands it to the platform. See artifacts/api-server/src/ticker.ts.
import server from "../artifacts/api-server/dist/ticker.mjs";

export default server;
