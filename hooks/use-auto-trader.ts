'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { AccumulatorProposalInfo } from './use-accumulator-proposal';
import type { OpenPosition } from './use-open-positions';
import type {
  AutoTraderConfig,
  AutoTraderStats,
  AutoStopReason,
  AutoTradeLogEntry,
  AggressionLevel,
} from '@/lib/auto-trader-types';

/** Entry safety thresholds per aggression level (max recent move / barrier distance). */
const ENTRY_RATIO: Record<AggressionLevel, number> = {
  conservative: 0.45,
  balanced: 0.62,
  aggressive: 0.82,
};

/** How many recent ticks to analyse per aggression level. */
const WINDOW: Record<AggressionLevel, number> = {
  conservative: 24,
  balanced: 18,
  aggressive: 12,
};

/** Volatility-spike exit factor — close the trade if a recent move exceeds this share of the barrier. */
const EXIT_SPIKE_FACTOR = 0.85;
/** Minimum ticks to wait after a close before re-entering. */
const COOLDOWN_TICKS = 2;
/** How many of the most recent moves are inspected for an exit spike. */
const EXIT_LOOKBACK = 3;

export type SignalState = 'idle' | 'scanning' | 'ready' | 'in-trade' | 'cooldown';

export interface AutoTraderSignal {
  state: SignalState;
  /** 0-100 safety score (higher = calmer market, safer to enter). */
  safety: number;
  /** Human readable status line. */
  detail: string;
}

interface UseAutoTraderParams {
  config: AutoTraderConfig;
  isConnected: boolean;
  isAuthenticated: boolean;
  prices: number[];
  proposal: AccumulatorProposalInfo | null;
  activePosition: OpenPosition | null;
  openPositions: OpenPosition[];
  isBuying: boolean;
  sellingId: number | null;
  /** Sync the manual stake field so the proposal is priced at the bot's next stake. */
  setStake: (value: string) => void;
  buyContract: () => Promise<void>;
  sellContract: (contractId: number, bidPrice: string) => Promise<void>;
}

export interface UseAutoTraderReturn {
  isRunning: boolean;
  start: () => void;
  stop: () => void;
  resetSession: () => void;
  stopReason: AutoStopReason;
  stats: AutoTraderStats;
  signal: AutoTraderSignal;
  log: AutoTradeLogEntry[];
}

interface InternalStats {
  sessionPnl: number;
  totalTrades: number;
  wins: number;
  losses: number;
  lossStreak: number;
  bestTrade: number;
}

const INITIAL_STATS: InternalStats = {
  sessionPnl: 0,
  totalTrades: 0,
  wins: 0,
  losses: 0,
  lossStreak: 0,
  bestTrade: 0,
};

function computeNextStake(config: AutoTraderConfig, lossStreak: number): number {
  if (!config.martingaleEnabled || lossStreak <= 0) return config.baseStake;
  const scaled = config.baseStake * Math.pow(config.martingaleMultiplier, lossStreak);
  return Math.min(scaled, config.martingaleMaxStake);
}

/** Absolute tick-to-tick moves for the most recent `count` prices. */
function recentMoves(prices: number[], count: number): number[] {
  const slice = prices.slice(-count);
  const moves: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    moves.push(Math.abs(slice[i] - slice[i - 1]));
  }
  return moves;
}

export function useAutoTrader({
  config,
  isConnected,
  isAuthenticated,
  prices,
  proposal,
  activePosition,
  openPositions,
  isBuying,
  sellingId,
  setStake,
  buyContract,
  sellContract,
}: UseAutoTraderParams): UseAutoTraderReturn {
  const [isRunning, setIsRunning] = useState(false);
  const [stopReason, setStopReason] = useState<AutoStopReason>(null);
  const [stats, setStats] = useState<InternalStats>(INITIAL_STATS);
  const [log, setLog] = useState<AutoTradeLogEntry[]>([]);
  const [signal, setSignal] = useState<AutoTraderSignal>({
    state: 'idle',
    safety: 0,
    detail: 'Engine idle',
  });

  // Refs for values the effects need without re-subscribing every tick.
  const logIdRef = useRef(0);
  const botContractsRef = useRef<Set<number>>(new Set());
  const processedRef = useRef<Set<number>>(new Set());
  const pendingEntryRef = useRef(false);
  const cooldownRef = useRef(0);
  const lastTickCountRef = useRef(prices.length);
  const runningRef = useRef(isRunning);
  const statsRef = useRef(stats);
  const configRef = useRef(config);

  runningRef.current = isRunning;
  statsRef.current = stats;
  configRef.current = config;

  const nextStake = useMemo(
    () => computeNextStake(config, stats.lossStreak),
    [config, stats.lossStreak]
  );

  const addLog = useCallback((type: AutoTradeLogEntry['type'], message: string) => {
    setLog((prev) => {
      const entry: AutoTradeLogEntry = {
        id: `${Date.now()}-${logIdRef.current++}`,
        time: Date.now(),
        type,
        message,
      };
      // Keep the most recent 60 entries.
      return [entry, ...prev].slice(0, 60);
    });
  }, []);

  const stopEngine = useCallback(
    (reason: AutoStopReason, message?: string) => {
      setIsRunning(false);
      runningRef.current = false;
      setStopReason(reason);
      pendingEntryRef.current = false;
      if (message) addLog('risk', message);
      setSignal({ state: 'idle', safety: 0, detail: message ?? 'Engine stopped' });
    },
    [addLog]
  );

  const start = useCallback(() => {
    if (!isConnected || !isAuthenticated) {
      addLog('risk', 'Cannot start: connect and sign in first.');
      return;
    }
    setStopReason(null);
    pendingEntryRef.current = false;
    cooldownRef.current = 0;
    setIsRunning(true);
    runningRef.current = true;
    addLog('info', 'Auto-trading engine started. Scanning market…');
  }, [isConnected, isAuthenticated, addLog]);

  const stop = useCallback(() => {
    setIsRunning(false);
    runningRef.current = false;
    pendingEntryRef.current = false;
    addLog('info', 'Auto-trading engine paused by user.');
    setSignal({ state: 'idle', safety: 0, detail: 'Engine paused' });
  }, [addLog]);

  const resetSession = useCallback(() => {
    setStats(INITIAL_STATS);
    setLog([]);
    setStopReason(null);
    botContractsRef.current.clear();
    processedRef.current.clear();
    pendingEntryRef.current = false;
    cooldownRef.current = 0;
  }, []);

  // Keep the proposal priced at the bot's next stake while running and flat.
  useEffect(() => {
    if (isRunning && !activePosition) {
      setStake(String(nextStake));
    }
  }, [isRunning, activePosition, nextStake, setStake]);

  // Register a freshly opened position as a bot-owned contract.
  useEffect(() => {
    if (!activePosition) return;
    const id = activePosition.contract_id;
    if (runningRef.current && pendingEntryRef.current && !botContractsRef.current.has(id)) {
      botContractsRef.current.add(id);
      pendingEntryRef.current = false;
      addLog('buy', `Opened trade #${id} • stake ${parseFloat(activePosition.buy_price).toFixed(2)} USD`);
    }
  }, [activePosition, addLog]);

  // Detect closed bot contracts and update session stats + risk limits.
  useEffect(() => {
    for (const p of openPositions) {
      const id = p.contract_id;
      const isClosed = !!p.is_sold || !!p.is_expired || p.status !== 'open';
      if (!isClosed) continue;
      if (!botContractsRef.current.has(id) || processedRef.current.has(id)) continue;

      processedRef.current.add(id);
      const profit = parseFloat(p.profit) || 0;
      const isWin = profit >= 0;
      cooldownRef.current = COOLDOWN_TICKS;

      const prev = statsRef.current;
      const next: InternalStats = {
        sessionPnl: prev.sessionPnl + profit,
        totalTrades: prev.totalTrades + 1,
        wins: prev.wins + (isWin ? 1 : 0),
        losses: prev.losses + (isWin ? 0 : 1),
        lossStreak: isWin ? 0 : prev.lossStreak + 1,
        bestTrade: Math.max(prev.bestTrade, profit),
      };
      statsRef.current = next;
      setStats(next);

      addLog(
        isWin ? 'win' : 'loss',
        `Trade #${id} closed ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} USD • session ${next.sessionPnl >= 0 ? '+' : ''}${next.sessionPnl.toFixed(2)} USD`
      );

      // Risk-limit evaluation against the updated session figures.
      const cfg = configRef.current;
      if (cfg.dailyProfitTarget > 0 && next.sessionPnl >= cfg.dailyProfitTarget) {
        stopEngine('profit-target', `Daily profit target reached (+${next.sessionPnl.toFixed(2)} USD). Engine stopped.`);
        return;
      }
      if (cfg.maxSessionLoss > 0 && next.sessionPnl <= -cfg.maxSessionLoss) {
        stopEngine('max-loss', `Max session loss hit (${next.sessionPnl.toFixed(2)} USD). Engine stopped.`);
        return;
      }
      if (cfg.maxTrades > 0 && next.totalTrades >= cfg.maxTrades) {
        stopEngine('max-trades', `Max trades per session reached (${next.totalTrades}). Engine stopped.`);
        return;
      }
    }
  }, [openPositions, addLog, stopEngine]);

  // Core decision loop — runs on every new tick.
  useEffect(() => {
    if (prices.length !== lastTickCountRef.current) {
      lastTickCountRef.current = prices.length;
      if (cooldownRef.current > 0) cooldownRef.current -= 1;
    }

    if (!isRunning) return;
    if (!isConnected) return;

    const barrierDistance = proposal ? parseFloat(proposal.barrierSpotDistance) : NaN;

    // --- Manage an open trade: exit logic ---
    if (activePosition) {
      const cfg = configRef.current;
      const profit = parseFloat(activePosition.profit) || 0;
      const elapsedTicks = activePosition.tick_stream?.length ?? 0;
      const canSell = !!activePosition.is_valid_to_sell && sellingId !== activePosition.contract_id;

      setSignal({
        state: 'in-trade',
        safety: 0,
        detail: `In trade • ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} USD • ${elapsedTicks} ticks`,
      });

      if (!canSell) return;

      // 1. Take-profit per trade.
      if (cfg.takeProfitPerTrade > 0 && profit >= cfg.takeProfitPerTrade) {
        addLog('close', `Take-profit hit (+${profit.toFixed(2)} USD). Closing trade.`);
        void sellContract(activePosition.contract_id, activePosition.bid_price);
        return;
      }
      // 2. Tick target reached with profit secured.
      if (cfg.targetTicks > 0 && elapsedTicks >= cfg.targetTicks && profit > 0) {
        addLog('close', `Tick target reached (${elapsedTicks} ticks, +${profit.toFixed(2)} USD). Locking in.`);
        void sellContract(activePosition.contract_id, activePosition.bid_price);
        return;
      }
      // 3. Volatility-spike protection.
      if (!isNaN(barrierDistance) && barrierDistance > 0 && profit > 0) {
        const moves = recentMoves(prices, EXIT_LOOKBACK + 1);
        const spike = moves.length ? Math.max(...moves) : 0;
        if (spike > barrierDistance * EXIT_SPIKE_FACTOR) {
          addLog('close', `Volatility spike detected. Protecting +${profit.toFixed(2)} USD.`);
          void sellContract(activePosition.contract_id, activePosition.bid_price);
        }
      }
      return;
    }

    // --- Flat: look for an entry ---
    if (pendingEntryRef.current || isBuying) {
      setSignal({ state: 'scanning', safety: 0, detail: 'Placing order…' });
      return;
    }
    if (cooldownRef.current > 0) {
      setSignal({ state: 'cooldown', safety: 0, detail: `Cooling down (${cooldownRef.current})` });
      return;
    }
    if (!proposal || isNaN(barrierDistance) || barrierDistance <= 0) {
      setSignal({ state: 'scanning', safety: 0, detail: 'Waiting for market data…' });
      return;
    }

    const win = WINDOW[config.aggression];
    const moves = recentMoves(prices, win);
    if (moves.length < Math.min(8, win - 1)) {
      setSignal({ state: 'scanning', safety: 0, detail: 'Building tick history…' });
      return;
    }

    const maxMove = Math.max(...moves);
    const ratio = maxMove / barrierDistance;
    const threshold = ENTRY_RATIO[config.aggression];
    // Safety score: 100 when market is dead calm, 0 at/above the entry threshold.
    const safety = Math.max(0, Math.min(100, Math.round((1 - ratio / threshold) * 100)));

    if (ratio < threshold) {
      setSignal({ state: 'ready', safety, detail: `Entry signal • safety ${safety}%` });
      pendingEntryRef.current = true;
      addLog('info', `Entry signal (safety ${safety}%). Buying ${nextStake.toFixed(2)} USD.`);
      void buyContract().catch(() => {
        pendingEntryRef.current = false;
      });
    } else {
      setSignal({ state: 'scanning', safety, detail: `Market too volatile • safety ${safety}%` });
    }
  }, [
    prices,
    isRunning,
    isConnected,
    proposal,
    activePosition,
    isBuying,
    sellingId,
    config.aggression,
    nextStake,
    addLog,
    buyContract,
    sellContract,
  ]);

  const publicStats: AutoTraderStats = useMemo(() => {
    const total = stats.totalTrades;
    return {
      sessionPnl: stats.sessionPnl,
      totalTrades: total,
      wins: stats.wins,
      losses: stats.losses,
      winRate: total > 0 ? (stats.wins / total) * 100 : 0,
      lossStreak: stats.lossStreak,
      nextStake,
      bestTrade: stats.bestTrade,
    };
  }, [stats, nextStake]);

  return {
    isRunning,
    start,
    stop,
    resetSession,
    stopReason,
    stats: publicStats,
    signal,
    log,
  };
}
