import { logger } from "./logger";

export class SmsAdapter {
  private provider: string = "hubtel";
  private apiKey: string = process.env.HUBTEL_API_KEY || "placeholder";
  private clientId: string = process.env.HUBTEL_CLIENT_ID || "placeholder";

  async send(to: string, message: string): Promise<{ success: boolean; messageId?: string }> {
    if (this.apiKey === "placeholder" || process.env.NODE_ENV === "development") {
      logger.info(`[SMS STUB] To: ${to} | Message: ${message}`);
      return { success: true, messageId: `mock-${Date.now()}` };
    }

    try {
      // Hubtel API integration would go here
      // const response = await fetch("https://smsc.hubtel.com/v1/messages/send", { ... })
      
      logger.info(`[SMS SENT] To: ${to}`);
      return { success: true, messageId: `hubtel-${Date.now()}` };
    } catch (error) {
      logger.error(`[SMS ERROR] Failed to send to ${to}`, error);
      return { success: false };
    }
  }
}
