// EdgeDNA server: reads your account (read-only), grades trades and serves the results as JSON.
// Without an API key it runs in demo mode on simulated trades, so you can try it right away.
const http = require('http');
const cfg = require('./config');
const engine = require('./engine');

const state = { mode: cfg.apiKey ? cfg.env : 'demo', account: null, trades: [], updated: null, error: null };

function summary() {
  const t = state.trades, n = t.length;
  if (state.mode === 'demo') {
    const byStyle = {};
    for (const x of t) {
      const k = x.cls.family, e = (byStyle[k] = byStyle[k] || { style: engine.FAM[k], trades: 0, wins: 0, score: 0 });
      e.trades++; if (x.pnl > 0) e.wins++; e.score += x.score;
    }
    for (const e of Object.values(byStyle)) { e.winRate = +(e.wins / e.trades).toFixed(2); e.avgScore = Math.round(e.score / e.trades); delete e.wins; delete e.score; }
    return { mode: 'demo', trades: n, byStyle };
  }
  const slips = t.map((x) => x.slipBps).filter((v) => v != null);
  const sum = (f) => t.reduce((s, x) => s + f(x), 0);
  return {
    mode: state.mode, account: state.account, updated: state.updated, error: state.error,
    trades: n,
    winRate: n ? +(t.filter((x) => x.pnl > 0).length / n).toFixed(2) : null,
    netPnl: +sum((x) => x.pnl).toFixed(2), fees: +sum((x) => x.fees).toFixed(2), funding: +sum((x) => x.funding).toFixed(2),
    avgEntrySlippageBps: slips.length ? +(slips.reduce((s, v) => s + v, 0) / slips.length).toFixed(2) : null,
    flags: { revenge: t.filter((x) => x.flags.includes('revenge')).length, overtrading: t.filter((x) => x.flags.includes('over')).length },
    note: 'Setup detection needs candles from the market-data stream; that is the next step.',
  };
}

async function loadDemo() {
  const trades = engine.genHistory({ start: 100000, risk: 0.0026, seed: 41 });
  trades.forEach(engine.analyze); engine.rescore(trades);
  state.trades = trades; state.updated = new Date().toISOString();
  console.log(`[demo] graded ${trades.length} simulated trades`);
}

async function loadLive() {
  const api = require('./api');
  const { toTrades, flags } = require('./trades');
  let id = cfg.accountId;
  if (!id) {
    const list = (await api.accounts()).data || [];
    console.log('[accounts]', list.map((a) => `${a.id} ${a.display_name || a.name || ''} (${a.status})`).join(' | ') || 'none');
    if (!list.length) throw new Error('No accounts visible to this key.');
    id = list[0].id;
    console.log(`[accounts] using ${id}. Set MFP_ACCOUNT_ID in .env to choose another.`);
  }
  const acc = (await api.account(id)).data;
  state.account = { id: acc.id, name: acc.display_name || acc.name, stage: acc.stage, status: acc.status, balance: acc.balance };
  const [positions, fills] = await Promise.all([api.closedPositions(id), api.fills(id)]);
  console.log(`[${cfg.env}] ${positions.length} closed positions, ${fills.length} fills`);
  state.trades = flags(toTrades(positions, fills));
  state.updated = new Date().toISOString();
  if (process.env.MFP_STREAM === '1') {
    const { connectAccountStream } = require('./stream');
    connectAccountStream((msg) => console.log('[stream]', msg.type || '', msg.event || ''));
  }
}

http.createServer((req, res) => {
  const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(body, null, 2)); };
  if (req.url === '/api/summary') return send(200, summary());
  if (req.url === '/api/trades') return send(200, state.trades.slice(-50).map(({ candles, ...t }) => t));
  send(404, { error: 'Try /api/summary or /api/trades' });
}).listen(cfg.port, () => console.log(`EdgeDNA server on http://localhost:${cfg.port}  (mode: ${state.mode})`));

(cfg.apiKey ? loadLive() : loadDemo()).catch((e) => { state.error = e.message; console.error('Load failed:', e.message); });
