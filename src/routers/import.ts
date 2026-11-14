import express from "express";
import multer from "multer";
import { requireAdmin } from "@src/auth/guards.js";
import { listCoursesWithSections } from "@db/repos/courses.js";
import { UserError } from "@db/repos/errors.js";
import { analyseCsv, commitCsv, CSV_HEADERS } from "@src/services/csvImport.js";
import { str } from "./helpers.js";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});
router.use("/import", requireAdmin);

router.get("/import", async (req, res) => {
  const courses = await listCoursesWithSections();
  res.render("pages/import", {
    title: "Import students",
    user: req.user,
    courses,
    headers: CSV_HEADERS,
  });
});

router.get("/import/template.csv", (req, res) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="students_template.csv"');
  res.send(
    "﻿" +
      CSV_HEADERS.join(",") +
      "\r\n259103-2568-1,001,650612345,Somchai,Jaidee\r\n"
  );
});

/** CSV text from either an uploaded file or the textarea. */
function csvText(req: express.Request) {
  const fromFile = req.file?.buffer?.toString("utf8") ?? "";
  const text = fromFile || str(req.body?.csv);
  if (!text) throw new UserError("Choose a CSV file or paste CSV text.");
  return text;
}

// Step 1: preview (no writes).
router.post("/import/preview", upload.single("file"), async (req, res) => {
  const text = csvText(req);
  const analysis = await analyseCsv(text);
  res.render("components/importPreview", { analysis, csv: text });
});

// Step 2: commit. Re-analyses the same text so the result matches the latest DB state.
router.post("/import/commit", async (req, res) => {
  const text = csvText(req);
  try {
    const { analysis, applied } = await commitCsv(text);
    res.render("components/importResult", { analysis, applied });
  } catch (e: any) {
    if (e instanceof UserError) throw e;
    throw new UserError(
      `Import failed and nothing was saved (${e?.message ?? e}). Run the preview again.`
    );
  }
});

export default router;
