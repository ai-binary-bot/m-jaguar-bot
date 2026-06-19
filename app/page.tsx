'use client';

import { useState, useCallback, useMemo } from 'react';
import { useSmartChartsApi } from '@/hooks/use-smartcharts-api';
import { useSmartChartChartData } from '@/hooks/use-smartchart-chart-data';
import { useAccumulatorTrading } from '../hooks/use-accumulator-trading';
import { useAutoTrader } from '@/hooks/use-auto-trader';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { useLogoSrc } from '@/components/custom/logo-src-provider';
import { AccumulatorView } from '../components/accumulator-view';
import { DEFAULT_AUTO_TRADER_CONFIG, type AutoTraderConfig } from '@/lib/auto-trader-types';

export default function AccumulatorPage() {
  const logoSrc = useLogoSrc();
  const { ws, isConnected, isExhausted, auth } = useDerivWSContext();
  const { authState, accounts, activeAccount, login, signUp, logout, switchAccount } = auth;

  const trading = useAccumulatorTrading({ ws, isConnected, isExhausted, isAuthenticated: !!auth.wsUrl, onAuthWSFailed: logout });

  const { chartData } = useSmartChartChartData(trading.ws, trading.isConnected, trading.symbols);
  const { getQuotes, subscribeQuotes, unsubscribeQuotes } = useSmartChartsApi(trading.ws);

  // The single accumulator position allowed for the active symbol.
  const activeAccuPosition = useMemo(
    () =>
      trading.openPositions.find(
        (p) => p.contract_type === 'ACCU' && p.underlying_symbol === trading.activeSymbol?.underlying_symbol
      ) ?? null,
    [trading.openPositions, trading.activeSymbol]
  );

  // Auto-trader configuration.
  const [autoConfig, setAutoConfig] = useState<AutoTraderConfig>(DEFAULT_AUTO_TRADER_CONFIG);
  const handleConfigChange = useCallback((patch: Partial<AutoTraderConfig>) => {
    setAutoConfig((prev) => ({ ...prev, ...patch }));
  }, []);

  const isAuthenticated = authState === 'authenticated';

  const autoTrader = useAutoTrader({
    config: autoConfig,
    isConnected: trading.isConnected,
    isAuthenticated,
    prices: trading.prices,
    proposal: trading.proposal,
    activePosition: activeAccuPosition,
    openPositions: trading.openPositions,
    isBuying: trading.isBuying,
    sellingId: trading.sellingId,
    setStake: trading.setStake,
    buyContract: trading.buyContract,
    sellContract: trading.sellContract,
  });

  return (
    <AccumulatorView
      authState={authState}
      accounts={accounts}
      activeAccount={activeAccount}
      onLogin={login}
      onSignUp={signUp}
      onLogout={logout}
      onSwitchAccount={switchAccount}
      logoSrc={logoSrc}
      isConnected={trading.isConnected}
      isLoading={trading.isLoading}
      error={trading.error}
      activeSymbol={trading.activeSymbol}
      selectSymbol={trading.selectSymbol}
      growthRate={trading.growthRate}
      setGrowthRate={trading.setGrowthRate}
      growthRateOptions={trading.growthRateOptions}
      stake={trading.stake}
      setStake={trading.setStake}
      takeProfit={trading.takeProfit}
      setTakeProfit={trading.setTakeProfit}
      proposal={trading.proposal}
      buyContract={trading.buyContract}
      isBuying={trading.isBuying}
      buyResult={trading.buyResult}
      buyError={trading.buyError}
      clearBuyResult={trading.clearBuyResult}
      openPositions={trading.openPositions}
      sellContract={trading.sellContract}
      sellingId={trading.sellingId}
      chartData={chartData}
      getQuotes={getQuotes}
      subscribeQuotes={subscribeQuotes}
      unsubscribeQuotes={unsubscribeQuotes}
      autoConfig={autoConfig}
      onAutoConfigChange={handleConfigChange}
      autoTrader={autoTrader}
    />
  );
}
