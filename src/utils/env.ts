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

// LINE Official Account shown on the public "Get Started" page.
// The QR image lives in /public; replace it together with these values if the account changes.
export const LINE_OA_ID = process.env.LINE_OA_ID || "@010dprfk";
export const LINE_OA_NAME = process.env.LINE_OA_NAME || "Attendance IECMU";
export const LINE_OA_QR = process.env.LINE_OA_QR || "/img/line_qr_@010dprfk.png";
