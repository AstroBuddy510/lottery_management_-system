let serverTimeOffsetMs = 0;

export async function syncServerTime() {
  try {
    const startTime = Date.now();
    const res = await fetch("/api/auth/time");
    if (!res.ok) return;
    const data = (await res.json()) as { utcTime: string };
    const endTime = Date.now();

    // Estimate round-trip latency
    const latency = (endTime - startTime) / 2;
    const serverTime = new Date(data.utcTime).getTime();

    // Offset = localTime - (serverTime + latency)
    serverTimeOffsetMs = Date.now() - (serverTime + latency);
  } catch (error) {
    console.error("Failed to sync server time:", error);
  }
}

export function getServerNow(): Date {
  return new Date(Date.now() - serverTimeOffsetMs);
}
