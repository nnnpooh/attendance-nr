import { type Request, type Response, type NextFunction } from "express";

/** Only logged-in admins may use the attendance pages. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    if (req.get("HX-Request")) {
      res.setHeader("HX-Redirect", "/login");
      res.status(401).send("Please log in.");
    } else {
      res.redirect("/login");
    }
    return;
  }
  if (!req.user.isAdmin) {
    res.status(403).send("Not authorized: admin accounts only.");
    return;
  }
  next();
}
