import "dotenv/config";

export const NODE_ENV = (process.env.NODE_ENV ?? "") as
  | "production"
  | "development";

if (!["production", "development"].includes(NODE_ENV)) {
  throw new Error("Invalid NODE_ENV");
}

export const PORT = process.env.BACKEND_PORT ?? "5001";

export const SESSION_SECRET = process.env.SESSION_SECRET ?? "";
if (!SESSION_SECRET) {
  throw new Error("SESSION_SECRET is not set");
}
