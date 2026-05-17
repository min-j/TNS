const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

async function sendEmbed(embeds: object[]): Promise<void> {
  if (!WEBHOOK_URL) return;

  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds }),
    });
  } catch (err) {
    console.error("Discord webhook failed:", err);
  }
}

interface TokyoSummary {
  date: string;
  entry: { price: number; quantity: number } | null;
  exit: { price: number; quantity: number } | null;
  pnl: number;
  result: "WIN" | "LOSS" | "FLAT";
  warning?: string;
}

export async function notifyTokyoDaily(summary: TokyoSummary): Promise<void> {
  const color = summary.pnl > 0 ? 0x2ecc71 : summary.pnl < 0 ? 0xe74c3c : 0x95a5a6;
  const sign = summary.pnl >= 0 ? "+" : "";

  const fields = [];
  if (summary.entry) {
    fields.push({ name: "Entry", value: `$${summary.entry.price.toFixed(2)} x${summary.entry.quantity}`, inline: true });
  }
  if (summary.exit) {
    fields.push({ name: "Exit", value: `$${summary.exit.price.toFixed(2)} x${summary.exit.quantity}`, inline: true });
  }
  fields.push({ name: "PnL", value: `${sign}$${summary.pnl.toFixed(2)}`, inline: true });
  fields.push({ name: "Result", value: summary.result, inline: true });
  if (summary.warning) {
    fields.push({ name: "Warning", value: summary.warning, inline: false });
  }

  await sendEmbed([
    {
      title: `Daily Summary: tokyobot`,
      description: summary.date,
      color,
      fields,
    },
  ]);
}

interface SwingPosition {
  ticker: string;
  entry_price: number;
  quantity: number;
  status: string;
  pnl: number | null;
  opened_at: string;
  closed_at: string | null;
  exit_price: number | null;
}

interface SwingSummary {
  date: string;
  opened: SwingPosition[];
  closed: SwingPosition[];
  held: SwingPosition[];
  netRealizedPnl: number;
}

export async function notifySwingDaily(summary: SwingSummary): Promise<void> {
  const color = summary.netRealizedPnl > 0 ? 0x2ecc71 : summary.netRealizedPnl < 0 ? 0xe74c3c : 0x3498db;

  const fields = [];

  if (summary.opened.length > 0) {
    const lines = summary.opened.map((p) => `${p.ticker} — $${parseFloat(String(p.entry_price)).toFixed(2)} x${p.quantity}`);
    fields.push({ name: "Opened", value: lines.join("\n"), inline: false });
  }

  if (summary.closed.length > 0) {
    const lines = summary.closed.map((p) => {
      const pnl = p.pnl ?? 0;
      const sign = pnl >= 0 ? "+" : "";
      return `${p.ticker} — $${parseFloat(String(p.entry_price)).toFixed(2)} -> $${parseFloat(String(p.exit_price)).toFixed(2)} | ${sign}$${pnl.toFixed(2)}`;
    });
    fields.push({ name: "Closed", value: lines.join("\n"), inline: false });
  }

  if (summary.held.length > 0) {
    const lines = summary.held.map((p) => `${p.ticker} — $${parseFloat(String(p.entry_price)).toFixed(2)} x${p.quantity}`);
    fields.push({ name: "Held", value: lines.join("\n"), inline: false });
  }

  const sign = summary.netRealizedPnl >= 0 ? "+" : "";
  fields.push({ name: "Net Realized PnL", value: `${sign}$${summary.netRealizedPnl.toFixed(2)}`, inline: true });

  await sendEmbed([
    {
      title: `Daily Summary: swingbot`,
      description: summary.date,
      color,
      fields,
    },
  ]);
}
