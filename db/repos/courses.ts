import { and, asc, desc, eq, sql } from "drizzle-orm";
import { dbClient } from "@db/client.js";
import {
  coursesTable,
  sectionsTable,
  enrollmentsTable,
  meetingsTable,
  type Course,
} from "@db/schema.js";
import { isUniqueViolation, UserError } from "./errors.js";

export function courseKey(c: Pick<Course, "code" | "year" | "semester">) {
  return `${c.code}-${c.year}-${c.semester}`;
}

/** Normalise a section number: "1" -> "001". Non-numeric values are kept as typed. */
export function normaliseSection(raw: string) {
  const s = (raw ?? "").trim();
  return /^\d{1,3}$/.test(s) ? s.padStart(3, "0") : s;
}

export async function listCoursesWithSections() {
  const courses = await dbClient.query.coursesTable.findMany({
    orderBy: [
      desc(coursesTable.year),
      desc(coursesTable.semester),
      asc(coursesTable.code),
    ],
    with: { sections: { orderBy: [asc(sectionsTable.number)] } },
  });
  const counts = await dbClient
    .select({
      sectionId: enrollmentsTable.sectionId,
      n: sql<number>`count(*)`,
    })
    .from(enrollmentsTable)
    .groupBy(enrollmentsTable.sectionId);
  const meetingCounts = await dbClient
    .select({
      sectionId: meetingsTable.sectionId,
      n: sql<number>`count(*)`,
    })
    .from(meetingsTable)
    .groupBy(meetingsTable.sectionId);
  const countMap = new Map(counts.map((c) => [c.sectionId, c.n]));
  const meetingMap = new Map(meetingCounts.map((c) => [c.sectionId, c.n]));
  return courses.map((c) => {
    const sections = c.sections.map((s) => ({
      ...s,
      studentCount: countMap.get(s.id) ?? 0,
      meetingCount: meetingMap.get(s.id) ?? 0,
    }));
    return {
      ...c,
      key: courseKey(c),
      sections,
      studentCount: sections.reduce((n, s) => n + s.studentCount, 0),
      meetingCount: sections.reduce((n, s) => n + s.meetingCount, 0),
    };
  });
}

export async function getCourseWithCounts(id: string) {
  const all = await listCoursesWithSections();
  return all.find((c) => c.id === id);
}

export async function getCourse(id: string) {
  const c = await dbClient.query.coursesTable.findFirst({
    where: eq(coursesTable.id, id),
    with: { sections: { orderBy: [asc(sectionsTable.number)] } },
  });
  return c ? { ...c, key: courseKey(c) } : undefined;
}

function validateCourse(input: {
  code: string;
  name: string;
  year: string | number;
  semester: string | number;
}) {
  const code = String(input.code ?? "").trim();
  const name = String(input.name ?? "").trim();
  const year = Number(input.year);
  const semester = Number(input.semester);
  if (!/^[A-Za-z0-9]+$/.test(code))
    throw new UserError("Course code must be letters/digits only (e.g. 259103).");
  if (!Number.isInteger(year) || year < 2000 || year > 3000)
    throw new UserError("Year must be a 4-digit year (e.g. 2568).");
  if (!Number.isInteger(semester) || semester < 1 || semester > 3)
    throw new UserError("Semester must be 1, 2 or 3.");
  return { code, name, year, semester };
}

export async function createCourse(input: {
  code: string;
  name: string;
  year: string | number;
  semester: string | number;
}) {
  const values = validateCourse(input);
  try {
    const [row] = await dbClient.insert(coursesTable).values(values).returning();
    return row;
  } catch (e) {
    if (isUniqueViolation(e))
      throw new UserError(`Course ${courseKey(values)} already exists.`);
    throw e;
  }
}

export async function updateCourse(
  id: string,
  input: { code: string; name: string; year: string | number; semester: string | number }
) {
  const values = validateCourse(input);
  try {
    await dbClient.update(coursesTable).set(values).where(eq(coursesTable.id, id));
  } catch (e) {
    if (isUniqueViolation(e))
      throw new UserError(`Course ${courseKey(values)} already exists.`);
    throw e;
  }
}

export async function deleteCourse(id: string) {
  await dbClient.delete(coursesTable).where(eq(coursesTable.id, id));
}

export async function createSection(courseId: string, rawNumber: string) {
  const number = normaliseSection(rawNumber);
  if (!number) throw new UserError("Section number is required.");
  try {
    const [row] = await dbClient
      .insert(sectionsTable)
      .values({ courseId, number })
      .returning();
    return row;
  } catch (e) {
    if (isUniqueViolation(e))
      throw new UserError(`Section ${number} already exists in this course.`);
    throw e;
  }
}

export async function deleteSection(id: string) {
  await dbClient.delete(sectionsTable).where(eq(sectionsTable.id, id));
}

export async function getSection(id: string) {
  const s = await dbClient.query.sectionsTable.findFirst({
    where: eq(sectionsTable.id, id),
    with: {
      course: { with: { sections: { orderBy: [asc(sectionsTable.number)] } } },
    },
  });
  return s ? { ...s, courseKey: courseKey(s.course) } : undefined;
}

/** Lookup used by CSV import: course key -> { courseId, sections: number -> sectionId }. */
export async function getSectionKeyMap() {
  const courses = await dbClient.query.coursesTable.findMany({
    with: { sections: true },
  });
  const map = new Map<
    string,
    { courseId: string; sections: Map<string, string> }
  >();
  for (const c of courses) {
    map.set(courseKey(c), {
      courseId: c.id,
      sections: new Map(c.sections.map((s) => [s.number, s.id])),
    });
  }
  return map;
}

export async function findSectionInCourse(courseId: string, number: string) {
  return dbClient.query.sectionsTable.findFirst({
    where: and(
      eq(sectionsTable.courseId, courseId),
      eq(sectionsTable.number, number)
    ),
  });
}
