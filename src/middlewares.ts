import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import * as useragent from "express-useragent";
import { type Express } from "express";

export default function setupCommonMiddleWares(app: Express) {
  app.set("view engine", "pug");
  app.use(express.urlencoded({ extended: true }));
  app.use(
    express.json({
      // Keep the raw bytes: the LINE webhook signature is computed over them.
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = buf;
      },
    })
  );
  app.use(express.static("public"));
  app.use(morgan("dev", { immediate: true }));
  const scriptSources = ["'self'", "https://unpkg.com"];
  const styleSources = ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "fonts.googleapis.com"];
  const fontSources = ["'self'", "fonts.gstatic.com", "data:"];
  const connectSources = ["'self'"];
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          scriptSrc: scriptSources,
          scriptSrcElem: scriptSources,
          styleSrc: styleSources,
          fontSrc: fontSources,
          connectSrc: connectSources,
        },
        reportOnly: true,
      },
    })
  );
  app.use(
    cors({
      origin: false, // Disable CORS
      // origin: "*", // Allow all origins
    })
  );
  app.use(useragent.express());
}
