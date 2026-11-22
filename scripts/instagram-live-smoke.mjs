/**
 * Public-contract smoke checks. Does not use or print any credentials.
 * This does NOT verify a real Meta subscription or Direct delivery.
 */
import {pathToFileURL} from 'node:url';

export const WEBHOOK = 'https://chbkkoxwzpaghanofvqk.supabase.co/functions/v1/instagram-catalog';
export const CATALOG = 'https://edmama121212-tech.github.io/arhittek-app/catalog.html';

export async function checkLive({request = fetch, webhook = WEBHOOK, catalog = CATALOG} = {}) {
  const results = [];
  async function probe(label, url, options, expected) {
    try {
      const res = await request(url, {...options, signal: AbortSignal.timeout(12000)});
      results.push({label, status: res.status, pass: res.status === expected, expected});
      return res;
    } catch {
      results.push({label, status: 'network-error', pass: false, expected});
      return null;
    }
  }
  const challenge = new URL(webhook);
  challenge.searchParams.set('hub.mode', 'subscribe');
  // A deliberately invalid public marker; no real verify token ever used.
  challenge.searchParams.set('hub.verify_token', '__arhittek_invalid_public_probe__');
  challenge.searchParams.set('hub.challenge', 'public_smoke');
  await probe('Invalid Meta challenge is forbidden', challenge, {method: 'GET'}, 403);
  await probe('Unsigned Meta POST is unauthorized', webhook,
    {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'}, 401);
  const page = await probe('Public catalog page is served', catalog, {method: 'GET'}, 200);
  if (page && page.status === 200) {
    const html = await page.text();
    results.push({label: 'Catalog uses time-gated server RPC', pass: html.includes('get_public_catalog')});
    results.push({label: 'Catalog has no direct anonymous table reads',
      pass: !/\.from\s*\(\s*['"](?:share_links|project_cards)['"]\s*\)/.test(html)});
  } else {
    results.push({label: 'Catalog uses time-gated server RPC', pass: false});
    results.push({label: 'Catalog has no direct anonymous table reads', pass: false});
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await checkLive();
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.label}${r.status === undefined ? '' : ` (HTTP ${r.status}, expected ${r.expected})`}`);
  console.log('NOTE: These public probes do not confirm token validity, Meta approval, webhook subscription or Direct delivery.');
  if (results.some(r => !r.pass)) process.exitCode = 1;
}
