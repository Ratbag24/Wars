'use strict';
/* Sound, input handling and HUD */

const Sfx = {
  ctx: null, muted: false, last: {}, noise: null,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const n = this.ctx.sampleRate, buf = this.ctx.createBuffer(1, n, n), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      this.master = this.ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ctx.destination);
    } catch (e) { this.ctx = null; }
  },
  tone(f0, f1, dur, vol, type, delay) {
    const c = this.ctx, t = c.currentTime + (delay || 0), o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  },
  burst(dur, vol, freq, q, type) {
    const c = this.ctx, t = c.currentTime, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; s.loop = true;
    f.type = type || 'lowpass'; f.frequency.setValueAtTime(freq, t); f.Q.value = q || 0.7;
    if (type !== 'highpass') f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.25), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  },
  play(name) {
    if (!this.ctx || this.muted || G.demo) return;
    const now = performance.now(), gap = { shot: 55, flame: 90, pop: 60, boom: 90, cannon: 70, rocket: 80 }[name] || 0;
    if (now - (this.last[name] || 0) < gap) return;
    this.last[name] = now;
    switch (name) {
      case 'shot': this.burst(0.06, 0.10, 2600, 1.2, 'bandpass'); break;
      case 'flame': this.burst(0.2, 0.06, 900, 0.5); break;
      case 'cannon': this.burst(0.22, 0.3, 900); this.tone(140, 45, 0.2, 0.3); break;
      case 'rocket': this.burst(0.3, 0.12, 3000, 2, 'bandpass'); break;
      case 'pop': this.burst(0.14, 0.2, 1400); break;
      case 'boom': this.burst(0.6, 0.45, 700); this.tone(90, 30, 0.45, 0.4); break;
      case 'power': this.tone(60, 400, 0.9, 0.3, 'sawtooth'); break;
      case 'alert': this.tone(660, 660, 0.12, 0.2, 'square'); this.tone(440, 440, 0.16, 0.2, 'square', 0.15); break;
      case 'done': this.tone(520, 520, 0.1, 0.15, 'triangle'); this.tone(780, 780, 0.16, 0.15, 'triangle', 0.1); break;
      case 'ready': this.tone(700, 900, 0.1, 0.12, 'triangle'); break;
      case 'pickup': this.tone(880, 1320, 0.18, 0.15, 'sine'); break;
      case 'click': this.tone(1200, 900, 0.04, 0.08, 'square'); break;
      case 'order': this.tone(420, 520, 0.06, 0.08, 'triangle'); break;
      case 'deny': this.tone(200, 150, 0.14, 0.14, 'sawtooth'); break;
    }
  },
};

const UI = {
  sel: { units: [], bld: null, site: null, slot: -1 },
  drag: null, mouse: { x: 0, y: 0, inside: false }, targeting: null, amove: false,
  groups: {}, keys: {}, lastClick: { t: 0, type: null }, spec: null, html: '', pan: null,

  init() {
    const cv = Render.cv;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('mousedown', (e) => this.down(e));
    window.addEventListener('mousemove', (e) => this.move(e));
    window.addEventListener('mouseup', (e) => this.up(e));
    cv.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    document.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    window.addEventListener('keydown', (e) => this.key(e));
    window.addEventListener('keyup', (e) => { this.keys[e.key] = false; });
    window.addEventListener('blur', () => { this.keys = {}; });
    const mm = Render.mm;
    const mmGo = (e) => {
      const r = mm.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * WORLD_W, y = ((e.clientY - r.top) / r.height) * WORLD_H;
      if (e.buttons & 2 || e.button === 2) { this.command(x, y, null); return; }
      if (this.targeting) { this.cast(x, y); return; }
      Render.centerOn(x, y);
    };
    mm.addEventListener('mousedown', (e) => { e.preventDefault(); this.mmDrag = e.button === 0; mmGo(e); });
    mm.addEventListener('mousemove', (e) => { if (this.mmDrag && e.buttons & 1 && !this.targeting) mmGo(e); });
    mm.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mouseup', () => { this.mmDrag = false; });
    document.getElementById('cmds').addEventListener('pointerdown', (e) => {
      const q = e.target.closest('[data-q]');
      if (q && this.sel.bld) { cancelTrain(this.sel.bld, +q.dataset.q); Sfx.play('click'); return; }
      const el = e.target.closest('[data-i]');
      if (el) this.press(+el.dataset.i);
    });
    document.getElementById('powers').addEventListener('pointerdown', (e) => {
      const el = e.target.closest('[data-p]');
      if (el) this.startPower(el.dataset.p);
    });
  },

  /* ----- selection ----- */
  clear() {
    for (const u of this.sel.units) u.selected = false;
    this.sel = { units: [], bld: null, site: null, slot: -1 };
  },
  selectUnits(list, add) {
    const keep = add ? this.sel.units : [];
    this.clear();
    const set = new Set(keep);
    for (const u of list) if (!u.dead) set.add(u);
    this.sel.units = [...set];
    for (const u of this.sel.units) u.selected = true;
  },
  prune() {
    const s = this.sel;
    if (s.units.some((u) => u.dead)) s.units = s.units.filter((u) => !u.dead);
    if (s.bld && s.bld.dead) { s.bld = null; }
    if (s.site && s.slot >= 0 && s.site.owner !== 0) { s.site = null; s.slot = -1; }
    if (s.site && s.slot >= 0 && s.site.slots[s.slot]) { s.bld = s.site.slots[s.slot]; s.site = null; s.slot = -1; }
    if (s.site && s.slot < 0 && s.site.owner !== -1) { s.bld = s.site.owner === 0 ? s.site.citadel : null; s.site = null; }
  },
  unitAt(x, y, team) {
    let best = null, bd = 1e9;
    for (const u of G.units) {
      if (u.team !== team) continue;
      if (team !== 0 && !Fog.visibleAt(u.x, u.y)) continue;
      const d = dist(x, y, u.x, u.y);
      if (d < u.radius + 8 && d < bd) { bd = d; best = u; }
    }
    return best;
  },
  bldAt(x, y, team) {
    for (const b of G.blds) {
      if (b.team !== team) continue;
      if (team !== 0 && !Fog.seenAt(b.x, b.y)) continue;
      if (dist(x, y, b.x, b.y) < b.radius) return b;
    }
    return null;
  },

  /* ----- mouse ----- */
  down(e) {
    if (!G.running || G.demo) return;
    Sfx.init();
    const w = Render.toWorld(e.clientX, e.clientY);
    if (e.button === 1) { this.pan = { x: e.clientX, y: e.clientY }; e.preventDefault(); return; }
    if (e.button === 2) {
      if (this.targeting || this.amove) { this.targeting = null; this.amove = false; return; }
      this.command(w.x, w.y, e);
      return;
    }
    if (e.button !== 0) return;
    if (this.targeting) { this.cast(w.x, w.y); return; }
    if (this.amove) {
      this.amove = false;
      if (this.sel.units.length) { groupMove(this.sel.units, w.x, w.y, 'amove'); G.fx.push({ type: 'ring', x: w.x, y: w.y, t: 0, life: 0.5, col: '#ff6a4a' }); Sfx.play('order'); }
      return;
    }
    this.drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, box: false, shift: e.shiftKey };
  },
  move(e) {
    this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true;
    if (this.pan) {
      Render.cam.x -= (e.clientX - this.pan.x) / Render.cam.z; Render.cam.y -= (e.clientY - this.pan.y) / Render.cam.z;
      this.pan = { x: e.clientX, y: e.clientY }; Render.clampCam();
    }
    const d = this.drag;
    if (d) {
      d.x1 = e.clientX; d.y1 = e.clientY;
      if (Math.abs(d.x1 - d.x0) + Math.abs(d.y1 - d.y0) > 8) d.box = true;
    }
  },
  up(e) {
    if (e.button === 1) this.pan = null;
    const d = this.drag;
    if (e.button !== 0 || !d) return;
    this.drag = null;
    if (d.box) {
      const a = Render.toWorld(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1)), b = Render.toWorld(Math.max(d.x0, d.x1), Math.max(d.y0, d.y1));
      const list = G.units.filter((u) => u.team === 0 && u.x > a.x - 6 && u.x < b.x + 6 && u.y > a.y - 6 && u.y < b.y + 6);
      if (list.length || !d.shift) this.selectUnits(list, d.shift);
      return;
    }
    const w = Render.toWorld(d.x0, d.y0);
    const u = this.unitAt(w.x, w.y, 0);
    const now = performance.now();
    if (u) {
      if (now - this.lastClick.t < 320 && this.lastClick.type === u.type) {
        this.selectUnits(G.units.filter((o) => o.team === 0 && o.type === u.type && Render.onScreen(o.x, o.y, 0)), d.shift);
      } else if (d.shift && u.selected) {
        this.selectUnits(this.sel.units.filter((o) => o !== u), false);
      } else this.selectUnits([u], d.shift);
      this.lastClick = { t: now, type: u.type };
      Sfx.play('click');
      return;
    }
    this.lastClick = { t: 0, type: null };
    const b = this.bldAt(w.x, w.y, 0);
    if (b) { this.clear(); this.sel.bld = b; Sfx.play('click'); return; }
    for (const s of World.sites) {
      if (s.owner === 0 && s.citadel && !s.citadel.building) {
        for (let i = 0; i < SLOTS; i++) {
          const p = World.slotPos(s, i);
          if (!s.slots[i] && dist(w.x, w.y, p.x, p.y) < 30) { this.clear(); this.sel.site = s; this.sel.slot = i; Sfx.play('click'); return; }
        }
      }
      if (s.owner === -1 && dist(w.x, w.y, s.x, s.y) < 150 && Fog.seenAt(s.x, s.y)) { this.clear(); this.sel.site = s; this.sel.slot = -1; Sfx.play('click'); return; }
    }
    if (!d.shift) this.clear();
  },
  wheel(e) {
    e.preventDefault();
    if (!G.running) return;
    const c = Render.cam, before = Render.toWorld(e.clientX, e.clientY);
    c.z *= e.deltaY < 0 ? 1.1 : 1 / 1.1;
    Render.clampCam();
    c.x = before.x - e.clientX / c.z; c.y = before.y - e.clientY / c.z;
    Render.clampCam();
  },

  command(x, y, e) {
    const s = this.sel;
    if (s.units.length) {
      const eu = e ? this.unitAt(x, y, 1) : null, eb = e && !eu ? this.bldAt(x, y, 1) : null;
      const t = eu || eb;
      if (t) {
        for (const u of s.units) orderAttack(u, t);
        G.fx.push({ type: 'ring', x: t.x, y: t.y, t: 0, life: 0.5, col: '#ff6a4a' });
      } else {
        groupMove(s.units, x, y, 'move');
        G.fx.push({ type: 'ring', x, y, t: 0, life: 0.5, col: '#7dffb0' });
      }
      Sfx.play('order');
    } else if (s.bld && s.bld.team === 0) {
      const c = nearestFree(World.cell(x, y));
      s.bld.site.rally = World.isBlocked(x, y) ? { x: (c % MW) * CELL + 16, y: ((c / MW) | 0) * CELL + 16 } : { x, y };
      Sfx.play('order');
    }
  },

  /* ----- powers ----- */
  startPower(k) {
    if (!G.running || G.demo) return;
    Sfx.init();
    const why = canPower(0, k);
    if (why) { this.toast(why); Sfx.play('deny'); return; }
    this.targeting = this.targeting === k ? null : k; this.amove = false;
  },
  cast(x, y) {
    if (castPower(0, this.targeting, x, y)) this.targeting = null;
  },

  /* ----- keyboard ----- */
  key(e) {
    if (!G.running || G.demo) return;
    this.keys[e.key] = true;
    const k = e.key.toLowerCase();
    if (k === 'p') { G.paused = !G.paused; document.getElementById('paused').classList.toggle('on', G.paused); return; }
    if (G.paused) return;
    if (k === 'escape') { if (this.targeting || this.amove) { this.targeting = null; this.amove = false; } else this.clear(); return; }
    if (k === ' ') { e.preventDefault(); const s = World.sites.find((q) => q.owner === 0 && q.citadel); if (s) Render.centerOn(s.x, s.y); return; }
    if (k === 'g') { const a = G.alerts[G.alerts.length - 1]; if (a) Render.centerOn(a.x, a.y); return; }
    if (k === 'f') { this.selectUnits(G.units.filter((u) => u.team === 0)); return; }
    if (k === 'v') { this.selectUnits(G.units.filter((u) => u.team === 0 && Render.onScreen(u.x, u.y, 0))); return; }
    if (k === 's' && this.sel.units.length) { for (const u of this.sel.units) orderStop(u); return; }
    if (k === 'a' && this.sel.units.length) { this.amove = true; this.targeting = null; return; }
    if (k === 'z') { this.startPower('strike'); return; }
    if (k === 'x') { this.startPower('mend'); return; }
    if (k === 'm') { Sfx.muted = !Sfx.muted; this.toast(Sfx.muted ? 'Sound off' : 'Sound on'); return; }
    if (k >= '1' && k <= '9' && k.length === 1) {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.groups[k] = this.sel.units.slice(); this.toast('Group ' + k + ' set'); }
      else if (this.groups[k]) {
        const g = this.groups[k].filter((u) => !u.dead);
        if (g.length) {
          const same = g.length === this.sel.units.length && g.every((u) => u.selected);
          this.selectUnits(g);
          if (same) { const a = avgOf(g.slice()); Render.centerOn(a.x, a.y); }
        }
      }
      return;
    }
    const i = 'qwerty'.indexOf(k);
    if (i >= 0 && k.length === 1) this.press(i);
  },

  press(i) {
    if (!this.spec || !this.spec.buttons[i] || !G.running || G.demo || G.paused) return;
    Sfx.init();
    const b = this.spec.buttons[i];
    if (b.why) { this.toast(b.why); Sfx.play('deny'); return; }
    b.act(); Sfx.play('click');
    this.refresh(true);
  },
  toast(t) {
    const el = document.getElementById('toast');
    el.textContent = t; el.classList.add('on');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => el.classList.remove('on'), 1600);
  },

  /* ----- camera ----- */
  camera(dt) {
    if (G.demo) {
      const t = performance.now() / 1000;
      Render.cam.z = 0.8;
      Render.centerOn(WORLD_W / 2 + Math.cos(t * 0.05) * 900, WORLD_H / 2 + Math.sin(t * 0.05) * 700);
      return;
    }
    let dx = 0, dy = 0;
    const k = this.keys, m = this.mouse;
    if (k.ArrowLeft) dx--; if (k.ArrowRight) dx++; if (k.ArrowUp) dy--; if (k.ArrowDown) dy++;
    if (m.inside && !this.drag && document.hasFocus()) {
      if (m.x < 6) dx--; else if (m.x > Render.W - 7) dx++;
      if (m.y < 6) dy--; else if (m.y > Render.H - 7) dy++;
    }
    if (dx || dy) {
      const sp = 1100 / Render.cam.z;
      Render.cam.x += dx * sp * dt; Render.cam.y += dy * sp * dt; Render.clampCam();
    }
  },

  /* ----- HUD ----- */
  buildSpec() {
    const s = this.sel, T = G.teams[0];
    const spec = { title: '', sub: '', buttons: [], queue: null };
    if (s.units.length) {
      const counts = {};
      for (const u of s.units) counts[u.type] = (counts[u.type] || 0) + 1;
      const parts = Object.keys(counts).map((k) => counts[k] + '× ' + UNITS[k].name);
      spec.title = s.units.length === 1 ? s.units[0].d.name : s.units.length + ' units selected';
      spec.sub = s.units.length === 1 ? s.units[0].d.desc : parts.join(' · ');
      spec.buttons.push({ name: 'Attack-move', sub: 'Press A, then click a destination', key: 'A', act: () => { this.amove = true; }, nokey: true });
      spec.buttons.push({ name: 'Stop', sub: 'Halt and hold position', key: 'S', act: () => { for (const u of s.units) orderStop(u); }, nokey: true });
    } else if (s.site && s.slot >= 0) {
      spec.title = 'Empty build pad'; spec.sub = 'Choose a structure to build here.';
      for (const type of BUILD_ORDER) {
        const d = BUILDINGS[type];
        spec.buttons.push({ name: d.name, sub: d.desc, cost: d.cost, why: canBuild(0, s.site, s.slot, type), act: () => { const b = build(0, s.site, s.slot, type); if (b) { this.clear(); this.sel.bld = b; } } });
      }
    } else if (s.site) {
      spec.title = 'Unclaimed site'; spec.sub = 'Move a unit here, clear out any enemies, then found a new Citadel with 7 build pads.';
      spec.buttons.push({ name: 'Establish Citadel', sub: 'Found a new base on this site', cost: CITADEL_COST, why: canEstablish(0, s.site), act: () => { const c = establish(0, s.site); if (c) { this.clear(); this.sel.bld = c; } } });
    } else if (s.bld) {
      const b = s.bld, d = b.d;
      spec.title = d.name + (b.type === 'depot' && b.level > 1 ? ' (Heavy)' : '');
      spec.sub = b.building ? 'Under construction… ' + Math.round((b.bt / d.time) * 100) + '%' : d.desc;
      if (b.building) {
        if (b.type !== 'citadel') spec.buttons.push({ name: 'Cancel', sub: 'Full refund', act: () => recycle(b) });
      } else {
        if (d.trains) {
          for (const type of d.trains) {
            const ud = UNITS[type];
            spec.buttons.push({ name: ud.name, sub: ud.desc, cost: ud.cost, pop: ud.pop, why: canTrain(0, b, type), act: () => train(0, b, type) });
          }
          spec.queue = b;
        }
        if (b.type === 'depot' && b.level === 1) {
          spec.buttons.push(b.upT >= 0
            ? { name: 'Upgrading…', sub: Math.round((b.upT / DEPOT_UP.time) * 100) + '% complete', why: 'Already upgrading' }
            : { name: 'Heavy Depot', sub: 'Upgrade: nearly doubles this depot\'s income', cost: DEPOT_UP.cost, why: canUpgradeDepot(0, b), act: () => upgradeDepot(0, b) });
        }
        if (b.type === 'citadel') spec.sub = 'Click an empty pad around the Citadel to build. Right-click the ground to set the rally point.';
        else spec.buttons.push({ name: 'Recycle', sub: 'Demolish for a 50% refund', act: () => { recycle(b); this.clear(); } });
      }
    } else {
      spec.title = TEAM_COL[0].name;
      spec.sub = 'Drag to select units · Right-click to move or attack · Click a build pad to construct';
    }
    void T;
    return spec;
  },

  refresh(force) {
    this.prune();
    const spec = (this.spec = this.buildSpec());
    const keys = 'QWERTY';
    let h = '<div id="selinfo"><h3>' + spec.title + '</h3><p>' + spec.sub + '</p>';
    if (spec.queue) {
      h += '<div class="queue">';
      spec.queue.queue.forEach((q, i) => { h += '<span class="qi" data-q="' + i + '" title="Click to cancel">' + UNITS[q].name + (i === 0 ? '<i id="qbar"></i>' : '') + '</span>'; });
      if (!spec.queue.queue.length) h += '<span class="qe">Queue empty</span>';
      h += '</div>';
    }
    h += '</div><div class="btns">';
    spec.buttons.forEach((b, i) => {
      h += '<button class="cmd' + (b.why ? ' off' : '') + '" data-i="' + i + '"><kbd>' + (b.nokey ? b.key : keys[i]) + '</kbd><b>' + b.name + '</b>' +
        (b.cost ? '<span class="cost">◆ ' + b.cost + (b.pop ? ' <em>· ' + b.pop + ' pop</em>' : '') + '</span>' : '') +
        '<small>' + (b.why && b.cost ? b.why : b.sub || '') + '</small></button>';
    });
    h += '</div>';
    if (h !== this.html || force) { this.html = h; document.getElementById('cmds').innerHTML = h; }
    const qb = document.getElementById('qbar');
    if (qb && spec.queue && spec.queue.queue.length) qb.style.width = Math.round((spec.queue.qt / UNITS[spec.queue.queue[0]].time) * 100) + '%';

    const T = G.teams[0];
    const set = (id, v) => { const el = document.getElementById(id); if (el.textContent !== v) el.textContent = v; };
    set('r-sup', String(Math.floor(T.supplies)));
    set('r-inc', '+' + T.income.toFixed(1) + '/s');
    set('r-tech', '●'.repeat(T.tech) + '○'.repeat(MAX_TECH - T.tech));
    set('r-pop', T.pop + (T.queued ? '+' + T.queued : '') + ' / ' + POP_CAP);
    const m = Math.floor(G.time / 60), sec = Math.floor(G.time % 60);
    set('r-time', m + ':' + (sec < 10 ? '0' : '') + sec);
    for (const k in POWERS) {
      const el = document.getElementById('pw-' + k), cd = T.cd[k];
      el.classList.toggle('off', !!canPower(0, k));
      el.classList.toggle('arm', this.targeting === k);
      el.querySelector('.cd').style.height = (cd / POWERS[k].cd) * 100 + '%';
      set('pw-' + k + '-s', cd > 0 ? Math.ceil(cd) + 's' : '◆ ' + POWERS[k].cost);
    }
    let ah = '';
    for (const a of G.alerts) if (G.time - a.t < 5) ah += '<div class="' + (a.quiet ? 'q' : '') + '">' + a.txt + '</div>';
    const al = document.getElementById('alerts');
    if (al.innerHTML !== ah) al.innerHTML = ah;
    Render.cv.style.cursor = this.targeting || this.amove ? 'crosshair' : 'default';
  },
};
