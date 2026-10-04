import { logger } from "./logger";

/**
 * WhatsApp delivery, through Meta's WhatsApp Cloud API.
 *
 * Writers live in WhatsApp, so a settlement reminder that arrives there is
 * read; one that waits in the portal is not. Two things about the platform
 * shape this file:
 *
 * A business cannot message a user freely. Outside a 24-hour window opened by
 * the user's own message, only a pre-approved TEMPLATE may be sent, with its
 * variables filled in. So the reminder is sent as a template by name, and the
 * template itself is created and approved in the Meta Business account - not
 * here. If it is not approved, Meta rejects the send and says so, which is why
 * the error body is logged rather than swallowed.
 *
 * Numbers must be in full international form with no plus sign. Ghanaian
 * writers are stored locally as 0XXXXXXXXX, so that is normalised here rather
 * than in nine call sites.
 */

const GRAPH = "https://graph.facebook.com";

function token(): string {
  return process.env["WHATSAPP_ACCESS_TOKEN"] ?? "";
}
function phoneNumberId(): string {
  return process.env["WHATSAPP_PHONE_NUMBER_ID"] ?? "";
}
function apiVersion(): string {
  return process.env["WHATSAPP_API_VERSION"] ?? "v21.0";
}
function defaultCountryCode(): string {
  return process.env["WHATSAPP_DEFAULT_COUNTRY_CODE"] ?? "233";
}

/** Configured means a real token and number, not a leftover placeholder. */
export function whatsappConfigured(): boolean {
  const t = token();
  return t.length > 0 && !t.includes("placeholder") && phoneNumberId().length > 0;
}

/**
 * 0241234567 -> 233241234567. Numbers already in international form, with or
 * without a plus, are left alone apart from the plus.
 */
export function toWhatsAppNumber(raw: string): string | null {
  const digits = (raw ?? "").replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (digits.length < 7) return null;
  const cc = defaultCountryCode();
  if (digits.startsWith(cc)) return digits;
  if (digits.startsWith("0")) return cc + digits.slice(1);
  return digits;
}

export interface WhatsAppResult {
  success: boolean;
  messageId?: string;
  /** Set when the send was not even attempted, so callers can tell the two apart. */
  skipped?: "not-configured" | "bad-number";
  error?: string;
}

/**
 * Send an approved template.
 *
 * `variables` fill the template's {{1}}, {{2}} ... in order. Keep the order in
 * step with whatever was approved in the Meta console; there is no way to
 * check it from here.
 */
export async function sendWhatsAppTemplate(opts: {
  to: string;
  template: string;
  language?: string;
  variables?: string[];
}): Promise<WhatsAppResult> {
  if (!whatsappConfigured()) {
    logger.info({ to: opts.to, template: opts.template }, "[WHATSAPP SKIPPED] not configured");
    return { success: false, skipped: "not-configured" };
  }

  const to = toWhatsAppNumber(opts.to);
  if (!to) {
    logger.warn({ raw: opts.to }, "[WHATSAPP SKIPPED] unusable number");
    return { success: false, skipped: "bad-number" };
  }

  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: opts.template,
      language: { code: opts.language ?? "en" },
      ...(opts.variables && opts.variables.length > 0
        ? {
            components: [
              {
                type: "body",
                parameters: opts.variables.map((text) => ({ type: "text", text })),
              },
            ],
          }
        : {}),
    },
  };

  try {
    const res = await fetch(`${GRAPH}/${apiVersion()}/${phoneNumberId()}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const payload = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number };
    };

    if (!res.ok) {
      // Meta's errors are specific and actionable (template not approved, number
      // not on the allow list, token expired), so they are kept verbatim.
      const error = payload.error?.message ?? `HTTP ${res.status}`;
      logger.error({ to, template: opts.template, error }, "[WHATSAPP FAILED]");
      return { success: false, error };
    }

    const messageId = payload.messages?.[0]?.id;
    logger.info({ to, template: opts.template, messageId }, "[WHATSAPP SENT]");
    return { success: true, ...(messageId ? { messageId } : {}) };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ to, error }, "[WHATSAPP ERROR]");
    return { success: false, error };
  }
}
