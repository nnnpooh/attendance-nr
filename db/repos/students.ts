import { and, asc, eq, like, or, sql } from "drizzle-orm";
import { dbClient } from "@db/client.js";
import {
  studentsTable,
  enrollmentsTable,
  sectionsTable,
  lineAccountsTable,
  coursesTable,
} from "@db/schema.js";
import { isUniqueViolation, UserError } from "./errors.js";
import { courseKey } from "./courses.js";

/**
 * CMU student IDs: 9 digits starting with 6 or 7 (entry years 25[67]x).
 * Single source of truth for the web forms, CSV import and LINE registration.
 */
export const STUDENT_ID_RE = /^[67]\d{8}$/;
export const STUDENT_ID_HINT = "9 digits starting with 6 or 7";

export function validateStudentInput(input: {
  id: string;
  firstname: string;
  lastname: string;
}) {
  const id = String(input.id ?? "").trim();
  const firstname = String(input.firstname ?? "").trim();
  const lastname = String(input.lastname ?? "").trim();
  const errors: string[] = [];
  if (!STUDENT_ID_RE.test(id)) errors.push(`invalid student ID "${id}" (need ${STUDENT_ID_HINT})`);
  if (!firstname) errors.push("missing firstname");
  if (!lastname) errors.push("missing lastname");
  return { value: { id, firstname, lastname }, errors };
}

export async function getStudent(id: string) {
  return dbClient.query.studentsTable.findFirst({
    where: eq(studentsTable.id, id),
    with: {
      lineAccount: true,
      enrollments: {
        with: {
          course: { with: { sections: { orderBy: [asc(sectionsTable.number)] } } },
          section: true,
        },
      },
    },
  });
}

export async function searchStudents(q: string, limit = 200) {
  const term = `%${q.trim()}%`;
  const where = q.trim()
    ? or(
        like(studentsTable.id, term),
        like(studentsTable.firstname, term),
        like(studentsTable.lastname, term)
      )
    : undefined;
  const rows = await dbClient
    .select({
      id: studentsTable.id,
      firstname: studentsTable.firstname,
      lastname: studentsTable.lastname,
      lineUserId: lineAccountsTable.lineUserId,
    })
    .from(studentsTable)
    .leftJoin(lineAccountsTable, eq(lineAccountsTable.studentId, studentsTable.id))
    .where(where)
    .orderBy(asc(studentsTable.id))
    .limit(limit);
  const [{ total }] = await dbClient
    .select({ total: sql<number>`count(*)` })
    .from(studentsTable)
    .where(where);
  return { rows, total };
}

/** Insert or update a student in the directory. */
export async function upsertStudent(input: {
  id: string;
  firstname: string;
  lastname: string;
}) {
  const { value, errors } = validateStudentInput(input);
  if (errors.length) throw new UserError(errors.join("; "));
  await dbClient
    .insert(studentsTable)
    .values(value)
    .onConflictDoUpdate({
      target: studentsTable.id,
      set: {
        firstname: value.firstname,
        lastname: value.lastname,
        updatedAt: new Date(),
      },
    });
  return value;
}

export async function getSectionRoster(sectionId: string) {
  return dbClient
    .select({
      id: studentsTable.id,
      firstname: studentsTable.firstname,
      lastname: studentsTable.lastname,
      lineUserId: lineAccountsTable.lineUserId,
    })
    .from(enrollmentsTable)
    .innerJoin(studentsTable, eq(studentsTable.id, enrollmentsTable.studentId))
    .leftJoin(lineAccountsTable, eq(lineAccountsTable.studentId, studentsTable.id))
    .where(eq(enrollmentsTable.sectionId, sectionId))
    .orderBy(asc(studentsTable.id));
}

/** The student's enrollment in a given course (which section), if any. */
export async function getEnrollmentInCourse(studentId: string, courseId: string) {
  const [row] = await dbClient
    .select({
      sectionId: enrollmentsTable.sectionId,
      sectionNumber: sectionsTable.number,
    })
    .from(enrollmentsTable)
    .innerJoin(sectionsTable, eq(sectionsTable.id, enrollmentsTable.sectionId))
    .where(
      and(
        eq(enrollmentsTable.studentId, studentId),
        eq(enrollmentsTable.courseId, courseId)
      )
    );
  return row;
}

export type EnrollResult =
  | { status: "enrolled" }
  | { status: "already" }
  | { status: "conflict"; otherSection: string };

/**
 * Enroll a student into a section. Refuses (status "conflict") if the student
 * is already in another section of the same course, unless `move` is true.
 */
export async function enrollStudent(
  studentId: string,
  sectionId: string,
  opts: { move?: boolean } = {}
): Promise<EnrollResult> {
  const section = await dbClient.query.sectionsTable.findFirst({
    where: eq(sectionsTable.id, sectionId),
  });
  if (!section) throw new UserError("Section not found.");
  const existing = await getEnrollmentInCourse(studentId, section.courseId);
  if (existing) {
    if (existing.sectionId === sectionId) return { status: "already" };
    if (!opts.move)
      return { status: "conflict", otherSection: existing.sectionNumber };
    await dbClient
      .update(enrollmentsTable)
      .set({ sectionId })
      .where(
        and(
          eq(enrollmentsTable.studentId, studentId),
          eq(enrollmentsTable.courseId, section.courseId)
        )
      );
    return { status: "enrolled" };
  }
  try {
    await dbClient
      .insert(enrollmentsTable)
      .values({ studentId, courseId: section.courseId, sectionId });
  } catch (e) {
    // Lost a race with another insert: report as conflict instead of crashing.
    if (isUniqueViolation(e)) {
      const other = await getEnrollmentInCourse(studentId, section.courseId);
      return other?.sectionId === sectionId
        ? { status: "already" }
        : { status: "conflict", otherSection: other?.sectionNumber ?? "?" };
    }
    throw e;
  }
  return { status: "enrolled" };
}

export async function unenroll(studentId: string, courseId: string) {
  await dbClient
    .delete(enrollmentsTable)
    .where(
      and(
        eq(enrollmentsTable.studentId, studentId),
        eq(enrollmentsTable.courseId, courseId)
      )
    );
}

/** Enrollments of a student, for the LINE "info" reply. */
export async function listEnrollmentsForStudent(studentId: string) {
  const rows = await dbClient
    .select({
      code: coursesTable.code,
      name: coursesTable.name,
      year: coursesTable.year,
      semester: coursesTable.semester,
      section: sectionsTable.number,
    })
    .from(enrollmentsTable)
    .innerJoin(coursesTable, eq(coursesTable.id, enrollmentsTable.courseId))
    .innerJoin(sectionsTable, eq(sectionsTable.id, enrollmentsTable.sectionId))
    .where(eq(enrollmentsTable.studentId, studentId))
    .orderBy(asc(coursesTable.code));
  return rows.map((r) => ({ ...r, key: courseKey(r) }));
}

// ---------- LINE account links ----------

export async function getLineAccount(lineUserId: string) {
  return dbClient.query.lineAccountsTable.findFirst({
    where: eq(lineAccountsTable.lineUserId, lineUserId),
    with: { student: true },
  });
}

export type LinkResult =
  | { status: "linked" }
  | { status: "no-student" }
  | { status: "line-already-linked"; studentId: string }
  | { status: "student-taken" };

export async function linkLineAccount(
  lineUserId: string,
  studentId: string,
  displayName: string | null
): Promise<LinkResult> {
  const mine = await getLineAccount(lineUserId);
  if (mine) return { status: "line-already-linked", studentId: mine.studentId };
  const student = await dbClient.query.studentsTable.findFirst({
    where: eq(studentsTable.id, studentId),
  });
  if (!student) return { status: "no-student" };
  try {
    await dbClient
      .insert(lineAccountsTable)
      .values({ lineUserId, studentId, displayName });
  } catch (e) {
    if (isUniqueViolation(e)) return { status: "student-taken" };
    throw e;
  }
  return { status: "linked" };
}

export async function unlinkLineAccountByStudent(studentId: string) {
  await dbClient
    .delete(lineAccountsTable)
    .where(eq(lineAccountsTable.studentId, studentId));
}
