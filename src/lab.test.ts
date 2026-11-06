import { describe, expect, it } from 'vitest';
import { tokensFromPools, pickNewTokens, type GeckoPool } from './newPools';
import { renderPage } from './page';
import { buildReport, describeRate } from './report';
import { classify, wentBad } from './rules';
import { runDaily } from './run';
import { memoryStore } from './store';
import type { Network, OutcomeRow, Scanner, ScanRow, Snapshot, TokenRef } from './types';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 11, 1);

const clean: Snapshot = {
  security: 92,
  band: 'low',
  fatal: null,
  foundation: 60,
  issues: [],
  coverage: { checked: 18, total: 22 },
  failures: [],
  liquidityUsd: 40_000,
  honeypotRisk: 0,
  sellFeePct: 0,
  transferFeePct: 0,
};

const row = (over: Partial<ScanRow> = {}): ScanRow => ({
  id: 1,
  network: 'sol',
  address: 'Mint1111111111111111111111111111111111111111',
  scannedAt: NOW - 8 * DAY,
  v2Version: 'abc123',
  ...clean,
  ...over,
});

const pool = (network: string, address: string, liquidity: number): GeckoPool => ({
  attributes: { reserve_in_usd: String(liquidity) },
  relationships: { base_token: { data: { id: `${network}_${address}` } } },
});

describe('classify', () => {
  it('finds each way a token goes bad', () => {
    expect(classify(row(), { ...clean, honeypotRisk: 100 }).outcome).toBe('honeypot');
    expect(classify(row(), { ...clean, sellFeePct: 50.5 }).outcome).toBe('tax');
    expect(classify(row(), { ...clean, sellFeePct: 50 }).outcome).toBe('fine');
    expect(classify(row(), { ...clean, tradingPaused: true }).outcome).toBe('paused');
    expect(classify(row(), { ...clean, canTakeTokens: true }).outcome).toBe('takeover');
  });

  it('only counts a power as new if the scan didn’t already show it', () => {
    const shown = row({ issues: [{ id: 'canTakeTokens', severity: 'critical', title: 'Creator can take your tokens' }] });
    expect(classify(shown, { ...clean, canTakeTokens: true }).outcome).toBe('fine');
  });

  it('sends collapsed pools for review', () => {
    expect(classify(row(), { ...clean, liquidityUsd: 3_000 }).outcome).toBe('collapsed');
    expect(classify(row(), { ...clean, liquidityUsd: 5_000 }).outcome).toBe('fine');
    expect(classify(row(), 'not-found').outcome).toBe('collapsed');
    expect(wentBad({ outcome: 'collapsed', review: null })).toBeUndefined();
    expect(wentBad({ outcome: 'collapsed', review: 'rug' })).toBe(true);
    expect(wentBad({ outcome: 'collapsed', review: 'faded' })).toBe(false);
  });
});

describe('new pools', () => {
  it('takes the launched token, not the coin it’s paired with, and skips thin pools', () => {
    const tokens = tokensFromPools(
      [
        pool('solana', 'NewMint11111111111111111111111111111111111', 20_000),
        pool('solana', 'So11111111111111111111111111111111111111112', 90_000),
        pool('solana', 'Dust111111111111111111111111111111111111111', 900),
        pool('eth', '0xABCDEF0000000000000000000000000000000001', 10_000),
      ],
      'sol',
    );
    expect(tokens).toEqual([{ network: 'sol', address: 'NewMint11111111111111111111111111111111111' }]);
    expect(tokensFromPools([pool('eth', '0xABCDEF0000000000000000000000000000000001', 10_000)], 'eth')).toEqual([
      { network: 'eth', address: '0xabcdef0000000000000000000000000000000001' },
    ]);
  });

  it('fills each chain’s quota, skipping tokens already logged', async () => {
    const fetchPools = async (network: Network, page: number) =>
      page > 2 ? [] : Array.from({ length: 20 }, (_, i) => pool(network === 'sol' ? 'solana' : network, `${network}${page}x${i}`.padEnd(40, '0'), 10_000));
    const seen = async (token: TokenRef) => token.address.startsWith('sol1x0');
    const picked = await pickNewTokens(seen, fetchPools, { sol: 25, base: 10, bsc: 10, eth: 5 }, async () => {});
    const count = (network: Network) => picked.filter((token) => token.network === network).length;
    expect([count('sol'), count('base'), count('bsc'), count('eth')]).toEqual([25, 10, 10, 5]);
    expect(picked.some((token) => token.address.startsWith('sol1x0'))).toBe(false);
  });
});

describe('daily run', () => {
  it('logs new tokens, then checks them at 7 and 30 days', async () => {
    const store = memoryStore();
    const answers = new Map<string, Snapshot | 'not-found'>();
    const scanner: Scanner = { version: 'v1', scan: async (token) => answers.get(token.address) ?? clean };
    const fetchPools = async (network: Network, page: number) =>
      network === 'sol' && page === 1 ? [pool('solana', 'Good1111111111111111111111111111111111111', 50_000), pool('solana', 'Rug11111111111111111111111111111111111111', 50_000)] : [];
    const options = { fetchPools, pause: async () => {} };

    expect(await runDaily(store, scanner, { ...options, now: NOW })).toEqual({ scanned: 2, skipped: 0, checked: 0 });
    // Nothing new on later days; the rug token's pool is pulled.
    answers.set('Rug11111111111111111111111111111111111111', { ...clean, liquidityUsd: 10 });
    const later = { ...options, fetchPools: async () => [] };
    expect((await runDaily(store, scanner, { ...later, now: NOW + 3 * DAY })).checked).toBe(0);
    expect((await runDaily(store, scanner, { ...later, now: NOW + 7 * DAY })).checked).toBe(2);
    expect((await runDaily(store, scanner, { ...later, now: NOW + 8 * DAY })).checked).toBe(0);

    let report = buildReport(await store.scans(), await store.outcomes(), NOW + 8 * DAY);
    expect(report.horizons[0].overall).toEqual({ safe: 1, bad: 0, pending: 1 });
    expect(report.misses.map((miss) => miss.status)).toEqual(['pending']);

    expect(await store.setReview(2, 7, 'rug')).toBe(true);
    report = buildReport(await store.scans(), await store.outcomes(), NOW + 8 * DAY);
    expect(describeRate(report.horizons[0].overall)).toBe('1 of 2 (50.0%)');
    expect(renderPage(report)).toContain('Reviewed: rug');

    expect((await runDaily(store, scanner, { ...later, now: NOW + 30 * DAY })).checked).toBe(2);
  });

  it('retries a check the sources didn’t answer, up to 3 times', async () => {
    const store = memoryStore();
    let down = false;
    const scanner: Scanner = {
      version: 'v1',
      scan: async () => {
        if (down) throw new Error('GoPlus 503');
        return clean;
      },
    };
    const first = async (network: Network, page: number) => (network === 'eth' && page === 1 ? [pool('eth', '0x1111111111111111111111111111111111111111', 9_000)] : []);
    await runDaily(store, scanner, { now: NOW, fetchPools: first, pause: async () => {} });
    down = true;
    const none = { fetchPools: async () => [], pause: async () => {} };
    for (let d = 7; d <= 11; d += 1) await runDaily(store, scanner, { ...none, now: NOW + d * DAY });
    const outcome = (await store.outcomes()).find((o: OutcomeRow) => o.horizon === 7);
    expect([outcome?.outcome, outcome?.attempts]).toEqual(['unknown', 3]);
    const report = buildReport(await store.scans(), await store.outcomes());
    expect(report.horizons[0].overall).toEqual({ safe: 0, bad: 0, pending: 0 });
  });

  it('never counts a token that scored under 80 as called safe', () => {
    const scans = [row({ id: 1, security: 79, band: 'medium' }), row({ id: 2, security: 0, fatal: 'honeypot', band: 'high' })];
    const outcomes: OutcomeRow[] = scans.map((scan) => ({ scanId: scan.id, horizon: 7, checkedAt: NOW, attempts: 1, outcome: 'honeypot', detail: '', review: null }));
    const report = buildReport(scans, outcomes);
    expect(report.horizons[0].overall.safe).toBe(0);
    expect(report.horizons[0].falseAlarms).toEqual({ alarms: 1, fine: 0 });
  });
});

describe('report page', () => {
  it('escapes token names', () => {
    const scan = row({ symbol: '<script>alert(1)</script>' });
    const outcome: OutcomeRow = { scanId: 1, horizon: 7, checkedAt: NOW, attempts: 1, outcome: 'honeypot', detail: '', review: null };
    const page = renderPage(buildReport([scan], [outcome]));
    expect(page).not.toContain('<script>alert');
    expect(page).toContain('&lt;script&gt;');
  });
});
