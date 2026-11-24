// Reads settings from server/.env (never commit that file).
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const env = (process.env.MFP_ENV || 'sandbox').toLowerCase();

// Hosts as published in the MyFundedPerps docs (https://docs.myfundedperpetuals.com).
// Check them against the docs before running: they can change.
const HOSTS = {
  sandbox: {
    rest: 'https://sandbox.myfundedperpetuals.com/v1',
    accountStream: 'wss://account-stream.myfundedperpetuals.com/v1/sandbox/stream',
  },
  live: {
    rest: 'https://developers.myfundedperpetuals.com/v1',
    accountStream: 'wss://account-stream.myfundedperpetuals.com/v1/stream',
  },
};

module.exports = {
  env,
  apiKey: process.env.MFP_API_KEY || '',
  accountId: process.env.MFP_ACCOUNT_ID || '',
  port: Number(process.env.PORT || 8787),
  rest: HOSTS[env].rest,
  accountStream: HOSTS[env].accountStream,
  marketData: 'wss://api-stream.myfundedperpetuals.com/v1/market-data',
};
