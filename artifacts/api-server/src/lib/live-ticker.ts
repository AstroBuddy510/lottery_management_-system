import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import { createDirectClient } from "@workspace/db";
import { verifyToken, type SessionClaims } from "./tokens";
import { originAllowed } from "./origins";
import { logger } from "./logger";
import { TICKER_CHANNEL } from "./ticker-events";

/**
 * The Live Ticker's WebSocket: every sale, pushed the moment it commits.
 *
 * How a sale reaches a browser
 * ----------------------------
 * 1. The sale's transaction runs pg_notify('live_ticker', <ticket json>).
 *    Postgres delivers it on commit - not before, and not at all on rollback.
 * 2. Every instance with an open ticker holds ONE connection that LISTENs on
 *    that channel. Postgres fans the notification out to all of them.
 * 3. Each instance writes it to its own sockets.
 *
 * Postgres is the hub because on Vercel the instance that takes a sale is
 * almost never the instance holding a given browser's socket - connections
 * are pinned to whichever instance accepted them, and there is no shared
 * memory between instances. The database already sees every sale, so it is
 * the one place every instance can hear from without a new service.
 *
 * The listener connects when the first authenticated socket arrives and is
 * closed shortly after the last one leaves, so an instance with no one
 * watching holds no connection - and Neon can suspend when no one is.
 *
 * Protocol (JSON text frames)
 * ---------------------------
 *   client -> {type:"auth", token}      first message, and again to extend
 *   server -> {type:"ready", serverTime}
 *   server -> {type:"sale", ticket}     one per ticket sold
 *   server -> {type:"resync"}           the feed may have a gap: reload
 *   close 4001                          not signed in, or the token expired
 *   close 4003                          signed in, but not office staff
 */

const VIEWER_ROLES = new Set(["director", "administrator"]);
const AUTH_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 25_000;
const LISTENER_IDLE_CLOSE_MS = 30_000;
const MAX_CLIENT_MESSAGE_BYTES = 4_096;

type Viewer = {
  socket: WebSocket;
  claims: SessionClaims | null;
  alive: boolean;
  authTimer: NodeJS.Timeout | null;
  expiryTimer: NodeJS.Timeout | null;
};

const viewers = new Set<Viewer>();

/* ── the one LISTEN connection for this instance ─────────────────────────── */

let listener: ReturnType<typeof createDirectClient> | null = null;
let listenerConnecting: Promise<void> | null = null;
let listenerRetryTimer: NodeJS.Timeout | null = null;
let listenerIdleTimer: NodeJS.Timeout | null = null;
let listenerBackoffMs = 1_000;
/** True once a listener has been up - a later connect means events may have been missed. */
let listenerHadConnected = false;

function authedViewers(): Viewer[] {
  return [...viewers].filter((v) => v.claims && v.socket.readyState === WebSocket.OPEN);
}

function send(viewer: Viewer, message: unknown) {
  if (viewer.socket.readyState === WebSocket.OPEN) {
    viewer.socket.send(typeof message === "string" ? message : JSON.stringify(message));
  }
}

function broadcast(frame: string) {
  for (const v of authedViewers()) v.socket.send(frame);
}

function scheduleListenerRetry() {
  if (listenerRetryTimer || authedViewers().length === 0) return;
  const delay = listenerBackoffMs;
  listenerBackoffMs = Math.min(listenerBackoffMs * 2, 30_000);
  listenerRetryTimer = setTimeout(() => {
    listenerRetryTimer = null;
    void ensureListener();
  }, delay);
}

function dropListener(reason: string, err?: unknown) {
  const client = listener;
  listener = null;
  if (client) {
    client.removeAllListeners("notification");
    client.end().catch(() => {});
  }
  if (err) logger.warn({ err, reason }, "Live Ticker listener lost");
  scheduleListenerRetry();
}

async function ensureListener(): Promise<void> {
  if (listenerIdleTimer) {
    clearTimeout(listenerIdleTimer);
    listenerIdleTimer = null;
  }
  if (listener) return;
  if (listenerConnecting) return listenerConnecting;

  listenerConnecting = (async () => {
    const client = createDirectClient();
    // An error on an idle client is emitted on the client. Unhandled, Node
    // treats it as fatal and takes every socket on the instance down with it.
    client.on("error", (err) => {
      if (listener === client) dropListener("error", err);
    });
    client.on("end", () => {
      if (listener === client) dropListener("ended");
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${TICKER_CHANNEL}`);
    } catch (err) {
      client.end().catch(() => {});
      logger.warn({ err }, "Live Ticker listener could not connect");
      scheduleListenerRetry();
      return;
    }

    client.on("notification", (msg) => {
      if (msg.channel !== TICKER_CHANNEL || !msg.payload) return;
      let ticket: unknown;
      try {
        ticket = JSON.parse(msg.payload);
      } catch {
        return;
      }
      broadcast(JSON.stringify({ type: "sale", ticket }));
    });

    listener = client;
    listenerBackoffMs = 1_000;
    // Anything sold while no listener was up never reached this instance.
    // Telling the browsers to reload is cheaper than pretending otherwise.
    if (listenerHadConnected) broadcast(JSON.stringify({ type: "resync" }));
    listenerHadConnected = true;
  })().finally(() => {
    listenerConnecting = null;
  });

  return listenerConnecting;
}

function releaseListenerIfIdle() {
  if (authedViewers().length > 0 || listenerIdleTimer) return;
  // A grace period, so a browser that reconnects - a page refresh, a token
  // renewal, the function's own duration limit - does not cost a new
  // database connection every time.
  listenerIdleTimer = setTimeout(() => {
    listenerIdleTimer = null;
    if (authedViewers().length > 0) return;
    if (listenerRetryTimer) {
      clearTimeout(listenerRetryTimer);
      listenerRetryTimer = null;
    }
    const client = listener;
    listener = null;
    listenerHadConnected = false;
    client?.end().catch(() => {});
  }, LISTENER_IDLE_CLOSE_MS);
}

/* ── one browser ─────────────────────────────────────────────────────────── */

function authenticate(viewer: Viewer, token: unknown) {
  const claims = typeof token === "string" ? verifyToken(token, "access") : null;
  if (!claims) {
    viewer.socket.close(4001, "Sign in again");
    return;
  }
  if (!VIEWER_ROLES.has(claims.role)) {
    viewer.socket.close(4003, "Office staff only");
    return;
  }

  const first = viewer.claims === null;
  viewer.claims = claims;
  if (viewer.authTimer) {
    clearTimeout(viewer.authTimer);
    viewer.authTimer = null;
  }

  // The socket lives no longer than the token that opened it. The browser
  // renews its token every few minutes and sends the new one here, which
  // moves this deadline; a browser that stops renewing - signed out,
  // suspended - is cut off when its last token would have been.
  if (viewer.expiryTimer) clearTimeout(viewer.expiryTimer);
  if (claims.exp) {
    const ms = claims.exp * 1000 - Date.now();
    viewer.expiryTimer = setTimeout(() => viewer.socket.close(4001, "Session expired"), Math.max(ms, 0));
  }

  if (first) {
    send(viewer, { type: "ready", serverTime: new Date().toISOString() });
    void ensureListener();
  }
}

function onConnection(socket: WebSocket) {
  const viewer: Viewer = { socket, claims: null, alive: true, authTimer: null, expiryTimer: null };
  viewers.add(viewer);

  viewer.authTimer = setTimeout(() => socket.close(4001, "Sign in again"), AUTH_TIMEOUT_MS);

  socket.on("pong", () => {
    viewer.alive = true;
  });

  socket.on("message", (data, isBinary) => {
    if (isBinary) return;
    let msg: { type?: unknown; token?: unknown };
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === "auth") authenticate(viewer, msg.token);
  });

  const cleanup = () => {
    if (!viewers.delete(viewer)) return;
    if (viewer.authTimer) clearTimeout(viewer.authTimer);
    if (viewer.expiryTimer) clearTimeout(viewer.expiryTimer);
    releaseListenerIfIdle();
  };
  socket.on("close", cleanup);
  socket.on("error", cleanup);
}

/* ── wiring ──────────────────────────────────────────────────────────────── */

export type LiveTickerOptions = {
  /** Only upgrades for this path are accepted. Omit to accept any path. */
  path?: string;
};

/**
 * Serve the Live Ticker's WebSocket from an existing HTTP server.
 *
 * Locally that is the Express server, on /api/ticker. On Vercel it is a
 * function of its own, so it accepts the upgrade whatever path the platform
 * forwards.
 */
export function attachLiveTicker(server: Server, options: LiveTickerOptions = {}): WebSocketServer {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_CLIENT_MESSAGE_BYTES,
    // Frames here are a few hundred bytes. Compression would cost more CPU
    // than it saves bandwidth.
    perMessageDeflate: false,
  });

  wss.on("connection", onConnection);

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = (req.url ?? "/").split("?")[0];
    if (options.path && pathname !== options.path) {
      socket.destroy();
      return;
    }
    // The token check would refuse a stranger anyway, but a page on another
    // site has no business opening this socket in a staff member's browser.
    if (!originAllowed(req.headers.origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  // Ping every socket; one that has not answered the last ping is gone - a
  // phone that lost signal, a laptop lid shut - and would otherwise hold its
  // place until the platform's limit.
  const heartbeat = setInterval(() => {
    for (const v of viewers) {
      if (!v.alive) {
        v.socket.terminate();
        continue;
      }
      v.alive = false;
      try {
        v.socket.ping();
      } catch {
        v.socket.terminate();
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();
  wss.on("close", () => clearInterval(heartbeat));

  return wss;
}
