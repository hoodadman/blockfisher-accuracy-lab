import type { Horizon, OutcomeRow, Review, ScanRow, TokenRef } from './types';

/** Where the lab keeps its log. Its own Postgres database, never the live scanner's. */
export interface Store {
  kind: string;
  hasToken(token: TokenRef): Promise<boolean>;
  addScan(row: Omit<ScanRow, 'id'>): Promise<number>;
  scans(): Promise<ScanRow[]>;
  outcomes(): Promise<OutcomeRow[]>;
  saveOutcome(row: OutcomeRow): Promise<void>;
  /** H's verdict on a collapsed pool. False when there was no such row. */
  setReview(scanId: number, horizon: Horizon, review: Review): Promise<boolean>;
  close(): Promise<void>;
}

const keyOf = (token: TokenRef) => `${token.network}:${token.network === 'sol' ? token.address : token.address.toLowerCase()}`;

export function memoryStore(): Store {
  const scanRows: ScanRow[] = [];
  const outcomeRows = new Map<string, OutcomeRow>();
  return {
    kind: 'memory',
    hasToken: async (token) => scanRows.some((row) => keyOf(row) === keyOf(token)),
    addScan: async (row) => {
      const id = scanRows.length + 1;
      scanRows.push({ ...row, id });
      return id;
    },
    scans: async () => [...scanRows],
    outcomes: async () => [...outcomeRows.values()],
    saveOutcome: async (row) => {
      outcomeRows.set(`${row.scanId}:${row.horizon}`, row);
    },
    setReview: async (scanId, horizon, review) => {
      const row = outcomeRows.get(`${scanId}:${horizon}`);
      if (!row || row.outcome !== 'collapsed') return false;
      outcomeRows.set(`${scanId}:${horizon}`, { ...row, review });
      return true;
    },
    close: async () => {},
  };
}

const SCHEMA = [
  `create table if not exists lab_scans (
    id serial primary key,
    token_key text not null unique,
    network text not null,
    address text not null,
    scanned_at timestamptz not null,
    v2_version text not null,
    security integer,
    band text,
    fatal text,
    foundation integer,
    liquidity_usd double precision,
    snapshot jsonb not null
  )`,
  `create table if not exists lab_outcomes (
    scan_id integer not null references lab_scans(id),
    horizon integer not null,
    checked_at timestamptz not null,
    attempts integer not null,
    outcome text not null,
    detail text not null,
    review text,
    primary key (scan_id, horizon)
  )`,
];

export async function postgresStore(url: string): Promise<Store> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  for (const statement of SCHEMA) await pool.query(statement);
  return {
    kind: 'postgres',
    hasToken: async (token) => (await pool.query('select 1 from lab_scans where token_key = $1', [keyOf(token)])).rowCount! > 0,
    addScan: async (row) => {
      const result = await pool.query(
        `insert into lab_scans (token_key, network, address, scanned_at, v2_version, security, band, fatal, foundation, liquidity_usd, snapshot)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
        [keyOf(row), row.network, row.address, new Date(row.scannedAt), row.v2Version, row.security, row.band, row.fatal, row.foundation, row.liquidityUsd ?? null, JSON.stringify(row)],
      );
      return result.rows[0].id as number;
    },
    scans: async () => {
      const result = await pool.query('select id, snapshot from lab_scans order by id');
      return result.rows.map((row) => ({ ...(row.snapshot as ScanRow), id: row.id as number }));
    },
    outcomes: async () => {
      const result = await pool.query('select * from lab_outcomes');
      return result.rows.map((row) => ({
        scanId: row.scan_id as number,
        horizon: row.horizon as Horizon,
        checkedAt: (row.checked_at as Date).getTime(),
        attempts: row.attempts as number,
        outcome: row.outcome as OutcomeRow['outcome'],
        detail: row.detail as string,
        review: (row.review ?? null) as Review | null,
      }));
    },
    saveOutcome: async (row) => {
      await pool.query(
        `insert into lab_outcomes (scan_id, horizon, checked_at, attempts, outcome, detail, review)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (scan_id, horizon) do update set checked_at = excluded.checked_at, attempts = excluded.attempts,
           outcome = excluded.outcome, detail = excluded.detail, review = excluded.review`,
        [row.scanId, row.horizon, new Date(row.checkedAt), row.attempts, row.outcome, row.detail, row.review],
      );
    },
    setReview: async (scanId, horizon, review) => {
      const result = await pool.query(
        "update lab_outcomes set review = $3 where scan_id = $1 and horizon = $2 and outcome = 'collapsed'",
        [scanId, horizon, review],
      );
      return (result.rowCount ?? 0) > 0;
    },
    close: () => pool.end(),
  };
}

export async function openStore(url = process.env.DATABASE_URL?.trim()): Promise<Store> {
  if (url) return postgresStore(url);
  console.warn('DATABASE_URL is not set: using memory, nothing will be kept.');
  return memoryStore();
}
