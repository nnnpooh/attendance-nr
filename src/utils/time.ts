import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

// All timestamps are stored as UTC ms; everything shown to humans is in this zone.
export const TZ = "Asia/Bangkok";

export function fmt(date: Date | number | null | undefined, pattern: string) {
  if (date === null || date === undefined) return "";
  return dayjs(date).tz(TZ).format(pattern);
}

export const fmtDateTime = (d: Date | number | null | undefined) =>
  fmt(d, "DD/MM/YYYY HH:mm");
export const fmtDate = (d: Date | number | null | undefined) =>
  fmt(d, "ddd DD MMM");
export const fmtTime = (d: Date | number | null | undefined) =>
  fmt(d, "HH:mm");

/** Value for <input type="datetime-local"> in Bangkok time. */
export const toLocalInput = (d: Date | number) => fmt(d, "YYYY-MM-DDTHH:mm");

/** Parse a <input type="datetime-local"> value as Bangkok time. */
export function fromLocalInput(value: string): Date | null {
  if (!value) return null;
  const d = dayjs.tz(value, TZ);
  return d.isValid() ? d.toDate() : null;
}
