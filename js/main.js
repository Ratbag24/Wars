'use strict';
/* Boot, menu and main loop */

const params = new URLSearchParams(location.search);

function startGame(diff, demo) {
  const seed = params.has('seed') ? +params.get('seed') : (Math.random() * 1e9) | 0;
  resetGame(seed, diff);
  G.demo = !!demo;
  G.ais = [new AIController(1, diff)];
  if (demo || params.has('autoplay')) G.ais.push(new AIController(0, diff));
  Fog.enabled = !demo && !params.has('nofog');
  UI.clear(); UI.groups = {}; UI.targeting = null; UI.amove = false; UI.html = '';
  Render.newMap();
  Render.cam.z = 1;
  const s = World.sites[0];
  Render.centerOn(s.x + 120, s.y - 80);
  G.running = true; G.paused = false;
  document.getElementById('paused').classList.remove('on');
  document.body.classList.toggle('demo', G.demo);
  document.getElementById('end').classList.remove('on');
  if (!demo) {
    document.getElementById('menu').classList.remove('on');
    alertMsg('Build Supply Depots on the pads around your Citadel', s.x, s.y, true);
  }
}

function showEnd() {
  const win = G.over === 'victory', T = G.teams[0];
  const m = Math.floor(G.time / 60), sec = Math.floor(G.time % 60);
  document.getElementById('end-title').textContent = win ? 'VICTORY' : 'DEFEAT';
  document.getElementById('end').classList.toggle('win', win);
  document.getElementById('end-sub').textContent = win ? 'The Sable Dominion has been driven from the Ashline.' : 'Your last Citadel has fallen.';
  document.getElementById('end-stats').innerHTML =
    '<div><b>' + m + ':' + (sec < 10 ? '0' : '') + sec + '</b>Battle time</div><div><b>' + T.killed + '</b>Enemies destroyed</div><div><b>' + T.lost + '</b>Units lost</div>';
  document.getElementById('end').classList.add('on');
  Sfx.play(win ? 'done' : 'alert');
}

let last = performance.now(), acc = 0, hudT = 0;
const STEP = 1 / 30;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!G.running) return;
  if (!G.paused) {
    acc += dt * G.speed;
    let n = 0;
    while (acc >= STEP && n++ < 8 * G.speed) {
      simTick(STEP); acc -= STEP;
      if (G.over) break;
    }
    if (acc > STEP) acc = 0;
  }
  UI.camera(dt);
  Render.draw();
  hudT -= dt;
  if (hudT <= 0 && !G.demo) { hudT = 0.1; UI.refresh(); }
  if (G.over) {
    if (G.demo) startGame(G.diff, true);
    else if (!G.endShown) { G.endShown = true; setTimeout(showEnd, 1200); }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  Render.init();
  UI.init();
  for (const b of document.querySelectorAll('[data-diff]')) {
    b.addEventListener('click', () => { Sfx.init(); G.endShown = false; startGame(b.dataset.diff, false); });
  }
  document.getElementById('again').addEventListener('click', () => {
    document.getElementById('end').classList.remove('on');
    document.getElementById('menu').classList.add('on');
    G.endShown = false;
    startGame('normal', true);
  });
  if (params.has('autoplay')) { startGame(params.get('diff') || 'normal', false); G.speed = +params.get('speed') || 1; }
  else startGame('normal', true);
  requestAnimationFrame(frame);
});
