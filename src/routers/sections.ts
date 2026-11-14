import express from "express";
import { requireAdmin } from "@src/auth/guards.js";
import { getSection, deleteSection } from "@db/repos/courses.js";
import { enrollStudent } from "@db/repos/students.js";
import { getSectionPivot } from "@db/repos/checkins.js";
import { fmt } from "@src/utils/time.js";
import { hxRefresh, notFound, str } from "./helpers.js";

const router = express.Router();
router.use("/sections", requireAdmin);

// Sections no longer have their own page: they live as a tab on the course page.
const toCourseTab = async (req: express.Request, res: express.Response) => {
  const section = await getSection(String(req.params.id));
  if (!section) return notFound(res, "Section not found");
  res.redirect(`/courses/${section.courseId}?section=${section.id}`);
};
router.get("/sections/:id", toCourseTab);
router.get("/sections/:id/attendance", toCourseTab);

// From the course edit page.
router.delete("/sections/:id", async (req, res) => {
  const section = await getSection(req.params.id);
  if (!section) return notFound(res, "Section not found");
  await deleteSection(section.id);
  hxRefresh(res);
});

// "Enroll / move here" button from the attendance grid.
router.post("/sections/:id/enroll", async (req, res) => {
  const section = await getSection(req.params.id);
  if (!section) return notFound(res, "Section not found");
  await enrollStudent(str(req.body.studentId), section.id, { move: true });
  hxRefresh(res);
});

// ---------- attendance CSV ----------

function csvCell(v: string | number) {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

router.get("/sections/:id/attendance.csv", async (req, res) => {
  const section = await getSection(req.params.id);
  if (!section) return notFound(res, "Section not found");
  const pivot = await getSectionPivot(section.id, section.courseId);
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
