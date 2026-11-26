const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const token = 'valid-single-house-15726';
const tariffId = '00000000-0000-0000-0000-000000000450';
const db = new PGlite();

async function payload(access, pricesOnly) {
  const args = pricesOnly ? '$1, true' : '$1';
  const { rows } = await db.query('select public.get_public_catalog(' + args + ') as result', [access]);
  return rows[0].result;
}

async function run() {
  await db.exec(`
    create role anon;
    create role authenticated;
    create table kp_catalog (id uuid primary key, group_name text, name text, unit text, rate numeric, sort_order integer, deleted_at timestamptz);
    create table catalog_pricing (id integer primary key);
    create table project_cards (id text primary key, total_area text, price text, project_number text, floors integer,
      created_at timestamptz, deleted_at timestamptz, pdf_import_meta jsonb);
    create table share_links (id text primary key, token text, project_id text, floors_filter text, expires_at timestamptz, deleted_at timestamptz);
    insert into catalog_pricing values (1);
    insert into kp_catalog values ('${tariffId}', 'Архитектурное проектирование', 'Архитектурное решение', 'м²', 450, 1, null);
    insert into project_cards (id, project_number, total_area, price, floors) values
      ('a','15726','482,51','33776',2), ('b','10026','88','9999',1), ('c','10027','','10000',1);
    insert into share_links (id, token, project_id, floors_filter) values
      ('link','${token}','a','all'), ('floor','valid-one-floor-houses-link', null,'1');
  `);
  await db.exec(fs.readFileSync(path.join(root, 'supabase/instagram-catalog-token-gateway.sql'), 'utf8'));
  for (const mode of [false, true]) {
    assert.equal(await payload('invalid-catalog-bearer-token', mode), null);
    const offer = await payload(token, mode);
    assert.equal(offer.individual_design_rate, 450);
    assert.deepEqual(offer.cards.map(card => card.id), ['a']);
    assert(!Object.hasOwn(offer.cards[0], 'pdf_import_meta'));
    if (mode) assert.deepEqual(Object.keys(offer.cards[0]).sort(), ['id', 'price', 'total_area']);
    assert.deepEqual((await payload('valid-one-floor-houses-link', mode)).cards.map(card=>card.id).sort(), ['b','c']);
  }
  const browser = await chromium.launch({executablePath: process.env.BROWSER_EXECUTABLE || undefined});
  try {
    for (const width of [320, 360, 1440]) {
      const context = await browser.newContext({viewport: {width, height: 860}});
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname === 'cdn.jsdelivr.net') {
          return route.fulfill({contentType:'text/javascript', body: `window.supabase={createClient:()=>({
            rpc:async(name, args)=>({data:await fetch('/fixture', {method:'POST', body:JSON.stringify(args)}).then(r=>r.json())}),
            from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})})
          })}`});
        }
        if (url.pathname === '/fixture') {
          const args = route.request().postDataJSON();
          return route.fulfill({json:await payload(args.p_token, args.p_prices_only)});
        }
        if (!['catalog.html','catalog-floors.js','data-access.js','catalog-floors.css','client.css'].includes(url.pathname.slice(1))) {
          return route.abort();
        }
        return route.fulfill({path:path.join(root, url.pathname.slice(1))});
      });
      await page.goto('https://catalog.test/catalog.html?t=' + token);
      const box = page.locator('.price-block');
      await box.locator('s').waitFor();
      const money = async element => (await element.textContent()).replace(/\s/g, '');
      assert.equal(await money(box.locator('.price')), '34000₽');
      assert.equal(await money(box.locator('s')), '217000₽');
      assert.equal(await page.locator('.stat-area').textContent(), '482,51');
      const layout = await box.evaluate(el => {
        const comparison = el.querySelector('s');
        const ready = el.querySelector('.price');
        const price = ready.getBoundingClientRect();
        const quote = comparison.getBoundingClientRect();
        const buttons = el.querySelector('.btn-row').getBoundingClientRect();
        const readyStyle = getComputedStyle(ready);
        const quoteStyle = getComputedStyle(comparison);
        return {
          sideBySide: quote.left >= price.right && quote.top <= price.top,
          aboveButtons: quote.bottom <= buttons.top,
          withinViewport: quote.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth,
          largerComparison: parseFloat(quoteStyle.fontSize) > parseFloat(readyStyle.fontSize),
          comparisonDecoration: quoteStyle.textDecorationLine,
          colors: [readyStyle.color, quoteStyle.color],
        };
      });
      assert.deepEqual(layout, {
        sideBySide: true, aboveButtons: true, withinViewport: true, largerComparison: true,
        comparisonDecoration: 'line-through', colors: ['rgb(23, 114, 69)', 'rgb(180, 35, 46)'],
      });
      // The real lightweight API path reads the same tariff even after it is renamed.
      await db.exec("update kp_catalog set rate=500, name='Текущая ставка'");
      await page.evaluate(() => refreshCatalogPrices());
      assert.equal(await money(box.locator('s')), '241000₽');
      await db.exec("update project_cards set total_area='100,25' where id='a'");
      await page.evaluate(() => refreshCatalogPrices());
      assert.equal(await money(box.locator('s')), '50000₽');
      assert.equal(await page.locator('.stat-area').textContent(), '100,25');
      assert.equal(await money(box.locator('.price')), '34000₽');
      await db.exec("update project_cards set total_area=null where id='a'");
      await page.evaluate(() => refreshCatalogPrices());
      assert.equal(await box.locator('s').count(), 0);
      await db.exec("update project_cards set total_area='482,51' where id='a'; update kp_catalog set deleted_at=now()");
      await page.evaluate(() => refreshCatalogPrices());
      assert.equal(await box.locator('s').count(), 0);
      await db.exec("update share_links set expires_at=now() where id='link'");
      await page.evaluate(() => refreshCatalogPrices());
      assert.equal(await page.locator('.card').count(), 0);
      assert.deepEqual(errors, []);
      await db.exec("update kp_catalog set rate=450, deleted_at=null; update share_links set expires_at=null where id='link'");
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

run().then(() => console.log('Individual price comparison: SQL access, legacy and compact payloads, desktop and mobile layout, live tariff/area changes, expiry passed'))
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => db.close());
