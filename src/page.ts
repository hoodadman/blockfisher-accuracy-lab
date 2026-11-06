import { describeRate, type Miss, type Rate, type Report } from './report';
import { SAFE_LINE } from './rules';

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const EXPLORER: Record<string, string> = {
  sol: 'https://dexscreener.com/solana/',
  eth: 'https://dexscreener.com/ethereum/',
  base: 'https://dexscreener.com/base/',
  bsc: 'https://dexscreener.com/bsc/',
};

function rateCells(rate: Rate | undefined) {
  if (!rate) return '<td>none checked yet</td><td>0</td>';
  return `<td>${escape(describeRate(rate))}</td><td>${rate.pending}</td>`;
}

function missRow(miss: Miss) {
  const { scan, outcome } = miss;
  const name = scan.symbol ?? scan.name ?? scan.address.slice(0, 8);
  const link = `${EXPLORER[scan.network]}${scan.address}`;
  const review =
    miss.status === 'pending'
      ? `<form method="post" action="/review">
          <input type="hidden" name="scan" value="${scan.id}"><input type="hidden" name="horizon" value="${outcome.horizon}">
          <button name="verdict" value="rug">Rug</button> <button name="verdict" value="faded">Faded</button>
        </form>`
      : outcome.review
        ? `Reviewed: ${escape(outcome.review)}`
        : 'Automatic';
  const issues = scan.issues.map((issue) => escape(issue.title)).join(', ') || 'none';
  return `<tr>
    <td><a href="${escape(link)}" target="_blank" rel="noopener">${escape(name)}</a><br><small>${escape(scan.network)}</small></td>
    <td>${day(scan.scannedAt)}</td>
    <td>${scan.security}</td>
    <td>${outcome.horizon} days: ${escape(outcome.outcome)}<br><small>${escape(outcome.detail)}</small></td>
    <td><small>${issues}<br>checks ${scan.coverage.checked}/${scan.coverage.total}${scan.failures.length ? `, failed: ${escape(scan.failures.join(', '))}` : ''}</small></td>
    <td>${review}</td>
  </tr>`;
}

/** The private report page: wrong-safe rates and the list of misses for H to review. */
export function renderPage(report: Report): string {
  const chains = ['sol', 'base', 'bsc', 'eth'];
  const versions = [...new Set(report.horizons.flatMap((h) => Object.keys(h.byVersion)))];
  const pending = report.misses.filter((miss) => miss.status === 'pending').length;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Accuracy lab</title>
<style>
  :root { color-scheme: light dark; --line: #8884; }
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 1000px; margin: 0 auto; padding: 16px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 24px; }
  th, td { border-bottom: 1px solid var(--line); padding: 6px 8px; text-align: left; vertical-align: top; }
  .wrap { overflow-x: auto; }
  small { opacity: .75; }
</style></head><body>
<h1>Accuracy lab</h1>
<p>Security score ${SAFE_LINE}+ counts as "called safe". ${report.scans} tokens logged. Updated ${escape(new Date(report.generatedAt).toISOString().slice(0, 16).replace('T', ' '))} UTC.
${pending ? `<strong>${pending} collapsed ${pending === 1 ? 'token waits' : 'tokens wait'} for your review.</strong>` : ''}</p>
<h2>Called safe, then went bad</h2>
<div class="wrap"><table><tr><th></th>${report.horizons.map((h) => `<th>${h.horizon} days</th><th>waiting</th>`).join('')}</tr>
<tr><th>All chains</th>${report.horizons.map((h) => rateCells(h.overall)).join('')}</tr>
${chains.map((chain) => `<tr><th>${chain}</th>${report.horizons.map((h) => rateCells(h.byChain[chain])).join('')}</tr>`).join('')}
${versions.map((v) => `<tr><th>v2 ${escape(v)}</th>${report.horizons.map((h) => rateCells(h.byVersion[v])).join('')}</tr>`).join('')}
</table></div>
<h2>False alarms</h2>
<p>${report.horizons
    .map((h) => `${h.horizon} days: ${h.falseAlarms.fine} of ${h.falseAlarms.alarms} tokens scored under 40 (or 0) turned out fine.`)
    .join('<br>')}</p>
<h2>Misses</h2>
<p>Tokens called safe that went bad, or whose pool collapsed. Collapsed pools need your call: <b>Rug</b> (pulled on purpose) counts as a miss, <b>Faded</b> (just died) doesn't.</p>
<div class="wrap"><table><tr><th>Token</th><th>Scanned</th><th>Security</th><th>What happened</th><th>What the scan showed</th><th>Review</th></tr>
${report.misses.map(missRow).join('') || '<tr><td colspan="6">None yet.</td></tr>'}
</table></div>
</body></html>`;
}
