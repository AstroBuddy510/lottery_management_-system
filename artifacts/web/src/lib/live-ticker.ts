import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The Live Ticker's data: a snapshot from the API, kept current by every
 * sale the WebSocket pushes.
 *
 * The snapshot is the truth; the socket is the speed. The page loads the day
 * as it stands, then applies each sale to the same figures the moment it
 * arrives - so the chart moves on the sale itself, not on the next poll. The
 * snapshot is reloaded whenever the socket (re)connects, when the server says
 * it may have missed something, and once a minute regardless, which is what
 * corrects anything a stream of additions cannot express: a cancellation, a
 * void, a sale made while this tab was asleep.
 *
 * If the socket cannot be held at all - a network that blocks WebSockets, a
 * deploy without them - the page falls back to reloading the snapshot every
 * few seconds and says so, rather than silently freezing.
 */

export type TickerSale = {
  id: string;
  ticketNumber: string;
  createdAt: string;
  stake: string;
  numbers: string;
  banker: number | null;
  status: string;
  betType: string | null;
  gameId: string;
  gameName: string;
  eventNumber: string;
  writerId: string;
  writerName: string;
  writerCode: string;
  location: string | null;
  model: string;
  agentId: string;
  agentCode: string;
  agencyName: string;
  terminalSerial: string | null;
  terminalModel: string | null;
};

export type TickerSnapshot = {
  day: string;
  serverTime: string;
  seriesMinutes: number;
  totals: { tickets: number; stakes: string; writers: number; agencies: number };
  numbers: { number: number; count: number; stake: string }[];
  agencies: {
    agentId: string;
    agentCode: string;
    agencyName: string;
    tickets: number;
    stakes: string;
    writers: number;
    lastSaleAt: string | null;
  }[];
  games: { gameId: string; gameName: string; eventNumber: string; tickets: number; stakes: string }[];
  betTypes: { betType: string; tickets: number; stakes: string }[];
  channels: { model: string; tickets: number; stakes: string }[];
  writers: { writerId: string; agentId: string }[];
  minutes: { minute: string; tickets: number; stakes: string }[];
  feed: TickerSale[];
};

/** The figures the page draws, held as numbers and maps so a sale is cheap to apply. */
export type TickerState = {
  day: string;
  seriesMinutes: number;
  tickets: number;
  stakes: number;
  numbers: Map<number, { count: number; stake: number }>;
  agencies: Map<string, { agentId: string; agentCode: string; agencyName: string; tickets: number; stakes: number; lastSaleAt: string | null }>;
  games: Map<string, { gameId: string; gameName: string; eventNumber: string; tickets: number; stakes: number }>;
  betTypes: Map<string, { tickets: number; stakes: number }>;
  channels: Map<string, { tickets: number; stakes: number }>;
  /** writerId -> agentId, for everyone who has sold today. */
  writers: Map<string, string>;
  /** Minute (ISO) -> totals. */
  minutes: Map<string, { tickets: number; stakes: number }>;
  feed: TickerSale[];
  /** Ticket ids already counted, so a sale delivered twice is counted once. */
  seen: Set<string>;
  lastSaleAt: string | null;
};

export type TickerConnection = "connecting" | "live" | "reconnecting" | "polling" | "forbidden";

const FEED_KEEP = 300;
const RECONNECT_MAX_MS = 15_000;
const FALLBACK_AFTER_FAILURES = 3;
const POLL_FALLBACK_MS = 5_000;
const SNAPSHOT_REFRESH_MS = 60_000;
const REAUTH_MS = 4 * 60_000;

/** Every distinct number on a ticket, banker included - the same rule the API counts by. */
export function ticketNumbers(sale: Pick<TickerSale, "numbers" | "banker">): number[] {
  const out = new Set<number>();
  for (const part of (sale.numbers ?? "").split(/[^0-9]+/)) {
    if (/^[0-9]{1,3}$/.test(part)) out.add(Number(part));
  }
  if (sale.banker != null) out.add(Number(sale.banker));
  return [...out];
}

export function minuteKey(iso: string): string {
  const d = new Date(iso);
  d.setUTCSeconds(0, 0);
  return d.toISOString();
}

function fromSnapshot(s: TickerSnapshot): TickerState {
  const n = (v: string | number) => Number(v) || 0;
  return {
    day: s.day,
    seriesMinutes: s.seriesMinutes,
    tickets: s.totals.tickets,
    stakes: n(s.totals.stakes),
    numbers: new Map(s.numbers.map((r) => [r.number, { count: r.count, stake: n(r.stake) }])),
    agencies: new Map(s.agencies.map((a) => [a.agentId, { ...a, stakes: n(a.stakes) }])),
    games: new Map(s.games.map((g) => [g.gameId, { ...g, stakes: n(g.stakes) }])),
    betTypes: new Map(s.betTypes.map((b) => [b.betType, { tickets: b.tickets, stakes: n(b.stakes) }])),
    channels: new Map(s.channels.map((c) => [c.model, { tickets: c.tickets, stakes: n(c.stakes) }])),
    writers: new Map(s.writers.map((w) => [w.writerId, w.agentId])),
    minutes: new Map(s.minutes.map((m) => [m.minute, { tickets: m.tickets, stakes: n(m.stakes) }])),
    feed: s.feed,
    seen: new Set(s.feed.map((f) => f.id)),
    lastSaleAt: s.feed[0]?.createdAt ?? null,
  };
}

/** A new state with one sale added. Returns the same state if it was already counted. */
function applySale(prev: TickerState, sale: TickerSale): TickerState {
  if (prev.seen.has(sale.id)) return prev;
  // A sale from yesterday's last second, delivered after midnight, is not today's.
  if (sale.createdAt.slice(0, 10) !== prev.day) return prev;

  const stake = Number(sale.stake) || 0;
  const bump = <K, V extends { tickets: number; stakes: number }>(m: Map<K, V>, key: K, init: V) => {
    const next = new Map(m);
    const cur = next.get(key) ?? init;
    next.set(key, { ...cur, tickets: cur.tickets + 1, stakes: cur.stakes + stake });
    return next;
  };

  const numbers = new Map(prev.numbers);
  for (const num of ticketNumbers(sale)) {
    const cur = numbers.get(num) ?? { count: 0, stake: 0 };
    numbers.set(num, { count: cur.count + 1, stake: cur.stake + stake });
  }

  const agencies = bump(prev.agencies, sale.agentId, {
    agentId: sale.agentId,
    agentCode: sale.agentCode,
    agencyName: sale.agencyName,
    tickets: 0,
    stakes: 0,
    lastSaleAt: null,
  });
  agencies.set(sale.agentId, { ...agencies.get(sale.agentId)!, lastSaleAt: sale.createdAt });

  const writers = prev.writers.has(sale.writerId) ? prev.writers : new Map(prev.writers).set(sale.writerId, sale.agentId);
  const seen = new Set(prev.seen);
  seen.add(sale.id);

  // Keep the feed newest first even when two sales arrive out of order.
  const feed = [sale, ...prev.feed];
  if (prev.feed[0] && prev.feed[0].createdAt > sale.createdAt) {
    feed.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }

  return {
    ...prev,
    tickets: prev.tickets + 1,
    stakes: prev.stakes + stake,
    numbers,
    agencies,
    games: bump(prev.games, sale.gameId, {
      gameId: sale.gameId,
      gameName: sale.gameName,
      eventNumber: sale.eventNumber,
      tickets: 0,
      stakes: 0,
    }),
    betTypes: bump(prev.betTypes, sale.betType ?? "Other", { tickets: 0, stakes: 0 }),
    channels: bump(prev.channels, sale.model, { tickets: 0, stakes: 0 }),
    writers,
    minutes: bump(prev.minutes, minuteKey(sale.createdAt), { tickets: 0, stakes: 0 }),
    feed: feed.slice(0, FEED_KEEP),
    seen,
    lastSaleAt: !prev.lastSaleAt || sale.createdAt > prev.lastSaleAt ? sale.createdAt : prev.lastSaleAt,
  };
}

function tickerUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/ticker`;
}

async function fetchSnapshot(): Promise<TickerSnapshot> {
  const res = await fetch("/api/live-ticker/snapshot", {
    headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({}))).error || "Could not load the ticker");
  }
  return res.json();
}

export function useLiveTicker(opts: { onSale?: (sale: TickerSale) => void } = {}) {
  const [state, setState] = useState<TickerState | null>(null);
  const [connection, setConnection] = useState<TickerConnection>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [lastMessageAt, setLastMessageAt] = useState<number | null>(null);

  const onSaleRef = useRef(opts.onSale);
  onSaleRef.current = opts.onSale;

  // Sales that arrive while a snapshot is loading are held and replayed on
  // top of it - otherwise a sale could land in the gap between the query and
  // its answer and be either lost or counted twice.
  const loadingRef = useRef(false);
  const bufferRef = useRef<TickerSale[]>([]);
  const pendingReloadRef = useRef(false);

  const loadSnapshot = useCallback(async () => {
    if (loadingRef.current) {
      pendingReloadRef.current = true;
      return;
    }
    loadingRef.current = true;
    try {
      do {
        pendingReloadRef.current = false;
        const snap = await fetchSnapshot();
        const held = bufferRef.current;
        bufferRef.current = [];
        let next = fromSnapshot(snap);
        for (const sale of held) next = applySale(next, sale);
        setState(next);
        setError(null);
      } while (pendingReloadRef.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the ticker");
    } finally {
      loadingRef.current = false;
      // Anything that arrived after the last load began is applied now.
      const held = bufferRef.current;
      bufferRef.current = [];
      if (held.length) setState((prev) => (prev ? held.reduce(applySale, prev) : prev));
    }
  }, []);

  const receiveSale = useCallback((sale: TickerSale) => {
    if (loadingRef.current) {
      bufferRef.current.push(sale);
    } else {
      setState((prev) => (prev ? applySale(prev, sale) : prev));
    }
    onSaleRef.current?.(sale);
  }, []);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reauthTimer: ReturnType<typeof setInterval> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let failures = 0;
    let backoff = 1_000;

    const startPolling = () => {
      if (pollTimer) return;
      setConnection("polling");
      pollTimer = setInterval(() => void loadSnapshot(), POLL_FALLBACK_MS);
    };
    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    };

    const scheduleReconnect = (immediate = false) => {
      if (disposed || reconnectTimer) return;
      const delay = immediate ? 0 : backoff;
      backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed) return;
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(tickerUrl());
      } catch {
        failures += 1;
        if (failures >= FALLBACK_AFTER_FAILURES) startPolling();
        scheduleReconnect();
        return;
      }
      socket = ws;
      let ready = false;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "auth", token: localStorage.getItem("accessToken") }));
      };

      ws.onmessage = (ev) => {
        let msg: { type?: string; ticket?: TickerSale };
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        setLastMessageAt(Date.now());
        if (msg.type === "ready") {
          ready = true;
          failures = 0;
          backoff = 1_000;
          stopPolling();
          setConnection("live");
          // The socket is now listening, so a snapshot taken from here on
          // cannot miss a sale: anything after it arrives on the socket.
          void loadSnapshot();
          if (reauthTimer) clearInterval(reauthTimer);
          // The access token is renewed in the background every few minutes.
          // Handing the server the current one keeps this socket open past
          // the first token's fifteen minutes.
          reauthTimer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "auth", token: localStorage.getItem("accessToken") }));
            }
          }, REAUTH_MS);
        } else if (msg.type === "sale" && msg.ticket) {
          receiveSale(msg.ticket);
        } else if (msg.type === "resync") {
          void loadSnapshot();
        }
      };

      ws.onclose = (ev) => {
        if (socket === ws) socket = null;
        if (reauthTimer) clearInterval(reauthTimer);
        reauthTimer = null;
        if (disposed) return;
        if (ev.code === 4003) {
          setConnection("forbidden");
          return;
        }
        if (!ready) failures += 1;
        if (failures >= FALLBACK_AFTER_FAILURES) {
          startPolling();
        } else {
          setConnection("reconnecting");
        }
        // 4001 is an expired token: the background refresh will have a new
        // one by now, so try again straight away.
        scheduleReconnect(ev.code === 4001 && ready);
      };
    };

    void loadSnapshot();
    connect();

    const refresh = setInterval(() => void loadSnapshot(), SNAPSHOT_REFRESH_MS);

    // A laptop waking up or a phone regaining signal should not wait out the
    // backoff to start streaming again.
    const wake = () => {
      if (document.visibilityState === "hidden") return;
      if (!socket) {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = null;
        backoff = 1_000;
        scheduleReconnect(true);
      }
      void loadSnapshot();
    };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);

    return () => {
      disposed = true;
      clearInterval(refresh);
      stopPolling();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (reauthTimer) clearInterval(reauthTimer);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
      socket?.close(1000, "Page closed");
    };
  }, [loadSnapshot, receiveSale]);

  return { state, connection, error, lastMessageAt, reload: loadSnapshot };
}
