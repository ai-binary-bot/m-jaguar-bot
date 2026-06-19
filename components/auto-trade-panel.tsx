'use client';

import { useState } from 'react';
import {
  Activity,
  Bot,
  ChevronDown,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  Shield,
  TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import type {
  AutoTraderConfig,
  AutoTraderStats,
  AutoStopReason,
  AutoTradeLogEntry,
  AggressionLevel,
} from '@/lib/auto-trader-types';
import type { AutoTraderSignal, SignalState } from '@/hooks/use-auto-trader';

interface AutoTradePanelProps {
  config: AutoTraderConfig;
  onConfigChange: (patch: Partial<AutoTraderConfig>) => void;
  isRunning: boolean;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
  stopReason: AutoStopReason;
  stats: AutoTraderStats;
  signal: AutoTraderSignal;
  log: AutoTradeLogEntry[];
  isConnected: boolean;
  isAuthenticated: boolean;
}

const SIGNAL_LABEL: Record<SignalState, string> = {
  idle: 'Idle',
  scanning: 'Scanning',
  ready: 'Signal',
  'in-trade': 'In Trade',
  cooldown: 'Cooldown',
};

const SIGNAL_DOT: Record<SignalState, string> = {
  idle: 'bg-muted-foreground/40',
  scanning: 'bg-amber-500',
  ready: 'bg-green-500',
  'in-trade': 'bg-blue-500',
  cooldown: 'bg-muted-foreground/60',
};

const STOP_REASON_TEXT: Record<Exclude<AutoStopReason, null>, string> = {
  'profit-target': 'Daily profit target reached',
  'max-loss': 'Max session loss reached',
  'max-trades': 'Max trades reached',
};

function NumberField({
  id,
  label,
  value,
  onChange,
  step = '1',
  suffix = 'USD',
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: string;
  suffix?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        onKeyDown={(e) => {
          if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
        }}
        min={0}
        step={step}
        labelRight={suffix}
        disabled={disabled}
      />
    </div>
  );
}

export function AutoTradePanel({
  config,
  onConfigChange,
  isRunning,
  onStart,
  onStop,
  onReset,
  stopReason,
  stats,
  signal,
  log,
  isConnected,
  isAuthenticated,
}: AutoTradePanelProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const pnlPositive = stats.sessionPnl >= 0;

  // Progress toward whichever limit is configured.
  const profitPct =
    config.dailyProfitTarget > 0
      ? Math.min(100, Math.max(0, (stats.sessionPnl / config.dailyProfitTarget) * 100))
      : 0;
  const lossPct =
    config.maxSessionLoss > 0 && stats.sessionPnl < 0
      ? Math.min(100, (Math.abs(stats.sessionPnl) / config.maxSessionLoss) * 100)
      : 0;

  return (
    <div className="w-full space-y-4 lg:max-w-[400px]">
      {/* Engine status header */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex items-center gap-2.5">
          <div className="relative flex size-9 items-center justify-center rounded-md bg-primary/10">
            <Bot className="size-5 text-primary" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold">AI Auto-Trader</p>
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  SIGNAL_DOT[signal.state],
                  isRunning && signal.state !== 'idle' && 'animate-pulse'
                )}
              />
              <span className="text-xs text-muted-foreground">
                {isRunning ? SIGNAL_LABEL[signal.state] : 'Stopped'}
              </span>
            </div>
          </div>
        </div>
        {isRunning ? (
          <Badge variant="secondary" className="gap-1">
            <Activity className="size-3" /> Live
          </Badge>
        ) : (
          <Badge variant="outline">Offline</Badge>
        )}
      </div>

      {/* Signal detail / safety meter */}
      <div className="space-y-2 rounded-lg border border-border bg-card p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Gauge className="size-3.5" /> Market signal
          </span>
          <span className="font-medium">{signal.detail}</span>
        </div>
        {(signal.state === 'scanning' || signal.state === 'ready') && (
          <div className="space-y-1">
            <Progress value={signal.safety} />
            <p className="text-right text-[11px] text-muted-foreground">
              Entry safety {signal.safety}%
            </p>
          </div>
        )}
      </div>

      {/* Session stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Session P&L</p>
          <p
            className={cn(
              'text-lg font-bold tabular-nums',
              pnlPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
            )}
          >
            {pnlPositive ? '+' : ''}
            {stats.sessionPnl.toFixed(2)}
            <span className="ml-1 text-xs font-normal text-muted-foreground">USD</span>
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Win rate</p>
          <p className="text-lg font-bold tabular-nums">
            {stats.winRate.toFixed(0)}
            <span className="ml-0.5 text-xs font-normal text-muted-foreground">%</span>
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Trades</p>
          <p className="text-lg font-bold tabular-nums">
            {stats.totalTrades}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              {stats.wins}W / {stats.losses}L
            </span>
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Next stake</p>
          <p className="text-lg font-bold tabular-nums">
            {stats.nextStake.toFixed(2)}
            <span className="ml-1 text-xs font-normal text-muted-foreground">USD</span>
          </p>
        </div>
      </div>

      {/* Limit progress bars */}
      {(config.dailyProfitTarget > 0 || config.maxSessionLoss > 0) && (
        <div className="space-y-2">
          {config.dailyProfitTarget > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Profit target</span>
                <span>{config.dailyProfitTarget.toFixed(0)} USD</span>
              </div>
              <Progress value={profitPct} />
            </div>
          )}
          {config.maxSessionLoss > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Loss limit</span>
                <span>{config.maxSessionLoss.toFixed(0)} USD</span>
              </div>
              <Progress value={lossPct} className="[&>div]:bg-red-500" />
            </div>
          )}
        </div>
      )}

      {stopReason && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
          <Shield className="size-4 shrink-0" />
          <span>{STOP_REASON_TEXT[stopReason]} — engine stopped automatically.</span>
        </div>
      )}

      <Separator />

      {/* Strategy config */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Strategy aggression</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            value={config.aggression}
            onValueChange={(v) => v && onConfigChange({ aggression: v as AggressionLevel })}
            className="grid grid-cols-3 gap-1.5"
            disabled={isRunning}
          >
            <ToggleGroupItem value="conservative" className="text-xs" aria-label="Conservative">
              Safe
            </ToggleGroupItem>
            <ToggleGroupItem value="balanced" className="text-xs" aria-label="Balanced">
              Balanced
            </ToggleGroupItem>
            <ToggleGroupItem value="aggressive" className="text-xs" aria-label="Aggressive">
              Aggressive
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <NumberField
            id="base-stake"
            label="Base stake"
            value={config.baseStake}
            onChange={(v) => onConfigChange({ baseStake: v })}
            step="0.01"
            disabled={isRunning}
          />
          <NumberField
            id="tp-trade"
            label="Take profit / trade"
            value={config.takeProfitPerTrade}
            onChange={(v) => onConfigChange({ takeProfitPerTrade: v })}
            step="0.01"
          />
        </div>
      </div>

      {/* Advanced / risk controls */}
      <button
        type="button"
        onClick={() => setShowAdvanced((s) => !s)}
        className="flex w-full items-center justify-between rounded-md py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="flex items-center gap-1.5">
          <Shield className="size-3.5" /> Risk management
        </span>
        <ChevronDown className={cn('size-4 transition-transform', showAdvanced && 'rotate-180')} />
      </button>

      {showAdvanced && (
        <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              id="profit-target"
              label="Daily profit target"
              value={config.dailyProfitTarget}
              onChange={(v) => onConfigChange({ dailyProfitTarget: v })}
              disabled={isRunning}
            />
            <NumberField
              id="max-loss"
              label="Max session loss"
              value={config.maxSessionLoss}
              onChange={(v) => onConfigChange({ maxSessionLoss: v })}
              disabled={isRunning}
            />
            <NumberField
              id="max-trades"
              label="Max trades"
              value={config.maxTrades}
              onChange={(v) => onConfigChange({ maxTrades: v })}
              suffix=""
              disabled={isRunning}
            />
            <NumberField
              id="target-ticks"
              label="Tick target"
              value={config.targetTicks}
              onChange={(v) => onConfigChange({ targetTicks: v })}
              suffix="ticks"
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="leading-tight">
              <Label htmlFor="martingale" className="text-xs font-medium">
                Martingale recovery
              </Label>
              <p className="text-[11px] text-muted-foreground">Raise stake after a loss</p>
            </div>
            <Switch
              id="martingale"
              checked={config.martingaleEnabled}
              onCheckedChange={(v) => onConfigChange({ martingaleEnabled: v })}
              disabled={isRunning}
            />
          </div>

          {config.martingaleEnabled && (
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                id="mg-mult"
                label="Multiplier"
                value={config.martingaleMultiplier}
                onChange={(v) => onConfigChange({ martingaleMultiplier: v })}
                step="0.1"
                suffix="x"
                disabled={isRunning}
              />
              <NumberField
                id="mg-max"
                label="Max stake"
                value={config.martingaleMaxStake}
                onChange={(v) => onConfigChange({ martingaleMaxStake: v })}
                disabled={isRunning}
              />
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-2">
        {!isRunning ? (
          <Button
            className="flex-1 rounded-full"
            size="lg"
            onClick={onStart}
            disabled={!isConnected || !isAuthenticated}
          >
            <Play className="size-4" data-icon="inline-start" />
            Start Bot
          </Button>
        ) : (
          <Button
            variant="outline"
            className="flex-1 rounded-full"
            size="lg"
            onClick={onStop}
          >
            <Pause className="size-4" data-icon="inline-start" />
            Pause Bot
          </Button>
        )}
        <Button
          variant="ghost"
          size="lg"
          className="rounded-full"
          onClick={onReset}
          disabled={isRunning}
          aria-label="Reset session"
        >
          <RotateCcw className="size-4" />
        </Button>
      </div>

      {!isAuthenticated && (
        <p className="text-center text-xs text-muted-foreground">
          Sign in to enable automated trading.
        </p>
      )}

      {/* Activity log */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <TrendingUp className="size-3.5" /> Activity log
        </div>
        <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border bg-muted/20 p-2">
          {log.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No activity yet. Start the bot to begin.
            </p>
          ) : (
            log.map((entry) => (
              <div key={entry.id} className="flex items-start gap-2 text-[11px] leading-snug">
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {new Date(entry.time).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
                <span
                  className={cn(
                    'flex-1',
                    entry.type === 'win' && 'text-green-600 dark:text-green-400',
                    entry.type === 'loss' && 'text-red-600 dark:text-red-400',
                    entry.type === 'risk' && 'text-amber-600 dark:text-amber-400',
                    entry.type === 'buy' && 'text-blue-600 dark:text-blue-400'
                  )}
                >
                  {entry.message}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
