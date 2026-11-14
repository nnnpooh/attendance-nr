import { and, asc, desc, eq, gt, lte, sql } from "drizzle-orm";
import { dbClient } from "@db/client.js";
import { meetingsTable, checkinsTable, enrollmentsTable } from "@db/schema.js";
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
