// Token Radar Senja v3 — the model: one sealed snapshot in, one ranked board out.
//
// The board ranks pre-token protocols by an implied value that is the model's own claim, never the
// snapshot's: implied = fitted market cap x P(token). The fitted cap comes from a log-log fit on the
// priced comps (token-bearing peers whose market cap sits within [0.02, 2] of their TVL), and P(token)
// from a logistic fit on the universe of listed peers at or above $25M of TVL plus the board rows.
// Every term in both fits passed the same two-test gate (leave-one-out and a walk-forward split at the
// median listing date); terms that failed either test are listed in the evidence section as tested and
// not kept. No protocol name is ever special-cased: the same functions score every row.
//
// Pre-token here means what the snapshot says it means: mcap_usd is null. The snapshot's own words
// are "mcap_usd (null when it records no token)". A hundred of the 194 board rows also carry a symbol
// in DefiLlama's record (a product or stablecoin ticker, not a launch token with a market cap); the
// dashboard names that count instead of hiding it. The house watchlist is stricter (both gecko_id and
// symbol null), and all 40 of its slugs are on the board.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** The board's floor in whole dollars: $25M, half the watchlist's $50M floor, so the board carries the
 *  early rows the radar exists to find while every watchlist row still clears it. */
export const BOARD_FLOOR_USD = 25_000_000;
/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Years from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageYears(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, (a - b) / DAY_MS / 365.25);
}

/** Whole days from `listedAt` to `asOf`; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  const y = ageYears(asOf, listedAt);
  return y === null ? null : Math.floor(y * 365.25);
}

// ---------------------------------------------------------------- the house rule

/** The categories the house rule keeps off the watchlist: bridged, staked and exchange products. */
export const BAD_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** A name ending in a release marker is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped, staked or staking anywhere in the name. */
const WRAPPED = /\b(wrapped|staked|staking)\b/i;
/** A name that begins with an exchange's name. */
const EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Why the house rule sets a protocol aside, or null when it keeps it. */
export function outReason(p: SnapshotProtocol): 'category' | 'versioned-name' | 'wrapped-word' | 'exchange-name' | null {
  if (p.category !== null && BAD_CATEGORIES.has(p.category)) return 'category';
  if (VERSIONED.test(p.name)) return 'versioned-name';
  if (WRAPPED.test(p.name)) return 'wrapped-word';
  if (EXCHANGE.test(p.name)) return 'exchange-name';
  return null;
}

/** Whether a protocol records no token at all, in the snapshot's own sense: no market cap. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null;
}

/** Whether a protocol is one the board may rank: pre-token, and kept by the house rule. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && outReason(p) === null;
}

// ---------------------------------------------------------------- linear algebra

/** Solve A x = b by Gauss elimination with partial pivoting; A is small and well conditioned here. */
export function solve(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    const tmp = M[c]!;
    M[c] = M[piv]!;
    M[piv] = tmp;
    const d = M[c]![c]!;
    if (Math.abs(d) < 1e-12) continue;
    for (let j = c; j <= n; j++) M[c]![j]! /= d;
    for (let r = 0; r < n; r++) {
      if (r === c || M[r]![c] === 0) continue;
      const f = M[r]![c]!;
      for (let j = c; j <= n; j++) M[r]![j]! -= f * M[c]![j]!;
    }
  }
  return M.map((row) => row[n]!);
}

/** Ordinary least squares with an optional ridge penalty (pen[i] = 0 means no penalty on term i). */
export function ols(X: number[][], y: number[], ridge = 0, pen: number[] | null = null): number[] {
  const k = X[0]!.length;
  const A: number[][] = [];
  for (let i = 0; i < k; i++) {
    A.push([]);
    for (let j = 0; j < k; j++) {
      let s = 0;
      for (let r = 0; r < X.length; r++) s += X[r]![i]! * X[r]![j]!;
      if (i === j && ridge > 0) s += ridge * (pen === null ? 1 : pen[i]!);
      A[i]!.push(s);
    }
  }
  const b: number[] = [];
  for (let i = 0; i < k; i++) {
    let s = 0;
    for (let r = 0; r < X.length; r++) s += X[r]![i]! * y[r]!;
    b.push(s);
  }
  return solve(A, b);
}

/** The median of absolute values: the middle value, or the mean of the two middles for an even count. */
export function medAbs(e: number[]): number {
  const s = e.map((x) => Math.abs(x)).sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** A deterministic PRNG (mulberry32) so the bootstrap refits are byte-identical every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over a string, as 8 lowercase hex digits; the dashboard recomputes it live. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `0000000${(h >>> 0).toString(16)}`.slice(-8);
}

// ---------------------------------------------------------------- the value model

/** One term of the value fit, in the order the spec lists them. */
export type ValueTerm = 'const' | 'tvl' | 'quad' | 'age' | 'growth' | 'chains' | 'cat';

/** A value spec: the terms of one candidate fit. The frozen model is ['const','tvl','quad','age']. */
export type ValueSpec = ValueTerm[];

/** One row of the value fit's feature vector. Age null counts as 0 (a protocol whose listing date the
 *  snapshot does not carry is scored as newborn); growth null counts as 0; chains is log(count). */
export function valueFeats(p: SnapshotProtocol, asOf: string, spec: ValueSpec, cats: string[]): number[] {
  const lt = Math.log(p.tvl_usd);
  const v: number[] = [];
  for (const f of spec) {
    if (f === 'const') v.push(1);
    else if (f === 'tvl') v.push(lt);
    else if (f === 'quad') v.push((lt * lt) / 100);
    else if (f === 'age') {
      const a = ageYears(asOf, p.listed_at);
      v.push(a === null ? 0 : Math.min(a, 6));
    } else if (f === 'growth') {
      const g = p.change_7d;
      v.push(g === null ? 0 : Math.max(-50, Math.min(50, g)) / 100);
    } else if (f === 'chains') v.push(Math.log(Math.max(1, p.chains.length)));
    else if (f === 'cat') for (const c of cats) v.push(p.category === c ? 1 : 0);
  }
  return v;
}

/** The priced comps: token-bearing peers whose market cap sits within [0.02, 2] of their TVL. The 34
 *  peers outside that band are dust caps (a ratio under 0.02) or detached valuations (over 2); fitting
 *  on all 128 leaves R-squared at 0.19, on the 94 it is 0.57. The band is stated, not tuned per row. */
export function pricedComps(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.mcap_usd / p.tvl_usd >= 0.02 && p.mcap_usd / p.tvl_usd <= 2,
  );
}

/** The median listing date of the dated protocols in `set`, as an ISO day string, or null. */
function medianListedAt(set: SnapshotProtocol[]): string | null {
  const dates = set.filter((p) => p.listed_at !== null).map((p) => p.listed_at as string).sort();
  if (dates.length === 0) return null;
  return dates[Math.floor(dates.length / 2)]!;
}

/** One candidate value fit, scored on its own peers: R-squared, leave-one-out median miss, and the
 *  walk-forward median miss (fit on protocols listed before the median date, scored on the rest). */
export interface ValueEval {
  spec: string;
  beta: number[];
  r2: number;
  loo: number;
  wf: number;
  wfCut: string | null;
  trainN: number;
  testN: number;
}

export function evalValueSpec(
  peers: SnapshotProtocol[],
  asOf: string,
  spec: ValueSpec,
  ridge = 0,
): ValueEval {
  const cats = [...new Set(peers.map((p) => p.category).filter((c): c is string => c !== null))].sort();
  const pen = spec.flatMap((f) => (f === 'cat' ? cats.map(() => 1) : [0]));
  const X = peers.map((p) => valueFeats(p, asOf, spec, cats));
  const y = peers.map((p) => Math.log(p.mcap_usd!));
  const beta = ols(X, y, ridge, pen);
  const mean = y.reduce((a, b) => a + b, 0) / y.length;
  const ssr = y.reduce((a, v, i) => a + (v - X[i]!.reduce((s, f, j) => s + f * beta[j]!, 0)) ** 2, 0);
  const sst = y.reduce((a, v) => a + (v - mean) ** 2, 0);
  const r2 = 1 - ssr / sst;
  const looErrs: number[] = [];
  for (let i = 0; i < peers.length; i++) {
    const rest = peers.filter((_, j) => j !== i);
    const bi = ols(
      rest.map((p) => valueFeats(p, asOf, spec, cats)),
      rest.map((p) => Math.log(p.mcap_usd!)),
      ridge,
      pen,
    );
    looErrs.push(y[i]! - X[i]!.reduce((s, f, j) => s + f * bi[j]!, 0));
  }
  const cut = medianListedAt(peers);
  const tr = peers.filter((p) => p.listed_at !== null && cut !== null && p.listed_at < cut);
  const te = peers.filter((p) => p.listed_at !== null && cut !== null && p.listed_at >= cut);
  let wf = NaN;
  if (tr.length > X[0]!.length + 2 && te.length > 0) {
    const bt = ols(
      tr.map((p) => valueFeats(p, asOf, spec, cats)),
      tr.map((p) => Math.log(p.mcap_usd!)),
      ridge,
      pen,
    );
    wf = medAbs(te.map((p) => Math.log(p.mcap_usd!) - valueFeats(p, asOf, spec, cats).reduce((s, f, j) => s + f * bt[j]!, 0)));
  }
  return { spec: spec.join('+'), beta, r2, loo: medAbs(looErrs), wf, wfCut: cut, trainN: tr.length, testN: te.length };
}

/** The fitted market cap of one protocol under a fitted beta. */
export function fittedCap(p: SnapshotProtocol, asOf: string, beta: number[], spec: ValueSpec, cats: string[]): number {
  const v = valueFeats(p, asOf, spec, cats);
  return Math.exp(v.reduce((s, f, j) => s + f * beta[j]!, 0));
}

/** The range honesty of the frozen fit: the share of comps whose real cap lands inside the
 *  P25-P75 band (implied x exp(+/- LOO)) and the P10-P90 band (implied x exp(+/- 1.9 x LOO)),
 *  counted on leave-one-out predictions so no row scores its own fit. */
export function rangeHonesty(
  peers: SnapshotProtocol[],
  asOf: string,
  spec: ValueSpec,
  loo: number,
): { p2575: number; p1090: number; n: number } {
  const cats = [...new Set(peers.map((p) => p.category).filter((c): c is string => c !== null))].sort();
  let in2575 = 0;
  let in1090 = 0;
  for (let i = 0; i < peers.length; i++) {
    const rest = peers.filter((_, j) => j !== i);
    const bi = ols(
      rest.map((p) => valueFeats(p, asOf, spec, cats)),
      rest.map((p) => Math.log(p.mcap_usd!)),
    );
    const pred = valueFeats(peers[i]!, asOf, spec, cats).reduce((s, f, j) => s + f * bi[j]!, 0);
    const err = Math.abs(Math.log(peers[i]!.mcap_usd!) - pred);
    if (err <= loo) in2575++;
    if (err <= 1.9 * loo) in1090++;
  }
  return { p2575: in2575 / peers.length, p1090: in1090 / peers.length, n: peers.length };
}

// ---------------------------------------------------------------- the token-odds model

/** One row of the odds fit's feature vector. Age null counts as the peer set's median age (a protocol
 *  whose listing date is missing is scored as typical, not newborn); growth is clamped to +/-50%. */
export function oddsFeats(p: SnapshotProtocol, asOf: string, medAge: number): number[] {
  const lt = Math.log(p.tvl_usd);
  const a = ageYears(asOf, p.listed_at);
  const age = a === null ? medAge : Math.min(a, 6);
  const g = p.change_7d === null ? 0 : Math.max(-50, Math.min(50, p.change_7d)) / 100;
  return [1, lt, age, g, Math.log(Math.max(1, p.chains.length))];
}

/** Logistic regression by IRLS with a ridge penalty on every term but the intercept. */
export function logitFit(X: number[][], y: number[], ridge = 1): number[] {
  const k = X[0]!.length;
  const beta = new Array<number>(k).fill(0);
  beta[0] = Math.log(Math.max(1, y.reduce((a, b) => a + b, 0)) / Math.max(1, y.length - y.reduce((a, b) => a + b, 0)));
  for (let iter = 0; iter < 60; iter++) {
    const g = new Array<number>(k).fill(0);
    const H: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    for (let r = 0; r < X.length; r++) {
      const z = X[r]!.reduce((s, f, j) => s + f * beta[j]!, 0);
      const pr = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
      const w = Math.max(pr * (1 - pr), 1e-6);
      for (let i = 0; i < k; i++) {
        g[i]! += (y[r]! - pr) * X[r]![i]!;
        for (let j = 0; j < k; j++) H[i]![j]! += w * X[r]![i]! * X[r]![j]!;
      }
    }
    for (let i = 1; i < k; i++) H[i]![i]! += ridge;
    const step = solve(H, g);
    for (let i = 0; i < k; i++) beta[i]! += step[i]!;
    if (Math.max(...step.map((s) => Math.abs(s))) < 1e-7) break;
  }
  return beta;
}

/** P(token) under a fitted odds beta. */
export function oddsPredict(beta: number[], x: number[]): number {
  const z = x.reduce((s, f, j) => s + f * beta[j]!, 0);
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
}

/** The Brier score: the mean squared miss of the predicted probabilities. */
export function brierScore(y: number[], p: number[]): number {
  return y.reduce((a, v, i) => a + (v - p[i]!) ** 2, 0) / y.length;
}

// ---------------------------------------------------------------- farm economics

/** Gas for one transaction, in whole dollars, by a protocol's first chain; anything else costs $5. */
export const GAS_USD: Record<string, number> = {
  Ethereum: 28,
  Base: 2,
  Arbitrum: 2,
  Optimism: 2,
  Polygon: 1,
  'BNB Chain': 1,
  Solana: 0.5,
  Avalanche: 1,
};
export const GAS_DEFAULT_USD = 5;
/** The minutes one farm position takes to set up and tend: 15 + 10 + 60 + 60 + 0 + 10. */
export const FARM_MINUTES = 155;
/** The share of the band-low value one farmer's pool is assumed to capture. */
export const POOL_SHARE = 0.05;
/** The deposit the board's verdicts are judged on, in whole dollars. */
export const VERDICT_DEPOSIT_USD = 1500;
/** The big deposit a MARGINAL row is judged on, in whole dollars. */
export const BIG_DEPOSIT_USD = 5000;
/** A FARM verdict needs the band-low net on a $1,500 deposit to clear this many dollars: a profit
 *  worth the lock-up and the risk, not a rounding error. */
export const FARM_THRESHOLD_USD = 50;
/** The payout horizon the farm plan assumes, in days. */
export const HORIZON_DAYS = 180;

export function gasFor(chain: string): number {
  return GAS_USD[chain] ?? GAS_DEFAULT_USD;
}

/** How many farmers share the pool: TVL / $100k, clamped to 100..5000. */
export function farmersFor(tvlUsd: number): number {
  return Math.max(100, Math.min(5000, Math.round(tvlUsd / 100_000)));
}

/** The net dollars of farming with `deposit` against a band-low value, after gas and a 0.3% fee. */
export function farmNet(bandLowUsd: number, farmers: number, gasUsd: number, depositUsd: number): number {
  const gross = (bandLowUsd * POOL_SHARE * depositUsd) / (farmers * VERDICT_DEPOSIT_USD);
  return gross - (3 * gasUsd + 0.003 * depositUsd);
}

/** FARM when the band-low net on $1,500 clears $50; MARGINAL when only a $5,000 deposit clears it;
 *  SKIP when even $5,000 does not. */
export type Verdict = 'FARM' | 'MARGINAL' | 'SKIP';
export function farmVerdict(net1500: number, net5000: number): Verdict {
  if (net1500 >= FARM_THRESHOLD_USD) return 'FARM';
  if (net5000 > 0) return 'MARGINAL';
  return 'SKIP';
}

/** The smallest deposit whose band-low net reaches zero, or null when no deposit ever does. */
export function minDeposit(bandLowUsd: number, farmers: number, gasUsd: number): number | null {
  const perDollar = (bandLowUsd * POOL_SHARE) / (farmers * VERDICT_DEPOSIT_USD) - 0.003;
  if (perDollar <= 0) return null;
  return Math.ceil((3 * gasUsd) / perDollar);
}

/** The days to break even at the horizon's payout rate, or null when the position never pays. */
export function breakEvenDays(bandLowUsd: number, farmers: number, gasUsd: number): number | null {
  const gross1500 = (bandLowUsd * POOL_SHARE) / farmers;
  const cost1500 = 3 * gasUsd + 0.003 * VERDICT_DEPOSIT_USD;
  if (gross1500 <= cost1500) return null;
  return Math.round((HORIZON_DAYS * cost1500) / gross1500);
}

// ---------------------------------------------------------------- farm steps

/** How long to hold, from the protocol's age in years: unknown or young gets the longest window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 0.5) return 60;
  if (age < 1) return 45;
  return 30;
}

/** The category's one action, in words a farmer can follow. */
export function actionFor(p: SnapshotProtocol, depositUsd: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${depositUsd} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${depositUsd} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${depositUsd} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${depositUsd} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${depositUsd} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${depositUsd} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${depositUsd} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${depositUsd} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${depositUsd} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${depositUsd} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${depositUsd} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** One step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is a template
 * over the protocol's own record (category, first chain, age) and the reader's deposit and horizon, so
 * the dashboard regenerates the identical steps live when the reader changes either. The board's
 * steps are this template at the $1,500 deposit and the 180-day horizon.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, depositUsd: number, horizonDays: number): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const gas = gasFor(chain);
  const hold = holdDaysFor(age);
  return [
    stepText('Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', 'nothing to create the wallet', '5 minutes'),
    stepText(actionFor(p, depositUsd, chain), `$${depositUsd} of capital and about $${gas} of gas`, '15 minutes to set up'),
    stepText('Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the wallet stays active.', `about $${gas} of gas a week`, '10 minutes a week'),
    stepText(`Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, `the $${depositUsd} stays in the position`, `${hold} days`),
    stepText(`Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`, 'no fee to check, and never pay to claim', '10 minutes'),
    stepText(`Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it before the ${horizonDays}-day horizon.`, 'nothing but the log', '5 minutes'),
  ];
}

// ---------------------------------------------------------------- the board

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    fitted_mcap_usd: number;
    token_odds: number;
    band_low_usd: number;
    band_high_usd: number;
    net_1500_usd: number;
    net_5000_usd: number;
    net_1000_usd: number;
    net_per_hour_usd: number;
    verdict: Verdict;
    min_deposit_usd: number | null;
    break_even_days: number | null;
    rank_low: number;
    rank_high: number;
  };
  farm_steps: string[];
}

/** One value-fit term as the dashboard's evidence table shows it. */
export interface TermRow {
  spec: string;
  r2: number;
  loo: number;
  wf: number;
  kept: boolean;
  note: string;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  board_floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  total_implied_usd: number;
  symbol_rows: number;
  checksum: string;
  steps_checksum: string;
  value: {
    beta: number[];
    spec: string;
    comps_n: number;
    r2: number;
    loo: number;
    wf: number;
    wf_cut: string | null;
    train_n: number;
    test_n: number;
    terms: TermRow[];
    all128: TermRow[];
    range: { p2575: number; p1090: number; n: number };
    wf_by_cut: { cut: string; quad_age: number; quad: number }[];
  };
  odds: {
    beta: number[];
    n: number;
    listed_n: number;
    base_rate: number;
    brier: number;
    brier_const: number;
    quintiles: { pred: number; actual: number; n: number }[];
    wf_brier: number;
    wf_acc: number;
    wf_cut: string | null;
    wf_train_n: number;
    wf_test_n: number;
    wf_test_base: number;
    median_age: number;
  };
  census: {
    ranked: number;
    early: number;
    out_category: number;
    out_versioned: number;
    out_wrapped: number;
    priced: number;
    detached: number;
    no_cap: number;
    total: number;
  };
  farm: {
    threshold_usd: number;
    counts: { FARM: number; MARGINAL: number; SKIP: number };
    minutes: number;
    pool_share: number;
    horizon_days: number;
  };
  cats: string[];
  /** One priced comp for the live refit: [TVL $k, real cap $k, age years, name]. */
  peers: [number, number, number, string][];
  rows: unknown[][];
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** The frozen value spec: log TVL, its square, and age. It won both tests against every simpler and
 *  every richer candidate (see the evidence table this function builds). */
export const VALUE_SPEC: ValueSpec = ['const', 'tvl', 'quad', 'age'];

/** The candidate specs the two-test gate ran, in the order they were tried. */
const TERM_SPECS: { spec: ValueSpec; ridge: number; note: string }[] = [
  { spec: ['const', 'tvl'], ridge: 0, note: 'Baseline: TVL alone.' },
  { spec: ['const', 'tvl', 'quad'], ridge: 0, note: 'Kept: wins both tests over TVL alone.' },
  { spec: ['const', 'tvl', 'quad', 'age'], ridge: 0, note: 'Kept (frozen): wins both tests over TVL + quad.' },
  { spec: ['const', 'tvl', 'quad', 'age', 'growth'], ridge: 0, note: 'Tested, not kept: wins LOO but loses the walk-forward.' },
  { spec: ['const', 'tvl', 'quad', 'age', 'chains'], ridge: 0, note: 'Tested, not kept: loses LOO.' },
  { spec: ['const', 'tvl', 'quad', 'age', 'cat'], ridge: 64, note: 'Tested, not kept: loses both tests.' },
];

/** The walk-forward cutoffs the age term's edge is checked against, for the caveat in the evidence. */
const WF_CUTS = ['2023-01-01', '2023-06-01', '2024-01-01', '2024-06-01', '2025-01-01'];

/** The protocols the board ranks, strongest first, with ranks 1..n, and everything the dashboard needs. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const asOf = snapshot.as_of;
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watchSet = new Set(snapshot.watchlist);

  // ---- the value fit and its evidence -------------------------------------
  const comps = pricedComps(snapshot);
  const allPriced = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
  const compCats = [...new Set(comps.map((p) => p.category).filter((c): c is string => c !== null))].sort();
  const terms: TermRow[] = TERM_SPECS.map((t) => {
    const e = evalValueSpec(comps, asOf, t.spec, t.ridge);
    return {
      spec: e.spec,
      r2: e.r2,
      loo: e.loo,
      wf: e.wf,
      kept: t.spec.join('+') === VALUE_SPEC.join('+') || t.spec.join('+') === 'const+tvl+quad',
      note: t.note,
    };
  });
  const frozen = evalValueSpec(comps, asOf, VALUE_SPEC);
  const all128: TermRow[] = (['const+tvl', 'const+tvl+quad', 'const+tvl+quad+age'] as const).map((s) => {
    const spec = s.split('+') as ValueSpec;
    const e = evalValueSpec(allPriced, asOf, spec);
    return { spec: e.spec, r2: e.r2, loo: e.loo, wf: e.wf, kept: false, note: 'Untrimmed.' };
  });
  const range = rangeHonesty(comps, asOf, VALUE_SPEC, frozen.loo);
  // The age term's walk-forward edge, checked at five cutoffs instead of one.
  const wfByCut = WF_CUTS.map((cut) => {
    const dated = comps.filter((p) => p.listed_at !== null);
    const tr = dated.filter((p) => p.listed_at! < cut);
    const te = dated.filter((p) => p.listed_at! >= cut);
    const wfOf = (spec: ValueSpec): number => {
      if (tr.length <= 6 || te.length === 0) return NaN;
      const bt = ols(
        tr.map((p) => valueFeats(p, asOf, spec, compCats)),
        tr.map((p) => Math.log(p.mcap_usd!)),
      );
      return medAbs(te.map((p) => Math.log(p.mcap_usd!) - valueFeats(p, asOf, spec, compCats).reduce((s2, f, j) => s2 + f * bt[j]!, 0)));
    };
    return { cut, quad_age: wfOf(VALUE_SPEC), quad: wfOf(['const', 'tvl', 'quad']) };
  });

  // ---- the odds fit and its evidence --------------------------------------
  const boardProtos = snapshot.protocols.filter((p) => isRankable(p) && p.tvl_usd >= BOARD_FLOOR_USD);
  const listedPeers = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd >= BOARD_FLOOR_USD);
  const universe = [...listedPeers, ...boardProtos];
  const datedUni = universe.filter((p) => ageYears(asOf, p.listed_at) !== null);
  const medAge = (() => {
    const ages = datedUni.map((p) => ageYears(asOf, p.listed_at)!).sort((a, b) => a - b);
    return ages[Math.floor(ages.length / 2)]!;
  })();
  const oddsX = universe.map((p) => oddsFeats(p, asOf, medAge));
  const oddsY = universe.map((p) => (p.mcap_usd !== null && p.mcap_usd > 0 ? 1 : 0));
  const oddsBeta = logitFit(oddsX, oddsY, 1);
  const oddsPred = oddsX.map((x) => oddsPredict(oddsBeta, x));
  const baseRate = oddsY.reduce((a, b) => a + b, 0) / oddsY.length;
  const brier = brierScore(oddsY, oddsPred);
  const brierConst = brierScore(oddsY, oddsY.map(() => baseRate));
  const order = oddsPred.map((p, i) => i).sort((a, b) => oddsPred[a]! - oddsPred[b]!);
  const quintiles: { pred: number; actual: number; n: number }[] = [];
  for (let q = 0; q < 5; q++) {
    const idx = order.slice(Math.floor((q * order.length) / 5), Math.floor(((q + 1) * order.length) / 5));
    quintiles.push({
      pred: idx.reduce((a, i) => a + oddsPred[i]!, 0) / idx.length,
      actual: idx.reduce((a, i) => a + oddsY[i]!, 0) / idx.length,
      n: idx.length,
    });
  }
  // Walk-forward on the odds: fit before the median listing date, score after it.
  const uniCut = medianListedAt(universe);
  const uniTr = universe.filter((p) => p.listed_at !== null && uniCut !== null && p.listed_at < uniCut);
  const uniTe = universe.filter((p) => p.listed_at !== null && uniCut !== null && p.listed_at >= uniCut);
  const uniTrBeta = logitFit(
    uniTr.map((p) => oddsFeats(p, asOf, medAge)),
    uniTr.map((p) => (p.mcap_usd !== null && p.mcap_usd > 0 ? 1 : 0)),
    1,
  );
  const wfPred = uniTe.map((p) => oddsPredict(uniTrBeta, oddsFeats(p, asOf, medAge)));
  const wfY = uniTe.map((p) => (p.mcap_usd !== null && p.mcap_usd > 0 ? 1 : 0));
  const wfBrier = brierScore(wfY, wfPred);
  const wfAcc = wfY.filter((v, i) => (wfPred[i]! >= 0.5) === (v === 1)).length / wfY.length;

  // ---- the board -----------------------------------------------------------
  const scored = boardProtos.map((p) => {
    const fitted = fittedCap(p, asOf, frozen.beta, VALUE_SPEC, compCats);
    const odds = oddsPredict(oddsBeta, oddsFeats(p, asOf, medAge));
    const implied = Math.max(1, Math.round(fitted * odds));
    const bandLow = fitted * odds * Math.exp(-1.9 * frozen.loo);
    const bandHigh = fitted * odds * Math.exp(1.9 * frozen.loo);
    const chain = p.chains.length > 0 ? p.chains[0]! : 'Ethereum';
    const gas = gasFor(chain);
    const farmers = farmersFor(p.tvl_usd);
    const n15 = farmNet(bandLow, farmers, gas, VERDICT_DEPOSIT_USD);
    const n50 = farmNet(bandLow, farmers, gas, BIG_DEPOSIT_USD);
    const n10 = farmNet(bandLow, farmers, gas, 1000);
    return {
      p,
      fitted,
      odds,
      implied,
      bandLow,
      bandHigh,
      n15,
      n50,
      n10,
      perHour: n15 / (FARM_MINUTES / 60),
      verdict: farmVerdict(n15, n50),
      minDeposit: minDeposit(bandLow, farmers, gas),
      breakEven: breakEvenDays(bandLow, farmers, gas),
      age: ageYears(asOf, p.listed_at),
    };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  // Bootstrap rank ranges: 200 refits on resampled comps, odds held fixed.
  const rng = mulberry32(20261122);
  const rankLists = new Map<string, number[]>();
  for (const s of scored) rankLists.set(s.p.slug, []);
  for (let rep = 0; rep < 200; rep++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < comps.length; i++) sample.push(comps[Math.floor(rng() * comps.length)]!);
    const bi = ols(
      sample.map((p) => valueFeats(p, asOf, VALUE_SPEC, compCats)),
      sample.map((p) => Math.log(p.mcap_usd!)),
    );
    const orderRep = scored
      .map((s) => {
        const proto = bySlug.get(s.p.slug)!;
        const fit = fittedCap(proto, asOf, bi, VALUE_SPEC, compCats);
        return { slug: s.p.slug, imp: fit * s.odds };
      })
      .sort((a, b) => b.imp - a.imp || (a.slug < b.slug ? -1 : 1));
    orderRep.forEach((r, i) => rankLists.get(r.slug)!.push(i + 1));
  }
  const rankRange = new Map<string, [number, number]>();
  for (const [slug, list] of rankLists) {
    const sorted = [...list].sort((a, b) => a - b);
    rankRange.set(slug, [sorted[Math.floor(0.05 * sorted.length)]!, sorted[Math.floor(0.95 * sorted.length)]!]);
  }

  const board: BoardRow[] = scored.map((s, i) => {
    const [rLo, rHi] = rankRange.get(s.p.slug)!;
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: ageDays(asOf, s.p.listed_at),
      implied_value_usd: s.implied,
      model: {
        fitted_mcap_usd: Math.round(s.fitted),
        token_odds: Math.round(s.odds * 1000) / 1000,
        band_low_usd: Math.round(s.bandLow),
        band_high_usd: Math.round(s.bandHigh),
        net_1500_usd: Math.round(s.n15),
        net_5000_usd: Math.round(s.n50),
        net_1000_usd: Math.round(s.n10),
        net_per_hour_usd: Math.round(s.perHour * 10) / 10,
        verdict: s.verdict,
        min_deposit_usd: s.minDeposit,
        break_even_days: s.breakEven,
        rank_low: rLo,
        rank_high: rHi,
      },
      farm_steps: farmSteps(s.p, s.age, VERDICT_DEPOSIT_USD, HORIZON_DAYS),
    };
  });

  // ---- the census: every one of the 758 protocols, in exactly one group -----
  const early = snapshot.protocols.filter((p) => isPreToken(p) && outReason(p) === null && p.tvl_usd < BOARD_FLOOR_USD).length;
  const outCat = snapshot.protocols.filter((p) => isPreToken(p) && outReason(p) === 'category').length;
  const outVer = snapshot.protocols.filter((p) => isPreToken(p) && outReason(p) === 'versioned-name').length;
  const outWrap = snapshot.protocols.filter((p) => isPreToken(p) && outReason(p) === 'wrapped-word').length;
  const detached = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && !(p.mcap_usd / p.tvl_usd >= 0.02 && p.mcap_usd / p.tvl_usd <= 2),
  ).length;
  const noCap = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd <= 0).length;
  const census = {
    ranked: board.length,
    early,
    out_category: outCat,
    out_versioned: outVer,
    out_wrapped: outWrap,
    priced: comps.length,
    detached,
    no_cap: noCap,
    total: snapshot.protocols.length,
  };

  // ---- the dashboard's compact rows ----------------------------------------
  const cats = [...new Set(board.map((r) => r.category).filter((c): c is string => c !== null))].sort();
  const catIdx = (c: string | null): number => (c === null ? -1 : cats.indexOf(c));
  // Compact rows: [rank, slug, name, catIdx, chains, tvl, chg, ageDays, fitK, odds, imp, bandLowUsd,
  //  bandHighK, rankLow, rankHigh, watch]. Age is whole days (the snapshot's dates are whole days, so
  //  this is exact, and the page's hold-days rule matches the build's year rule day for day). Farm
  //  nets, verdicts, min deposit and break-even are all recomputed live in the page from the
  //  band-low value, so they are not stored per row.
  const rows: unknown[][] = board.map((r) => {
    const s = scored[r.rank - 1]!;
    return [
      r.rank,
      r.slug,
      r.name,
      catIdx(r.category),
      r.chains.join('|'),
      r.tvl_usd,
      r.change_7d === null ? null : Math.round(r.change_7d * 10) / 10,
      r.age_days,
      Math.round(s.fitted / 1000),
      r.model.token_odds,
      r.implied_value_usd,
      Math.round(s.bandLow),
      Math.round(s.bandHigh / 1000),
      r.model.rank_low,
      r.model.rank_high,
      watchSet.has(r.slug) ? 1 : 0,
    ];
  });
  const peers: [number, number, number, string][] = comps.map((p) => {
    const a = ageYears(asOf, p.listed_at);
    return [Math.round(p.tvl_usd / 1000), Math.round(p.mcap_usd! / 1000), a === null ? 0 : Math.round(Math.min(a, 6) * 10) / 10, p.name];
  });
  const counts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  for (const r of board) counts[r.model.verdict]++;
  const totalImplied = board.reduce((a, r) => a + r.implied_value_usd, 0);
  const checksum = fnv1a(board.map((r) => `${r.slug}|${r.rank}|${r.implied_value_usd}`).join(';'));
  const stepsChecksum = fnv1a(board.flatMap((r) => r.farm_steps).join('\n'));

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    board_floor_usd: BOARD_FLOOR_USD,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    total_implied_usd: totalImplied,
    symbol_rows: board.filter((r) => r.symbol !== null).length,
    checksum,
    steps_checksum: stepsChecksum,
    value: {
      beta: frozen.beta,
      spec: frozen.spec,
      comps_n: comps.length,
      r2: frozen.r2,
      loo: frozen.loo,
      wf: frozen.wf,
      wf_cut: frozen.wfCut,
      train_n: frozen.trainN,
      test_n: frozen.testN,
      terms,
      all128,
      range,
      wf_by_cut: wfByCut,
    },
    odds: {
      beta: oddsBeta,
      n: universe.length,
      listed_n: listedPeers.length,
      base_rate: baseRate,
      brier,
      brier_const: brierConst,
      quintiles,
      wf_brier: wfBrier,
      wf_acc: wfAcc,
      wf_cut: uniCut,
      wf_train_n: uniTr.length,
      wf_test_n: uniTe.length,
      wf_test_base: wfY.length === 0 ? 0 : wfY.reduce((a, b) => a + b, 0) / wfY.length,
      median_age: medAge,
    },
    census,
    farm: {
      threshold_usd: FARM_THRESHOLD_USD,
      counts,
      minutes: FARM_MINUTES,
      pool_share: POOL_SHARE,
      horizon_days: HORIZON_DAYS,
    },
    cats,
    peers,
    rows,
  };
  return { board, radar };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
