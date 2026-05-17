import { pool } from "./db";

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS bots (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        strategy VARCHAR(50) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      INSERT INTO bots (name, strategy)
      VALUES ('tokyobot', 'intraday'), ('swingbot', 'swing')
      ON CONFLICT (name) DO NOTHING;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS trades (
        id SERIAL PRIMARY KEY,
        bot_id INTEGER NOT NULL REFERENCES bots(id),
        ticker VARCHAR(10) NOT NULL,
        action VARCHAR(4) NOT NULL,
        quantity NUMERIC NOT NULL,
        price NUMERIC NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS positions (
        id SERIAL PRIMARY KEY,
        bot_id INTEGER NOT NULL REFERENCES bots(id),
        ticker VARCHAR(10) NOT NULL,
        entry_trade_id INTEGER NOT NULL REFERENCES trades(id),
        exit_trade_id INTEGER REFERENCES trades(id),
        entry_price NUMERIC NOT NULL,
        exit_price NUMERIC,
        quantity NUMERIC NOT NULL,
        pnl NUMERIC,
        status VARCHAR(10) DEFAULT 'open',
        opened_at TIMESTAMPTZ NOT NULL,
        closed_at TIMESTAMPTZ
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_summaries (
        id SERIAL PRIMARY KEY,
        bot_id INTEGER NOT NULL REFERENCES bots(id),
        date DATE NOT NULL,
        total_trades INTEGER NOT NULL,
        wins INTEGER NOT NULL,
        losses INTEGER NOT NULL,
        net_pnl NUMERIC NOT NULL,
        summary_data JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (bot_id, date)
      );
    `);

    await client.query("COMMIT");
    console.log("Migration completed successfully.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
