import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

/** Writers authenticate with a 4-digit PIN (see writer-auth login). */
export const PIN_LENGTH = 4;

/**
 * Cryptographically random 4-digit PIN, zero-padded so every value in
 * 0000-9999 is equally likely. Math.random() is not used here: this is a
 * credential.
 */
export function generatePin(): string {
  return String(randomInt(0, 10 ** PIN_LENGTH)).padStart(PIN_LENGTH, "0");
}

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

/** writers.full_code is varchar(16); agents.full_code is varchar(10). */
export const WRITER_FULL_CODE_MAX = 16;

/**
 * Compose a writer's full ID from the agent's code and the writer's own
 * code, matching the scheme already used by agent-led onboarding.
 * Returns null when the result would overflow the column.
 */
export function composeWriterFullCode(
  agentFullCode: string,
  writerCode: string,
): string | null {
  const fullCode = `${agentFullCode}-${writerCode.toUpperCase()}`;
  return fullCode.length > WRITER_FULL_CODE_MAX ? null : fullCode;
}
