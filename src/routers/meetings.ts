import express from "express";
import { requireAdmin } from "@src/auth/guards.js";
import {
  getMeeting,
  createMeeting,
  closeMeeting,
  extendMeeting,
  deleteMeeting,
  countCheckins,
  listMeetings,
  lastUsedSectionId,
  findOpenMeetingForSection,
} from "@db/repos/meetings.js";
import { courseKey, getSection, listCoursesWithSections } from "@db/repos/courses.js";
import { getStudent, getSectionRoster } from "@db/repos/students.js";
import {
  insertCheckin,
  getCheckin,
  deleteCheckin,
  getMeetingAttendance,
  listRecentCheckins,
} from "@db/repos/checkins.js";
import { UserError } from "@db/repos/errors.js";
import { currentCode, CODE_PERIOD_SEC } from "@src/utils/totp.js";
import { fromLocalInput, toLocalInput } from "@src/utils/time.js";
import { hxAfterDelete, hxRefresh, hxRedirect, notFound, str } from "./helpers.js";

const router = express.Router();
router.use(["/meetings", "/checkins"], requireAdmin);

// ---------- list ("Check-Ins") ----------

router.get("/meetings", async (req, res) => {
  const courseId = str(req.query.course) || undefined;
  const [meetings, courses] = await Promise.all([
    listMeetings({ courseId }),
    listCoursesWithSections(),
  ]);
  res.render("pages/meetings", {
    title: "Check-Ins",
    user: req.user,
    meetings,
    courses,
    courseId,
    now: new Date(),
  });
});

// ---------- new check-in (always starts now) ----------

router.get("/meetings/new", async (req, res) => {
  const courses = (await listCoursesWithSections()).filter((c) => c.sections.length);
  const selected = str(req.query.section) || (await lastUsedSectionId());
  res.render("pages/meetingNew", {
    title: "New Check-In",
    user: req.user,
    courses,
    selected,
  });
});

router.post("/meetings", async (req, res) => {
  const section = await getSection(str(req.body.sectionId));
  if (!section) throw new UserError("Please choose a course and section.");
  // Already running for this section? Just show it instead of opening a second one.
  const open = await findOpenMeetingForSection(section.id);
  if (open) return hxRedirect(res, `/meetings/${open.id}/display`);
  const minutes = Number(str(req.body.minutes) || "15");
  const m = await createMeeting(section.id, new Date(), minutes, req.user?.id ?? null);
  hxRedirect(res, `/meetings/${m.id}/display`);
});

// ---------- one meeting ----------

router.get("/meetings/:id", async (req, res) => {
  const meeting = await getMeeting(req.params.id);
  if (!meeting) return notFound(res, "Meeting not found");
  const attendance = await getMeetingAttendance(meeting);
  res.render("pages/meeting", {
    title: `${courseKey(meeting.section.course)} sec ${meeting.section.number}`,
    user: req.user,
    meeting,
    courseKey: courseKey(meeting.section.course),
    ...attendance,
    now: new Date(),
  });
});

// Projector page.
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
  const [count, roster, recent] = await Promise.all([
    countCheckins(meeting.id, meeting.sectionId),
    getSectionRoster(meeting.sectionId),
    listRecentCheckins(meeting.id, meeting.sectionId),
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
    // Highlight anyone recorded in the last 10 seconds.
    recent: recent.map((r) => ({ ...r, fresh: now - r.createdAt.getTime() < 10_000 })),
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
  hxAfterDelete(req, res, `/meetings/${meeting.id}`, "/meetings");
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
