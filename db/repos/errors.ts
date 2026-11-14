/** True if `e` (or a wrapped cause) is a SQLite UNIQUE / PRIMARY KEY violation. */
export function isUniqueViolation(e: unknown): boolean {
  let cur: any = e;
  for (let i = 0; i < 3 && cur; i++) {
    const code = cur?.code ?? "";
    if (
      code === "SQLITE_CONSTRAINT_UNIQUE" ||
      code === "SQLITE_CONSTRAINT_PRIMARYKEY"
    ) {
      return true;
    }
    cur = cur.cause;
  }
  return false;
}

/** Error whose message is safe to show to the admin (rendered as a 400). */
export class UserError extends Error {
  status = 400;
}
