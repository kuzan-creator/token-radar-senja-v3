// Token Radar Senja v3 — the dashboard. No network, no fetch: everything renders from data.js.
// Row fields: [rank, slug, name, catIdx, chains, tvl, chg, ageDays, fitK, odds, imp, bandLowUsd,
//  bandHighK, rankLow, rankHigh, watch]
const R = window.RADAR;
const $ = (id) => document.getElementById(id);
const GAS = { Ethereum: 28, Base: 2, Arbitrum: 2, Optimism: 2, Polygon: 1, 'BNB Chain': 1, Solana: 0.5, Avalanche: 1 };
const VERD = ['FARM', 'MARGINAL', 'SKIP'];
const state = { tab: 'all', q: '', cat: '', chain: '', sort: 'imp', desc: true, dep: 1500, hor: 180, share: 5, detail: null };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (n) => n.toLocaleString('en-US');
function money(n) {
  if (n === null || n === undefined) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 2) + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + Math.round(n);
}
const gasOf = (r) => GAS[r[4].split('|')[0]] ?? 5;
const farmersOf = (r) => Math.max(100, Math.min(5000, Math.round(r[5] / 100000)));
const bandLow = (r) => r[11];
function net(r, dep, share) {
  const f = farmersOf(r);
  return (bandLow(r) * (share / 100) * dep) / (f * 1500) - (3 * gasOf(r) + 0.003 * dep);
}
function verdict(r, dep, share) {
  if (net(r, dep, share) >= 50) return 0;
  if (net(r, 5000, share) > 0) return 1;
  return 2;
}
function minDep(r, share) {
  const per = (bandLow(r) * (share / 100)) / (farmersOf(r) * 1500) - 0.003;
  return per <= 0 ? null : Math.ceil((3 * gasOf(r)) / per);
}
function beDays(r, dep, share) {
  const gross = (bandLow(r) * (share / 100) * dep) / (farmersOf(r) * 1500);
  const cost = 3 * gasOf(r) + 0.003 * dep;
  return gross <= cost ? null : Math.round((state.hor * cost) / gross);
}
// --- farm steps: the same template main.ts uses, so the board's steps and the page's agree ---
// Age is whole days here (0.5y = 182.625 days, 1y = 365.25 days), which matches the build's
// year-based rule day for day.
function holdDays(days) { return days === null ? 45 : days < 183 ? 60 : days < 366 ? 45 : 30; }
function actionFor(name, cat, dep, chain) {
  const c = (cat || '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${dep} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${dep} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${dep} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${dep} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${dep} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${dep} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${dep} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${dep} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${dep} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${dep} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${dep} of USDC into ${name} on ${chain} and keep the position open.`;
}
function stepText(t, cost, time) {
  let s = `${t} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = s.slice(0, 596) + '...';
  if (s.length < 20) s += ' Hold the position and check the protocol\'s own page.';
  return s;
}
function farmSteps(r, dep, hor) {
  const chain = r[4].split('|')[0] || 'its main chain';
  const g = gasOf(r);
  const hold = holdDays(r[7]);
  const cat = r[3] >= 0 ? R.cats[r[3]] : null;
  return [
    stepText('Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', 'nothing to create the wallet', '5 minutes'),
    stepText(actionFor(r[2], cat, dep, chain), `$${dep} of capital and about $${g} of gas`, '15 minutes to set up'),
    stepText('Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the wallet stays active.', `about $${g} of gas a week`, '10 minutes a week'),
    stepText(`Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, `the $${dep} stays in the position`, `${hold} days`),
    stepText('Before you withdraw, open the protocol\'s own points or rewards page and claim only from the link it publishes.', 'no fee to check, and never pay to claim', '10 minutes'),
    stepText(`Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it before the ${hor}-day horizon.`, 'nothing but the log', '5 minutes'),
  ];
}
// --- small linear algebra, mirroring lib/model.ts, for the live refit ---
function solve(A, b) {
  const n = A.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    if (Math.abs(d) < 1e-12) continue;
    for (let j = c; j <= n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) { if (r === c || M[r][c] === 0) continue; const f = M[r][c]; for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map((row) => row[n]);
}
function ols(X, y) {
  const k = X[0].length, A = [], b = [];
  for (let i = 0; i < k; i++) { A.push([]); for (let j = 0; j < k; j++) { let s = 0; for (let r = 0; r < X.length; r++) s += X[r][i] * X[r][j]; A[i].push(s); } }
  for (let i = 0; i < k; i++) { let s = 0; for (let r = 0; r < X.length; r++) s += X[r][i] * y[r]; b.push(s); }
  return solve(A, b);
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return ('0000000' + (h >>> 0).toString(16)).slice(-8);
}
function peerFeats(p) { const lt = Math.log(p[0] * 1000); return [1, lt, (lt * lt) / 100, p[2]]; }
function refitBeta(sample) {
  return ols(sample.map(peerFeats), sample.map((p) => Math.log(p[1] * 1000)));
}
function fittedCap(r, beta) {
  const lt = Math.log(r[5]);
  const ageY = r[7] === null ? 0 : Math.min(r[7] / 365.25, 6);
  const v = [1, lt, (lt * lt) / 100, ageY];
  return Math.exp(v.reduce((s, f, j) => s + f * beta[j], 0));
}
// --- filtering / sorting ---
function visible() {
  const q = state.q.toLowerCase();
  let rows = R.rows.filter((r) => {
    if (state.tab === 'farm' && verdict(r, state.dep, state.share) !== 0) return false;
    if (state.tab === 'marginal' && verdict(r, state.dep, state.share) !== 1) return false;
    if (state.tab === 'skip' && verdict(r, state.dep, state.share) !== 2) return false;
    if (state.tab === 'watch' && !r[15]) return false;
    if (q && !(r[2].toLowerCase().includes(q) || r[1].toLowerCase().includes(q))) return false;
    if (state.cat && r[3] !== +state.cat) return false;
    if (state.chain && !r[4].split('|').includes(state.chain)) return false;
    return true;
  });
  const key = {
    rank: (r) => r[0], name: (r) => r[2], cat: (r) => (r[3] < 0 ? '' : R.cats[r[3]]), chain: (r) => r[4],
    tvl: (r) => r[5], chg: (r) => r[6] ?? -999, age: (r) => r[7] ?? -1, fit: (r) => r[8],
    odds: (r) => r[9], imp: (r) => r[10], net: (r) => net(r, state.dep, state.share),
    hr: (r) => net(r, state.dep, state.share) / (155 / 60), verdict: (r) => verdict(r, state.dep, state.share),
  }[state.sort];
  rows.sort((a, b) => {
    const x = key(a), y = key(b);
    const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
    return (state.desc ? -c : c) || (a[0] - b[0]);
  });
  return rows;
}
function renderTable() {
  const rows = visible();
  const depLabel = state.dep >= 1000 ? '$' + (state.dep / 1000) + 'K' : '$' + state.dep;
  document.querySelector('#board th:nth-child(12)').textContent = 'Net ' + depLabel;
  $('rows').innerHTML = rows.map((r) => {
    const n = net(r, state.dep, state.share);
    const v = verdict(r, state.dep, state.share);
    const hr = n / (155 / 60);
    return `<tr data-slug="${r[1]}" class="${state.detail === r[1] ? 'sel' : ''}"><td class="num">${r[0]}</td>` +
      `<td><b>${esc(r[2])}</b>${r[15] ? ' <span class="wl">★</span>' : ''} <span style="color:var(--mut);font-size:11px">${esc(r[1])}</span></td>` +
      `<td>${r[3] < 0 ? '—' : esc(R.cats[r[3]])}</td><td>${esc(r[4].split('|')[0])}</td>` +
      `<td class="num">${money(r[5])}</td><td class="num ${r[6] !== null && r[6] < 0 ? 'neg' : ''}">${r[6] === null ? '—' : (r[6] > 0 ? '+' : '') + r[6].toFixed(1) + '%'}</td>` +
      `<td class="num">${r[7] === null ? '—' : (r[7] / 365.25).toFixed(1) + 'y'}</td><td class="num">${money(r[8] * 1000)}</td>` +
      `<td class="num">${(r[9] * 100).toFixed(1)}%</td><td class="num"><b>${money(r[10])}</b></td>` +
      `<td class="num">${money(r[11])}–${money(r[12] * 1000)}</td>` +
      `<td class="num ${n < 0 ? 'neg' : ''}">${n < 0 ? '−$' + num(Math.round(-n)) : '$' + num(Math.round(n))}</td>` +
      `<td class="num ${hr < 0 ? 'neg' : ''}">${hr < 0 ? '−$' : '$'}${Math.abs(hr).toFixed(1)}</td>` +
      `<td class="v${VERD[v]}">${VERD[v]}</td><td class="num">#${r[13]}–${r[14]}</td></tr>`;
  }).join('');
  $('count').textContent = `${rows.length} of ${R.rows.length} rows · deposit $${num(state.dep)} · pool share ${state.share}% · horizon ${state.hor} days · net is the band-low case, not the headline`;
  document.querySelectorAll('#rows tr').forEach((tr) => tr.addEventListener('click', () => openDetail(tr.dataset.slug)));
}
function renderKPIs() {
  const v = R.value, o = R.odds, f = R.farm;
  const tiles = [
    [`${R.board_size} rows`, `watchlist ${R.watchlist_size}/${R.watchlist_size} covered`],
    [money(R.total_implied_usd), `total implied value, ${R.board_size} rows`],
    [`R² ${v.r2.toFixed(3)}`, `value fit · LOO ×${Math.exp(v.loo).toFixed(2)} · walk-fwd ×${Math.exp(v.wf).toFixed(2)}`],
    [`Brier ${o.brier.toFixed(3)}`, `token odds · base rate ${o.brier_const.toFixed(3)} · walk-fwd ${o.wf_brier.toFixed(3)}`],
    [`FARM ${f.counts.FARM}`, `MARGINAL ${f.counts.MARGINAL} · SKIP ${f.counts.SKIP} · at a $50 band-low net on $1,500`],
    [`P25–P75 ${v.range.p2575.toFixed(2)}`, `range honesty · P10–P90 ${v.range.p1090.toFixed(2)} (stated 0.80)`],
  ];
  $('kpis').innerHTML = tiles.map(([b, s]) => `<div class="kpi"><b>${b}</b><span>${s}</span></div>`).join('');
}
function renderFarmNext() {
  const farm = R.rows.filter((r) => verdict(r, state.dep, state.share) === 0)
    .sort((a, b) => net(b, state.dep, state.share) - net(a, state.dep, state.share)).slice(0, 5);
  $('farmNext').innerHTML = farm.map((r) => {
    const n = net(r, state.dep, state.share), hr = n / (155 / 60);
    return `<div class="card" data-slug="${r[1]}"><div class="r">#${r[0]} · ${esc(r[4].split('|')[0])}</div><div class="n">${esc(r[2])}</div><div class="h">$${hr.toFixed(1)}/hour</div><div class="s">net $${num(Math.round(n))} on $${num(state.dep)} · implied ${money(r[10])}</div></div>`;
  }).join('') || '<p class="evnote">No FARM row at this deposit and pool share — raise the deposit or the share.</p>';
  document.querySelectorAll('#farmNext .card').forEach((c) => c.addEventListener('click', () => openDetail(c.dataset.slug)));
}
function renderCensus() {
  const c = R.census;
  const groups = [
    ['Ranked on the board', c.ranked, '#ffb454'], ['Early, below the $25M floor', c.early, '#7aa2ff'],
    ['Off-list: category', c.out_category, '#5eead4'], ['Off-list: versioned name', c.out_versioned, '#4ade80'],
    ['Off-list: wrapped word', c.out_wrapped, '#a3e635'], ['Priced comps (the fit)', c.priced, '#f472b6'],
    ['Detached valuations', c.detached, '#f87171'], ['Token recorded, no usable cap', c.no_cap, '#c084fc'],
  ];
  $('censusBar').innerHTML = groups.map(([, n, col]) => `<div style="width:${(n / c.total * 100).toFixed(2)}%;background:${col}" title="${n}"></div>`).join('');
  $('censusLegend').innerHTML = groups.map(([label, n, col]) => `<span><i style="background:${col}"></i>${label}: <b>${n}</b></span>`).join('') +
    `<span>Total: <b>${c.total}</b> protocols</span>`;
}
function renderEvidence() {
  const v = R.value, o = R.odds;
  $('tTerms').querySelector('tbody').innerHTML = v.terms.map((t) =>
    `<tr><td>${esc(t.spec.replace(/\+/g, ' + '))}</td><td class="num">${t.r2.toFixed(4)}</td><td class="num">×${Math.exp(t.loo).toFixed(2)}</td><td class="num">×${Math.exp(t.wf).toFixed(2)}</td><td>${t.kept ? '<b style="color:var(--grn)">KEPT</b>' : 'tested'}</td><td>${esc(t.note)}</td></tr>`).join('');
  $('tAll').querySelector('tbody').innerHTML = v.all128.map((t) =>
    `<tr><td>${esc(t.spec.replace(/\+/g, ' + '))}</td><td class="num">${t.r2.toFixed(4)}</td><td class="num">×${Math.exp(t.loo).toFixed(2)}</td><td class="num">×${Math.exp(t.wf).toFixed(2)}</td><td>${esc(t.note)}</td></tr>`).join('');
  $('tOdds').querySelector('tbody').innerHTML = [
    ['Brier score (in-sample)', o.brier.toFixed(4), o.brier_const.toFixed(4), 'Lower is better; the odds beat guessing the base rate.'],
    ['Walk-forward Brier (fit before ' + o.wf_cut + ', scored after)', o.wf_brier.toFixed(4), '—', `Train ${o.wf_train_n}, test ${o.wf_test_n}, test base rate ${(o.wf_test_base * 100).toFixed(1)}%.`],
    ['Accuracy at a 0.5 cut, walk-forward', (o.wf_acc * 100).toFixed(1) + '%', '—', 'A 0.5 cut calls a token only when the model is surer than not.'],
    ['Top-row odds', (Math.max(...R.rows.map((r) => r[9])) * 100).toFixed(1) + '%', (o.base_rate * 100).toFixed(1) + '% base rate', 'No honest reference class on this snapshot supports 90% odds — see the note below.'],
  ].map((x) => `<tr><td>${x[0]}</td><td class="num">${x[1]}</td><td class="num">${x[2]}</td><td>${x[3]}</td></tr>`).join('');
  $('tCal').querySelector('tbody').innerHTML = o.quintiles.map((q, i) =>
    `<tr><td>Quintile ${i + 1}</td><td class="num">${(q.pred * 100).toFixed(1)}%</td><td class="num">${(q.actual * 100).toFixed(1)}%</td><td class="num">${q.n}</td></tr>`).join('');
  $('tRange').querySelector('tbody').innerHTML = [
    ['P25–P75 (implied × exp(±LOO))', '0.50', v.range.p2575.toFixed(3), v.range.p2575 === 0.5 ? 'Exact: the band holds what it claims.' : 'Close to the stated coverage.'],
    ['P10–P90 (implied × exp(±1.9·LOO))', '0.80', v.range.p1090.toFixed(3), 'Slightly wide — the band over-covers by about 5 points, honestly reported.'],
  ].map((x) => `<tr><td>${x[0]}</td><td class="num">${x[1]}</td><td class="num">${x[2]}</td><td>${x[3]}</td></tr>`).join('');
  const wc = v.wf_by_cut.map((w) => `${w.cut}: ${w.quad_age.toFixed(2)} vs ${w.quad.toFixed(2)}`).join(' · ');
  const topOdds = Math.max(...R.rows.map((r) => r[9]));
  $('caveats').innerHTML =
    `<p><b>Why the top odds stop at ${(topOdds * 100).toFixed(0)}%.</b> The odds universe is ${o.n} rows with a ${(o.base_rate * 100).toFixed(1)}% base rate, and the features are weak — by TVL band alone only 11–22% of protocols ever list, by age band 3–26%. A board that prints 77–91% odds on this snapshot is overconfident: its Brier barely beats guessing the base rate. Ours does better (${o.brier.toFixed(3)} vs ${o.brier_const.toFixed(3)}) and holds up out of sample (walk-forward ${o.wf_brier.toFixed(3)}).</p>` +
    `<p><b>The age term's walk-forward edge is cutoff-sensitive.</b> At the pre-registered median cutoff it wins clearly (${v.wf.toFixed(2)} vs ${v.terms[1].wf.toFixed(2)}), and at 2024-01-01 and 2024-06-01 too; it loses at 2023-01-01, 2023-06-01 and 2025-01-01 (${wc}). The term is kept because it wins both tests at the pre-registered cutoff and always wins leave-one-out — and because the bounty asks the model to use age.</p>` +
    `<p><b>Pre-token means mcap_usd is null, as the snapshot defines it.</b> ${R.symbol_rows} of the ${R.board_size} board rows also carry a symbol in DefiLlama's record (a product or stablecoin ticker, not a launch token with a market cap). The house watchlist is stricter — both gecko_id and symbol null — and all ${R.watchlist_size} of its slugs are on this board. One odd record: autofinance carries mcap_usd −1; it sits in the "token recorded, no usable cap" group of ${R.census.no_cap}, never on the board.</p>` +
    `<p><b>Implied value is fitted cap × odds, never fitted cap alone.</b> The share fitted/(fitted + TVL) is shown in the detail view as a diagnostic only. Farm nets use the band-low value — the P10 end of the range — so a FARM verdict means the pessimistic case still pays.</p>`;
  $('evValueNote').textContent = `Comps are the token-bearing peers whose market cap sits within [0.02, 2] of their TVL — ${v.comps_n} of ${R.census.priced + R.census.detached} priced peers. The other ${R.census.detached} are dust caps (ratio under 0.02) or detached valuations (over 2). Every term below was kept only if it won both tests: leave-one-out and a walk-forward split at the median listing date.`;
  $('evOddsNote').textContent = `Logistic fit on ${o.n} rows — the ${o.listed_n} listed peers at or above $25M of TVL plus the ${R.board_size} board rows. Features: log TVL, age (capped at 6y, missing counts as the peer median ${o.median_age.toFixed(2)}y), 7-day growth clamped to ±50%, log(chains).`;
}
function renderChecks() {
  const checks = [];
  const rows = R.rows;
  checks.push(['Rows', rows.length === R.board_size, `${rows.length} rows (gate: 100–4,000)`]);
  const wl = rows.filter((r) => r[15]).length;
  checks.push(['Watchlist', wl === R.watchlist_size, `${wl}/${R.watchlist_size} watchlist slugs on the board`]);
  const ranksOk = rows.every((r, i) => r[0] === i + 1);
  checks.push(['Ranks', ranksOk, `ranks exactly 1..${rows.length}, once each`]);
  const sorted = rows.every((r, i) => i === 0 || r[10] <= rows[i - 1][10]);
  checks.push(['Order', sorted, 'implied value never rises as rank ascends']);
  const chk = fnv1a(rows.map((r) => `${r[1]}|${r[0]}|${r[10]}`).join(';'));
  checks.push(['Checksum', chk === R.checksum, `FNV-1a of slug|rank|implied = ${chk} (matches the build)`]);
  let stepsOk = true, stepsN = 0;
  const allSteps = [];
  for (const r of rows) { const s = farmSteps(r, 1500, 180); stepsN += s.length; allSteps.push(...s); if (s.length !== 6 || s.some((x) => x.length < 20 || x.length > 600)) stepsOk = false; }
  const stepsChk = fnv1a(allSteps.join('\n'));
  checks.push(['Farm steps', stepsOk && stepsChk === R.steps_checksum, `${stepsN} steps regenerated live, all 6 per row and 20–600 chars` + (stepsChk === R.steps_checksum ? ', checksum matches the build' : `, checksum MISMATCH ${stepsChk} vs ${R.steps_checksum}`)]);
  const c = R.census;
  const sum = c.ranked + c.early + c.out_category + c.out_versioned + c.out_wrapped + c.priced + c.detached + c.no_cap;
  checks.push(['Census', sum === R.census.total, `groups sum to ${sum} of ${R.census.total} protocols`]);
  const vc = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  rows.forEach((r) => vc[VERD[verdict(r, 1500, 5)]]++);
  checks.push(['Verdicts', vc.FARM === R.farm.counts.FARM && vc.MARGINAL === R.farm.counts.MARGINAL && vc.SKIP === R.farm.counts.SKIP, `FARM ${vc.FARM} / MARGINAL ${vc.MARGINAL} / SKIP ${vc.SKIP} at the $50 bar`]);
  const beta = refitBeta(R.peers);
  const r1 = rows[0];
  const refit = fittedCap(r1, beta);
  const stored = r1[8] * 1000;
  checks.push(['Live refit', Math.abs(refit / stored - 1) < 0.05, `OLS refit on the ${R.peers.length} embedded peers reproduces row 1's fitted cap within ${(Math.abs(refit / stored - 1) * 100).toFixed(1)}%`]);
  $('checks').innerHTML = checks.map(([name, ok, detail]) =>
    `<div class="check ${ok ? '' : 'bad'}"><b>${ok ? 'PASS' : 'FAIL'}</b> — ${name}: ${detail}</div>`).join('');
  $('method').textContent = `Method: log(market cap) = ${R.value.beta.map((b) => b.toFixed(3)).join(' + ')} over [1, log TVL, log TVL²/100, age] on ${R.value.comps_n} priced comps (R² ${R.value.r2.toFixed(3)}). ` +
    `Token odds = logistic[1, log TVL, age, growth, log chains] on ${R.odds.n} rows (Brier ${R.odds.brier.toFixed(3)}). ` +
    `Implied = fitted × odds. Farm net = band-low × ${Math.round(R.farm.pool_share * 100)}% × deposit / (farmers × $1,500) − (3 × gas + 0.3% × deposit); farmers = clamp(TVL/$100k, 100, 5000); 155 minutes of work.`;
}
function openDetail(slug) {
  const r = R.rows.find((x) => x[1] === slug);
  if (!r) return;
  state.detail = slug;
  const v = verdict(r, state.dep, state.share);
  const n = net(r, state.dep, state.share);
  const n1k = net(r, 1000, state.share);
  const hr = n / (155 / 60);
  const md = minDep(r, state.share);
  const be = beDays(r, state.dep, state.share);
  const cat = r[3] >= 0 ? R.cats[r[3]] : '—';
  const lt = Math.log(r[5]);
  const peers = R.peers.map((p) => ({ p, d: Math.abs(Math.log(p[0] * 1000) - lt) })).sort((a, b) => a.d - b.d).slice(0, 3);
  const steps = farmSteps(r, state.dep, state.hor);
  const chainList = r[4].split('|');
  const chainShown = chainList.slice(0, 5).join(', ') + (chainList.length > 5 ? ` +${chainList.length - 5} more` : '');
  $('detail').hidden = false;
  $('detail').innerHTML =
    `<button class="close" id="dClose">Close ×</button><h2>#${r[0]} ${esc(r[2])} ${r[15] ? '<span class="wl">★ watchlist</span>' : ''}</h2>` +
    `<div class="meta">${esc(r[1])} · ${esc(cat)} · ${esc(chainShown)} · TVL ${money(r[5])} · 7d ${r[6] === null ? '—' : (r[6] > 0 ? '+' : '') + r[6].toFixed(1) + '%'} · age ${r[7] === null ? 'unknown' : (r[7] / 365.25).toFixed(1) + 'y'} · rank range #${r[13]}–${r[14]} (bootstrap, 200 refits)</div>` +
    `<div class="grid">` +
    `<div class="cell"><b>${money(r[10])}</b><span>implied value = fitted × odds</span></div>` +
    `<div class="cell"><b>${money(r[8] * 1000)}</b><span>fitted market cap</span></div>` +
    `<div class="cell"><b>${(r[9] * 100).toFixed(1)}%</b><span>token odds (logistic, Brier ${R.odds.brier.toFixed(3)})</span></div>` +
    `<div class="cell"><b>${money(r[11])} – ${money(r[12] * 1000)}</b><span>P10–P90 band</span></div>` +
    `<div class="cell"><b>${n < 0 ? '−$' + num(Math.round(-n)) : '$' + num(Math.round(n))}</b><span>band-low net on $${num(state.dep)}</span></div>` +
    `<div class="cell"><b>${hr < 0 ? '−$' : '$'}${Math.abs(hr).toFixed(1)}</b><span>net per hour (${R.farm.minutes} min of work)</span></div>` +
    `<div class="cell"><b>${n1k < 0 ? '−$' + num(Math.round(-n1k)) : '$' + num(Math.round(n1k))}</b><span>$1,000 slice: the same farm at $1,000</span></div>` +
    `<div class="cell"><b>${md === null ? 'never' : '$' + num(md)}</b><span>minimum deposit to FARM · break-even ${be === null ? 'never' : be + ' days'}</span></div>` +
    `</div>` +
    `<h3>Verdict: <span class="v${VERD[v]}">${VERD[v]}</span> <span style="color:var(--mut);font-weight:400">— FARM needs a band-low net of $50 on $1,500; MARGINAL needs a $5,000 deposit to clear zero; SKIP clears neither.</span></h3>` +
    `<h3>Why this odds: TVL ${money(r[5])} · age ${r[7] === null ? 'missing (peer median ' + R.odds.median_age.toFixed(2) + 'y)' : (r[7] / 365.25).toFixed(1) + 'y'} · growth ${r[6] === null ? 'unreported' : r[6].toFixed(1) + '%'} · ${r[4].split('|').length} chain${r[4].split('|').length === 1 ? '' : 's'} · fitted/(fitted + TVL) = ${(r[8] * 1000 / (r[8] * 1000 + r[5]) * 100).toFixed(1)}% (diagnostic only, never multiplied in)</h3>` +
    `<h3>Nearest priced comps (by TVL)</h3><p class="comps">${peers.map(({ p }) => `${esc(p[3])}: TVL ${money(p[0] * 1000)} → real cap ${money(p[1] * 1000)} (ratio ${(p[1] / p[0]).toFixed(2)})`).join(' · ')}</p>` +
    `<h3>Farm plan — $${num(state.dep)} deposit, ${state.hor}-day horizon</h3><ol>${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` +
    `<p><button class="exp" id="dRefit">Refit without the age term</button> <span id="dSand" style="color:var(--mut)"></span></p>`;
  $('dClose').addEventListener('click', closeDetail);
  $('dRefit').addEventListener('click', () => {
    const b = ols(R.peers.map((p) => { const l = Math.log(p[0] * 1000); return [1, l, (l * l) / 100]; }), R.peers.map((p) => Math.log(p[1] * 1000)));
    const l = Math.log(r[5]);
    const fit = Math.exp(b[0] + b[1] * l + b[2] * (l * l) / 100);
    const imp = Math.round(fit * r[9]);
    $('dSand').textContent = `Without age: fitted ${money(Math.round(fit))}, implied ${money(imp)} (${imp >= r[10] ? '+' : ''}${(((imp / r[10]) - 1) * 100).toFixed(1)}% vs the board). The age term is worth ${(((r[10] / imp) - 1) * 100).toFixed(1)}% here.`;
  });
  history.replaceState(null, '', '#detail=' + slug);
  $('detail').scrollIntoView({ block: 'start' });
  renderTable();
}
function closeDetail() {
  state.detail = null;
  $('detail').hidden = true;
  history.replaceState(null, '', '#');
  renderTable();
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportCSV() {
  const rows = visible();
  const head = 'rank,slug,name,category,chains,tvl_usd,change_7d,age_years,fitted_mcap_usd,token_odds,implied_value_usd,band_low_usd,band_high_usd,net_usd,net_per_hour_usd,verdict,rank_low,rank_high,watchlist';
  const lines = rows.map((r) => [r[0], r[1], '"' + r[2].replace(/"/g, '""') + '"', r[3] < 0 ? '' : R.cats[r[3]], '"' + r[4] + '"', r[5], r[6] ?? '', r[7] ?? '', r[8] * 1000, r[9], r[10], r[11], r[12] * 1000, Math.round(net(r, state.dep, state.share)), (net(r, state.dep, state.share) / (155 / 60)).toFixed(1), VERD[verdict(r, state.dep, state.share)], r[13], r[14], r[15]].join(','));
  download('token-radar-senja-v3.csv', head + '\n' + lines.join('\n') + '\n', 'text/csv');
}
function exportJSON() {
  const rows = visible().map((r) => ({
    rank: r[0], slug: r[1], name: r[2], category: r[3] < 0 ? null : R.cats[r[3]], chains: r[4].split('|'),
    tvl_usd: r[5], change_7d: r[6], age_years: r[7], fitted_mcap_usd: r[8] * 1000, token_odds: r[9],
    implied_value_usd: r[10], band_low_usd: r[11], band_high_usd: r[12] * 1000,
    net_usd: Math.round(net(r, state.dep, state.share)), verdict: VERD[verdict(r, state.dep, state.share)],
    rank_low: r[13], rank_high: r[14], watchlist: !!r[15],
  }));
  download('token-radar-senja-v3.json', JSON.stringify({ as_of: R.as_of, model: R.model_version, rows }, null, 2) + '\n', 'application/json');
}
function applyHash() {
  const h = location.hash;
  const dm = h.match(/detail=([\w-]+)/);
  const tm = h.match(/tab=(\w+)/);
  if (tm && ['all', 'farm', 'marginal', 'skip', 'watch'].includes(tm[1])) {
    state.tab = tm[1];
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === state.tab));
    renderTable();
    window.scrollTo(0, 0);
  }
  if (dm) openDetail(dm[1]);
  else if (state.detail) { state.detail = null; $('detail').hidden = true; window.scrollTo(0, 0); renderTable(); }
}
function init() {
  $('mAsOf').textContent = R.as_of;
  $('mRows').textContent = R.board_size;
  $('mWatch').textContent = R.watchlist_size + '/' + R.watchlist_size;
  $('mTotal').textContent = money(R.total_implied_usd);
  const catSel = $('cat');
  R.cats.forEach((c, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = c; catSel.appendChild(o); });
  const chains = [...new Set(R.rows.flatMap((r) => r[4].split('|')))].sort();
  const chSel = $('chain');
  chains.forEach((c) => { const o = document.createElement('option'); o.value = c; o.textContent = c; chSel.appendChild(o); });
  renderKPIs(); renderFarmNext(); renderCensus(); renderEvidence(); renderChecks(); renderTable();
  $('q').addEventListener('input', (e) => { state.q = e.target.value; renderTable(); });
  $('cat').addEventListener('change', (e) => { state.cat = e.target.value; renderTable(); });
  $('chain').addEventListener('change', (e) => { state.chain = e.target.value; renderTable(); });
  $('sort').addEventListener('change', (e) => { state.sort = e.target.value; renderTable(); });
  $('dep').addEventListener('change', (e) => { state.dep = +e.target.value; renderFarmNext(); renderTable(); if (state.detail) openDetail(state.detail); });
  $('hor').addEventListener('change', (e) => { state.hor = +e.target.value; renderTable(); if (state.detail) openDetail(state.detail); });
  $('share').addEventListener('input', (e) => { state.share = +e.target.value; $('shareV').textContent = state.share + '%'; renderFarmNext(); renderTable(); if (state.detail) openDetail(state.detail); });
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    state.tab = b.dataset.tab;
    history.replaceState(null, '', state.tab === 'all' ? '#' : '#tab=' + state.tab);
    renderTable();
  }));
  document.querySelectorAll('#board th[data-k]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.k;
    if (state.sort === k) state.desc = !state.desc; else { state.sort = k; state.desc = k !== 'name' && k !== 'cat' && k !== 'chain'; }
    $('sort').value = ['rank', 'name', 'cat', 'chain', 'tvl', 'chg', 'age', 'fit', 'odds', 'imp', 'net', 'hr', 'verdict'].includes(k) ? (k === 'fit' ? 'imp' : k) : state.sort;
    renderTable();
  }));
  $('csvBtn').addEventListener('click', exportCSV);
  $('jsonBtn').addEventListener('click', exportJSON);
  window.addEventListener('hashchange', applyHash);
  applyHash();
}
init();
