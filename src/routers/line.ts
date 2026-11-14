import Debug from "debug";
import express from "express";
import { lineConfigured, verifySignature } from "@src/line/client.js";
import { handleEvent } from "@src/line/bot.js";

const router = express.Router();
const debug = Debug("fs-auth:line");

// Set this URL as the Webhook URL in LINE Developers console: https://<host>/line/webhook
router.post("/line/webhook", async (req, res) => {
  if (!lineConfigured()) {
    res.status(503).send("LINE is not configured");
    return;
  }
  if (!verifySignature(req.rawBody, req.get("x-line-signature"))) {
    res.status(401).send("Bad signature");
    return;
  }
  // Acknowledge immediately; LINE retries on slow/failed responses.
  res.sendStatus(200);

  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (e) {
      debug("event failed: %o", e);
    }
  }
});

export default router;
