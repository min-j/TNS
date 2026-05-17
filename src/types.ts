// TODO: consider consolidation if possible
export interface TradeEvent {
  bot_id: string;
  ticker: string;
  action: "BUY" | "SELL";
  quantity: number;
  price: number;
  timestamp: string;
  pnl?: number;
}

export interface TradeRow {
  id: number;
  bot_id: number;
  ticker: string;
  action: "BUY" | "SELL";
  quantity: number;
  price: number;
  timestamp: Date;
  created_at: Date;
}

export interface PositionRow {
  id: number;
  bot_id: number;
  ticker: string;
  entry_trade_id: number;
  exit_trade_id: number | null;
  entry_price: number;
  exit_price: number | null;
  quantity: number;
  pnl: number | null;
  status: string;
  opened_at: Date;
  closed_at: Date | null;
}

export interface DailySummaryRow {
  id: number;
  bot_id: number;
  date: string;
  total_trades: number;
  wins: number;
  losses: number;
  net_pnl: number;
  summary_data: Record<string, unknown> | null;
  created_at: Date;
}
