import Debug from "debug";
import {
  getLineAccount,
  linkLineAccount,
  listEnrollmentsForStudent,
  STUDENT_ID_RE,
} from "@db/repos/students.js";
import { listCheckinsForStudent } from "@db/repos/checkins.js";
import { checkInWithCode } from "@src/services/checkin.js";
import { CODE_DIGITS } from "@src/utils/totp.js";
import { getDisplayName, replyText } from "./client.js";
import { msg } from "./messages.js";

const debug = Debug("fs-auth:line");

// ---------- command parsing ----------

export type Command =
  | { type: "register"; studentId: string }
  | { type: "register-bad" }
  | { type: "checkin"; code: string }
  | { type: "info" }
  | { type: "record" }
  | { type: "help" }
  | { type: "ignore" }
  | { type: "bare-id" }
  | { type: "unknown" };

export function parseCommand(raw: string): Command {
  // Normalise: full-width colon -> ':', trim.
  const text = raw
    .replace(/：/g, ":")
    .trim();

  if (text.startsWith(">>")) return { type: "ignore" };

  const reg = /^REG\s*:?\s*(\S*)$/i.exec(text);
  if (reg) {
    return STUDENT_ID_RE.test(reg[1])
      ? { type: "register", studentId: reg[1] }
      : { type: "register-bad" };
  }

  // The projector shows "482 913", so ignore whitespace: "482913", "482 913", "CODE: 482 913".
  const code = new RegExp(`^(?:CODE:?)?(\\d{${CODE_DIGITS}})$`, "i").exec(
    text.replace(/\s+/g, "")
  );
  if (code) return { type: "checkin", code: code[1] };

  if (/^(INFO|CMUID|ME)$/i.test(text)) return { type: "info" };
  if (/^(RECORD|RECORDS|HISTORY)$/i.test(text)) return { type: "record" };
  if (/^(HELP|\?|ช่วยเหลือ)$/i.test(text)) return { type: "help" };
  if (STUDENT_ID_RE.test(text)) return { type: "bare-id" };
  return { type: "unknown" };
}

// ---------- brute-force guard: wrong codes per LINE user ----------

const FAIL_WINDOW_MS = 10 * 60_000;
const FAIL_LIMIT = 10;
const failures = new Map<string, number[]>();

function recentFailures(userId: string, now: number) {
  const list = (failures.get(userId) ?? []).filter((t) => now - t < FAIL_WINDOW_MS);
  failures.set(userId, list);
  return list;
}

// ---------- event handling ----------

type LineEvent = {
  type: string;
  timestamp: number;
  replyToken?: string;
  source?: { type: string; userId?: string };
  message?: { type: string; text?: string };
};

export async function handleEvent(event: LineEvent) {
  const userId = event.source?.userId;
  const replyToken = event.replyToken;
  if (!userId || !replyToken) return;

  if (event.type === "follow") {
    await replyText(replyToken, msg.help());
    return;
  }
  if (event.type !== "message" || event.message?.type !== "text") return;

  const cmd = parseCommand(event.message.text ?? "");
  // Use the time the student sent the message (signed by LINE), never a future time.
  const at = new Date(Math.min(event.timestamp || Date.now(), Date.now()));
  const reply = await respond(cmd, userId, at);
  if (reply) await replyText(replyToken, reply);
}

async function respond(cmd: Command, userId: string, at: Date): Promise<string | null> {
  switch (cmd.type) {
    case "ignore":
      return null;
    case "help":
      return msg.help();
    case "register-bad":
      return msg.regBadFormat();
    case "bare-id":
      return msg.looksLikeId();
    case "unknown":
      return msg.unknown();
    case "register": {
      const displayName = await getDisplayName(userId);
      const r = await linkLineAccount(userId, cmd.studentId, displayName);
      debug("register %s -> %s: %s", userId, cmd.studentId, r.status);
      switch (r.status) {
        case "linked": {
          const acct = await getLineAccount(userId);
          const s = acct?.student;
          return msg.regOk(cmd.studentId, s ? `${s.firstname} ${s.lastname}` : "");
        }
        case "line-already-linked":
          return msg.regAlready(r.studentId);
        case "no-student":
          return msg.regNoStudent(cmd.studentId);
        case "student-taken":
          return msg.regTaken(cmd.studentId);
      }
    }
  }

  // Everything below needs a registered student.
  const acct = await getLineAccount(userId);
  if (!acct) return msg.notRegistered();
  const student = acct.student;

  switch (cmd.type) {
    case "info":
      return msg.info(student, await listEnrollmentsForStudent(student.id));
    case "record": {
      const rows = await listCheckinsForStudent(student.id, 15);
      return msg.records(rows.map((r) => ({ code: r.code, section: r.section, checkedAt: r.checkedAt })));
    }
    case "checkin": {
      const now = Date.now();
      if (recentFailures(userId, now).length >= FAIL_LIMIT) return msg.tooManyAttempts();
      const r = await checkInWithCode(student.id, cmd.code, at, userId);
      debug("checkin %s code=%s: %s", student.id, cmd.code, r.status);
      switch (r.status) {
        case "no-open-meeting":
          return msg.noOpenMeeting();
        case "invalid-code":
          failures.get(userId)!.push(now);
          return msg.invalidCode();
        case "ambiguous":
          return msg.ambiguousCode();
        case "ok":
        case "duplicate": {
          const head =
            r.status === "ok"
              ? msg.checkinOk(r.courseCode, r.sectionNumber, r.checkedAt)
              : msg.checkinDuplicate(r.courseCode, r.sectionNumber, r.checkedAt);
          if (r.enrollment === "this-section") return head;
          const warn =
            r.enrollment === "not-in-course"
              ? msg.notInCourse(r.courseCode)
              : msg.wrongSection(r.courseCode, r.enrollment.otherSection);
          return `${head}\n\n${warn}`;
        }
      }
    }
  }
  return null;
}
