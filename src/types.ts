export type Network = 'eth' | 'base' | 'bsc' | 'sol';
export const NETWORKS: readonly Network[] = ['sol', 'base', 'bsc', 'eth'];

export interface TokenRef {
  network: Network;
  address: string;
}

export interface Issue {
  id: string;
  severity: 'critical' | 'warning' | 'minor';
  title: string;
}

/** What v2's scoring said about a token at one moment. Security and Foundation only, never Community. */
export interface Snapshot {
  name?: string;
  symbol?: string;
  /** 0-100, or null when too few checks had data. */
  security: number | null;
  band: 'low' | 'medium' | 'high' | null;
  /** Set when v2 forced the score to 0 (honeypot, trading off, sell tax over the line). */
  fatal: string | null;
  foundation: number | null;
  issues: Issue[];
  coverage: { checked: number; total: number };
  /** Sources that failed during the scan. */
  failures: string[];
  liquidityUsd?: number;
  launchedAt?: number;
  honeypotRisk?: number;
  buyFeePct?: number;
  sellFeePct?: number;
  transferFeePct?: number;
  tradingPaused?: boolean;
  canTakeTokens?: boolean;
}

export interface Scanner {
  /** The v2 commit the scoring came from. */
  version: string;
  /** 'not-found' when the token no longer trades anywhere; throws when sources are down. */
  scan(token: TokenRef): Promise<Snapshot | 'not-found'>;
}

export interface ScanRow extends TokenRef, Snapshot {
  id: number;
  scannedAt: number;
  v2Version: string;
}

export const HORIZONS = [7, 30] as const;
export type Horizon = (typeof HORIZONS)[number];

export type Outcome = 'honeypot' | 'tax' | 'paused' | 'takeover' | 'collapsed' | 'fine' | 'unknown';
export type Review = 'rug' | 'faded';

export interface OutcomeRow {
  scanId: number;
  horizon: Horizon;
  checkedAt: number;
  attempts: number;
  outcome: Outcome;
  detail: string;
  /** H's verdict on a collapsed pool: a rug (went bad) or a token that just faded. */
  review: Review | null;
}
