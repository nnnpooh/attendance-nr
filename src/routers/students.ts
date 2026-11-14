import express from "express";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@src/auth/guards.js";
import { dbClient } from "@db/client.js";
import { studentsTable } from "@db/schema.js";
import {
  searchStudents,
  getStudent,
  upsertStudent,
  enrollStudent,
  unenroll,
  unlinkLineAccountByStudent,
} from "@db/repos/students.js";
import { courseKey } from "@db/repos/courses.js";
import { listCheckinsForStudent } from "@db/repos/checkins.js";
import { hxRedirect, hxRefresh, notFound, str } from "./helpers.js";

const router = express.Router();
router.use("/students", requireAdmin);

router.get("/students", async (req, res) => {
  const q = str(req.query.q);
  const { rows, total } = await searchStudents(q);
  // htmx live search swaps only the results table.
  const view = req.get("HX-Request") && req.get("HX-Target") === "student-results"
    ? "components/studentResults"
    : "pages/students";
  res.render(view, { title: "Students", user: req.user, q, rows, total });
});

router.get("/students/:id", async (req, res) => {
  const student = await getStudent(req.params.id);
  if (!student) return notFound(res, "Student not found");
  const checkins = await listCheckinsForStudent(student.id, 200);
  res.render("pages/student", {
    title: `${student.id} ${student.firstname}`,
    user: req.user,
    student,
    enrollments: student.enrollments.map((e) => ({ ...e, key: courseKey(e.course) })),
    checkins,
  });
});

router.post("/students/:id", async (req, res) => {
  await upsertStudent({
    id: req.params.id,
    firstname: str(req.body.firstname),
    lastname: str(req.body.lastname),
  });
  hxRefresh(res);
});

router.delete("/students/:id", async (req, res) => {
  await dbClient.delete(studentsTable).where(eq(studentsTable.id, req.params.id));
  hxRedirect(res, "/students");
});

// Move to another section of the same course.
router.post("/students/:id/move", async (req, res) => {
  await enrollStudent(req.params.id, str(req.body.sectionId), { move: true });
  hxRefresh(res);
});

router.delete("/students/:id/enrollments/:courseId", async (req, res) => {
  await unenroll(req.params.id, req.params.courseId);
  hxRefresh(res);
});

router.delete("/students/:id/line", async (req, res) => {
  await unlinkLineAccountByStudent(req.params.id);
  hxRefresh(res);
});

export default router;
