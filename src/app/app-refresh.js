/* Touch pull-to-refresh: refresh the current data without navigating or reloading. */
(() => {
  'use strict';
  if (window.ARHITTEKRefresh) return;

  const THRESHOLD = 80;
  const interactive = 'input,textarea,select,button,a,label,form,[contenteditable]:not([contenteditable="false"]),[role="slider"],video,audio,iframe';
  const editors = 'input,textarea,select,[contenteditable]:not([contenteditable="false"])';
  const overlays = '.sheet-overlay,.modal,.modal-overlay,.overlay,[id$="Overlay"],[role="dialog"],[aria-modal="true"],dialog[open]';
  const messages = {
    pulling: 'Потяните, чтобы обновить',
    armed: 'Отпустите для обновления',
    refreshing: 'Обновление…',
    success: 'Данные обновлены',
    error: 'Не удалось обновить. Потяните ещё раз'
  };
  let phase = 'idle', gesture = null, pending = null, hideTimer = null;
  let indicator, label, glyph, spacer;

  function visible(el) {
    if (!el || !el.getClientRects().length) return false;
    const css = getComputedStyle(el);
    return css.display !== 'none' && css.visibility !== 'hidden';
  }
  function mobileTouch() {
    return navigator.maxTouchPoints > 0 && window.matchMedia('(pointer: coarse)').matches;
  }
  function atTop() {
    return window.scrollY <= 1 && (document.scrollingElement?.scrollTop || 0) <= 1;
  }
  function blocked() {
    return !window.session?.token || typeof window.loadAll !== 'function' ||
      [...document.querySelectorAll(overlays)].some(visible) ||
      !!document.querySelector('.view.active[data-dirty="1"]') ||
      !!document.activeElement?.matches(editors);
  }
  function nestedScroller(target) {
    for (let el = target; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      const css = getComputedStyle(el);
      if ((/auto|scroll/.test(css.overflowY) && el.scrollHeight > el.clientHeight + 1) ||
          (/auto|scroll/.test(css.overflowX) && el.scrollWidth > el.clientWidth + 1)) return true;
    }
    return false;
  }
  function clearHide() {
    if (hideTimer !== null) window.clearTimeout(hideTimer);
    hideTimer = null;
  }
  function positionIndicator() {
    const headerBottom = document.querySelector('header')?.getBoundingClientRect().bottom || 0;
    indicator.style.setProperty('--app-refresh-header-bottom', Math.max(0, headerBottom) + 'px');
  }
  function show(next, distance) {
    clearHide();
    const changed = phase !== next;
    phase = next;
    indicator.dataset.state = next;
    indicator.hidden = next === 'idle';
    spacer.hidden = next === 'idle';
    if (next === 'idle') {
      indicator.style.removeProperty('transform');
      indicator.setAttribute('aria-busy', 'false');
      label.textContent = '';
      return;
    }
    positionIndicator();
    if (changed) label.textContent = messages[next] || '';
    glyph.textContent = next === 'success' ? '✓' : next === 'error' ? '!' : '↓';
    indicator.setAttribute('aria-busy', String(next === 'refreshing'));
    indicator.style.transform = 'translate(-50%,' + (distance == null ? '0' : Math.min(14, Math.max(0, distance * 0.2 - 4))) + 'px)';
  }
  function settle(next) {
    show(next);
    hideTimer = window.setTimeout(() => {
      hideTimer = null;
      if (!pending && !gesture) show('idle');
    }, next === 'error' ? 4500 : 1300);
  }
  function cancel() {
    gesture = null;
    if (!pending) show('idle');
  }

  function refresh() {
    if (pending) return pending;
    if (!indicator || blocked()) return Promise.resolve(false);
    gesture = null;
    show('refreshing');
    // loadAll shares its in-flight Promise, including a queued fresh pass. It
    // reports database errors through state rather than rejecting that Promise.
    pending = Promise.resolve().then(async () => {
      try {
        await window.loadAll();
        if (!window.session?.token || !window.state?.financialDataReady || window.state.financialDataError ||
            window.state.stageDataError || window.state.projectMembersDataError) {
          throw new Error('Refresh did not produce a complete data snapshot');
        }
        settle('success');
        return true;
      } catch (error) {
        settle('error');
        return false;
      }
    }).finally(() => { pending = null; });
    return pending;
  }

  function start(event) {
    if (pending || !mobileTouch() || event.touches.length !== 1 || !atTop() || blocked()) {
      if (!pending) cancel();
      return;
    }
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (!target || target.closest(interactive) || nestedScroller(target)) return;
    const touch = event.touches[0];
    clearHide();
    if (phase !== 'idle') show('idle');
    gesture = {id: touch.identifier, x: touch.clientX, y: touch.clientY, distance: 0, claimed: false};
  }
  function move(event) {
    if (!gesture) return;
    if (event.touches.length !== 1 || !atTop() || blocked()) { cancel(); return; }
    const touch = [...event.touches].find(t => t.identifier === gesture.id);
    if (!touch) { cancel(); return; }
    const dx = Math.abs(touch.clientX - gesture.x), dy = touch.clientY - gesture.y;
    // Never claim horizontal swipes or an upward scroll. Once the vertical
    // intent is clear, prevent the browser's own page reload and rubber band.
    if (dy < -5 || (dx > 12 && dx > Math.abs(dy) * 0.8)) { cancel(); return; }
    if (!gesture.claimed) {
      if (dy < 10 || dy <= dx * 1.3) return;
      if (!event.cancelable) { cancel(); return; }
      gesture.claimed = true;
    }
    if (event.cancelable) event.preventDefault();
    gesture.distance = Math.max(0, dy);
    show(dy >= THRESHOLD ? 'armed' : 'pulling', dy);
  }
  function end(event) {
    if (!gesture) return;
    const current = gesture;
    gesture = null;
    if (current.claimed && event.cancelable) event.preventDefault();
    if (event.touches.length || ![...event.changedTouches].some(t => t.identifier === current.id) ||
        !current.claimed || current.distance < THRESHOLD || !atTop() || blocked()) {
      if (!pending) show('idle');
      return;
    }
    void refresh();
  }

  function init() {
    const style = document.createElement('style');
    style.id = 'appRefreshStyles';
    style.textContent = `
      @media (pointer:coarse){html,body{overscroll-behavior-y:none}}
      #appRefreshSpacer{height:44px;pointer-events:none}
      #appRefreshSpacer[hidden]{display:none}
      #appRefreshIndicator{position:fixed;top:max(calc(env(safe-area-inset-top,0px) + 8px),calc(var(--app-refresh-header-bottom,0px) + 8px));left:50%;z-index:49;display:flex;align-items:center;gap:8px;width:max-content;max-width:calc(100vw - 24px);padding:10px 14px;border:1px solid var(--line-strong,rgba(22,35,58,.16));border-radius:24px;background:var(--card-solid,#fff);color:var(--text,#16233a);box-shadow:0 4px 22px rgba(22,35,58,.14);font:500 12px/1.35 Inter,-apple-system,BlinkMacSystemFont,sans-serif;pointer-events:none;transform:translate(-50%,0);transition:transform .12s ease}
      #appRefreshIndicator[hidden]{display:none}
      #appRefreshIndicator .refresh-glyph{display:grid;place-items:center;flex:none;width:16px;height:16px;color:var(--blue,#0071eb);font-size:17px;line-height:1}
      #appRefreshIndicator[data-state="armed"] .refresh-glyph{transform:rotate(180deg)}
      #appRefreshIndicator[data-state="refreshing"] .refresh-glyph{box-sizing:border-box;border:2px solid var(--line-strong,rgba(22,35,58,.16));border-top-color:var(--blue,#0071eb);border-radius:50%;font-size:0;animation:app-refresh-spin .7s linear infinite}
      #appRefreshIndicator[data-state="success"] .refresh-glyph{color:var(--green,#2e7d5b)}
      #appRefreshIndicator[data-state="error"] .refresh-glyph{color:var(--red,#c0522f)}
      @keyframes app-refresh-spin{to{transform:rotate(360deg)}}
      @media(prefers-reduced-motion:reduce){#appRefreshIndicator{transition:none}#appRefreshIndicator[data-state="refreshing"] .refresh-glyph{animation:none}}
    `;
    document.head.append(style);
    spacer = document.createElement('div');
    spacer.id = 'appRefreshSpacer';
    spacer.hidden = true;
    spacer.setAttribute('aria-hidden', 'true');
    const header = document.querySelector('header');
    if (header) header.after(spacer);
    else document.body.prepend(spacer);
    indicator = document.createElement('div');
    indicator.id = 'appRefreshIndicator';
    indicator.dataset.state = 'idle';
    indicator.hidden = true;
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');
    indicator.setAttribute('aria-atomic', 'true');
    glyph = document.createElement('span');
    glyph.className = 'refresh-glyph';
    glyph.setAttribute('aria-hidden', 'true');
    label = document.createElement('span');
    indicator.append(glyph, label);
    document.body.append(indicator);
    document.addEventListener('touchstart', start, {passive: true});
    document.addEventListener('touchmove', move, {passive: false});
    document.addEventListener('touchend', end, {passive: false});
    document.addEventListener('touchcancel', cancel, {passive: true});
    document.addEventListener('scroll', () => { if (gesture && !atTop()) cancel(); }, {passive: true, capture: true});
    window.addEventListener('resize', () => { if (phase !== 'idle') positionIndicator(); }, {passive: true});
  }
  window.ARHITTEKRefresh = {
    refresh,
    cancel,
    get state() { return phase; },
    get isRefreshing() { return pending !== null; }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();
