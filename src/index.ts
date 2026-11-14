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
import { PORT, NODE_ENV } from "./utils/env.js";
import { fmtDateTime, fmtDate, fmtTime, fmt } from "./utils/time.js";
import { UserError } from "@db/repos/errors.js";
import { listOpenMeetings } from "@db/repos/meetings.js";
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

// * Routers - need to load after session due to req.logout() function
app.use(authRouter);
app.use(coursesRouter);
app.use(sectionsRouter);
app.use(meetingsRouter);
app.use(studentsRouter);
app.use(importRouter);

// * Endpoints
app.get("/", async (req, res, next) => {
  const sessions = await formatSession(req);
  const openMeetings = req.user?.isAdmin ? await listOpenMeetings() : [];
  res.render("pages/index", {
    title: "Home",
    user: req.user,
    sessions: sessions,
    openMeetings,
  });
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
