import express from "express";
import { requireAdmin } from "@src/auth/guards.js";
import {
  getMeeting,
  closeMeeting,
  extendMeeting,
  deleteMeeting,
  countCheckins,
} from "@db/repos/meetings.js";
import { courseKey } from "@db/repos/courses.js";
import { getStudent, getSectionRoster } from "@db/repos/students.js";
import { insertCheckin, getCheckin, deleteCheckin } from "@db/repos/checkins.js";
import { UserError } from "@db/repos/errors.js";
import { currentCode, CODE_PERIOD_SEC } from "@src/utils/totp.js";
import { fromLocalInput, toLocalInput } from "@src/utils/time.js";
import { hxRefresh, hxRedirect, notFound, str } from "./helpers.js";

const router = express.Router();
router.use(["/meetings", "/checkins"], requireAdmin);

// ---------- projector page ----------

router.get("/meetings/:id/display", async (req, res) => {
  const meeting = await getMeeting(req.params.id);
  if (!meeting) return notFound(res, "Meeting not found");
  res.render("pages/display", {
    title: `Check-in ${courseKey(meeting.section.course)} sec ${meeting.section.number}`,
    user: req.user,
    meeting,
    courseKey: courseKey(meeting.section.course),
  });
});

// Polled every second by the projector page. The secret never leaves the server.
router.get("/meetings/:id/code", async (req, res) => {
  const meeting = await getMeeting(req.params.id);
  if (!meeting) return notFound(res, "Meeting not found");
  const now = Date.now();
  const isOpen = meeting.startsAt.getTime() <= now && now < meeting.endsAt.getTime();
  const notStarted = now < meeting.startsAt.getTime();
  const [count, roster] = await Promise.all([
    countCheckins(meeting.id, meeting.sectionId),
    getSectionRoster(meeting.sectionId),
  ]);
  const { code, secondsLeft } = currentCode(meeting.secret, now);
  res.render("components/codeBox", {
    meeting,
    isOpen,
    notStarted,
    code: isOpen ? `${code.slice(0, 3)} ${code.slice(3)}` : null,
    secondsLeft,
    period: CODE_PERIOD_SEC,
    minutesLeft: Math.max(0, Math.ceil((meeting.endsAt.getTime() - now) / 60000)),
    count,
    enrolled: roster.length,
  });
});

router.post("/meetings/:id/close", async (req, res) => {
  await closeMeeting(req.params.id);
  hxRefresh(res);
});

router.post("/meetings/:id/extend", async (req, res) => {
  const minutes = Number(str(req.body.minutes) || "5");
  if (!Number.isFinite(minutes) || minutes < 1) throw new UserError("Invalid minutes.");
  await extendMeeting(req.params.id, minutes);
  hxRefresh(res);
});

router.delete("/meetings/:id", async (req, res) => {
  const meeting = await getMeeting(req.params.id);
  if (!meeting) return notFound(res, "Meeting not found");
  await deleteMeeting(meeting.id);
  hxRedirect(res, `/sections/${meeting.sectionId}`);
});

// ---------- manual check-in ----------

router.get("/meetings/:id/manual", async (req, res) => {
  const meeting = await getMeeting(req.params.id);
  if (!meeting) return notFound(res, "Meeting not found");
  const student = await getStudent(str(req.query.studentId));
  if (!student) return notFound(res, "Student not found");
  res.render("components/manualDialog", {
    meeting,
    student,
    defaultTime: toLocalInput(meeting.startsAt),
  });
});

router.post("/checkins", async (req, res) => {
  const meeting = await getMeeting(str(req.body.meetingId));
  if (!meeting) return notFound(res, "Meeting not found");
  const student = await getStudent(str(req.body.studentId));
  if (!student) return notFound(res, "Student not found");
  const reason = str(req.body.reason);
  if (!reason) throw new UserError("Please give a reason for the manual check-in.");
  const checkedAt = fromLocalInput(str(req.body.checkedAt)) ?? meeting.startsAt;
  const r = await insertCheckin({
    meetingId: meeting.id,
    studentId: student.id,
    checkedAt,
    method: "MANUAL",
    reason,
    recordedBy: req.user?.id ?? null,
  });
  if (!r.ok) throw new UserError(`${student.id} is already checked in for this meeting.`);
  hxRefresh(res);
});

router.get("/checkins/:id", async (req, res) => {
  const checkin = await getCheckin(req.params.id);
  if (!checkin) return notFound(res, "Check-in not found");
  const student = await getStudent(checkin.studentId);
  res.render("components/checkinDialog", { checkin, student });
});

router.delete("/checkins/:id", async (req, res) => {
  await deleteCheckin(req.params.id);
  hxRefresh(res);
});

export default router;
