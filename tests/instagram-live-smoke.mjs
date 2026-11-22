import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checkLive} from '../scripts/instagram-live-smoke.mjs';

const fake = (status, body = '') => new Response(body, {status});
const html = "<script>sb.rpc('get_public_catalog',{p_token:t})</script>";

test('public smoke checks run without credentials and pass on expected contract', async () => {
  const calls = [];
  const results = await checkLive({request: async (url, options) => {
    const u = String(url);
    calls.push({url: u, options});
    if (u.includes('hub.verify_token')) return fake(403);
    if (options.method === 'POST') return fake(401);
    return fake(200, html);
  }});
  assert.equal(results.length, 5);
  assert.equal(results.every(r => r.pass), true);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.body, '{}');
  for (const c of calls) assert.doesNotMatch(JSON.stringify(c), /META_ACCESS_TOKEN|META_APP_SECRET|SUPABASE_SERVICE_ROLE_KEY/);
});

test('public smoke check rejects missing HMAC check, unsafe catalog and service errors', async () => {
  const results = await checkLive({request: async (url, options) => {
    const u = String(url);
    if (u.includes('hub.verify_token')) return fake(403);
    if (options.method === 'POST') return fake(503);
    return fake(200, "sb.from('share_links');");
  }});
  assert.equal(results.filter(r => !r.pass).length, 3);
});

test('network failures report failure rather than inventing passing checks', async () => {
  const results = await checkLive({request: async () => {throw new Error('offline');}});
  assert.equal(results.length, 5);
  assert.equal(results.every(r => !r.pass), true);
  assert.equal(results[0].status, 'network-error');
});
