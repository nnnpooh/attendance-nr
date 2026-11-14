import "dotenv/config";
import Debug from "debug";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import multer from "multer";
import sessionIns, { formatSession } from "./auth/session.js";
import passportIns from "./auth/passport.js";
import setupCommonMiddleWares from "./middlewares.js";
import { PORT, NODE_ENV, LINE_OA_ID, LINE_OA_NAME, LINE_OA_QR } from "./utils/env.js";
import { fmtDateTime, fmtDate, fmtTime, fmt } from "./utils/time.js";
import { UserError } from "@db/repos/errors.js";
import { courseKey } from "@db/repos/courses.js";
import authRouter from "./routers/auth.js";
import lineRouter from "./routers/line.js";
import coursesRouter from "./routers/courses.js";
import sectionsRouter from "./routers/sections.js";
import meetingsRouter from "./routers/meetings.js";
import studentsRouter from "./routers/students.js";
import importRouter from "./routers/import.js";

const debug = Debug("fs-auth");
const app = express(); // Intializing the express app
setupCommonMiddleWares(app);

// Helpers available in every Pug template.
Object.assign(app.locals, { fmtDateTime, fmtDate, fmtTime, fmt, courseKey });

// * LINE webhook: no session/passport needed.
app.use(lineRouter);

// * Session
if (NODE_ENV === "production") app.set("trust proxy", 1); // trust first proxy
app.use(sessionIns);

// * Passport
app.use(passportIns.initialize());
app.use(passportIns.session());

// Current path, so the nav can highlight the active section.
app.use((req, res, next) => {
  res.locals.path = req.path;
  next();
});

// * Routers - need to load after session due to req.logout() function
app.use(authRouter);
app.use(coursesRouter);
app.use(sectionsRouter);
app.use(meetingsRouter);
app.use(studentsRouter);
app.use(importRouter);

// * Endpoints
// Admins land on the Check-Ins list; everyone else sees the welcome page.
app.get("/", async (req, res) => {
  if (req.user?.isAdmin) return res.redirect("/meetings");
  res.render("pages/index", { title: "Home", user: req.user });
});

// Public "Get Started" page: how students join the LINE OA and register.
app.get("/start", (req, res) => {
  res.render("pages/start", {
    title: "Get Started",
    user: req.user,
    oa: {
      id: LINE_OA_ID,
      name: LINE_OA_NAME,
      qr: LINE_OA_QR,
      addFriendUrl: `https://line.me/R/ti/p/${encodeURIComponent(LINE_OA_ID)}`,
    },
  });
});

app.get("/account", async (req, res) => {
  if (!req.user) return res.redirect("/login");
  const sessions = await formatSession(req);
  res.render("pages/account", { title: "Account", user: req.user, sessions });
});

// * Errors: UserError / upload errors -> 400 with a readable message (script.js alerts it).
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof UserError) {
    res.status(400).send(err.message);
    return;
  }
  if (err instanceof multer.MulterError) {
    res.status(400).send(`Upload error: ${err.message}`);
    return;
  }
  debug("Unhandled error on %s %s: %o", req.method, req.url, err);
  res.status(500).send("Something went wrong. Check the server log.");
});

// * Running app
app.listen(PORT, async () => {
  debug(`Listening on port ${PORT}: http://localhost:${PORT}`);
});
