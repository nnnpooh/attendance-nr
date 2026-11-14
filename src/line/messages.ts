// All LINE reply texts in one place so they are easy to edit.
import { fmtDateTime, fmtTime } from "@src/utils/time.js";

export const msg = {
  help: () =>
    [
      "Commands",
      "• reg <student ID> — register (e.g. reg 690612345)",
      "• 6-digit code on screen — check in (e.g. 482913)",
      "• info — my info",
      "• record — my check-ins",
    ].join("\n"),

  notRegistered: () => "You are not registered yet. Send reg <student ID> (e.g. reg 690612345).",

  // Registration
  regOk: (id: string, name: string) => `✅ Registered ${id} (${name}).`,
  regAlready: (id: string) => `This LINE account is already registered as ${id}.`,
  regNoStudent: (id: string) =>
    `${id} is not on any class list. Please contact your instructor.`,
  regTaken: (id: string) =>
    `${id} is already linked to another LINE account. Please contact your instructor.`,
  regBadFormat: () =>
    "Student ID must be 9 digits starting with 6 or 7 (e.g. reg 690612345).",
  looksLikeId: () => "To register, send reg <student ID> (e.g. reg 690612345).",

  // Check-in
  checkinOk: (courseCode: string, section: string, at: Date) =>
    `✅ Checked in: ${courseCode} sec ${section} @ ${fmtDateTime(at)}`,
  checkinDuplicate: (courseCode: string, section: string, at: Date) =>
    `Already checked in: ${courseCode} sec ${section} @ ${fmtTime(at)}`,
  wrongSection: (courseCode: string, mySection: string) =>
    `⚠️ You are enrolled in ${courseCode} sec ${mySection}, not this section.`,
  notInCourse: (courseCode: string) =>
    `⚠️ You are not on the ${courseCode} class list. Please contact your instructor.`,
  invalidCode: () => "Invalid or expired code. Send the code currently on screen.",
  ambiguousCode: () => "Please send the next code shown on screen.",
  noOpenMeeting: () => "No check-in is open right now.",
  tooManyAttempts: () => "Too many wrong codes. Please wait a few minutes.",

  // Info / record
  info: (
    s: { id: string; firstname: string; lastname: string },
    enrollments: { code: string; section: string; year: number; semester: number }[]
  ) =>
    [
      `ID: ${s.id}`,
      `Name: ${s.firstname} ${s.lastname}`,
      enrollments.length
        ? "Courses:\n" +
          enrollments
            .map((e) => `• ${e.code} sec ${e.section} (${e.semester}/${e.year})`)
            .join("\n")
        : "Not enrolled in any course.",
    ].join("\n"),
  records: (rows: { code: string; section: string; checkedAt: Date }[]) =>
    rows.length
      ? "Recent check-ins\n" +
        rows.map((r) => `• ${r.code} sec ${r.section} @ ${fmtDateTime(r.checkedAt)}`).join("\n")
      : "No check-ins found.",
  unknown: () => "Sorry, I didn't understand that.\n\n" + msg.help(),
};
