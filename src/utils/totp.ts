import crypto from "crypto";

/**
 * Rotating check-in codes, RFC 6238 (TOTP) style.
 *
 * Each meeting has its own random secret. The code for time step
 * floor(now / PERIOD) is HMAC-SHA1(secret, step) truncated to DIGITS digits.
 * Nothing is stored per code; the server recomputes and compares.
 */
export const CODE_PERIOD_SEC = 30;
export const CODE_DIGITS = 6;
/** Also accept codes this many steps in the past (typing / network delay). */
export const CODE_GRACE_STEPS = 1;

export function newSecret() {
  return crypto.randomBytes(20).toString("hex");
}

export function stepAt(timeMs: number) {
  return Math.floor(timeMs / 1000 / CODE_PERIOD_SEC);
}

export function codeForStep(secretHex: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto
    .createHmac("sha1", Buffer.from(secretHex, "hex"))
    .update(counter)
    .digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 10 ** CODE_DIGITS).padStart(CODE_DIGITS, "0");
}

export function currentCode(secretHex: string, nowMs = Date.now()) {
  const step = stepAt(nowMs);
  const nextChangeMs = (step + 1) * CODE_PERIOD_SEC * 1000;
  return {
    code: codeForStep(secretHex, step),
    secondsLeft: Math.max(0, Math.ceil((nextChangeMs - nowMs) / 1000)),
  };
}

/** True if `code` is the current code or one of the previous CODE_GRACE_STEPS codes. */
export function verifyCode(secretHex: string, code: string, nowMs = Date.now()) {
  const step = stepAt(nowMs);
  for (let i = 0; i <= CODE_GRACE_STEPS; i++) {
    const expected = codeForStep(secretHex, step - i);
    if (
      expected.length === code.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code))
    ) {
      return true;
    }
  }
  return false;
}
