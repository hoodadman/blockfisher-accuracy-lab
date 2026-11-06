import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import { renderPage } from './page';
import { buildReport } from './report';
import { openStore } from './store';
import type { Horizon, Review } from './types';

/**
 * The private report page. Your browser asks for a password: ADMIN_PASSWORD on Render
 * (any user name). Without it set, the page refuses everyone.
 */
const PASSWORD = process.env.ADMIN_PASSWORD ?? '';
const store = await openStore();

function allowed(req: IncomingMessage): boolean {
  if (!PASSWORD) return false;
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString();
  const given = Buffer.from(decoded.slice(decoded.indexOf(':') + 1));
  const wanted = Buffer.from(PASSWORD);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) break;
  }
  return new URLSearchParams(body);
}

const server = createServer(async (req, res) => {
  try {
    if (!allowed(req)) {
      res.writeHead(401, { 'www-authenticate': 'Basic realm="accuracy lab"', 'content-type': 'text/plain' });
      res.end(PASSWORD ? 'Password needed.' : 'Set ADMIN_PASSWORD to open this page.');
      return;
    }
    const url = new URL(req.url ?? '/', 'http://lab');
    if (req.method === 'POST' && url.pathname === '/review') {
      const form = await readForm(req);
      const scan = Number(form.get('scan'));
      const horizon = Number(form.get('horizon')) as Horizon;
      const verdict = form.get('verdict') as Review;
      if (Number.isInteger(scan) && (horizon === 7 || horizon === 30) && (verdict === 'rug' || verdict === 'faded')) {
        await store.setReview(scan, horizon, verdict);
      }
      res.writeHead(303, { location: '/' });
      res.end();
      return;
    }
    if (req.method === 'GET' && url.pathname === '/') {
      const page = renderPage(buildReport(await store.scans(), await store.outcomes()));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
      res.end(page);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found.');
  } catch (error) {
    console.error(error);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Something went wrong.');
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`accuracy lab report on :${port} (store ${store.kind})`));
