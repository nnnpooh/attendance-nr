import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { dbClient } from "@db/client.js";
import {
  checkinsTable,
  meetingsTable,
  studentsTable,
  enrollmentsTable,
  sectionsTable,
  coursesTable,
  type Checkin,
  type CheckinMethod,
} from "@db/schema.js";
import { isUniqueViolation } from "./errors.js";
import { courseKey } from "./courses.js";

export async function insertCheckin(input: {
  meetingId: string;
  studentId: string;
  checkedAt: Date;
  method: CheckinMethod;
  reason?: string | null;
  recordedBy?: string | null;
  lineUserId?: string | null;
}): Promise<{ ok: true; checkin: Checkin } | { ok: false; existing: Checkin }> {
  try {
    const [row] = await dbClient.insert(checkinsTable).values(input).returning();
    return { ok: true, checkin: row };
  } catch (e) {
    if (isUniqueViolation(e)) {
      const existing = await dbClient.query.checkinsTable.findFirst({
        where: and(
          eq(checkinsTable.meetingId, input.meetingId),
          eq(checkinsTable.studentId, input.studentId)
        ),
      });
      if (existing) return { ok: false, existing };
    }
    throw e;
  }
}

export async function getCheckin(id: string) {
  return dbClient.query.checkinsTable.findFirst({
    where: eq(checkinsTable.id, id),
    with: { meeting: true },
  });
}

export async function deleteCheckin(id: string) {
  await dbClient.delete(checkinsTable).where(eq(checkinsTable.id, id));
}

/** A student's check-in history across all courses (newest first). */
export async function listCheckinsForStudent(studentId: string, limit = 100) {
  const rows = await dbClient
    .select({
      id: checkinsTable.id,
      checkedAt: checkinsTable.checkedAt,
      method: checkinsTable.method,
      reason: checkinsTable.reason,
      meetingStartsAt: meetingsTable.startsAt,
      sectionId: sectionsTable.id,
      section: sectionsTable.number,
      code: coursesTable.code,
      year: coursesTable.year,
      semester: coursesTable.semester,
      courseId: coursesTable.id,
    })
    .from(checkinsTable)
    .innerJoin(meetingsTable, eq(meetingsTable.id, checkinsTable.meetingId))
    .innerJoin(sectionsTable, eq(sectionsTable.id, meetingsTable.sectionId))
    .innerJoin(coursesTable, eq(coursesTable.id, sectionsTable.courseId))
    .where(eq(checkinsTable.studentId, studentId))
    .orderBy(desc(checkinsTable.checkedAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, key: courseKey(r) }));
}

// ---------- Pivot ----------

type PivotStudent = { id: string; firstname: string; lastname: string };
export type PivotCell = { meetingId: string; checkin: Checkin | null };
export type PivotRow = {
  student: PivotStudent;
  cells: PivotCell[];
  present: number;
  /** For "not enrolled" rows: the section they ARE enrolled in (same course), or null. */
  enrolledSection?: { id: string; number: string } | null;
};

/**
 * Attendance pivot for one section:
 *  - enrolled: every student enrolled in this section (absences visible)
 *  - others:   students who checked in to this section's meetings but are not
 *              enrolled in it (wrong section of the same course, or not in the course)
 */
export async function getSectionPivot(sectionId: string, courseId: string) {
  const meetings = await dbClient
    .select({
      id: meetingsTable.id,
      startsAt: meetingsTable.startsAt,
      endsAt: meetingsTable.endsAt,
    })
    .from(meetingsTable)
    .where(eq(meetingsTable.sectionId, sectionId))
    .orderBy(asc(meetingsTable.startsAt));
  const meetingIds = meetings.map((m) => m.id);

  const enrolled = await dbClient
    .select({
      id: studentsTable.id,
      firstname: studentsTable.firstname,
      lastname: studentsTable.lastname,
    })
    .from(enrollmentsTable)
    .innerJoin(studentsTable, eq(studentsTable.id, enrollmentsTable.studentId))
    .where(eq(enrollmentsTable.sectionId, sectionId))
    .orderBy(asc(studentsTable.id));

  const checkins = meetingIds.length
    ? await dbClient
        .select()
        .from(checkinsTable)
        .where(inArray(checkinsTable.meetingId, meetingIds))
    : [];

  // studentId -> meetingId -> checkin
  const byStudent = new Map<string, Map<string, Checkin>>();
  for (const c of checkins) {
    if (!byStudent.has(c.studentId)) byStudent.set(c.studentId, new Map());
    byStudent.get(c.studentId)!.set(c.meetingId, c);
  }

  const buildRow = (student: PivotStudent): PivotRow => {
    const mine = byStudent.get(student.id);
    const cells = meetings.map((m) => ({
      meetingId: m.id,
      checkin: mine?.get(m.id) ?? null,
    }));
    return {
      student,
      cells,
      present: cells.filter((c) => c.checkin).length,
    };
  };

  const enrolledSet = new Set(enrolled.map((s) => s.id));
  const enrolledRows = enrolled.map(buildRow);

  const otherIds = [...byStudent.keys()].filter((id) => !enrolledSet.has(id));
  let otherRows: PivotRow[] = [];
  if (otherIds.length) {
    const students = await dbClient
      .select({
        id: studentsTable.id,
        firstname: studentsTable.firstname,
        lastname: studentsTable.lastname,
        sectionId: sectionsTable.id,
        sectionNumber: sectionsTable.number,
      })
      .from(studentsTable)
      .leftJoin(
        enrollmentsTable,
        and(
          eq(enrollmentsTable.studentId, studentsTable.id),
          eq(enrollmentsTable.courseId, courseId)
        )
      )
      .leftJoin(sectionsTable, eq(sectionsTable.id, enrollmentsTable.sectionId))
      .where(inArray(studentsTable.id, otherIds))
      .orderBy(asc(studentsTable.id));
    otherRows = students.map((s) => ({
      ...buildRow({ id: s.id, firstname: s.firstname, lastname: s.lastname }),
      enrolledSection:
        s.sectionId && s.sectionNumber
          ? { id: s.sectionId, number: s.sectionNumber }
          : null,
    }));
  }

  return { meetings, enrolledRows, otherRows };
}
