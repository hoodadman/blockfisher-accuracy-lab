import { calledSafe, raisedAlarm, wentBad } from './rules';
import { HORIZONS, type Horizon, type OutcomeRow, type ScanRow } from './types';

export interface Rate {
  /** Called safe and checked, with a known outcome. */
  safe: number;
  /** Of those, how many went bad. */
  bad: number;
  /** Called safe and collapsed, waiting for H's review. */
  pending: number;
}

export interface HorizonReport {
  horizon: Horizon;
  overall: Rate;
  byChain: Record<string, Rate>;
  byVersion: Record<string, Rate>;
  /** Alarms (score under 40, or 0) on tokens that turned out fine, out of all alarms with a known outcome. */
  falseAlarms: { alarms: number; fine: number };
}

export interface Miss {
  scan: ScanRow;
  outcome: OutcomeRow;
  status: 'bad' | 'pending';
}

export interface Report {
  generatedAt: number;
  scans: number;
  horizons: HorizonReport[];
  misses: Miss[];
}

const empty = (): Rate => ({ safe: 0, bad: 0, pending: 0 });

export function buildReport(scans: readonly ScanRow[], outcomes: readonly OutcomeRow[], now = Date.now()): Report {
  const byId = new Map(scans.map((scan) => [scan.id, scan]));
  const horizons = HORIZONS.map((horizon): HorizonReport => {
    const report: HorizonReport = { horizon, overall: empty(), byChain: {}, byVersion: {}, falseAlarms: { alarms: 0, fine: 0 } };
    for (const outcome of outcomes) {
      if (outcome.horizon !== horizon) continue;
      const scan = byId.get(outcome.scanId);
      if (!scan) continue;
      const bad = wentBad(outcome);
      if (calledSafe(scan)) {
        const rates = [report.overall, (report.byChain[scan.network] ??= empty()), (report.byVersion[scan.v2Version] ??= empty())];
        for (const rate of rates) {
          if (bad === undefined) {
            if (outcome.outcome === 'collapsed') rate.pending += 1;
            continue;
          }
          rate.safe += 1;
          if (bad) rate.bad += 1;
        }
      } else if (raisedAlarm(scan) && bad !== undefined) {
        report.falseAlarms.alarms += 1;
        if (!bad) report.falseAlarms.fine += 1;
      }
    }
    return report;
  });
  const misses: Miss[] = [];
  for (const outcome of outcomes) {
    const scan = byId.get(outcome.scanId);
    if (!scan || !calledSafe(scan)) continue;
    const bad = wentBad(outcome);
    if (bad) misses.push({ scan, outcome, status: 'bad' });
    else if (bad === undefined && outcome.outcome === 'collapsed') misses.push({ scan, outcome, status: 'pending' });
  }
  // Waiting for review first, then newest first.
  misses.sort((a, b) => (a.status === b.status ? b.outcome.checkedAt - a.outcome.checkedAt : a.status === 'pending' ? -1 : 1));
  return { generatedAt: now, scans: scans.length, horizons, misses };
}

/** "2 of 340 (0.6%)", or "none checked yet". */
export function describeRate(rate: Rate): string {
  if (rate.safe === 0) return 'none checked yet';
  return `${rate.bad} of ${rate.safe} (${((rate.bad / rate.safe) * 100).toFixed(1)}%)`;
}
