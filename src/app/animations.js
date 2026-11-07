// ============================================================
// АНИМАЦИИ (единый принцип для всего приложения)
// ============================================================
function animateCountUp(el, duration){
  duration = duration || 700;
  const target = parseInt(el.getAttribute('data-countup'), 10);
  if(isNaN(target)){ return; }
  const start = performance.now();
  function step(ts){
    const p = Math.min((ts - start) / duration, 1);
    el.textContent = Math.round(p * target);
    if(p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

