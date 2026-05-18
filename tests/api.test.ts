import request from "supertest";
import app from "../src/app";
import { pool } from "../src/db";

const API_KEY = process.env.API_KEY || "";

const headers = { "x-api-key": API_KEY, "Content-Type": "application/json" };

const today = new Date().toISOString().split("T")[0];

function makeTrade(overrides: Record<string, unknown> = {}) {
  return {
    bot_id: "tokyobot",
    ticker: "TEST",
    action: "BUY",
    quantity: 1,
    price: 100,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// Clean up all test data after the full suite
afterAll(async () => {
  await pool.query("DELETE FROM daily_summaries WHERE bot_id IN (SELECT id FROM bots)");
  await pool.query("DELETE FROM positions WHERE ticker IN ('TEST', 'TEST2', 'TEST3')");
  await pool.query("DELETE FROM trades WHERE ticker IN ('TEST', 'TEST2', 'TEST3')");
  await pool.end();
});

// ─── Payload Validation ───

describe("Payload validation", () => {
  it("POST /trades with valid payload returns 201", async () => {
    const res = await request(app)
      .post("/trades")
      .set(headers)
      .send(makeTrade());

    expect(res.status).toBe(201);
    expect(res.body.message).toBe("Trade logged");
    expect(res.body.id).toBeDefined();
  });

  it("POST /trades with missing fields returns 400", async () => {
    const res = await request(app)
      .post("/trades")
      .set(headers)
      .send({ bot_id: "tokyobot" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("POST /trades without API key returns 401", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Content-Type", "application/json")
      .send(makeTrade());

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Unauthorized/);
  });

  it("POST /trades with invalid API key returns 401", async () => {
    const res = await request(app)
      .post("/trades")
      .set({ "x-api-key": "wrong-key", "Content-Type": "application/json" })
      .send(makeTrade());

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Unauthorized/);
  });
});

// ─── Tokyo Bot Flow ───

describe("Tokyo bot flow", () => {
  // Use a unique date to isolate from validation tests
  const sessionDate = "2026-01-15";
  const buyTimestamp = `${sessionDate}T01:00:00Z`;
  const sellTimestamp = `${sessionDate}T05:00:00Z`;

  afterAll(async () => {
    await pool.query(
      `DELETE FROM daily_summaries WHERE date = $1`,
      [sessionDate]
    );
  });

  it("POST BUY then POST SELL, verify PnL is calculated correctly", async () => {
    const buyRes = await request(app)
      .post("/trades")
      .set(headers)
      .send(makeTrade({ ticker: "TEST", price: 100, timestamp: buyTimestamp }));
    expect(buyRes.status).toBe(201);

    const sellRes = await request(app)
      .post("/trades")
      .set(headers)
      .send(makeTrade({ ticker: "TEST", action: "SELL", price: 110, timestamp: sellTimestamp }));
    expect(sellRes.status).toBe(201);

    // Generate summary — PnL should be (110 - 100) * 1 * 5 = $50
    const range = {
      start: `${sessionDate}T00:00:00Z`,
      end: `${sessionDate}T07:00:00Z`,
    };
    const { generateDailySummary } = await import("../src/store");
    const summary = await generateDailySummary("tokyobot", sessionDate, range);

    expect(parseFloat(summary.net_pnl)).toBe(50);
    expect(summary.wins).toBe(1);
    expect(summary.losses).toBe(0);
    expect(summary.total_trades).toBe(2);
  });

  it("GET /summary/tokyobot returns the correct summary", async () => {
    const res = await request(app)
      .get("/summary/tokyobot")
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.bot_id).toBe("tokyobot");
    expect(res.body.count).toBeGreaterThanOrEqual(1);

    const summary = res.body.summaries.find(
      (s: { date: string }) => s.date.startsWith(sessionDate)
    );
    expect(summary).toBeDefined();
    expect(parseFloat(summary.net_pnl)).toBe(50);
  });
});

// ─── Swing Bot Flow ───

describe("Swing bot flow", () => {
  const buyTimestamp = new Date().toISOString();

  it("POST BUY for swingbot, verify position is created with status open", async () => {
    const res = await request(app)
      .post("/trades")
      .set(headers)
      .send(makeTrade({ bot_id: "swingbot", ticker: "TEST", price: 200, timestamp: buyTimestamp }));

    expect(res.status).toBe(201);

    const posRes = await request(app).get("/positions").set(headers);
    expect(posRes.status).toBe(200);

    const pos = posRes.body.positions.find(
      (p: { ticker: string; bot_id: string }) => p.ticker === "TEST" && p.bot_id === "swingbot"
    );
    expect(pos).toBeDefined();
    expect(pos.status).toBe("open");
    expect(parseFloat(pos.entry_price)).toBe(200);
  });

  it("PATCH /positions/update with unrealized PnL, verify position is updated", async () => {
    const res = await request(app)
      .patch("/positions/update")
      .set(headers)
      .send({ bot_id: "swingbot", ticker: "TEST", pnl: 75 });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Position updated");
    expect(parseFloat(res.body.position.pnl)).toBe(75);
  });

  it("POST SELL for swingbot, verify position is closed with final PnL", async () => {
    const sellTimestamp = new Date().toISOString();
    const res = await request(app)
      .post("/trades")
      .set(headers)
      .send(makeTrade({ bot_id: "swingbot", ticker: "TEST", action: "SELL", price: 250, timestamp: sellTimestamp }));

    expect(res.status).toBe(201);

    // Position should now be closed with realized PnL = (250 - 200) * 1 = 50
    const posRes = await request(app).get("/positions").set(headers);
    const openTestPos = posRes.body.positions.find(
      (p: { ticker: string; bot_id: string }) => p.ticker === "TEST" && p.bot_id === "swingbot"
    );
    expect(openTestPos).toBeUndefined();

    // Verify closed position PnL in DB
    const dbResult = await pool.query(
      `SELECT pnl, status FROM positions
       WHERE ticker = 'TEST' AND status = 'closed'
       ORDER BY closed_at DESC LIMIT 1`
    );
    expect(dbResult.rows.length).toBeGreaterThanOrEqual(1);
    expect(dbResult.rows[0].status).toBe("closed");
    expect(parseFloat(dbResult.rows[0].pnl)).toBe(50);
  });

  it("GET /positions returns only open positions", async () => {
    const res = await request(app).get("/positions").set(headers);

    expect(res.status).toBe(200);
    for (const pos of res.body.positions) {
      expect(pos.status).toBe("open");
    }
  });
});

// ─── Summary Generation ───

describe("Summary generation", () => {
  it("generateDailySummary creates a daily_summaries record", async () => {
    const { generateDailySummary } = await import("../src/store");
    const summary = await generateDailySummary("swingbot", today);

    expect(summary).toBeDefined();
    expect(summary.date.toISOString().startsWith(today)).toBe(true);
    expect(summary.total_trades).toBeDefined();
  });

  it("summaryExists returns true after generation", async () => {
    const { summaryExists } = await import("../src/store");
    const exists = await summaryExists("swingbot", today);
    expect(exists).toBe(true);
  });

  it("generating twice for same bot and date results in one record (idempotency)", async () => {
    const { generateDailySummary } = await import("../src/store");
    await generateDailySummary("swingbot", today);
    await generateDailySummary("swingbot", today);

    const result = await pool.query(
      `SELECT COUNT(*) FROM daily_summaries
       WHERE bot_id = (SELECT id FROM bots WHERE name = 'swingbot') AND date = $1`,
      [today]
    );
    expect(parseInt(result.rows[0].count)).toBe(1);
  });
});

// ─── Edge Cases ───

describe("Edge cases", () => {
  it("POST SELL for swingbot with no open position does not error", async () => {
    // Ensure no open TEST2 position exists
    const res = await request(app)
      .post("/trades")
      .set(headers)
      .send(makeTrade({ bot_id: "swingbot", ticker: "TEST2", action: "SELL", price: 100 }));

    // The trade is still logged (no validation prevents orphan sells), but no position is closed
    expect(res.status).toBe(201);

    const posRes = await pool.query(
      "SELECT * FROM positions WHERE ticker = 'TEST2' AND status = 'closed'"
    );
    expect(posRes.rows.length).toBe(0);
  });

  it("PATCH /positions/update for a ticker with no open position returns 404", async () => {
    const res = await request(app)
      .patch("/positions/update")
      .set(headers)
      .send({ bot_id: "swingbot", ticker: "NONEXISTENT", pnl: 100 });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/No open position found/);
  });

  it("POST /trades with quantity 0 returns 400", async () => {
    const res = await request(app)
      .post("/trades")
      .set(headers)
      .send(makeTrade({ quantity: 0 }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/quantity/);
  });

  it("POST /trades with negative price returns 400", async () => {
    const res = await request(app)
      .post("/trades")
      .set(headers)
      .send(makeTrade({ price: -50 }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/price/);
  });

  it("Negative unrealized PnL is stored correctly", async () => {
    // Create an open position
    await request(app)
      .post("/trades")
      .set(headers)
      .send(makeTrade({ bot_id: "swingbot", ticker: "TEST3", price: 300 }));

    const res = await request(app)
      .patch("/positions/update")
      .set(headers)
      .send({ bot_id: "swingbot", ticker: "TEST3", pnl: -150 });

    expect(res.status).toBe(200);
    expect(parseFloat(res.body.position.pnl)).toBe(-150);
  });

  it("PATCH /positions/update on an already-closed position returns 404", async () => {
    // Close the TEST3 position
    await request(app)
      .post("/trades")
      .set(headers)
      .send(makeTrade({ bot_id: "swingbot", ticker: "TEST3", action: "SELL", price: 250 }));

    const res = await request(app)
      .patch("/positions/update")
      .set(headers)
      .send({ bot_id: "swingbot", ticker: "TEST3", pnl: 999 });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/No open position found/);
  });

  it("POST /trades with future timestamp is accepted", async () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const res = await request(app)
      .post("/trades")
      .set(headers)
      .send(makeTrade({ timestamp: future.toISOString() }));

    expect(res.status).toBe(201);
  });

  it("POST /trades with very old timestamp is accepted", async () => {
    const res = await request(app)
      .post("/trades")
      .set(headers)
      .send(makeTrade({ timestamp: "2000-01-01T00:00:00Z" }));

    expect(res.status).toBe(201);
  });

  it("POST /trades with empty string ticker returns 400", async () => {
    const res = await request(app)
      .post("/trades")
      .set(headers)
      .send(makeTrade({ ticker: "" }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ticker/);
  });

  it("POST /trades with empty string bot_id returns 400", async () => {
    const res = await request(app)
      .post("/trades")
      .set(headers)
      .send(makeTrade({ bot_id: "" }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bot_id/);
  });
});
