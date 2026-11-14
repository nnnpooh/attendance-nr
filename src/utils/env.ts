import "dotenv/config";

export const NODE_ENV = (process.env.NODE_ENV ?? "") as
  | "production"
  | "development";

if (!["production", "development"].includes(NODE_ENV)) {
  throw new Error("Invalid NODE_ENV");
}

export const PORT = process.env.PORT ?? "5001";

export const SESSION_SECRET = process.env.SESSION_SECRET ?? "";
if (!SESSION_SECRET) {
  throw new Error("SESSION_SECRET is not set");
}

// LINE Messaging API (Basic settings -> Channel secret, Messaging API -> Channel access token).
// The web app runs without them; the /line/webhook endpoint refuses requests until both are set.
export const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET ?? "";
export const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN ?? "";
