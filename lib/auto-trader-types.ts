/**
 * Configuration and runtime types for the autonomous accumulator trading engine.
 *
 * The engine is a transparent, rule-based signal model that runs entirely in the
 * browser off the live tick stream. It decides when to open an accumulator
 * contract (low-volatility / consolidation entry) and when to close it
 * (take-profit, tick target, or volatility-spike protection), while enforcing
 * professional risk-management limits at the session level.
 */

/** How aggressive the entry signal is. Higher = trades more often, more risk. */
export type AggressionLevel = 'conservative' | 'balanced' | 'aggressive';

export interface AutoTraderConfig {
  /** Base stake per trade in account currency. */
  baseStake: number;
  /** Aggression preset controlling entry sensitivity. */
  aggression: AggressionLevel;
  /** Auto-close a trade once profit reaches this amount (currency). 0 = disabled. */
  takeProfitPerTrade: number;
  /** Close the trade once it has run this many profitable ticks. 0 = disabled. */
  targetTicks: number;

  // --- Session risk controls ---
  /** Stop the bot for the session once cumulative loss reaches this amount. 0 = disabled. */
  maxSessionLoss: number;
  /** Stop the bot once cumulative session profit reaches this target. 0 = disabled. */
  dailyProfitTarget: number;
  /** Maximum number of trades the bot will place in a session. 0 = unlimited. */
  maxTrades: number;

  // --- Martingale ---
  /** Enable martingale stake recovery after a loss. */
  martingaleEnabled: boolean;
  /** Stake multiplier applied per consecutive loss. */
  martingaleMultiplier: number;
  /** Maximum stake the martingale ladder is allowed to reach (currency). */
  martingaleMaxStake: number;
}

export const DEFAULT_AUTO_TRADER_CONFIG: AutoTraderConfig = {
  baseStake: 10,
  aggression: 'balanced',
  takeProfitPerTrade: 5,
  targetTicks: 10,
  maxSessionLoss: 100,
  dailyProfitTarget: 50,
  maxTrades: 20,
  martingaleEnabled: false,
  martingaleMultiplier: 2,
  martingaleMaxStake: 200,
};

/** Why the bot stopped automatically (null while running or idle). */
export type AutoStopReason =
  | 'profit-target'
  | 'max-loss'
  | 'max-trades'
  | null;

export interface AutoTradeLogEntry {
  id: string;
  time: number;
  type: 'info' | 'buy' | 'close' | 'win' | 'loss' | 'risk';
  message: string;
}

export interface AutoTraderStats {
  /** Cumulative realized session profit/loss (currency). */
  sessionPnl: number;
  /** Number of completed trades this session. */
  totalTrades: number;
  wins: number;
  losses: number;
  /** Win rate 0-100. */
  winRate: number;
  /** Current consecutive loss streak (drives martingale). */
  lossStreak: number;
  /** Stake that will be used for the next trade. */
  nextStake: number;
  /** Best single-trade profit this session. */
  bestTrade: number;
}
