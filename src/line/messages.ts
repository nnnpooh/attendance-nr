// All LINE reply texts in one place so they are easy to edit / translate.
import { fmtDateTime, fmtTime } from "@src/utils/time.js";

export const msg = {
  help: () =>
    [
      "คำสั่ง / Commands",
      "• REG:รหัสนักศึกษา — ลงทะเบียน (e.g. REG:650612345)",
      "• รหัส 6 หลักบนจอ — เช็คชื่อ (e.g. 482913 or CODE:482913)",
      "• INFO — ข้อมูลของฉัน / my info",
      "• RECORD — ประวัติการเช็คชื่อ / my check-ins",
    ].join("\n"),

  notRegistered: () =>
    "คุณยังไม่ได้ลงทะเบียน กรุณาพิมพ์ REG:รหัสนักศึกษา\nYou are not registered yet. Send REG:<student ID>.",

  // Registration
  regOk: (id: string, name: string) =>
    `ลงทะเบียนสำเร็จ ✅\nRegistered ${id} (${name}).`,
  regAlready: (id: string) =>
    `บัญชี LINE นี้ลงทะเบียนกับรหัส ${id} แล้ว\nThis LINE account is already registered as ${id}.`,
  regNoStudent: (id: string) =>
    `ไม่พบรหัส ${id} ในระบบ กรุณาติดต่ออาจารย์\nStudent ID ${id} is not in the class list. Please contact your instructor.`,
  regTaken: (id: string) =>
    `รหัส ${id} ถูกลงทะเบียนกับบัญชี LINE อื่นแล้ว กรุณาติดต่ออาจารย์\n${id} is already linked to another LINE account. Please contact your instructor.`,
  regBadFormat: () =>
    "รูปแบบไม่ถูกต้อง กรุณาพิมพ์ REG:รหัสนักศึกษา 9 หลัก\nFormat: REG:650612345",
  looksLikeId: () =>
    "ถ้าต้องการลงทะเบียน กรุณาพิมพ์ REG: นำหน้ารหัส\nTo register, send REG:<student ID>.",

  // Check-in
  checkinOk: (courseCode: string, section: string, at: Date) =>
    `เช็คชื่อสำเร็จ ✅\n${courseCode} ตอน ${section} @ ${fmtDateTime(at)}`,
  checkinDuplicate: (courseCode: string, section: string, at: Date) =>
    `คุณเช็คชื่อไปแล้ว\nAlready checked in: ${courseCode} sec ${section} @ ${fmtTime(at)}`,
  wrongSection: (courseCode: string, mySection: string) =>
    `⚠️ คุณลงทะเบียนวิชา ${courseCode} ตอน ${mySection} ไม่ใช่ตอนนี้ กรุณาเข้าเรียนให้ถูกตอน\nYou are enrolled in ${courseCode} sec ${mySection}, not this section.`,
  notInCourse: (courseCode: string) =>
    `⚠️ ไม่พบชื่อคุณในรายชื่อวิชา ${courseCode} กรุณาติดต่ออาจารย์\nYou are not on the ${courseCode} class list.`,
  invalidCode: () =>
    "Code ไม่ถูกต้องหรือหมดอายุแล้ว กรุณาส่งรหัสที่แสดงบนจอขณะนี้\nInvalid or expired code. Send the code currently on screen.",
  ambiguousCode: () =>
    "กรุณาส่งรหัสถัดไปที่แสดงบนจออีกครั้ง\nPlease send the next code shown on screen.",
  noOpenMeeting: () => "ไม่มีการเช็คชื่อในขณะนี้\nNo check-in is open right now.",
  tooManyAttempts: () =>
    "ส่งรหัสผิดหลายครั้งเกินไป กรุณารอสักครู่\nToo many wrong codes. Please wait a few minutes.",

  // Info / record
  info: (
    s: { id: string; firstname: string; lastname: string },
    enrollments: { code: string; section: string; year: number; semester: number }[]
  ) =>
    [
      `รหัส / ID: ${s.id}`,
      `ชื่อ / Name: ${s.firstname} ${s.lastname}`,
      enrollments.length
        ? "วิชา / Courses:\n" +
          enrollments
            .map((e) => `• ${e.code} ตอน ${e.section} (${e.semester}/${e.year})`)
            .join("\n")
        : "ยังไม่มีรายชื่อในวิชาใด / Not enrolled in any course",
    ]
      .filter(Boolean)
      .join("\n"),
  records: (rows: { code: string; section: string; checkedAt: Date }[]) =>
    rows.length
      ? "ประวัติการเช็คชื่อ (ล่าสุด)\n" +
        rows.map((r) => `• ${r.code}-${r.section} @ ${fmtDateTime(r.checkedAt)}`).join("\n")
      : "ไม่พบข้อมูลการเช็คชื่อ\nNo check-ins found.",
  unknown: () => "ไม่เข้าใจคำสั่ง\n\n" + msg.help(),
};
