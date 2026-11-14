import express from "express";
import { requireAdmin } from "@src/auth/guards.js";
import {
  listCoursesWithSections,
  getCourse,
  getCourseWithCounts,
  createCourse,
  updateCourse,
  deleteCourse,
  createSection,
} from "@db/repos/courses.js";
import { getSectionPivot } from "@db/repos/checkins.js";
import { UserError } from "@db/repos/errors.js";
import { hxRedirect, hxRefresh, notFound, str } from "./helpers.js";

const router = express.Router();
router.use("/courses", requireAdmin);

// List
router.get("/courses", async (req, res) => {
  const courses = await listCoursesWithSections();
  res.render("pages/courses", { title: "Courses", user: req.user, courses });
});

// Create
router.get("/courses/new", (req, res) => {
  res.render("pages/courseNew", { title: "New course", user: req.user });
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
  hxRedirect(res, "/courses");
});

// Students of the course = attendance grid, one section at a time.
router.get("/courses/:id", async (req, res) => {
  const course = await getCourseWithCounts(req.params.id);
  if (!course) return notFound(res, "Course not found");
  const section =
    course.sections.find((s) => s.id === str(req.query.section)) ?? course.sections[0];
  const pivot = section ? await getSectionPivot(section.id, course.id) : null;
  res.render("pages/course", {
    title: course.key,
    user: req.user,
    course,
    section,
    pivot,
  });
});

// Edit
router.get("/courses/:id/edit", async (req, res) => {
  const course = await getCourseWithCounts(req.params.id);
  if (!course) return notFound(res, "Course not found");
  res.render("pages/courseEdit", { title: `Edit ${course.key}`, user: req.user, course });
});

router.post("/courses/:id", async (req, res) => {
  await updateCourse(req.params.id, {
    code: str(req.body.code),
    name: str(req.body.name),
    year: str(req.body.year),
    semester: str(req.body.semester),
  });
  hxRedirect(res, "/courses");
});

// Deleting a course wipes everything under it, so the user must type the course code.
router.delete("/courses/:id", async (req, res) => {
  const course = await getCourse(req.params.id);
  if (!course) return notFound(res, "Course not found");
  const typed = str(req.get("HX-Prompt"));
  if (typed !== course.code)
    throw new UserError(`You typed "${typed}", not "${course.code}". Nothing was deleted.`);
  await deleteCourse(course.id);
  hxRedirect(res, "/courses");
});

router.post("/courses/:id/sections", async (req, res) => {
  const course = await getCourse(req.params.id);
  if (!course) return notFound(res, "Course not found");
  const numbers = str(req.body.number).split(/[\s,]+/).filter(Boolean);
  if (numbers.length === 0) throw new UserError("Section number is required.");
  for (const n of numbers) await createSection(course.id, n);
  hxRefresh(res);
});

export default router;
