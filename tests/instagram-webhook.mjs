import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {test} from 'node:test';
import {createHandler, hasProjectKeyword, INSTAGRAM_CATALOG_KEYWORDS, validSignature} from '../supabase/functions/instagram-catalog/handler.mjs';

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
const event = ({text = 'Хочу проект', comment = '17900000000012345', seconds = fixedTime / 1000, id = account, author = '123456', username = 'client_for_test', flags = {}} = {}) => ({
  object: 'instagram',
  entry: [{id, time: seconds, changes: [{field: 'comments', value: {id: comment, from: {id: author, username}, text, ...flags}}]}],
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
    if (path.endsWith('/rpc/record_instagram_catalog_identity')) return Response.json(true);
    if (path.includes('?fields=username%2Ctext')) return Response.json({id:'17900000000012345',username:'looked_up_client',text:'Проект'});
    if (path.endsWith('/rest/v1/share_links')) return new Response(null, {status: 201});
    if (path.endsWith('/messages')) {
      if (loseResponse) throw new Error('mock connection lost');
      return Response.json(payload, {status});
    }
    throw new Error('Unexpected mock URL: ' + path);
  };
  return {calls, fetch};
}

test('keyword list equals the exact owner-approved 27 entries', () => {
  const approved = [
    'проект', 'хочу проект', 'проэкт', 'дом', 'цена', 'стоимость', 'сколько',
    'почём', 'прайс', 'план', 'планировка', 'размеры', 'площадь', 'метраж',
    'купить', 'покупка', 'заказать', 'хочу', 'каталог', 'скинь', 'пришли',
    'отправь', 'price', 'project', 'house', 'plan', '+',
  ];
  assert.deepEqual([...INSTAGRAM_CATALOG_KEYWORDS], approved);
});

test('every approved keyword triggers as an exact word or phrase, case-insensitive', () => {
  for (const word of INSTAGRAM_CATALOG_KEYWORDS) {
    assert.equal(hasProjectKeyword(word), true, word);
    assert.equal(hasProjectKeyword('  ' + word + '  '), true, 'trim ' + word);
    if (word !== '+') assert.equal(hasProjectKeyword('Здравствуйте, ' + word.toUpperCase() + '!'), true, word);
  }
  assert.equal(hasProjectKeyword('Хочу ПРОЕКТ, пожалуйста'), true);
  assert.equal(hasProjectKeyword('Цена?'), true);
});

test('non-approved synonyms, emoji, substrings and extra pluses do not trigger', () => {
  for (const message of [
    '', 'Красивый фасад!', 'Спасибо', 'прожекторы', 'коттедж', 'вилла', 'особняк',
    'смета', 'бюджет', 'строительство', 'построить', 'чертёж', 'габариты',
    'ссылка', 'инфо', 'подробно', 'WhatsApp', 'ватсап', 'директ', 'личка',
    'телефон', 'контакты', 'cost', '🏡', '🏠', '++', '+++',
    'проектирование', 'домик', 'ценник', 'планы', 'цены', 'проекты',
    'планировки', 'размер', 'покупаю', 'заказываю', 'удом', 'myhouse',
    'projector', 'pricey', 'планшет', 'хотел', 'почем',
  ]) assert.equal(hasProjectKeyword(message), false, message);
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
    ['claim_instagram_catalog_reply', 'share_links', 'messages', 'finish_instagram_catalog_reply', 'record_instagram_catalog_comment']);
  const link = mock.calls[1].data;
  assert.equal(Date.parse(link.expires_at) - Date.parse(link.created_at), 48 * 60 * 60 * 1000);
  assert.match(link.token, /^[a-f0-9]{32}$/);
  const reply = mock.calls[2].data;
  assert.equal(reply.recipient.comment_id, '17900000000012345');
  assert.equal(reply.message.attachment.type, 'template');
  const template = reply.message.attachment.payload;
  assert.equal(template.template_type, 'button');
  assert.match(template.text, /48 часов/);
  assert.ok(template.text.includes('\n\n'), 'the greeting must render real paragraph breaks');
  assert.ok(!template.text.includes('\\n'), 'do not show raw slash-n characters to users');
  assert.match(template.text, /ARHITTEK/);
  assert.doesNotMatch(template.text, /https?:\/\//);
  assert.doesNotMatch(template.text, /\.pdf\b/i);
  assert.equal(template.buttons.length, 1);
  assert.equal(template.buttons[0].type, 'web_url');
  assert.equal(template.buttons[0].title, 'Открыть каталог');
  const linkUrl = new URL(template.buttons[0].url);
  assert.equal(linkUrl.hostname, 'edmama121212-tech.github.io');
  assert.equal(linkUrl.pathname, '/arhittek-app/catalog.html');
  assert.equal(linkUrl.searchParams.get('t'), link.token);
  assert.equal(mock.calls[3].data.p_state, 'sent');
  assert.equal(mock.calls[3].data.p_message, 'mock-message');
  assert.equal(mock.calls[4].data.p_text, 'Хочу проект');
  assert.equal(mock.calls[4].data.p_username, 'client_for_test');
  assert.equal(mock.calls[4].data.p_comment, '17900000000012345');
});

test('missing webhook username is fetched from Meta comment details after successful send', async () => {
  const mock=service();
  const res=await createHandler(env,{fetch:mock.fetch,now:()=>fixedTime})(
    signedRequest(event({username:''}))
  );
  assert.equal(res.status,200);
  const lookup=mock.calls.find(c=>c.path.includes('?fields=username%2Ctext'));
  assert(lookup,'expected read-only Graph lookup for missing username');
  const identity=mock.calls.find(c=>c.path.endsWith('/rpc/record_instagram_catalog_identity'));
  assert.equal(identity.data.p_username,'looked_up_client');
  assert.equal(identity.data.p_text,'Хочу проект');
});

test('duplicate, irrelevant, own, unrelated account and stale comments send nothing', async () => {
  const duplicate = service({claim: {claimed: false, state: 'sent'}});
  assert.equal((await createHandler(env, {fetch: duplicate.fetch, now: () => fixedTime})(signedRequest(event()))).status, 200);
  assert.equal(duplicate.calls.length, 1);
  for (const evt of [
    event({text: 'Спасибо'}), event({author: account}),
    event({flags: {is_deleted: true}}), event({flags: {is_self: true}}),
    // Comments expose from.username even when the self flag is not supplied.
    event({flags: {from: {id: 'scoped-own-id', username: 'ArHiTtEk.PlAnS'}}}),
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
