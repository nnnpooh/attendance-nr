import { type Request, type Response } from "express";

/**
 * After a delete: if the htmx request came from the deleted item's own page,
 * go to `fallback`; otherwise (e.g. from a list) just reload the current page.
 */
export function hxAfterDelete(req: Request, res: Response, itemPathPrefix: string, fallback: string) {
  let current = "";
  try {
    current = new URL(req.get("HX-Current-URL") ?? "").pathname;
  } catch {}
  if (current.startsWith(itemPathPrefix)) hxRedirect(res, fallback);
  else hxRefresh(res);
}

export function hxRedirect(res: Response, url: string) {
  res.setHeader("HX-Redirect", url);
  res.send("<div></div>");
}

export function hxRefresh(res: Response) {
  res.setHeader("HX-Refresh", "true");
  res.send("<div></div>");
}

export function notFound(res: Response, what = "Not found") {
  res.status(404).send(what);
}

/** Read a string form/query field. */
export function str(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}
