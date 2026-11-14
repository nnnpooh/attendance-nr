import express from "express";
import { requireAdmin } from "@src/auth/guards.js";
import {
  listCoursesWithSections,
  getCourse,
  createCourse,
  updateCourse,
  deleteCourse,
  createSection,
} from "@db/repos/courses.js";
import { hxRedirect, hxRefresh, notFound, str } from "./helpers.js";

const router = express.Router();
router.use("/courses", requireAdmin);

router.get("/courses", async (req, res) => {
  const courses = await listCoursesWithSections();
  res.render("pages/courses", { title: "Courses", user: req.user, courses });
});

router.post("/courses", async (req, res) => {
  const course = await createCourse({
    code: str(req.body.code),
    name: str(req.body.name),
    year: str(req.body.year),
    semester: str(req.body.semester),
  });
  // Optional: create sections from "001, 002, 003" in the same form.
  const sections = str(req.body.sections)
    .split(/[\s,]+/)
    .filter(Boolean);
  for (const s of sections) await createSection(course.id, s);
  hxRedirect(res, `/courses/${course.id}`);
});

router.get("/courses/:id", async (req, res) => {
  const course = await getCourse(req.params.id);
  if (!course) return notFound(res, "Course not found");
  const all = await listCoursesWithSections();
  const withCounts = all.find((c) => c.id === course.id)!;
  res.render("pages/course", {
    title: course.key,
    user: req.user,
    course: withCounts,
  });
});

router.post("/courses/:id", async (req, res) => {
  await updateCourse(req.params.id, {
    code: str(req.body.code),
    name: str(req.body.name),
    year: str(req.body.year),
    semester: str(req.body.semester),
  });
  hxRefresh(res);
});

router.delete("/courses/:id", async (req, res) => {
  await deleteCourse(req.params.id);
  hxRedirect(res, "/courses");
});

router.post("/courses/:id/sections", async (req, res) => {
  const course = await getCourse(req.params.id);
  if (!course) return notFound(res, "Course not found");
  const numbers = str(req.body.number).split(/[\s,]+/).filter(Boolean);
  if (numbers.length === 0) {
    res.status(400).send("Section number is required.");
    return;
  }
  for (const n of numbers) await createSection(course.id, n);
  hxRefresh(res);
});

export default router;
