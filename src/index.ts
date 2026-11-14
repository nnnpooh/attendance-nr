import "dotenv/config";
import Debug from "debug";
import express from "express";
import sessionIns, { formatSession } from "./auth/session.js";
import passportIns from "./auth/passport.js";
import setupCommonMiddleWares from "./middlewares.js";
import { deleteSession, createUser } from "@db/repositories.js";
import { PORT, NODE_ENV } from "./utils/env.js";
import authRouter from "./routers/auth.js";

const debug = Debug("fs-auth");
const app = express(); // Intializing the express app
setupCommonMiddleWares(app);

// * Session
if (NODE_ENV === "production") app.set("trust proxy", 1); // trust first proxy
app.use(sessionIns);

// * Passport
app.use(passportIns.initialize());
app.use(passportIns.session());

// * Routers - need to load after session due to req.logout() function
app.use(authRouter);

// * Endpoints
app.get("/", async (req, res, next) => {
  const sessions = await formatSession(req);
  res.render("pages/index", {
    title: "Home",
    user: req.user,
    sessions: sessions,
  });
});

// * Running app
app.listen(PORT, async () => {
  debug(`Listening on port ${PORT}: http://localhost:${PORT}`);
});
