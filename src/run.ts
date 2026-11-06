import { pickNewTokens, sleep, type FetchPools } from './newPools';
import { classify, MAX_ATTEMPTS } from './rules';
import type { Store } from './store';
import { HORIZONS, type Horizon, type OutcomeRow, type Scanner, type ScanRow } from './types';

const DAY = 86_400_000;

export interface RunOptions {
  now?: number;
  fetchPools?: FetchPools;
  /** Wait between scans so the free sources aren't hammered. */
  pause?: () => Promise<void>;
  /** At most this many outcome checks a run. */
  maxChecks?: number;
}

export interface RunSummary {
  scanned: number;
  skipped: number;
  checked: number;
}

/** One daily run: log today's new tokens, then check the ones that reached 7 or 30 days. */
export async function runDaily(store: Store, scanner: Scanner, options: RunOptions = {}): Promise<RunSummary> {
  const now = options.now ?? Date.now();
  const pause = options.pause ?? (() => sleep(3_000));
  const summary: RunSummary = { scanned: 0, skipped: 0, checked: 0 };

  const tokens = await pickNewTokens((token) => store.hasToken(token), options.fetchPools, undefined, pause);
  for (const token of tokens) {
    try {
      const snapshot = await scanner.scan(token);
      if (snapshot === 'not-found') {
        summary.skipped += 1;
      } else {
        await store.addScan({ ...token, ...snapshot, scannedAt: now, v2Version: scanner.version });
        summary.scanned += 1;
      }
    } catch (error) {
      summary.skipped += 1;
      console.error(`scan ${token.network}:${token.address} failed:`, error instanceof Error ? error.message : error);
    }
    await pause();
  }

  for (const { scan, horizon, previous } of await dueChecks(store, now, options.maxChecks ?? 300)) {
    const attempts = (previous?.attempts ?? 0) + 1;
    let row: OutcomeRow;
    try {
      const { outcome, detail } = classify(scan, await scanner.scan(scan));
      row = { scanId: scan.id, horizon, checkedAt: now, attempts, outcome, detail, review: null };
    } catch (error) {
      const detail = `Sources didn't answer (try ${attempts} of ${MAX_ATTEMPTS}).`;
      console.error(`check ${scan.network}:${scan.address} failed:`, error instanceof Error ? error.message : error);
      row = { scanId: scan.id, horizon, checkedAt: now, attempts, outcome: 'unknown', detail, review: null };
    }
    await store.saveOutcome(row);
    summary.checked += 1;
    await pause();
  }
  return summary;
}

/** Scans that reached a horizon and have no answer for it yet, or one worth retrying (once a day). */
export async function dueChecks(store: Store, now: number, limit: number) {
  const outcomes = new Map((await store.outcomes()).map((row) => [`${row.scanId}:${row.horizon}`, row]));
  const due: Array<{ scan: ScanRow; horizon: Horizon; previous?: OutcomeRow }> = [];
  for (const scan of await store.scans()) {
    for (const horizon of HORIZONS) {
      if (now - scan.scannedAt < horizon * DAY) continue;
      const previous = outcomes.get(`${scan.id}:${horizon}`);
      const retry = previous?.outcome === 'unknown' && previous.attempts < MAX_ATTEMPTS && now - previous.checkedAt >= DAY / 2;
      if (previous && !retry) continue;
      due.push({ scan, horizon, previous });
      if (due.length >= limit) return due;
    }
  }
  return due;
}
