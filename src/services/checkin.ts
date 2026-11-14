import { listOpenMeetings } from "@db/repos/meetings.js";
import { insertCheckin } from "@db/repos/checkins.js";
import { getEnrollmentInCourse } from "@db/repos/students.js";
import { courseKey } from "@db/repos/courses.js";
import { verifyCode } from "@src/utils/totp.js";

export type CodeCheckinResult =
  | { status: "no-open-meeting" }
  | { status: "invalid-code" }
  | { status: "ambiguous" }
  | {
      status: "ok" | "duplicate";
      checkedAt: Date;
      courseCode: string;
      courseKey: string;
      sectionNumber: string;
      /** Where the student is actually enrolled in this course. */
      enrollment: "this-section" | "not-in-course" | { otherSection: string };
    };

/**
 * Check a student in with a rotating code. The code identifies the meeting:
 * we compute the valid codes of every open meeting and look for a match.
 * Check-ins are always recorded, even for the wrong section; the result tells
 * the caller so the student can be warned.
 */
export async function checkInWithCode(
  studentId: string,
  code: string,
  at: Date,
  lineUserId: string | null
): Promise<CodeCheckinResult> {
  const open = await listOpenMeetings(at);
  if (open.length === 0) return { status: "no-open-meeting" };

  const matches = open.filter((m) => verifyCode(m.secret, code, at.getTime()));
  if (matches.length === 0) return { status: "invalid-code" };
  // Two simultaneous meetings showing the same 6 digits: ~1 in a million. Ask for the next code.
  if (matches.length > 1) return { status: "ambiguous" };

  const meeting = matches[0];
  const result = await insertCheckin({
    meetingId: meeting.id,
    studentId,
    checkedAt: at,
    method: "LINE",
    lineUserId,
  });

  const course = meeting.section.course;
  const enr = await getEnrollmentInCourse(studentId, course.id);
  const enrollment = !enr
    ? ("not-in-course" as const)
    : enr.sectionId === meeting.sectionId
      ? ("this-section" as const)
      : { otherSection: enr.sectionNumber };

  return {
    status: result.ok ? "ok" : "duplicate",
    checkedAt: result.ok ? result.checkin.checkedAt : result.existing.checkedAt,
    courseCode: course.code,
    courseKey: courseKey(course),
    sectionNumber: meeting.section.number,
    enrollment,
  };
}
