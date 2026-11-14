import express from "express";
import { requireAdmin } from "@src/auth/guards.js";
import { getSection, deleteSection } from "@db/repos/courses.js";
import {
  getSectionRoster,
  getStudent,
  upsertStudent,
  enrollStudent,
  unenroll,
} from "@db/repos/students.js";
import { createMeeting, listMeetingsForSection } from "@db/repos/meetings.js";
import { getSectionPivot } from "@db/repos/checkins.js";
import { UserError } from "@db/repos/errors.js";
import { fromLocalInput, fmt } from "@src/utils/time.js";
import { hxRedirect, hxRefresh, notFound, str } from "./helpers.js";

const router = express.Router();
router.use("/sections", requireAdmin);

router.get("/sections/:id", async (req, res) => {
  const section = await getSection(req.params.id);
  if (!section) return notFound(res, "Section not found");
  const [roster, meetings] = await Promise.all([
    getSectionRoster(section.id),
    listMeetingsForSection(section.id),
  ]);
  res.render("pages/section", {
    title: `${section.courseKey} sec ${section.number}`,
    user: req.user,
    section,
    roster,
    meetings,
    now: new Date(),
  });
});

router.delete("/sections/:id", async (req, res) => {
  const section = await getSection(req.params.id);
  if (!section) return notFound(res, "Section not found");
  await deleteSection(section.id);
  hxRedirect(res, `/courses/${section.courseId}`);
});

// Add one student via web form. Names are only required for a new student;
// if given for an existing one they update the directory.
router.post("/sections/:id/students", async (req, res) => {
  const section = await getSection(req.params.id);
  if (!section) return notFound(res, "Section not found");
  const id = str(req.body.id);
  const firstname = str(req.body.firstname);
  const lastname = str(req.body.lastname);
  const email = str(req.body.email);
  const existing = await getStudent(id);
  if (!existing || firstname || lastname || email) {
    await upsertStudent({
      id,
      firstname: firstname || existing?.firstname || "",
      lastname: lastname || existing?.lastname || "",
      email: email || existing?.email || "",
    });
  }
  const r = await enrollStudent(id, section.id, { move: req.body.move === "on" });
  if (r.status === "conflict")
    throw new UserError(
      `${id} is already in section ${r.otherSection} of this course. Tick "move" to move them here.`
    );
  if (r.status === "already") throw new UserError(`${id} is already in this section.`);
  hxRefresh(res);
});

// "Enroll / move here" button from the attendance pivot.
router.post("/sections/:id/enroll", async (req, res) => {
  const section = await getSection(req.params.id);
  if (!section) return notFound(res, "Section not found");
  await enrollStudent(str(req.body.studentId), section.id, { move: true });
  hxRefresh(res);
});

router.delete("/sections/:id/students/:studentId", async (req, res) => {
  const section = await getSection(req.params.id);
  if (!section) return notFound(res, "Section not found");
  await unenroll(req.params.studentId, section.courseId);
  hxRefresh(res);
});

router.post("/sections/:id/meetings", async (req, res) => {
  const section = await getSection(req.params.id);
  if (!section) return notFound(res, "Section not found");
  const minutes = Number(str(req.body.minutes) || "15");
  const startsAt = fromLocalInput(str(req.body.startsAt)) ?? new Date();
  const m = await createMeeting(section.id, startsAt, minutes, req.user?.id ?? null);
  hxRedirect(res, startsAt.getTime() <= Date.now() ? `/meetings/${m.id}/display` : `/sections/${section.id}`);
});

// ---------- attendance pivot ----------

async function loadPivot(sectionId: string) {
  const section = await getSection(sectionId);
  if (!section) return null;
  const pivot = await getSectionPivot(section.id, section.courseId);
  return { section, pivot };
}

router.get("/sections/:id/attendance", async (req, res) => {
  const data = await loadPivot(req.params.id);
  if (!data) return notFound(res, "Section not found");
  res.render("pages/attendance", {
    title: `Attendance ${data.section.courseKey} sec ${data.section.number}`,
    user: req.user,
    ...data,
  });
});

function csvCell(v: string | number) {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

router.get("/sections/:id/attendance.csv", async (req, res) => {
  const data = await loadPivot(req.params.id);
  if (!data) return notFound(res, "Section not found");
  const { section, pivot } = data;
  const header = [
    "group",
    "cmu_id",
    "firstname",
    "lastname",
    "enrolled_section",
    ...pivot.meetings.map((m) => fmt(m.startsAt, "YYYY-MM-DD HH:mm")),
    "present",
    "total",
  ];
  const lines = [header.map(csvCell).join(",")];
  const push = (group: string, row: (typeof pivot.enrolledRows)[number], enrolledSection: string) => {
    lines.push(
      [
        group,
        row.student.id,
        row.student.firstname,
        row.student.lastname,
        enrolledSection,
        ...row.cells.map((c) => (c.checkin ? 1 : 0)),
        row.present,
        pivot.meetings.length,
      ]
        .map(csvCell)
        .join(",")
    );
  };
  for (const r of pivot.enrolledRows) push("enrolled", r, section.number);
  for (const r of pivot.otherRows) push("not_enrolled", r, r.enrolledSection?.number ?? "");
  const filename = `attendance_${section.courseKey}_sec${section.number}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  // BOM so Excel opens Thai names correctly.
  res.send("﻿" + lines.join("\r\n"));
});

export default router;
