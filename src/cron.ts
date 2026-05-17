import dotenv from "dotenv";
dotenv.config();

import {
  generateDailySummary,
  getTradesByBotAndRange,
  getTradesByBotAndDate,
  getPositionsByBotAndDate,
} from "./store";
import { notifyTokyoDaily, notifySwingDaily } from "./discord";

function tokyoSessionRange(date: string): { start: string; end: string } {
  // Tokyo session: previous day 6PM EST to current day 2AM EST
  const d = new Date(date + "T00:00:00-05:00");
  const prev = new Date(d);
  prev.setDate(prev.getDate() - 1);
  const start = prev.toISOString().split("T")[0] + "T23:00:00Z"; // 6PM EST = 11PM UTC
  const end = date + "T07:00:00Z"; // 2AM EST = 7AM UTC
  return { start, end };
}

export async function runTokyoSummary(date: string): Promise<boolean> {
  const range = tokyoSessionRange(date);
  const trades = await getTradesByBotAndRange("tokyobot", range.start, range.end);
  if (trades.length === 0) return false;

  const summary = await generateDailySummary("tokyobot", date, range);
  const netPnl = parseFloat(summary.net_pnl);

  const buyTrade = trades.find((t) => t.action === "BUY");
  const sellTrade = trades.find((t) => t.action === "SELL");

  let warning: string | undefined;
  if (buyTrade && !sellTrade) {
    warning = "LONG entry found with no matching SELL exit";
  } else if (sellTrade && !buyTrade) {
    warning = "SHORT entry found with no matching BUY exit";
  }

  await notifyTokyoDaily({
    date,
    entry: buyTrade ? { price: parseFloat(buyTrade.price), quantity: parseFloat(buyTrade.quantity) } : null,
    exit: sellTrade ? { price: parseFloat(sellTrade.price), quantity: parseFloat(sellTrade.quantity) } : null,
    pnl: netPnl,
    result: netPnl > 0 ? "WIN" : netPnl < 0 ? "LOSS" : "FLAT",
    warning,
  });

  return true;
}

export async function runSwingSummary(date: string): Promise<boolean> {
  const trades = await getTradesByBotAndDate("swingbot", date);
  const opened = await getPositionsByBotAndDate("swingbot", date, "opened");
  const closed = await getPositionsByBotAndDate("swingbot", date, "closed");
  const held = await getPositionsByBotAndDate("swingbot", date, "open");

  if (trades.length === 0 && held.length === 0) return false;

  await generateDailySummary("swingbot", date);

  let netRealizedPnl = 0;
  for (const p of closed) {
    netRealizedPnl += parseFloat(p.pnl ?? "0");
  }

  await notifySwingDaily({
    date,
    opened,
    closed,
    held,
    netRealizedPnl,
  });

  return true;
}

export async function handler(): Promise<void> {
  const today = new Date().toISOString().split("T")[0];

  console.log(`Running daily summary cron for ${today}`);

  const tokyoSent = await runTokyoSummary(today);
  console.log(`tokyobot: ${tokyoSent ? "summary sent" : "no trades, skipped"}`);

  const swingSent = await runSwingSummary(today);
  console.log(`swingbot: ${swingSent ? "summary sent" : "no activity, skipped"}`);
}
