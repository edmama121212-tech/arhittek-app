const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const {chromium} = require('playwright');
const root = path.resolve(process.env.TEST_APP_ROOT || path.join(__dirname, '..'));

(async () => {
  const browser = await chromium.launch({executablePath: process.env.BROWSER_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'], headless: true});
  const results = [], pageErrors = [];
  async function createPage(touch = true) {
    const context = await browser.newContext({viewport: {width: touch ? 390 : 1280, height: 844},
      hasTouch: touch, isMobile: touch, serviceWorkers: 'block'});
    await context.addInitScript({path: path.join(__dirname, 'mock.js')});
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'app.test') {
        const file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
        if (fs.existsSync(file)) return route.fulfill({path: file,
          contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : undefined});
      }
      for (const [key, file] of [['xlsx@', 'xlsx/dist/xlsx.full.min.js'], ['jspdf@', 'jspdf/dist/jspdf.umd.min.js'],
        ['jspdf-autotable@', 'jspdf-autotable/dist/jspdf.plugin.autotable.min.js']]) {
        if (url.href.includes(key)) return route.fulfill({path: path.join(root, 'node_modules', file), contentType: 'text/javascript'});
      }
      return route.fulfill({body: '', contentType: 'text/javascript'});
    });
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto('https://app.test/');
    await page.waitForFunction(() => window.state?.financialDataReady && typeof window.loadAll === 'function');
    await page.waitForTimeout(350);
    await page.addScriptTag({path: path.join(root, 'app-refresh.js')});
    await page.evaluate(() => {
      window.__ptrTouch = function(type, x = 160, y = 200, options = {}) {
        const target = document.querySelector(options.target || 'main');
        const touches = Array.from({length: options.fingers || 1}, (_, i) => new Touch({
          identifier: i + 1, target, clientX: x + i * 20, clientY: y, screenX: x + i * 20, screenY: y, pageX: x + i * 20, pageY: y
        }));
        const ending = type === 'touchend' || type === 'touchcancel';
        const event = new TouchEvent(type, {bubbles: true, cancelable: options.cancelable !== false,
          touches: ending ? [] : touches, targetTouches: ending ? [] : touches, changedTouches: touches});
        target.dispatchEvent(event);
        return event.defaultPrevented;
      };
      window.__ptrPull = function(options = {}) {
        __ptrTouch('touchstart', 160, 200, options);
        __ptrTouch('touchmove', 160, 310, options);
        __ptrTouch('touchend', 160, 310, options);
      };
      const original = window.fetchAllRows;
      window.__ptrHold = false; window.__ptrReleases = []; window.__ptrFetches = 0;
      window.fetchAllRows = async function(...args) {
        __ptrFetches++;
        if (__ptrHold) await new Promise(resolve => __ptrReleases.push(resolve));
        return original.apply(this, args);
      };
      window.__ptrRelease = function() { __ptrHold = false; __ptrReleases.splice(0).forEach(resolve => resolve()); };
      window.scrollTo(0, 0);
    });
    return {page, context};
  }
  async function check(name, fn) {
    try { await fn(); results.push({name, pass: true}); }
    catch (error) { results.push({name, pass: false, error: error.message}); }
  }
  let {page, context} = await createPage();
  await check('The mobile indicator is installed once and starts hidden', async () => {
    await page.addScriptTag({path: path.join(root, 'app-refresh.js')});
    assert.deepEqual(await page.evaluate(() => [document.querySelectorAll('#appRefreshIndicator').length,
      document.getElementById('appRefreshIndicator').hidden, ARHITTEKRefresh.state]), [1, true, 'idle']);
  });
  await check('A short pull has clear feedback and does not read data', async () => {
    assert.deepEqual(await page.evaluate(() => {
      const before = __ptrFetches; __ptrTouch('touchstart');
      const prevented = __ptrTouch('touchmove', 160, 238);
      const pulling = [ARHITTEKRefresh.state, document.getElementById('appRefreshIndicator').textContent.includes('Потяните')];
      __ptrTouch('touchend', 160, 238);
      return [prevented, pulling, ARHITTEKRefresh.state, __ptrFetches - before];
    }), [true, ['pulling', true], 'idle', 0]);
  });
  await check('Horizontal and upward gestures remain ordinary scrolling', async () => {
    assert.deepEqual(await page.evaluate(() => {
      const before = __ptrFetches; __ptrTouch('touchstart');
      const horizontal = __ptrTouch('touchmove', 280, 215); __ptrTouch('touchend', 280, 215);
      __ptrTouch('touchstart'); const upward = __ptrTouch('touchmove', 160, 110); __ptrTouch('touchend', 160, 110);
      return [horizontal, upward, ARHITTEKRefresh.state, __ptrFetches - before];
    }), [false, false, 'idle', 0]);
  });
  await check('Releasing an armed pull waits for a delayed complete read', async () => {
    await page.evaluate(() => {
      __ptrHold = true; __ptrTouch('touchstart'); __ptrTouch('touchmove', 160, 310);
    });
    assert.equal(await page.evaluate(() => ARHITTEKRefresh.state), 'armed');
    await page.evaluate(() => __ptrTouch('touchend', 160, 310));
    await page.waitForFunction(() => __ptrReleases.length > 0);
    assert.deepEqual(await page.evaluate(() => [ARHITTEKRefresh.state, ARHITTEKRefresh.isRefreshing,
      document.getElementById('appRefreshIndicator').getAttribute('aria-busy')]), ['refreshing', true, 'true']);
    await page.evaluate(() => __ptrRelease());
    await page.waitForFunction(() => ARHITTEKRefresh.state === 'success' && !ARHITTEKRefresh.isRefreshing);
  });
  await check('Repeated pulls and manual triggers share one running refresh', async () => {
    await page.evaluate(() => { __ptrHold = true; window.__ptrBeforeReads = __ptrFetches; __ptrPull(); });
    await page.waitForFunction(() => __ptrReleases.length > 0);
    const before = await page.evaluate(() => __ptrFetches);
    assert.deepEqual(await page.evaluate(() => {
      const a = ARHITTEKRefresh.refresh(), b = ARHITTEKRefresh.refresh();
      __ptrPull(); __ptrPull(); __ptrTouch('touchcancel');
      return [a === b, ARHITTEKRefresh.state, ARHITTEKRefresh.isRefreshing];
    }), [true, 'refreshing', true]);
    assert.equal(await page.evaluate(() => __ptrFetches), before);
    await page.evaluate(() => __ptrRelease());
    await page.waitForFunction(() => !ARHITTEKRefresh.isRefreshing);
  });
  await check('Pull-to-refresh joins an existing load and waits for the queued fresh pass', async () => {
    await page.evaluate(() => {
      __ptrHold = true; window.__ptrPasses = 0;
      window.__ptrRender = window.renderAll;
      window.renderAll = function(...args) { __ptrPasses++; return __ptrRender.apply(this, args); };
      window.__ptrExisting = loadAll();
    });
    await page.waitForFunction(() => __ptrReleases.length > 0);
    await page.evaluate(() => __ptrPull());
    await page.waitForTimeout(60);
    assert.equal(await page.evaluate(() => ARHITTEKRefresh.state), 'refreshing');
    await page.evaluate(() => __ptrRelease());
    await page.waitForFunction(() => !ARHITTEKRefresh.isRefreshing);
    assert.deepEqual(await page.evaluate(() => {
      window.renderAll = __ptrRender; return [ARHITTEKRefresh.state, __ptrPasses];
    }), ['success', 2]);
  });
  await check('The active finance section and selected month survive a refresh without writes', async () => {
    await page.evaluate(() => {
      document.querySelector('.nav-btn[data-view="view-finance"]').click();
      const picker = document.getElementById('cashMonth'); picker.value = '2026-10'; picker.dispatchEvent(new Event('change'));
      window.__ptrBeforeNav = performance.getEntriesByType('navigation').length;
      __writes.length = 0; __ptrPull();
    });
    await page.waitForFunction(() => !ARHITTEKRefresh.isRefreshing);
    assert.deepEqual(await page.evaluate(() => [document.querySelector('.view.active').id,
      document.getElementById('cashMonth').value, __writes.length,
      performance.getEntriesByType('navigation').length === __ptrBeforeNav]), ['view-finance', '2026-10', 0, true]);
  });
  await check('A previously focused navigation button does not disable the next pull', async () => {
    await page.evaluate(() => {
      document.querySelector('.nav-btn[data-view="view-finance"]').focus();
      __ptrHold = true; __ptrPull();
    });
    await page.waitForFunction(() => __ptrReleases.length > 0);
    assert.equal(await page.evaluate(() => ARHITTEKRefresh.state), 'refreshing');
    await page.evaluate(() => { document.activeElement.blur(); __ptrRelease(); });
    await page.waitForFunction(() => !ARHITTEKRefresh.isRefreshing);
  });
  await check('A database error ends the spinner and never claims success', async () => {
    await page.evaluate(() => { __fail = {table: 'company_expenses', op: 'select'}; __ptrPull(); });
    await page.waitForFunction(() => !ARHITTEKRefresh.isRefreshing && ARHITTEKRefresh.state === 'error');
    assert.deepEqual(await page.evaluate(() => [state.financialDataReady, !!state.financialDataError,
      document.getElementById('appRefreshIndicator').getAttribute('aria-busy'),
      document.getElementById('appRefreshIndicator').textContent.includes('Не удалось')]), [false, true, 'false', true]);
    await page.evaluate(() => { __fail = null; __ptrPull(); });
    await page.waitForFunction(() => !ARHITTEKRefresh.isRefreshing && ARHITTEKRefresh.state === 'success');
  });
  for (const [table, field, label] of [
    ['project_stages', 'stageDataError', 'stage'],
    ['project_members', 'projectMembersDataError', 'project member']
  ]) {
    await check(`A partial ${label} read failure reports an error and a successful retry clears it`, async () => {
      await page.evaluate(table => { __fail = {table, op: 'select'}; __ptrPull(); }, table);
      await page.waitForFunction(() => !ARHITTEKRefresh.isRefreshing && ARHITTEKRefresh.state === 'error');
      assert.deepEqual(await page.evaluate(field => [state.financialDataReady, !!state[field],
        document.getElementById('appRefreshIndicator').getAttribute('aria-busy')], field), [true, true, 'false']);
      await page.evaluate(() => { __fail = null; __ptrPull(); });
      await page.waitForFunction(() => !ARHITTEKRefresh.isRefreshing && ARHITTEKRefresh.state === 'success');
      assert.deepEqual(await page.evaluate(field => [state.financialDataReady, state[field] == null], field), [true, true]);
    });
  }
  await check('A synchronous refresh error also releases the guard for a retry', async () => {
    assert.deepEqual(await page.evaluate(async () => {
      const original = window.loadAll; window.loadAll = () => { throw new Error('Simulated thrown read error'); };
      const result = await ARHITTEKRefresh.refresh(); window.loadAll = original;
      const failed = [result, ARHITTEKRefresh.isRefreshing, ARHITTEKRefresh.state];
      const retried = await ARHITTEKRefresh.refresh(); return [failed, retried, ARHITTEKRefresh.isRefreshing];
    }), [[false, false, 'error'], true, false]);
  });
  await check('Touch cancel and a second finger cancel armed gestures without reads', async () => {
    assert.deepEqual(await page.evaluate(() => {
      ARHITTEKRefresh.cancel(); const before = __ptrFetches;
      __ptrTouch('touchstart'); __ptrTouch('touchmove', 160, 310); __ptrTouch('touchcancel', 160, 310);
      __ptrTouch('touchstart'); __ptrTouch('touchmove', 160, 310); __ptrTouch('touchmove', 160, 320, {fingers: 2});
      __ptrTouch('touchend', 160, 320); __ptrTouch('touchstart', 160, 200, {fingers: 2}); __ptrTouch('touchend', 160, 310);
      return [ARHITTEKRefresh.state, __ptrFetches - before];
    }), ['idle', 0]);
  });
  await check('Returning above the release threshold cancels the refresh', async () => {
    assert.deepEqual(await page.evaluate(() => {
      const before = __ptrFetches; __ptrTouch('touchstart'); __ptrTouch('touchmove', 160, 310);
      __ptrTouch('touchmove', 160, 235); const phase = ARHITTEKRefresh.state; __ptrTouch('touchend', 160, 235);
      return [phase, ARHITTEKRefresh.state, __ptrFetches - before];
    }), ['pulling', 'idle', 0]);
  });
  await check('A gesture below the top and scrolling away during a pull do not refresh', async () => {
    await page.evaluate(() => {
      document.body.style.minHeight = '2500px'; window.scrollTo(0, 300); window.__ptrScrollReads = __ptrFetches;
    });
    await page.waitForFunction(() => window.scrollY >= 200);
    await page.evaluate(() => __ptrPull());
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => window.scrollY === 0);
    await page.evaluate(() => { __ptrTouch('touchstart'); __ptrTouch('touchmove', 160, 310); window.scrollTo(0, 100); });
    await page.waitForFunction(() => window.scrollY > 0);
    await page.evaluate(() => __ptrTouch('touchend', 160, 310));
    assert.deepEqual(await page.evaluate(() => [ARHITTEKRefresh.state, __ptrFetches - __ptrScrollReads]), ['idle', 0]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => window.scrollY === 0);
  });
  await check('Scrollable lists and horizontal tables keep their own gestures', async () => {
    assert.deepEqual(await page.evaluate(() => {
      const box = document.createElement('div'); box.id = 'ptrScroll'; box.style.cssText = 'width:100px;height:100px;overflow:auto';
      box.innerHTML = '<div id="ptrScrollContent" style="height:500px;width:500px">Content</div>'; document.body.append(box);
      const before = __ptrFetches; __ptrPull({target: '#ptrScrollContent'}); box.remove();
      return [ARHITTEKRefresh.state, __ptrFetches - before];
    }), ['idle', 0]);
  });
  await check('Inputs, focused editors and open sheets preserve unsaved values', async () => {
    assert.deepEqual(await page.evaluate(() => {
      const before = __ptrFetches;
      const input = document.createElement('input'); input.id = 'ptrInput'; input.value = 'Несохранённый текст'; document.body.append(input);
      __ptrPull({target: '#ptrInput'}); input.focus(); __ptrPull(); const value = input.value; input.blur(); input.remove();
      openProjectSheet(null); document.getElementById('pf-name').value = 'Несохранённый проект'; __ptrPull();
      const projectName = document.getElementById('pf-name').value; closeProjectSheet();
      return [ARHITTEKRefresh.state, __ptrFetches - before, value, projectName];
    }), ['idle', 0, 'Несохранённый текст', 'Несохранённый проект']);
  });
  await check('Dirty inline forms and an overlay opened mid-pull block the refresh', async () => {
    assert.deepEqual(await page.evaluate(() => {
      const before = __ptrFetches, active = document.querySelector('.view.active'); active.dataset.dirty = '1'; __ptrPull(); active.dataset.dirty = '0';
      __ptrTouch('touchstart'); __ptrTouch('touchmove', 160, 310);
      const overlay = document.createElement('div'); overlay.className = 'modal'; overlay.style.cssText = 'position:fixed;inset:0;display:block'; document.body.append(overlay);
      __ptrTouch('touchend', 160, 310); overlay.remove();
      return [ARHITTEKRefresh.state, __ptrFetches - before];
    }), ['idle', 0]);
  });
  await check('A browser-owned noncancelable swipe is not hijacked', async () => {
    assert.deepEqual(await page.evaluate(() => {
      const before = __ptrFetches; __ptrPull({cancelable: false}); return [ARHITTEKRefresh.state, __ptrFetches - before];
    }), ['idle', 0]);
  });
  await check('The signed-out app does not start a refresh gesture', async () => {
    assert.deepEqual(await page.evaluate(() => {
      const old = window.session, before = __ptrFetches; window.session = null; __ptrPull(); window.session = old;
      return [ARHITTEKRefresh.state, __ptrFetches - before];
    }), ['idle', 0]);
  });
  for (const width of [390, 360]) {
    await check(`The indicator fits ${width}px and does not cover the header or section heading`, async () => {
      await page.setViewportSize({width, height: 844});
      await page.evaluate(() => { ARHITTEKRefresh.cancel(); window.scrollTo(0, 0); __ptrHold = true; __ptrPull(); });
      await page.waitForFunction(() => __ptrReleases.length > 0);
      assert.deepEqual(await page.evaluate(() => {
        const indicator = document.getElementById('appRefreshIndicator'), rect = indicator.getBoundingClientRect();
        const header = document.querySelector('header').getBoundingClientRect();
        const heading = document.querySelector('.view.active .workspace-head').getBoundingClientRect();
        const rgb = text => text.match(/[\d.]+/g).slice(0, 3).map(Number);
        const luminance = color => rgb(color).map(c => c / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
          .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
        const css = getComputedStyle(indicator), fg = luminance(css.color), bg = luminance(css.backgroundColor);
        const contrast = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
        return [rect.left >= 12, rect.right <= innerWidth - 12, rect.top >= header.bottom,
          rect.bottom <= heading.top, indicator.scrollWidth <= indicator.clientWidth,
          contrast >= 4.5, document.documentElement.scrollWidth <= innerWidth];
      }), [true, true, true, true, true, true, true]);
      await page.evaluate(() => __ptrRelease());
      await page.waitForFunction(() => !ARHITTEKRefresh.isRefreshing);
    });
  }
  await check('The longer error state fits 360px without covering content', async () => {
    await page.evaluate(() => { __fail = {table: 'company_expenses', op: 'select'}; __ptrPull(); });
    await page.waitForFunction(() => !ARHITTEKRefresh.isRefreshing && ARHITTEKRefresh.state === 'error');
    assert.deepEqual(await page.evaluate(() => {
      const indicator = document.getElementById('appRefreshIndicator'), rect = indicator.getBoundingClientRect();
      return [innerWidth, rect.left >= 12, rect.right <= innerWidth - 12,
        rect.bottom <= document.querySelector('.view.active .workspace-head').getBoundingClientRect().top,
        indicator.scrollWidth <= indicator.clientWidth, document.documentElement.scrollWidth <= innerWidth];
    }), [360, true, true, true, true, true]);
    await page.evaluate(() => { __fail = null; __ptrPull(); });
    await page.waitForFunction(() => !ARHITTEKRefresh.isRefreshing && ARHITTEKRefresh.state === 'success');
  });
  await check('Trusted browser touch refreshes without native page reload or scrolling', async () => {
    await page.evaluate(() => {
      ARHITTEKRefresh.cancel(); window.scrollTo(0, 0); __ptrHold = true; window.__ptrTrusted = [];
      window.__ptrTrustedListener = event => __ptrTrusted.push(event.isTrusted);
      document.addEventListener('touchmove', __ptrTrustedListener, {passive: true});
      window.__ptrNativeNavigations = performance.getEntriesByType('navigation').length;
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 170, y: 130}]});
    for (const y of [150, 180, 215, 250]) {
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: 170, y}]});
      await page.waitForTimeout(20);
    }
    assert.equal(await page.evaluate(() => ARHITTEKRefresh.state), 'armed');
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await page.waitForFunction(() => __ptrReleases.length > 0);
    assert.deepEqual(await page.evaluate(() => [ARHITTEKRefresh.state,
      __ptrTrusted.length > 0 && __ptrTrusted.every(Boolean), window.scrollY,
      performance.getEntriesByType('navigation').length === __ptrNativeNavigations]), ['refreshing', true, 0, true]);
    await page.evaluate(() => { document.removeEventListener('touchmove', __ptrTrustedListener); __ptrRelease(); });
    await page.waitForFunction(() => !ARHITTEKRefresh.isRefreshing);
    await cdp.detach();
  });
  await context.close();
  ({page, context} = await createPage(false));
  await check('Desktop touch-shaped events do not activate pull-to-refresh', async () => {
    assert.deepEqual(await page.evaluate(() => {
      const before = __ptrFetches; __ptrPull(); return [ARHITTEKRefresh.state, __ptrFetches - before];
    }), ['idle', 0]);
  });
  await check('Desktop reserves no space for the mobile indicator', async () => {
    assert.deepEqual(await page.evaluate(() => [document.getElementById('appRefreshIndicator').hidden,
      document.getElementById('appRefreshSpacer').getBoundingClientRect().height,
      document.documentElement.scrollWidth <= innerWidth]), [true, 0, true]);
  });
  await context.close(); await browser.close();
  results.push({name: 'No uncaught browser errors', pass: pageErrors.length === 0, ...(pageErrors.length ? {error: pageErrors.join('; ')} : {})});
  for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.error ? ': ' + result.error : ''));
  console.log(`${results.filter(r => r.pass).length}/${results.length} pull-to-refresh checks passed`);
  if (results.some(r => !r.pass)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
