import { and, asc, desc, eq, gt, lte, sql } from "drizzle-orm";
import { dbClient } from "@db/client.js";
import {
  meetingsTable,
  checkinsTable,
  enrollmentsTable,
  sectionsTable,
  coursesTable,
} from "@db/schema.js";
import { courseKey } from "./courses.js";
import { newSecret } from "@src/utils/totp.js";
import { UserError } from "./errors.js";

export const MAX_MEETING_MINUTES = 6 * 60;

export async function createMeeting(
  sectionId: string,
  startsAt: Date,
  minutes: number,
  createdBy: string | null
) {
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_MEETING_MINUTES)
    throw new UserError(`Duration must be 1-${MAX_MEETING_MINUTES} minutes.`);
  const endsAt = new Date(startsAt.getTime() + minutes * 60_000);
  const [row] = await dbClient
    .insert(meetingsTable)
    .values({ sectionId, startsAt, endsAt, secret: newSecret(), createdBy })
    .returning();
  return row;
}

export async function getMeeting(id: string) {
  return dbClient.query.meetingsTable.findFirst({
    where: eq(meetingsTable.id, id),
    with: { section: { with: { course: true } } },
  });
}

export async function listMeetingsForSection(sectionId: string) {
  const rows = await dbClient
    .select({
      id: meetingsTable.id,
      startsAt: meetingsTable.startsAt,
      endsAt: meetingsTable.endsAt,
      checkinCount: sql<number>`(select count(*) from ${checkinsTable} where ${checkinsTable.meetingId} = ${meetingsTable.id})`,
    })
    .from(meetingsTable)
    .where(eq(meetingsTable.sectionId, sectionId))
    .orderBy(desc(meetingsTable.startsAt));
  return rows;
}

/** All meetings (newest first) with attendance counts, optionally for one course. */
export async function listMeetings(opts: { courseId?: string; limit?: number } = {}) {
  const rows = await dbClient
    .select({
      id: meetingsTable.id,
      startsAt: meetingsTable.startsAt,
      endsAt: meetingsTable.endsAt,
      sectionId: sectionsTable.id,
      sectionNumber: sectionsTable.number,
      courseId: coursesTable.id,
      code: coursesTable.code,
      name: coursesTable.name,
      year: coursesTable.year,
      semester: coursesTable.semester,
      checkinCount: sql<number>`(select count(*) from ${checkinsTable} where ${checkinsTable.meetingId} = ${meetingsTable.id})`,
      presentCount: sql<number>`(select count(*) from ${checkinsTable} c inner join ${enrollmentsTable} e on e.student_id = c.student_id and e.section_id = ${meetingsTable.sectionId} where c.meeting_id = ${meetingsTable.id})`,
      enrolledCount: sql<number>`(select count(*) from ${enrollmentsTable} where ${enrollmentsTable.sectionId} = ${meetingsTable.sectionId})`,
    })
    .from(meetingsTable)
    .innerJoin(sectionsTable, eq(sectionsTable.id, meetingsTable.sectionId))
    .innerJoin(coursesTable, eq(coursesTable.id, sectionsTable.courseId))
    .where(opts.courseId ? eq(coursesTable.id, opts.courseId) : undefined)
    .orderBy(desc(meetingsTable.startsAt))
    .limit(opts.limit ?? 300);
  return rows.map((r) => ({
    ...r,
    key: courseKey(r),
    otherCount: r.checkinCount - r.presentCount,
  }));
}

/** Section of the most recently created meeting (pre-selected in "New check-in"). */
export async function lastUsedSectionId() {
  const m = await dbClient.query.meetingsTable.findFirst({
    orderBy: [desc(meetingsTable.createdAt)],
  });
  return m?.sectionId;
}

export async function findOpenMeetingForSection(sectionId: string, now = new Date()) {
  return dbClient.query.meetingsTable.findFirst({
    where: and(
      eq(meetingsTable.sectionId, sectionId),
      lte(meetingsTable.startsAt, now),
      gt(meetingsTable.endsAt, now)
    ),
  });
}

/** Meetings currently accepting check-ins (startsAt <= now < endsAt). */
export async function listOpenMeetings(now = new Date()) {
  return dbClient.query.meetingsTable.findMany({
    where: and(lte(meetingsTable.startsAt, now), gt(meetingsTable.endsAt, now)),
    with: { section: { with: { course: true } } },
    orderBy: [asc(meetingsTable.startsAt)],
  });
}

export async function closeMeeting(id: string) {
  const m = await getMeeting(id);
  if (!m) throw new UserError("Meeting not found.");
  const now = new Date();
  if (m.endsAt > now)
    await dbClient
      .update(meetingsTable)
      .set({ endsAt: now < m.startsAt ? m.startsAt : now })
      .where(eq(meetingsTable.id, id));
}

/** Extend by `minutes` from max(now, endsAt). Also re-opens a closed meeting. */
export async function extendMeeting(id: string, minutes: number) {
  const m = await getMeeting(id);
  if (!m) throw new UserError("Meeting not found.");
  const base = Math.max(Date.now(), m.endsAt.getTime());
  const endsAt = new Date(base + minutes * 60_000);
  if (endsAt.getTime() - m.startsAt.getTime() > MAX_MEETING_MINUTES * 60_000)
    throw new UserError(`A meeting cannot be longer than ${MAX_MEETING_MINUTES} minutes.`);
  await dbClient
    .update(meetingsTable)
    .set({ endsAt })
    .where(eq(meetingsTable.id, id));
}

export async function deleteMeeting(id: string) {
  await dbClient.delete(meetingsTable).where(eq(meetingsTable.id, id));
}

/** Check-in counts for the projector: enrolled in the meeting's section vs. everyone else. */
export async function countCheckins(meetingId: string, sectionId: string) {
  const [row] = await dbClient
    .select({
      total: sql<number>`count(*)`,
      enrolled: sql<number>`coalesce(sum(case when ${enrollmentsTable.sectionId} = ${sectionId} then 1 else 0 end), 0)`,
    })
    .from(checkinsTable)
    .leftJoin(
      enrollmentsTable,
      and(
        eq(enrollmentsTable.studentId, checkinsTable.studentId),
        eq(enrollmentsTable.sectionId, sectionId)
      )
    )
    .where(eq(checkinsTable.meetingId, meetingId));
  return { enrolled: row.enrolled, others: row.total - row.enrolled };
}
