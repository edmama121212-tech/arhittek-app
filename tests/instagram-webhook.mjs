import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {test} from 'node:test';
import {createHandler, hasProjectKeyword, validSignature} from '../supabase/functions/instagram-catalog/handler.mjs';

const fixedTime = Date.parse('2026-11-22T18:00:00.000Z');
const secret = 'local-test-secret-not-real';
const account = '17841422845904072';
const env = {
  META_VERIFY_TOKEN: 'local-test-verify-token',
  META_APP_SECRET: secret,
  META_ACCESS_TOKEN: 'local-test-token',
  META_IG_ACCOUNT_ID: account,
  META_GRAPH_VERSION: 'v27.0',
  META_GRAPH_HOST: 'graph.facebook.com',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'local-test-key',
};
const event = ({text = 'Хочу проект', comment = '17900000000012345', seconds = fixedTime / 1000, id = account, author = '123456', flags = {}} = {}) => ({
  object: 'instagram',
  entry: [{id, time: seconds, changes: [{field: 'comments', value: {id: comment, from: {id: author}, text, ...flags}}]}],
});
function signedRequest(data, badSignature = false) {
  const raw = typeof data === 'string' ? data : JSON.stringify(data);
  const sig = createHmac('sha256', badSignature ? 'wrong-test-secret' : secret).update(raw).digest('hex');
  return new Request('https://example.supabase.co/functions/v1/instagram-catalog', {
    method: 'POST', headers: {'Content-Type': 'application/json', 'x-hub-signature-256': 'sha256=' + sig}, body: raw,
  });
}
function service({claim = {claimed: true, lease: '11111111-1111-4111-8111-111111111111'}, status = 200, payload = {message_id: 'mock-message'}, loseResponse = false} = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const path = String(url);
    const data = init.body ? JSON.parse(init.body) : null;
    calls.push({path, data});
    if (path.endsWith('/rpc/claim_instagram_catalog_reply')) return Response.json(claim);
    if (path.endsWith('/rpc/finish_instagram_catalog_reply')) return Response.json(true);
    if (path.endsWith('/rest/v1/share_links')) return new Response(null, {status: 201});
    if (path.endsWith('/messages')) {
      if (loseResponse) throw new Error('mock connection lost');
      return Response.json(payload, {status});
    }
    throw new Error('Unexpected mock URL: ' + path);
  };
  return {calls, fetch};
}

test('keyword filtering accepts intended comments, rejects irrelevant text', () => {
  for (const text of ['проект', 'Хочу проект', 'цену', 'PROJECT', '🏡', '+'])
    assert.equal(hasProjectKeyword(text), true, text);
  for (const text of ['', 'Красивый фасад!', 'Спасибо', 'прожекторы'])
    assert.equal(hasProjectKeyword(text), false, text);
});

test('Meta webhook GET challenge verifies exact token, never echoes invalid challenge', async () => {
  const fn = createHandler(env);
  const base = 'https://example.supabase.co/functions/v1/instagram-catalog';
  const valid = await fn(new Request(base + '?hub.mode=subscribe&hub.verify_token=local-test-verify-token&hub.challenge=ABC123'));
  assert.equal(valid.status, 200);
  assert.equal(await valid.text(), 'ABC123');
  const invalid = await fn(new Request(base + '?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=ABC123'));
  assert.equal(invalid.status, 403);
  const missing = await createHandler({...env, META_VERIFY_TOKEN: ''})(new Request(base + '?hub.mode=subscribe&hub.challenge=ABC123'));
  assert.equal(missing.status, 503);
});

test('unsigned, tampered and malformed POST requests fail closed', async () => {
  const fn = createHandler(env);
  const raw = new TextEncoder().encode('payload');
  const signature = 'sha256=' + createHmac('sha256', secret).update('payload').digest('hex');
  assert.equal(await validSignature(secret, raw, signature), true);
  const unsigned = await fn(new Request('https://example.supabase.co/functions/v1/instagram-catalog', {method: 'POST', body: '{}'}));
  assert.equal(unsigned.status, 401);
  assert.equal((await fn(signedRequest('{}', true))).status, 401);
  assert.equal((await fn(signedRequest('{bad-json'))).status, 400);
});

test('valid signed comment creates a 48h link and one private reply, not a PDF', async () => {
  const mock = service();
  const res = await createHandler(env, {fetch: mock.fetch, now: () => fixedTime})(signedRequest(event()));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'EVENT_RECEIVED');
  assert.deepEqual(mock.calls.map(x => x.path.split('/').at(-1)),
    ['claim_instagram_catalog_reply', 'share_links', 'messages', 'finish_instagram_catalog_reply']);
  const link = mock.calls[1].data;
  assert.equal(Date.parse(link.expires_at) - Date.parse(link.created_at), 48 * 60 * 60 * 1000);
  assert.match(link.token, /^[a-f0-9]{32}$/);
  const reply = mock.calls[2].data;
  assert.equal(reply.recipient.comment_id, '17900000000012345');
  assert.match(reply.message.text, /48 часов/);
  assert.match(reply.message.text, /WhatsApp/);
  assert.match(reply.message.text, /catalog\.html\?t=[a-f0-9]{32}/);
  assert.doesNotMatch(reply.message.text, /\.pdf\b/i);
  assert.equal(mock.calls[3].data.p_state, 'sent');
  assert.equal(mock.calls[3].data.p_message, 'mock-message');
});

test('duplicate, irrelevant, own, unrelated account and stale comments send nothing', async () => {
  const duplicate = service({claim: {claimed: false, state: 'sent'}});
  assert.equal((await createHandler(env, {fetch: duplicate.fetch, now: () => fixedTime})(signedRequest(event()))).status, 200);
  assert.equal(duplicate.calls.length, 1);
  for (const evt of [
    event({text: 'Спасибо'}), event({author: account}),
    event({flags: {is_deleted: true}}), event({flags: {is_self: true}}),
    event({id: '99999999'}), event({seconds: fixedTime / 1000 - 8 * 86400}),
  ]) {
    const mock = service();
    assert.equal((await createHandler(env, {fetch: mock.fetch, now: () => fixedTime})(signedRequest(evt))).status, 200);
    assert.equal(mock.calls.length, 0);
  }
});

test('definite Meta error is failed; network ambiguity is uncertain; 429 stays pending', async () => {
  for (const scenario of [
    {options: {status: 400, payload: {error: {code: 10}}}, result: 200, state: 'failed'},
    {options: {loseResponse: true}, result: 503, state: 'uncertain'},
    {options: {status: 429, payload: {error: {code: 4}}}, result: 503, state: 'pending'},
  ]) {
    const mock = service(scenario.options);
    const res = await createHandler(env, {fetch: mock.fetch, now: () => fixedTime})(signedRequest(event()));
    assert.equal(res.status, scenario.result);
    assert.equal(mock.calls.at(-1).data.p_state, scenario.state);
  }
});
