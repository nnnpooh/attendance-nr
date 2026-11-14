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
import { courseKey, listCoursesWithSections } from "@db/repos/courses.js";
import { listCheckinsForStudent } from "@db/repos/checkins.js";
import { UserError } from "@db/repos/errors.js";
import { hxAfterDelete, hxRedirect, hxRefresh, notFound, str } from "./helpers.js";

const router = express.Router();
router.use("/students", requireAdmin);

// List + live search
router.get("/students", async (req, res) => {
  const q = str(req.query.q);
  const { rows, total } = await searchStudents(q);
  // htmx live search swaps only the results table.
  const view = req.get("HX-Request") && req.get("HX-Target") === "student-results"
    ? "components/studentResults"
    : "pages/students";
  res.render(view, { title: "Students", user: req.user, q, rows, total });
});

// Create one student (optionally straight into a section)
router.get("/students/new", async (req, res) => {
  const courses = (await listCoursesWithSections()).filter((c) => c.sections.length);
  res.render("pages/studentNew", { title: "New Student", user: req.user, courses });
});

router.post("/students", async (req, res) => {
  const id = str(req.body.id);
  if (await getStudent(id))
    throw new UserError(`${id} already exists. Use the pen button on the Students list to edit them.`);
  await upsertStudent({ id, firstname: str(req.body.firstname), lastname: str(req.body.lastname) });
  const sectionId = str(req.body.sectionId);
  if (sectionId) await enrollStudent(id, sectionId);
  hxRedirect(res, `/students/${id}`);
});

// Details (read-only)
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

// Edit
router.get("/students/:id/edit", async (req, res) => {
  const student = await getStudent(req.params.id);
  if (!student) return notFound(res, "Student not found");
  const enrolledCourseIds = new Set(student.enrollments.map((e) => e.courseId));
  const otherCourses = (await listCoursesWithSections()).filter(
    (c) => c.sections.length && !enrolledCourseIds.has(c.id)
  );
  res.render("pages/studentEdit", {
    title: `Edit ${student.id}`,
    user: req.user,
    student,
    enrollments: student.enrollments.map((e) => ({ ...e, key: courseKey(e.course) })),
    otherCourses,
  });
});

router.post("/students/:id", async (req, res) => {
  if (!(await getStudent(req.params.id))) return notFound(res, "Student not found");
  await upsertStudent({
    id: req.params.id,
    firstname: str(req.body.firstname),
    lastname: str(req.body.lastname),
  });
  hxRedirect(res, `/students/${req.params.id}`);
});

router.delete("/students/:id", async (req, res) => {
  await dbClient.delete(studentsTable).where(eq(studentsTable.id, req.params.id));
  hxAfterDelete(req, res, `/students/${req.params.id}`, "/students");
});

// Add to a course (student is not in that course yet).
router.post("/students/:id/enroll", async (req, res) => {
  const r = await enrollStudent(req.params.id, str(req.body.sectionId));
  if (r.status === "conflict")
    throw new UserError(`Already in section ${r.otherSection} of that course. Use "Move" instead.`);
  hxRefresh(res);
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
