import type { Outcome, OutcomeRow, ScanRow, Snapshot } from './types';

/** H, 2026-11-06: a Security score of 80 or more is "called safe". */
export const SAFE_LINE = 80;
/** Below this (or a forced 0) the scanner raised the alarm. */
export const ALARM_LINE = 40;
/** H, 2026-11-06: a sell or transfer tax over 50% stops you getting your money out. */
export const BAD_TAX_PCT = 50;
/** Liquidity at or below this share of the scan-day figure counts as collapsed. */
export const COLLAPSE_SHARE = 0.1;
/** Sources that keep failing: give up after this many tries and leave the row out of the rate. */
export const MAX_ATTEMPTS = 3;

export const calledSafe = (scan: ScanRow) => scan.fatal === null && scan.security !== null && scan.security >= SAFE_LINE;
export const raisedAlarm = (scan: ScanRow) => scan.fatal !== null || (scan.security !== null && scan.security < ALARM_LINE);

/** What happened to a token since it was scanned. Collapsed pools go to H to call rug or faded. */
export function classify(baseline: ScanRow, now: Snapshot | 'not-found'): { outcome: Outcome; detail: string } {
  if (now === 'not-found') return { outcome: 'collapsed', detail: 'No longer trades anywhere we can find.' };
  if ((now.honeypotRisk ?? 0) >= 90) return { outcome: 'honeypot', detail: 'The sell test now fails.' };
  const exitTax = Math.max(now.sellFeePct ?? 0, now.transferFeePct ?? 0);
  if (exitTax > BAD_TAX_PCT) return { outcome: 'tax', detail: `Sell or transfer tax is now ${round(exitTax)}%.` };
  if (now.tradingPaused) return { outcome: 'paused', detail: 'Trading is switched off.' };
  if (now.canTakeTokens && !baseline.issues.some((issue) => issue.id === 'canTakeTokens')) {
    return { outcome: 'takeover', detail: 'The creator can now take tokens from wallets.' };
  }
  const before = baseline.liquidityUsd ?? 0;
  if (before > 0 && now.liquidityUsd !== undefined && now.liquidityUsd <= before * COLLAPSE_SHARE) {
    return { outcome: 'collapsed', detail: `Liquidity fell from $${dollars(before)} to $${dollars(now.liquidityUsd)}.` };
  }
  return { outcome: 'fine', detail: '' };
}

/** True = went bad, false = didn't, undefined = not known yet (collapsed and not reviewed, or no answer). */
export function wentBad(outcome: Pick<OutcomeRow, 'outcome' | 'review'>): boolean | undefined {
  switch (outcome.outcome) {
    case 'honeypot':
    case 'tax':
    case 'paused':
    case 'takeover':
      return true;
    case 'collapsed':
      return outcome.review === null ? undefined : outcome.review === 'rug';
    case 'fine':
      return false;
    default:
      return undefined;
  }
}

const round = (value: number) => Number(value.toFixed(1));
const dollars = (value: number) => Math.round(value).toLocaleString('en-GB');
