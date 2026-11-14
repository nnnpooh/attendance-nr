import { parse } from "csv-parse/sync";
import { eq, inArray } from "drizzle-orm";
import { dbClient } from "@db/client.js";
import { studentsTable, enrollmentsTable, sectionsTable } from "@db/schema.js";
import { getSectionKeyMap, normaliseSection } from "@db/repos/courses.js";
import { validateStudentInput } from "@db/repos/students.js";
import { UserError } from "@db/repos/errors.js";

/**
 * CSV roster import.
 *
 *   course_key,section,cmu_id,firstname,lastname,email
 *   259103-2568-1,001,650612345,Somchai,Jaidee,somchai_j@cmu.ac.th
 *
 * Two steps: analyseCsv() (no writes, for the preview) and commitCsv()
 * (re-analyses the same text and applies it in one transaction).
 */

export const CSV_HEADERS = [
  "course_key",
  "section",
  "cmu_id",
  "firstname",
  "lastname",
  "email",
] as const;

const HEADER_ALIASES: Record<string, string> = {
  student_id: "cmu_id",
  studentid: "cmu_id",
  id: "cmu_id",
  first_name: "firstname",
  last_name: "lastname",
  coursekey: "course_key",
  sec: "section",
};

export type RowAction = "enroll" | "skip" | "error";
export type StudentChange = "new" | "update" | "same" | null;

export type AnalysedRow = {
  line: number;
  courseKey: string;
  section: string;
  studentId: string;
  firstname: string;
  lastname: string;
  email: string;
  action: RowAction;
  studentChange: StudentChange;
  /** "old -> new" descriptions when studentChange is "update". */
  changes: string[];
  messages: string[];
  // resolved ids (when valid)
  courseId?: string;
  sectionId?: string;
};

export type Analysis = {
  rows: AnalysedRow[];
  summary: {
    total: number;
    enroll: number;
    skip: number;
    error: number;
    newStudents: number;
    updatedStudents: number;
  };
};

const MAX_ROWS = 5000;

function parseCsv(text: string): Record<string, string>[] {
  let records: Record<string, string>[];
  try {
    records = parse(text, {
      bom: true,
      columns: (header: string[]) =>
        header.map((h) => {
          const k = h.trim().toLowerCase().replace(/\s+/g, "_");
          return HEADER_ALIASES[k] ?? k;
        }),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (e: any) {
    throw new UserError(`Could not read the CSV: ${e?.message ?? e}`);
  }
  if (records.length === 0) throw new UserError("The CSV has no data rows.");
  if (records.length > MAX_ROWS)
    throw new UserError(`Too many rows (${records.length}); max is ${MAX_ROWS}.`);
  const headers = Object.keys(records[0]);
  const missing = CSV_HEADERS.filter((h) => h !== "email" && !headers.includes(h));
  if (missing.length)
    throw new UserError(
      `Missing column(s): ${missing.join(", ")}. Expected header: ${CSV_HEADERS.join(",")}`
    );
  return records;
}

export async function analyseCsv(text: string): Promise<Analysis> {
  const records = parseCsv(text);
  const keyMap = await getSectionKeyMap();

  // Existing students and enrollments for every ID in the file.
  const ids = [...new Set(records.map((r) => (r.cmu_id ?? "").trim()).filter(Boolean))];
  const existingStudents = new Map<string, typeof studentsTable.$inferSelect>();
  const existingEnroll = new Map<string, { sectionId: string; number: string }>(); // `${studentId}|${courseId}`
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const s of await dbClient
      .select()
      .from(studentsTable)
      .where(inArray(studentsTable.id, chunk))) {
      existingStudents.set(s.id, s);
    }
    for (const e of await dbClient
      .select({
        studentId: enrollmentsTable.studentId,
        courseId: enrollmentsTable.courseId,
        sectionId: enrollmentsTable.sectionId,
        number: sectionsTable.number,
      })
      .from(enrollmentsTable)
      .innerJoin(sectionsTable, eq(sectionsTable.id, enrollmentsTable.sectionId))
      .where(inArray(enrollmentsTable.studentId, chunk))) {
      existingEnroll.set(`${e.studentId}|${e.courseId}`, {
        sectionId: e.sectionId,
        number: e.number,
      });
    }
  }

  const seenEnroll = new Map<string, AnalysedRow>(); // `${studentId}|${courseId}` -> first row
  const seenStudent = new Map<string, AnalysedRow>(); // studentId -> first row
  const rows: AnalysedRow[] = [];

  records.forEach((r, idx) => {
    const { value, errors } = validateStudentInput({
      id: r.cmu_id,
      firstname: r.firstname,
      lastname: r.lastname,
      email: r.email,
    });
    const row: AnalysedRow = {
      line: idx + 2, // header is line 1
      courseKey: (r.course_key ?? "").trim(),
      section: normaliseSection(r.section ?? ""),
      studentId: value.id,
      firstname: value.firstname,
      lastname: value.lastname,
      email: value.email,
      action: "enroll",
      studentChange: null,
      changes: [],
      messages: [...errors],
    };
    rows.push(row);

    const course = keyMap.get(row.courseKey);
    if (!row.courseKey) row.messages.push("missing course_key");
    else if (!course) row.messages.push(`unknown course_key "${row.courseKey}"`);
    else {
      row.courseId = course.courseId;
      const sid = course.sections.get(row.section);
      if (!row.section) row.messages.push("missing section");
      else if (!sid)
        row.messages.push(`section ${row.section} does not exist in ${row.courseKey}`);
      else row.sectionId = sid;
    }
    if (row.messages.length) {
      row.action = "error";
      return;
    }

    // --- Student directory change (first occurrence of an ID decides) ---
    const firstForStudent = seenStudent.get(row.studentId);
    if (firstForStudent) {
      row.studentChange = firstForStudent.studentChange === "new" ? "new" : "same";
      if (
        firstForStudent.firstname !== row.firstname ||
        firstForStudent.lastname !== row.lastname
      ) {
        row.messages.push(
          `name differs from line ${firstForStudent.line}; line ${firstForStudent.line} is used`
        );
      }
    } else {
      seenStudent.set(row.studentId, row);
      const ex = existingStudents.get(row.studentId);
      if (!ex) row.studentChange = "new";
      else {
        if (ex.firstname !== row.firstname)
          row.changes.push(`firstname: ${ex.firstname} → ${row.firstname}`);
        if (ex.lastname !== row.lastname)
          row.changes.push(`lastname: ${ex.lastname} → ${row.lastname}`);
        if (row.email && ex.email !== row.email)
          row.changes.push(`email: ${ex.email || "(none)"} → ${row.email}`);
        row.studentChange = row.changes.length ? "update" : "same";
      }
    }

    // --- Enrollment: one section per course ---
    const ek = `${row.studentId}|${row.courseId}`;
    const dup = seenEnroll.get(ek);
    if (dup) {
      if (dup.sectionId === row.sectionId) {
        row.action = "skip";
        row.messages.push(`duplicate of line ${dup.line}`);
      } else {
        row.action = "error";
        row.messages.push(
          `also listed in section ${dup.section} (line ${dup.line}); a student can only be in one section per course`
        );
      }
      return;
    }
    seenEnroll.set(ek, row);

    const existing = existingEnroll.get(ek);
    if (existing) {
      if (existing.sectionId === row.sectionId) {
        row.action = "skip";
        row.messages.push("already enrolled in this section");
      } else {
        row.action = "error";
        row.messages.push(
          `already enrolled in section ${existing.number} of this course (move them on the student page if intended)`
        );
      }
    }
  });

  const summary = {
    total: rows.length,
    enroll: rows.filter((r) => r.action === "enroll").length,
    skip: rows.filter((r) => r.action === "skip").length,
    error: rows.filter((r) => r.action === "error").length,
    newStudents: rows.filter(
      (r) => r.action !== "error" && r.studentChange === "new" && seenStudent.get(r.studentId) === r
    ).length,
    updatedStudents: rows.filter((r) => r.action !== "error" && r.studentChange === "update").length,
  };
  return { rows, summary };
}

/** Apply all non-error rows in a single transaction. Error rows are ignored. */
export async function commitCsv(text: string) {
  const analysis = await analyseCsv(text);
  const now = new Date();
  const applied = { students: 0, enrollments: 0 };

  dbClient.transaction((tx) => {
    const doneStudents = new Set<string>();
    for (const r of analysis.rows) {
      if (r.action === "error") continue;
      if (!doneStudents.has(r.studentId) && (r.studentChange === "new" || r.studentChange === "update")) {
        doneStudents.add(r.studentId);
        tx.insert(studentsTable)
          .values({
            id: r.studentId,
            firstname: r.firstname,
            lastname: r.lastname,
            email: r.email,
          })
          .onConflictDoUpdate({
            target: studentsTable.id,
            set: {
              firstname: r.firstname,
              lastname: r.lastname,
              ...(r.email ? { email: r.email } : {}),
              updatedAt: now,
            },
          })
          .run();
        applied.students++;
      }
      doneStudents.add(r.studentId);
      if (r.action === "enroll") {
        tx.insert(enrollmentsTable)
          .values({
            studentId: r.studentId,
            courseId: r.courseId!,
            sectionId: r.sectionId!,
          })
          .run();
        applied.enrollments++;
      }
    }
  });

  return { analysis, applied };
}
