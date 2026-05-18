import { pool } from "./db";
import { TradeEvent } from "./types";

async function getBotId(botName: string): Promise<number | null> {
  const result = await pool.query("SELECT id FROM bots WHERE name = $1", [botName]);
  return result.rows.length > 0 ? result.rows[0].id : null;
}

export async function insertTrade(trade: TradeEvent): Promise<{ tradeId: number; botDbId: number }> {
  const botDbId = await getBotId(trade.bot_id);
  if (!botDbId) throw new Error(`Unknown bot: ${trade.bot_id}`);

  const result = await pool.query(
    `INSERT INTO trades (bot_id, ticker, action, quantity, price, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [botDbId, trade.ticker, trade.action, trade.quantity, trade.price, trade.timestamp]
  );

  const tradeId = result.rows[0].id;

  if (trade.bot_id === "swingbot") {
    if (trade.action === "BUY") {
      await pool.query(
        `INSERT INTO positions (bot_id, ticker, entry_trade_id, entry_price, quantity, opened_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [botDbId, trade.ticker, tradeId, trade.price, trade.quantity, trade.timestamp]
      );
    } else if (trade.action === "SELL") {
      const openPos = await pool.query(
        `SELECT id, entry_price, quantity FROM positions
         WHERE bot_id = $1 AND ticker = $2 AND status = 'open'
         ORDER BY opened_at ASC LIMIT 1`,
        [botDbId, trade.ticker]
      );

      if (openPos.rows.length > 0) {
        const pos = openPos.rows[0];
        const pnl = (trade.price - parseFloat(pos.entry_price)) * trade.quantity;

        await pool.query(
          `UPDATE positions
           SET exit_trade_id = $1, exit_price = $2, pnl = $3, status = 'closed', closed_at = $4
           WHERE id = $5`,
          [tradeId, trade.price, pnl, trade.timestamp, pos.id]
        );

      }
    }
  }

  return { tradeId, botDbId };
}

export async function getSummaries(botName: string) {
  const botDbId = await getBotId(botName);
  if (!botDbId) return [];

  const result = await pool.query(
    `SELECT date, total_trades, wins, losses, net_pnl, summary_data
     FROM daily_summaries
     WHERE bot_id = $1
     ORDER BY date DESC`,
    [botDbId]
  );

  return result.rows;
}

export async function updateOpenPosition(
  botName: string,
  ticker: string,
  pnl: number
): Promise<object | null> {
  const botDbId = await getBotId(botName);
  if (!botDbId) return null;

  const result = await pool.query(
    `UPDATE positions SET pnl = $1
     WHERE bot_id = $2 AND ticker = $3 AND status = 'open'
     RETURNING id, ticker, entry_price, quantity, pnl, status, opened_at`,
    [pnl, botDbId, ticker]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

export async function getOpenPositions() {
  const result = await pool.query(
    `SELECT p.id, b.name AS bot_id, p.ticker, p.entry_price, p.quantity, p.pnl, p.status, p.opened_at
     FROM positions p
     JOIN bots b ON b.id = p.bot_id
     WHERE p.status = 'open'
     ORDER BY p.opened_at DESC`
  );

  return result.rows;
}

export async function getTradesByBotAndDate(botName: string, date: string) {
  const botDbId = await getBotId(botName);
  if (!botDbId) return [];

  const result = await pool.query(
    `SELECT action, quantity, price, timestamp FROM trades
     WHERE bot_id = $1 AND timestamp::date = $2
     ORDER BY timestamp ASC`,
    [botDbId, date]
  );
  return result.rows;
}

export async function getTradesByBotAndRange(botName: string, start: string, end: string) {
  const botDbId = await getBotId(botName);
  if (!botDbId) return [];

  const result = await pool.query(
    `SELECT action, quantity, price, timestamp FROM trades
     WHERE bot_id = $1 AND timestamp >= $2 AND timestamp < $3
     ORDER BY timestamp ASC`,
    [botDbId, start, end]
  );
  return result.rows;
}

export async function getPositionsByBotAndDate(botName: string, date: string, status?: string) {
  const botDbId = await getBotId(botName);
  if (!botDbId) return [];

  if (status === "opened") {
    const result = await pool.query(
      `SELECT ticker, entry_price, quantity, status, pnl, opened_at, closed_at, exit_price
       FROM positions WHERE bot_id = $1 AND opened_at::date = $2
       ORDER BY opened_at ASC`,
      [botDbId, date]
    );
    return result.rows;
  }

  if (status === "closed") {
    const result = await pool.query(
      `SELECT ticker, entry_price, quantity, status, pnl, opened_at, closed_at, exit_price
       FROM positions WHERE bot_id = $1 AND closed_at::date = $2 AND status = 'closed'
       ORDER BY closed_at ASC`,
      [botDbId, date]
    );
    return result.rows;
  }

  if (status === "open") {
    const result = await pool.query(
      `SELECT ticker, entry_price, quantity, status, pnl, opened_at, closed_at, exit_price
       FROM positions WHERE bot_id = $1 AND status = 'open'
       ORDER BY opened_at ASC`,
      [botDbId]
    );
    return result.rows;
  }

  return [];
}

export async function summaryExists(botName: string, date: string): Promise<boolean> {
  const botDbId = await getBotId(botName);
  if (!botDbId) return false;

  const result = await pool.query(
    `SELECT 1 FROM daily_summaries WHERE bot_id = $1 AND date = $2`,
    [botDbId, date]
  );
  return result.rows.length > 0;
}

export async function generateDailySummary(
  botName: string,
  date: string,
  range?: { start: string; end: string }
) {
  const botDbId = await getBotId(botName);
  if (!botDbId) throw new Error(`Unknown bot: ${botName}`);

  const tradesResult = range
    ? await pool.query(
        `SELECT action, quantity, price FROM trades
         WHERE bot_id = $1 AND timestamp >= $2 AND timestamp < $3`,
        [botDbId, range.start, range.end]
      )
    : await pool.query(
        `SELECT action, quantity, price FROM trades
         WHERE bot_id = $1 AND timestamp::date = $2`,
        [botDbId, date]
      );

  const trades = tradesResult.rows;
  const totalTrades = trades.length;

  const closedPositions = await pool.query(
    `SELECT pnl FROM positions
     WHERE bot_id = $1 AND closed_at::date = $2 AND status = 'closed'`,
    [botDbId, date]
  );

  let wins = 0;
  let losses = 0;
  let netPnl = 0;

  if (botName === "tokyobot" && trades.length === 2) {
    const entry = trades[0];
    const exit = trades[1];
    const entryPrice = parseFloat(entry.price);
    const exitPrice = parseFloat(exit.price);
    const qty = parseFloat(entry.quantity);

    const pnl = entry.action === "BUY"
      ? (exitPrice - entryPrice) * qty
      : (entryPrice - exitPrice) * qty;

    netPnl = pnl * 5;
    if (pnl > 0) wins = 1;
    else if (pnl < 0) losses = 1;
  } else {
    for (const pos of closedPositions.rows) {
      const pnl = parseFloat(pos.pnl);
      netPnl += pnl;
      if (pnl > 0) wins++;
      else if (pnl < 0) losses++;
    }
  }

  const summaryData = {
    trades: trades.map((t) => ({
      action: t.action,
      quantity: parseFloat(t.quantity),
      price: parseFloat(t.price),
    })),
  };

  const result = await pool.query(
    `INSERT INTO daily_summaries (bot_id, date, total_trades, wins, losses, net_pnl, summary_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (bot_id, date)
     DO UPDATE SET total_trades = $3, wins = $4, losses = $5, net_pnl = $6, summary_data = $7
     RETURNING *`,
    [botDbId, date, totalTrades, wins, losses, netPnl, JSON.stringify(summaryData)]
  );

  return result.rows[0];
}
