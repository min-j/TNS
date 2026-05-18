import { pool } from "./db";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Clear existing data (order matters for FK constraints)
    await client.query("DELETE FROM daily_summaries");
    await client.query("DELETE FROM positions");
    await client.query("DELETE FROM trades");

    // Get bot IDs
    const tokyoBot = await client.query("SELECT id FROM bots WHERE name = 'tokyobot'");
    const swingBot = await client.query("SELECT id FROM bots WHERE name = 'swingbot'");

    if (tokyoBot.rows.length === 0 || swingBot.rows.length === 0) {
      throw new Error("Bots not found. Run migrate first.");
    }

    const tokyoId = tokyoBot.rows[0].id;
    const swingId = swingBot.rows[0].id;

    // --- Tokyo bot trades ---
    // Session window: previous day 6PM EST (23:00 UTC) to current day 2AM EST (07:00 UTC)
    // BUY at ~7PM EST (00:00 UTC), SELL at ~1AM EST (06:00 UTC)

    const day1 = daysAgo(4); // 4 days ago
    const day2 = daysAgo(3); // 3 days ago
    const day3 = daysAgo(2); // 2 days ago
    // day4 = daysAgo(1) — no trades
    const day5 = daysAgo(0); // today (last night's session)

    // Day 1: BUY $100, SELL $110 → win +$50 (with $5 multiplier)
    await client.query(
      `INSERT INTO trades (bot_id, ticker, action, quantity, price, timestamp)
       VALUES ($1, 'ES', 'BUY', 1, 100, $2),
              ($1, 'ES', 'SELL', 1, 110, $3)`,
      [tokyoId, `${day1}T00:00:00Z`, `${day1}T06:00:00Z`]
    );

    // Day 2: BUY $100, SELL $90 → loss -$50
    await client.query(
      `INSERT INTO trades (bot_id, ticker, action, quantity, price, timestamp)
       VALUES ($1, 'ES', 'BUY', 1, 100, $2),
              ($1, 'ES', 'SELL', 1, 90, $3)`,
      [tokyoId, `${day2}T00:00:00Z`, `${day2}T06:00:00Z`]
    );

    // Day 3: BUY $50, SELL $75 → win +$125
    await client.query(
      `INSERT INTO trades (bot_id, ticker, action, quantity, price, timestamp)
       VALUES ($1, 'ES', 'BUY', 1, 50, $2),
              ($1, 'ES', 'SELL', 1, 75, $3)`,
      [tokyoId, `${day3}T00:00:00Z`, `${day3}T06:00:00Z`]
    );

    // Day 4: no trades (yesterday)

    // Day 5: BUY $200, SELL $180 → loss -$100 (last night's session)
    await client.query(
      `INSERT INTO trades (bot_id, ticker, action, quantity, price, timestamp)
       VALUES ($1, 'ES', 'BUY', 1, 200, $2),
              ($1, 'ES', 'SELL', 1, 180, $3)`,
      [tokyoId, `${day5}T00:00:00Z`, `${day5}T06:00:00Z`]
    );

    // --- Swing bot trades ---

    const swingOpenDate = daysAgo(7);  // opened 7 days ago
    const swingCloseDate = daysAgo(2); // closed 2 days ago (5 days held)
    const swingHeldDate = daysAgo(3);  // opened 3 days ago, still open

    // Position 1: BUY $100, SELL $150 five days later → closed, +$50
    const swingBuy1 = await client.query(
      `INSERT INTO trades (bot_id, ticker, action, quantity, price, timestamp)
       VALUES ($1, 'ES', 'BUY', 1, 100, $2)
       RETURNING id`,
      [swingId, `${swingOpenDate}T14:00:00Z`]
    );
    const swingSell1 = await client.query(
      `INSERT INTO trades (bot_id, ticker, action, quantity, price, timestamp)
       VALUES ($1, 'ES', 'SELL', 1, 150, $2)
       RETURNING id`,
      [swingId, `${swingCloseDate}T14:00:00Z`]
    );
    await client.query(
      `INSERT INTO positions (bot_id, ticker, entry_trade_id, exit_trade_id, entry_price, exit_price, quantity, pnl, status, opened_at, closed_at)
       VALUES ($1, 'ES', $2, $3, 100, 150, 1, 50, 'closed', $4, $5)`,
      [swingId, swingBuy1.rows[0].id, swingSell1.rows[0].id, `${swingOpenDate}T14:00:00Z`, `${swingCloseDate}T14:00:00Z`]
    );

    // Position 2: BUY $200 three days ago, still open
    const swingBuy2 = await client.query(
      `INSERT INTO trades (bot_id, ticker, action, quantity, price, timestamp)
       VALUES ($1, 'ES', 'BUY', 1, 200, $2)
       RETURNING id`,
      [swingId, `${swingHeldDate}T14:00:00Z`]
    );
    await client.query(
      `INSERT INTO positions (bot_id, ticker, entry_trade_id, entry_price, quantity, status, opened_at)
       VALUES ($1, 'ES', $2, 200, 1, 'open', $3)`,
      [swingId, swingBuy2.rows[0].id, `${swingHeldDate}T14:00:00Z`]
    );

    await client.query("COMMIT");

    console.log("Seed data inserted successfully.");
    console.log(`  Tokyo bot: days ${day1}, ${day2}, ${day3}, (skip ${daysAgo(1)}), ${day5}`);
    console.log(`  Swing bot: closed position (${swingOpenDate} → ${swingCloseDate}), open position (${swingHeldDate})`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
