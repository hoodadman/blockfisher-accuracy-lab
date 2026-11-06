import { describeRate, buildReport } from './report';
import { runDaily } from './run';
import { openStore } from './store';
import { v2Scanner } from './v2';

// The Render cron job runs this once a day: npm run daily
const store = await openStore();
try {
  console.log(`accuracy lab: v2 ${v2Scanner.version}, store ${store.kind}`);
  const summary = await runDaily(store, v2Scanner);
  console.log(`logged ${summary.scanned} new tokens, skipped ${summary.skipped}, ran ${summary.checked} outcome checks`);
  const report = buildReport(await store.scans(), await store.outcomes());
  for (const horizon of report.horizons) {
    console.log(`${horizon.horizon}-day wrong-safe: ${describeRate(horizon.overall)}, ${horizon.overall.pending} waiting for review`);
  }
} finally {
  await store.close();
}
