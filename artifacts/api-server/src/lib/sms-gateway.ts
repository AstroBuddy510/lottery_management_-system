import { logger } from "./logger";

/**
 * Text messages through Hubtel.
 *
 * This used to log "[SMS SENT]" and return success without sending anything:
 * the request to Hubtel was a comment. Every "win text sent" figure the system
 * reported in production was therefore a count of log lines. It now makes the
 * call, and reports failure as failure.
 *
 * Configuration, all from the environment:
 *   HUBTEL_CLIENT_ID      the API client id
 *   HUBTEL_CLIENT_SECRET  the API client secret (HUBTEL_API_KEY is still read,
 *                         since that is the name this code used before)
 *   HUBTEL_SENDER_ID      what the handset shows as the sender; 11 characters
 *                         at most, and it must be approved on the Hubtel account
 *
 * With no credentials - or in development - messages are logged and not sent,
 * and the result says so (`stubbed: true`) rather than claiming a delivery.
 */

export interface SmsResult {
  success: boolean;
  messageId?: string;
  /** True when nothing was sent because the gateway is not configured. */
  stubbed?: boolean;
  error?: string;
}

/** Hubtel wants international form without the plus: 233XXXXXXXXX. */
function toInternational(phone: string): string | null {
  const digits = phone.replace(/[\s\-()+]/g, "");
  if (/^233\d{9}$/.test(digits)) return digits;
  if (/^0\d{9}$/.test(digits)) return `233${digits.slice(1)}`;
  return null;
}

export class SmsAdapter {
  private clientId = process.env["HUBTEL_CLIENT_ID"] ?? "";
  private clientSecret = process.env["HUBTEL_CLIENT_SECRET"] ?? process.env["HUBTEL_API_KEY"] ?? "";
  private senderId = (process.env["HUBTEL_SENDER_ID"] ?? "VS2000").slice(0, 11);

  configured(): boolean {
    return (
      this.clientId.length > 0 &&
      this.clientSecret.length > 0 &&
      !this.clientId.includes("placeholder") &&
      !this.clientSecret.includes("placeholder")
    );
  }

  async send(to: string, message: string): Promise<SmsResult> {
    if (!this.configured() || process.env["NODE_ENV"] === "development") {
      logger.info(`[SMS STUB] To: ${to} | Message: ${message}`);
      return { success: true, stubbed: true, messageId: `stub-${Date.now()}` };
    }

    const recipient = toInternational(to);
    if (!recipient) {
      logger.warn({ to }, "[SMS] not a Ghana mobile number, not sent");
      return { success: false, error: "invalid phone number" };
    }

    try {
      const res = await fetch("https://smsc.hubtel.com/v1/messages/send", {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ From: this.senderId, To: recipient, Content: message }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await res.json().catch(() => ({}))) as { messageId?: string; MessageId?: string; status?: number };
      if (!res.ok) {
        logger.error({ to: recipient, status: res.status }, "[SMS] Hubtel refused the message");
        return { success: false, error: `Hubtel returned HTTP ${res.status}` };
      }
      return { success: true, messageId: data.messageId ?? data.MessageId };
    } catch (error) {
      logger.error({ err: error, to: recipient }, "[SMS] failed to reach Hubtel");
      return { success: false, error: error instanceof Error ? error.message : "network error" };
    }
  }
}
