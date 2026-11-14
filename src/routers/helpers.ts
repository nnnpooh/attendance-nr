import { type Response } from "express";

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
