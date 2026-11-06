import { readFileSync } from 'node:fs';
import { setApiHosts } from '../vendor/v2/src/api/hosts';
import { LookupError, lookupToken } from '../vendor/v2/src/api/lookup';
import { PLANS } from '../vendor/v2/src/plans/plans';
import { scoreToken } from '../vendor/v2/src/scoring';
import type { Scanner, Snapshot, TokenRef } from './types';

/**
 * Runs the live scanner's own code (v2, pulled into vendor/v2 at build time) on a token,
 * with no Community and no X calls. It never calls the live server: data sources are
 * fetched directly. InsightX (holder checks) needs the live server's key, so those checks
 * show as not checked here; Security's core checks don't depend on it.
 */
setApiHosts({
  insightx: 'http://insightx.invalid',
  twitter: 'http://twitter.invalid',
  coingecko: 'https://api.coingecko.com',
  summarise: 'http://summarise.invalid',
  socials: 'http://socials.invalid',
});

const version = (() => {
  try {
    return readFileSync(new URL('../vendor/v2-version.txt', import.meta.url), 'utf8').trim();
  } catch {
    return 'unknown';
  }
})();

export const v2Scanner: Scanner = {
  version,
  async scan(token: TokenRef): Promise<Snapshot | 'not-found'> {
    let lookup;
    try {
      lookup = await lookupToken(token.address, undefined, token.network, {}, true, {
        plan: PLANS.pro,
        library: false,
        // Never read X: Community is out of scope for the lab.
        mayFetch: async () => false,
      });
    } catch (error) {
      if (error instanceof LookupError && error.reason === 'not-found') return 'not-found';
      throw error;
    }
    const security = scoreToken(lookup.signals);
    const s = lookup.signals;
    return {
      name: lookup.name,
      symbol: lookup.symbol,
      security: security.score,
      band: security.band,
      fatal: security.fatal?.id ?? null,
      foundation: lookup.foundation.score,
      issues: security.issues.map((issue) => ({ id: issue.id, severity: issue.severity, title: issue.title })),
      coverage: security.coverage,
      failures: lookup.failures.map((failure) => `${failure.source}${failure.status ? ` ${failure.status}` : ''}`),
      liquidityUsd: s.liquidityUsd,
      launchedAt: s.launchedAt,
      honeypotRisk: s.honeypotRisk,
      buyFeePct: s.buyFeePct,
      sellFeePct: s.sellFeePct,
      transferFeePct: s.transferFeePct,
      tradingPaused: s.tradingPaused,
      canTakeTokens: s.canTakeTokens,
    };
  },
};
