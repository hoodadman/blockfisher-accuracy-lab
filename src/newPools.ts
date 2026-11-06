import type { Network, TokenRef } from './types';

/**
 * Where the daily sample comes from: GeckoTerminal's list of newly created pools on each
 * chain (free, no key, about 30 calls a minute). We take each pool's base token, the one
 * being launched, never the coin it's paired with.
 */
const GECKO = 'https://api.geckoterminal.com/api/v2';
const GECKO_NETWORK: Record<Network, string> = { eth: 'eth', base: 'base', bsc: 'bsc', sol: 'solana' };

/** H, 2026-11-06: all four chains, weighted towards Solana, where most new tokens launch. */
export const DAILY_QUOTA: Record<Network, number> = { sol: 25, base: 10, bsc: 10, eth: 5 };

/** Pools thinner than this are mostly dust and say nothing about the scanner. */
export const MIN_LIQUIDITY_USD = Number(process.env.MIN_LIQUIDITY_USD ?? 5_000);

/** Coins that new tokens are paired with. Never scanned as "new". */
const QUOTES = new Set(
  [
    // Solana: wrapped SOL, USDC, USDT
    'So11111111111111111111111111111111111111112',
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    // Ethereum: WETH, USDC, USDT, DAI
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    '0xdac17f958d2ee523a2206206994597c13d831ec7',
    '0x6b175474e89094c44da98b954eedeac495271d0f',
    // Base: WETH, USDC
    '0x4200000000000000000000000000000000000006',
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    // BNB Chain: WBNB, USDT, USDC, BUSD
    '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
    '0x55d398326f99059ff775485246999027b3197955',
    '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
    '0xe9e7cea3dedca5984780bafc599bd69add087d56',
  ].map((address) => address.toLowerCase()),
);

export interface GeckoPool {
  attributes?: { reserve_in_usd?: string | null; pool_created_at?: string | null };
  relationships?: { base_token?: { data?: { id?: string } }; quote_token?: { data?: { id?: string } } };
}

/** "solana_<mint>" or "eth_0x..." to an address. */
function addressOf(id: string | undefined, network: Network): string | undefined {
  const prefix = `${GECKO_NETWORK[network]}_`;
  if (!id?.startsWith(prefix)) return undefined;
  const address = id.slice(prefix.length);
  return network === 'sol' ? address : address.toLowerCase();
}

/** New tokens from one page of pools, thin and quote-coin pools left out. */
export function tokensFromPools(pools: readonly GeckoPool[], network: Network, minLiquidity = MIN_LIQUIDITY_USD): TokenRef[] {
  const tokens: TokenRef[] = [];
  for (const pool of pools) {
    const liquidity = Number(pool.attributes?.reserve_in_usd ?? 0);
    if (!(liquidity >= minLiquidity)) continue;
    const address = addressOf(pool.relationships?.base_token?.data?.id, network);
    if (!address || QUOTES.has(address.toLowerCase())) continue;
    tokens.push({ network, address });
  }
  return tokens;
}

export type FetchPools = (network: Network, page: number) => Promise<GeckoPool[]>;

export const fetchGeckoPools: FetchPools = async (network, page) => {
  const response = await fetch(`${GECKO}/networks/${GECKO_NETWORK[network]}/new_pools?page=${page}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GeckoTerminal ${network} page ${page}: HTTP ${response.status}`);
  const body = (await response.json()) as { data?: GeckoPool[] };
  return body.data ?? [];
};

/**
 * Up to `quota` new tokens per chain that aren't logged yet. Reads up to `maxPages` pages
 * per chain (20 pools each), pausing between calls to stay inside GeckoTerminal's limit.
 */
export async function pickNewTokens(
  seen: (token: TokenRef) => Promise<boolean>,
  fetchPools: FetchPools = fetchGeckoPools,
  quota: Record<Network, number> = DAILY_QUOTA,
  pause: () => Promise<void> = () => sleep(2_500),
  maxPages = 5,
): Promise<TokenRef[]> {
  const picked: TokenRef[] = [];
  for (const network of Object.keys(quota) as Network[]) {
    const wanted = quota[network];
    const chosen = new Set<string>();
    for (let page = 1; page <= maxPages && chosen.size < wanted; page += 1) {
      let pools: GeckoPool[];
      try {
        pools = await fetchPools(network, page);
      } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        break;
      }
      await pause();
      if (pools.length === 0) break;
      for (const token of tokensFromPools(pools, network)) {
        if (chosen.size >= wanted) break;
        if (chosen.has(token.address) || (await seen(token))) continue;
        chosen.add(token.address);
        picked.push(token);
      }
    }
    if (chosen.size < wanted) console.log(`${network}: found ${chosen.size} of ${wanted} new tokens today`);
  }
  return picked;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
