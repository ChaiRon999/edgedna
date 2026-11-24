// Account stream: new fills arrive here in real time.
// The Bearer header is sent on the WebSocket upgrade, which a browser cannot do, so this runs on the server.
const WebSocket = require('ws');
const cfg = require('./config');

function connectAccountStream(onEvent) {
  let streamId = null, lastSeq = null, retry = 1000, ws;

  const open = () => {
    const url = new URL(cfg.accountStream);
    if (streamId && lastSeq != null) { url.searchParams.set('stream_id', streamId); url.searchParams.set('last_seq', lastSeq); }
    ws = new WebSocket(url, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });

    ws.on('open', () => { retry = 1000; console.log('[stream] connected'); });
    ws.on('message', (buf) => {
      let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
      if (msg.stream_id) streamId = msg.stream_id;
      if (msg.seq != null) lastSeq = msg.seq;
      // Message shapes per the docs: hello, snapshot, snapshot_end, then events with `type` and `event`.
      onEvent(msg);
    });
    ws.on('close', () => { console.log(`[stream] closed, reconnecting in ${retry / 1000}s`); setTimeout(open, retry); retry = Math.min(retry * 2, 30000); });
    ws.on('error', (e) => console.error('[stream] error:', e.message));
  };

  open();
  return () => ws && ws.close();
}

module.exports = { connectAccountStream };
