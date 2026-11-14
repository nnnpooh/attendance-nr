import crypto from "crypto";
import axios from "axios";
import Debug from "debug";
import { LINE_ACCESS_TOKEN, LINE_CHANNEL_SECRET } from "@src/utils/env.js";

const debug = Debug("fs-auth:line");
const api = axios.create({
  baseURL: "https://api.line.me/v2/bot",
  timeout: 10_000,
});

export const lineConfigured = () => Boolean(LINE_CHANNEL_SECRET && LINE_ACCESS_TOKEN);

/** x-line-signature = base64(HMAC-SHA256(channel secret, raw request body)). */
export function verifySignature(rawBody: Buffer | undefined, signature: string | undefined) {
  if (!rawBody || !signature || !LINE_CHANNEL_SECRET) return false;
  const expected = crypto
    .createHmac("sha256", LINE_CHANNEL_SECRET)
    .update(rawBody)
    .digest();
  const given = Buffer.from(signature, "base64");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export async function replyText(replyToken: string, text: string) {
  debug("reply: %s", text.replace(/\n/g, " | "));
  try {
    await api.post(
      "/message/reply",
      { replyToken, messages: [{ type: "text", text: text.slice(0, 5000) }] },
      { headers: { Authorization: `Bearer ${LINE_ACCESS_TOKEN}` } }
    );
  } catch (e: any) {
    debug("reply failed: %o", e?.response?.data ?? e?.message);
  }
}

export async function getDisplayName(userId: string): Promise<string | null> {
  try {
    const res = await api.get(`/profile/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${LINE_ACCESS_TOKEN}` },
    });
    return res.data?.displayName ?? null;
  } catch {
    return null;
  }
}
