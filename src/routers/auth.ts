import "dotenv/config";
import Debug from "debug";
import express from "express";
import { setSessionInfoAfterLogin } from "../auth/session.js";
import passportIns from "../auth/passport.js";
import { deleteSession } from "@db/repositories.js";

const router = express.Router();
const debug = Debug("fs-auth");

router.get("/login", function (req, res) {
  res.render("pages/login", {
    title: "Login",
  });
});

router.post("/login", passportIns.authenticate("local"), function (req, res) {
  debug("@login handler");
  setSessionInfoAfterLogin(req, "CREDENTIAL");
  res.setHeader("HX-Redirect", "/");
  res.send(`<div></div>`);
});

router.post("/logout", function (req, res, next) {
  // req.logout will not delete the session in db. It will generate new one for the already-logout user.
  // When the user login again, it will generate new session with the user id.
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    // If you want to delete the session in DB, you can use this function.
    req.session.destroy(function (err) {
      if (err) {
        return next(err);
      }
      res.setHeader("HX-Redirect", "/");
      res.send("<div></div>");
    });
  });
});

router.delete("/session", async function (req, res, next) {
  const sid = (req?.query?.sid ?? "") as string;
  const request = await deleteSession(sid);
  res.setHeader("HX-Redirect", "/account");
  res.send(`<div></div>`);
});

export default router;
