import { Router, Request, Response } from "express";
import { TradeEvent } from "./types";
import { insertTrade, getSummaries, getOpenPositions, updateOpenPosition } from "./store";
import { runTokyoSummary, runSwingSummary } from "./cron";

const router = Router();

const VALID_ACTIONS = ["BUY", "SELL"];

function validateTrade(body: unknown): { valid: true; trade: TradeEvent } | { valid: false; error: string } {
  const b = body as Record<string, unknown>;

  if (!b || typeof b !== "object") {
    return { valid: false, error: "Request body must be a JSON object" };
  }
  if (typeof b.bot_id !== "string" || b.bot_id.length === 0) {
    return { valid: false, error: "bot_id is required and must be a non-empty string" };
  }
  if (typeof b.ticker !== "string" || b.ticker.length === 0) {
    return { valid: false, error: "ticker is required and must be a non-empty string" };
  }
  if (typeof b.action !== "string" || !VALID_ACTIONS.includes(b.action)) {
    return { valid: false, error: `action must be one of: ${VALID_ACTIONS.join(", ")}` };
  }
  if (typeof b.quantity !== "number" || b.quantity <= 0 || !Number.isFinite(b.quantity)) {
    return { valid: false, error: "quantity must be a positive number" };
  }
  if (typeof b.price !== "number" || b.price <= 0 || !Number.isFinite(b.price)) {
    return { valid: false, error: "price must be a positive number" };
  }
  if (typeof b.timestamp !== "string" || isNaN(Date.parse(b.timestamp))) {
    return { valid: false, error: "timestamp is required and must be a valid ISO 8601 date string" };
  }
  if (b.pnl !== undefined && (typeof b.pnl !== "number" || !Number.isFinite(b.pnl))) {
    return { valid: false, error: "pnl must be a number when provided" };
  }

  return {
    valid: true,
    trade: {
      bot_id: b.bot_id as string,
      ticker: (b.ticker as string).toUpperCase(),
      action: b.action as "BUY" | "SELL",
      quantity: b.quantity as number,
      price: b.price as number,
      timestamp: b.timestamp as string,
      ...(b.pnl !== undefined && { pnl: b.pnl as number }),
    },
  };
}

// POST /trades
router.post("/trades", async (req: Request, res: Response) => {
  const result = validateTrade(req.body);

  if (!result.valid) {
    res.status(400).json({ error: result.error });
    return;
  }

  try {
    const { tradeId } = await insertTrade(result.trade);
    res.status(201).json({ message: "Trade logged", id: tradeId, trade: result.trade });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = message.startsWith("Unknown bot") ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

// GET /summary/:bot_id
router.get("/summary/:bot_id", async (req: Request<{ bot_id: string }>, res: Response) => {
  const { bot_id } = req.params;

  try {
    const summaries = await getSummaries(bot_id);
    res.json({ bot_id, count: summaries.length, summaries });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ error: message });
  }
});

// GET /positions
router.get("/positions", async (_req: Request, res: Response) => {
  try {
    const positions = await getOpenPositions();
    res.json({ count: positions.length, positions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ error: message });
  }
});

// PATCH /positions/update
router.patch("/positions/update", async (req: Request, res: Response) => {
  const { bot_id, ticker, pnl } = req.body;

  if (typeof bot_id !== "string" || bot_id.length === 0) {
    res.status(400).json({ error: "bot_id is required" });
    return;
  }
  if (typeof ticker !== "string" || ticker.length === 0) {
    res.status(400).json({ error: "ticker is required" });
    return;
  }
  if (typeof pnl !== "number" || !Number.isFinite(pnl)) {
    res.status(400).json({ error: "pnl must be a finite number" });
    return;
  }

  try {
    const position = await updateOpenPosition(bot_id, ticker, pnl);
    if (!position) {
      res.status(404).json({ error: "No open position found for that bot and ticker" });
      return;
    }
    res.json({ message: "Position updated", position });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ error: message });
  }
});

// POST /summary/generate/:bot_id (dev only)
if (process.env.NODE_ENV === "development") {
  router.post("/summary/generate/:bot_id", async (req: Request<{ bot_id: string }>, res: Response) => {
    const { bot_id } = req.params;
    const today = new Date().toISOString().split("T")[0];

    try {
      let sent = false;
      if (bot_id === "tokyobot") sent = await runTokyoSummary(today);
      else if (bot_id === "swingbot") sent = await runSwingSummary(today);
      else {
        res.status(400).json({ error: `Unknown bot: ${bot_id}` });
        return;
      }

      res.status(201).json({ message: sent ? "Summary generated and sent to Discord" : "No activity, skipped" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error";
      res.status(500).json({ error: message });
    }
  });
}

export default router;
