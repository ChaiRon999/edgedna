// Builds EdgeDNA trades from closed positions (one position = one trade),
// then adds entry slippage from the fills of that position.
// Position fields per the spec: id, market_id, symbol, side, size, entry_price, exit_price,
// realized_pnl, fees, funding, opened_at, closed_at, close_reason.

const num = (v) => (v == null || v === '' ? null : Number(v));
const isLong = (side) => /^(long|buy)$/i.test(String(side));

function toTrades(positions, fills) {
  return positions
    .filter((p) => p.closed_at)
    .map((p) => {
      const dir = isLong(p.side) ? 1 : -1;
      const t0 = new Date(p.opened_at).getTime(), t1 = new Date(p.closed_at).getTime();
      const entryFills = fills.filter((f) => {
        const t = new Date(f.requested_at || f.created_at || f.filled_at || 0).getTime();
        return f.market_id === p.market_id && t >= t0 - 60e3 && t <= t1 && (isLong(f.side) ? 1 : -1) === dir;
      });
      const slips = entryFills
        .filter((f) => num(f.expected_price) && num(f.fill_price))
        .map((f) => ((num(f.fill_price) - num(f.expected_price)) / num(f.expected_price)) * 1e4 * dir);
      return {
        id: p.id, market: p.market_id, symbol: p.symbol, side: dir > 0 ? 'long' : 'short', dir,
        size: num(p.size), entry: num(p.entry_price), exit: num(p.exit_price),
        pnl: num(p.realized_pnl) ?? 0, fees: num(p.fees) ?? 0, funding: num(p.funding) ?? 0,
        open: p.opened_at, close: p.closed_at, closeReason: p.close_reason || null,
        holdMin: Math.round((t1 - t0) / 60e3),
        slipBps: slips.length ? slips.reduce((s, x) => s + x, 0) / slips.length : null,
      };
    })
    .sort((a, b) => new Date(a.close) - new Date(b.close));
}

// Behaviour flags that need no candles: revenge re-entry and overtrading.
function flags(trades) {
  const perDay = {};
  trades.forEach((t, i) => {
    t.flags = [];
    const prev = trades[i - 1];
    if (prev && prev.pnl < 0 && new Date(t.open) - new Date(prev.close) <= 15 * 60e3 && t.size * t.entry >= 1.2 * prev.size * prev.entry) t.flags.push('revenge');
    const day = String(t.open).slice(0, 10);
    perDay[day] = (perDay[day] || 0) + 1;
    if (perDay[day] >= 4) t.flags.push('over');
  });
  return trades;
}

module.exports = { toTrades, flags };
