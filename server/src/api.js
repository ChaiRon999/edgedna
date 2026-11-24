// Read-only REST client, following https://docs.myfundedperpetuals.com/openapi.yaml
// The API key stays on this server and is never sent to a browser.
const cfg = require('./config');

async function get(pathname, params = {}) {
  const url = new URL(cfg.rest + pathname);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: 'application/json' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${url.pathname}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// Pages through { data, has_more, next_cursor }. limit is 1-100 per the spec.
async function all(pathname, params = {}, maxPages = 10) {
  const out = [];
  let cursor;
  for (let i = 0; i < maxPages; i++) {
    const page = await get(pathname, { ...params, limit: 100, cursor });
    out.push(...(page.data || []));
    if (!page.has_more || !page.next_cursor) break;
    cursor = page.next_cursor;
  }
  return out;
}

module.exports = {
  accounts: () => get('/accounts'),                                                 // { data: Account[] }
  account: (id) => get(`/accounts/${encodeURIComponent(id)}`),                      // { data: Account }
  closedPositions: (accountId) => all('/positions', { account_id: accountId, status: 'closed' }),
  fills: (accountId) => all('/fills', { account_id: accountId }),                   // items: expected_price, fill_price, fee, size, side…
  quote: (marketId, side, size) => get(`/markets/${encodeURIComponent(marketId)}/quote`, { side, size }),
};
