import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/**
 * Send a ticket straight to a customer's WhatsApp number.
 *
 * The WhatsApp button above it opens the writer's own WhatsApp on their
 * contact list, which only reaches people they have saved. This row takes any
 * number. When the company's WhatsApp Business number is connected, the
 * server sends the ticket - with its scannable QR - from that number through
 * the WhatsApp API. When it is not connected yet, the writer still gets
 * somewhere: a WhatsApp chat opens with that number and the ticket text
 * filled in, which also needs no saved contact.
 */

/** 0241234567, 233241234567 or +233 24 123 4567 -> 233241234567, or null. */
export function toWhatsAppDigits(raw: string): string | null {
  const d = raw.replace(/[^\d]/g, "");
  if (/^0\d{9}$/.test(d)) return `233${d.slice(1)}`;
  if (/^233\d{9}$/.test(d)) return d;
  // Another country's number, written in full.
  if (d.length >= 10 && d.length <= 15 && !d.startsWith("0")) return d;
  return null;
}

export function WhatsAppDirectSend({
  sendPath,
  fallbackText,
  what = "ticket",
}: {
  /** e.g. /api/tickets/<id>/whatsapp or /api/tickets/slip/<no>/whatsapp */
  sendPath: string;
  /** The text a fallback chat opens with. */
  fallbackText: string;
  what?: "ticket" | "slip";
}) {
  const { toast } = useToast();
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);

  const status = useQuery<{ configured: boolean }>({
    queryKey: ["/api/whatsapp/status"],
    queryFn: async () => {
      const res = await fetch("/api/whatsapp/status", {
        headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
      });
      if (!res.ok) return { configured: false };
      return res.json();
    },
    staleTime: 5 * 60_000,
  });
  const viaApi = !!status.data?.configured;
  const digits = toWhatsAppDigits(phone);

  const openChat = (to: string) => {
    window.open(`https://wa.me/${to}?text=${encodeURIComponent(fallbackText)}`, "_blank", "noopener,noreferrer");
  };

  const send = async () => {
    if (!digits) {
      toast({ title: "Enter a valid WhatsApp number", description: "For example 0241234567.", variant: "destructive" });
      return;
    }
    // Not connected: open the chat now, inside the tap, so the browser allows it.
    if (!viaApi) {
      openChat(digits);
      toast({ title: "Opening WhatsApp", description: `A chat with +${digits} - tap send there.` });
      setPhone("");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(sendPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("accessToken")}`,
        },
        body: JSON.stringify({ phone: digits }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "WhatsApp did not accept the message");
      toast({
        title: what === "slip" ? "Slip sent" : "Ticket sent",
        description: `Sent to +${body.to ?? digits} on WhatsApp${body.count > 1 ? ` (${body.count} tickets)` : ""}.`,
      });
      setPhone("");
    } catch (e) {
      toast({ title: "Couldn't send on WhatsApp", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="Enter WhatsApp number"
          aria-label="Customer's WhatsApp number"
          // 44px tall for a thumb; 16px text so iOS does not zoom on focus.
          className="h-11 min-w-0 flex-1 rounded-xl text-base"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !sending) {
              e.preventDefault();
              void send();
            }
          }}
          disabled={sending}
        />
        <Button
          type="button"
          size="icon"
          onClick={send}
          disabled={sending || !phone.trim()}
          aria-label={`Send the ${what} to this WhatsApp number`}
          title={`Send the ${what} to this WhatsApp number`}
          className="h-11 w-11 shrink-0 rounded-xl bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 disabled:bg-emerald-600/40"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
      <p className="px-1 text-[10px] text-muted-foreground">
        {viaApi
          ? `Sends the ${what} with its QR from our WhatsApp number - the contact need not be saved.`
          : "Opens a WhatsApp chat with this number - no need to save the contact."}
      </p>
    </div>
  );
}
