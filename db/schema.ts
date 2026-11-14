import {
  text,
  integer,
  sqliteTable,
  primaryKey,
  unique,
  index,
  foreignKey,
} from "drizzle-orm/sqlite-core";
import { nanoid } from "nanoid";
import { relations } from "drizzle-orm";

export const usersTable = sqliteTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  name: text("name"),
  email: text("email").unique().notNull(),
  password: text("password"), // I remove not null options.
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  avatarURL: text("avatar_url"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$default(
    () => new Date()
  ),
});

export const usersRelations = relations(usersTable, ({ many }) => ({
  accounts: many(accountsTable),
}));

export type ProviderType = "GITHUB" | "DISCORD" | "GOOGLE";

export const accountsTable = sqliteTable(
  "accounts",
  {
    id: text("id")
      .$defaultFn(() => nanoid())
      .notNull()
      .unique(),
    userId: text("user_id").notNull(),
    provider: text("provider", {
      enum: ["GITHUB", "DISCORD", "GOOGLE"],
    }).notNull(),
    providerAccountId: text("provider_account").notNull(),
    profile: text("profile", { mode: "json" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
  },
  // I add composite key so that each user can have only one provider type.
  (table) => {
    return {
      id: primaryKey({ columns: [table.userId, table.provider] }),
    };
  }
);

export const accountsRelations = relations(accountsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [accountsTable.userId],
    references: [usersTable.id],
  }),
}));

export const sessionsTable = sqliteTable("sessions", {
  sid: text("sid").primaryKey(),
  expired: integer("expired"),
  sess: text("sess", { mode: "json" }),
});

// For constructing user-data object to pass around
type UTI = typeof usersTable.$inferInsert;
type ATI = typeof accountsTable.$inferInsert;
export type UserData = UTI & ATI;

// ============================================================
// Attendance
// ============================================================

// A course offering in one semester, e.g. 259103 / 2568 / 1.
// Its "key" (used in CSV import) is `${code}-${year}-${semester}`.
export const coursesTable = sqliteTable(
  "courses",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    code: text("code").notNull(),
    name: text("name").notNull().default(""),
    year: integer("year").notNull(),
    semester: integer("semester").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$default(() => new Date()),
  },
  (t) => [unique("courses_code_year_semester").on(t.code, t.year, t.semester)]
);

export const sectionsTable = sqliteTable(
  "sections",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    courseId: text("course_id")
      .notNull()
      .references(() => coursesTable.id, { onDelete: "cascade" }),
    number: text("number").notNull(), // "001"
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$default(() => new Date()),
  },
  (t) => [
    unique("sections_course_number").on(t.courseId, t.number),
    // Target of the composite FK in enrollments (keeps course_id honest).
    unique("sections_id_course").on(t.id, t.courseId),
  ]
);

// Global student directory. id = CMU student ID.
export const studentsTable = sqliteTable("students", {
  id: text("id").primaryKey(),
  firstname: text("firstname").notNull(),
  lastname: text("lastname").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$default(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$default(() => new Date()),
});

// LINE user <-> student. One-to-one in both directions.
export const lineAccountsTable = sqliteTable("line_accounts", {
  lineUserId: text("line_user_id").primaryKey(),
  studentId: text("student_id")
    .notNull()
    .unique()
    .references(() => studentsTable.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
  linkedAt: integer("linked_at", { mode: "timestamp_ms" })
    .notNull()
    .$default(() => new Date()),
});

// A student is in at most ONE section per course:
//   PK(student_id, course_id) enforces it, and the composite FK
//   (section_id, course_id) -> sections(id, course_id) guarantees that
//   course_id really is the section's course.
export const enrollmentsTable = sqliteTable(
  "enrollments",
  {
    studentId: text("student_id")
      .notNull()
      .references(() => studentsTable.id, { onDelete: "cascade" }),
    courseId: text("course_id").notNull(),
    sectionId: text("section_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$default(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.studentId, t.courseId] }),
    foreignKey({
      name: "enrollments_section_course_fk",
      columns: [t.sectionId, t.courseId],
      foreignColumns: [sectionsTable.id, sectionsTable.courseId],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    index("enrollments_section_idx").on(t.sectionId),
  ]
);

// One class meeting of one section. Check-in is open in [startsAt, endsAt).
export const meetingsTable = sqliteTable(
  "meetings",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    sectionId: text("section_id")
      .notNull()
      .references(() => sectionsTable.id, { onDelete: "cascade" }),
    startsAt: integer("starts_at", { mode: "timestamp_ms" }).notNull(),
    endsAt: integer("ends_at", { mode: "timestamp_ms" }).notNull(),
    secret: text("secret").notNull(), // TOTP secret (hex)
    createdBy: text("created_by"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$default(() => new Date()),
  },
  (t) => [
    index("meetings_section_idx").on(t.sectionId),
    index("meetings_window_idx").on(t.startsAt, t.endsAt),
  ]
);

export type CheckinMethod = "LINE" | "MANUAL";

export const checkinsTable = sqliteTable(
  "checkins",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    meetingId: text("meeting_id")
      .notNull()
      .references(() => meetingsTable.id, { onDelete: "cascade" }),
    studentId: text("student_id")
      .notNull()
      .references(() => studentsTable.id, { onDelete: "cascade" }),
    checkedAt: integer("checked_at", { mode: "timestamp_ms" }).notNull(),
    method: text("method", { enum: ["LINE", "MANUAL"] }).notNull(),
    reason: text("reason"),
    recordedBy: text("recorded_by"), // users.id for MANUAL
    lineUserId: text("line_user_id"), // for LINE
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$default(() => new Date()),
  },
  (t) => [
    unique("checkins_meeting_student").on(t.meetingId, t.studentId),
    index("checkins_student_idx").on(t.studentId),
  ]
);

export const coursesRelations = relations(coursesTable, ({ many }) => ({
  sections: many(sectionsTable),
}));

export const sectionsRelations = relations(sectionsTable, ({ one, many }) => ({
  course: one(coursesTable, {
    fields: [sectionsTable.courseId],
    references: [coursesTable.id],
  }),
  enrollments: many(enrollmentsTable),
  meetings: many(meetingsTable),
}));

export const studentsRelations = relations(studentsTable, ({ one, many }) => ({
  lineAccount: one(lineAccountsTable, {
    fields: [studentsTable.id],
    references: [lineAccountsTable.studentId],
  }),
  enrollments: many(enrollmentsTable),
  checkins: many(checkinsTable),
}));

export const lineAccountsRelations = relations(
  lineAccountsTable,
  ({ one }) => ({
    student: one(studentsTable, {
      fields: [lineAccountsTable.studentId],
      references: [studentsTable.id],
    }),
  })
);

export const enrollmentsRelations = relations(enrollmentsTable, ({ one }) => ({
  student: one(studentsTable, {
    fields: [enrollmentsTable.studentId],
    references: [studentsTable.id],
  }),
  course: one(coursesTable, {
    fields: [enrollmentsTable.courseId],
    references: [coursesTable.id],
  }),
  section: one(sectionsTable, {
    fields: [enrollmentsTable.sectionId],
    references: [sectionsTable.id],
  }),
}));

export const meetingsRelations = relations(meetingsTable, ({ one, many }) => ({
  section: one(sectionsTable, {
    fields: [meetingsTable.sectionId],
    references: [sectionsTable.id],
  }),
  checkins: many(checkinsTable),
}));

export const checkinsRelations = relations(checkinsTable, ({ one }) => ({
  meeting: one(meetingsTable, {
    fields: [checkinsTable.meetingId],
    references: [meetingsTable.id],
  }),
  student: one(studentsTable, {
    fields: [checkinsTable.studentId],
    references: [studentsTable.id],
  }),
}));

export type Course = typeof coursesTable.$inferSelect;
export type Section = typeof sectionsTable.$inferSelect;
export type Student = typeof studentsTable.$inferSelect;
export type Meeting = typeof meetingsTable.$inferSelect;
export type Checkin = typeof checkinsTable.$inferSelect;
