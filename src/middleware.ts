import { Request, Response, NextFunction } from "express";

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    next();
    return;
  }

  const provided = req.headers["x-api-key"];
  if (!provided || provided !== apiKey) {
    res.status(401).json({ error: "Unauthorized: invalid or missing API key" });
    return;
  }

  next();
}
