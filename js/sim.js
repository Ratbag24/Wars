'use strict';
/* Simulation: entities, orders, combat, production, powers */

const G = {
  units: [], blds: [], proj: [], fx: [], teams: [], effects: [],
  time: 0, over: null, running: false, paused: false, speed: 1,
  nextId: 1, alerts: [], lastAlert: -99, diff: 'normal', stats: null,
};

function newTeam(i) {
  return { id: i, supplies: 500, tech: 0, pop: 0, queued: 0, income: 0, incMult: 1, cd: { strike: 0, mend: 0 }, lost: 0, killed: 0 };
}

function resetGame(seed, diff) {
  G.units = []; G.blds = []; G.proj = []; G.fx = []; G.effects = [];
  G.time = 0; G.over = null; G.nextId = 1; G.alerts = []; G.lastAlert = -99;
  G.diff = diff;
  G.teams = [newTeam(0), newTeam(1)];
  G.teams[1].incMult = DIFFS[diff].inc;
  World.gen(seed);
  Fog.reset();
  for (let t = 0; t < 2; t++) {
    const s = World.sites[t];
    const c = makeBuilding('citadel', t, s, -1, true);
    s.owner = t; s.citadel = c;
    const d = makeBuilding('depot', t, s, 0, true);
    s.slots[0] = d;
    for (let i = 0; i < 2; i++) {
      const u = spawnUnit('trooper', t, s.rally.x + (i - 0.5) * 50, s.rally.y);
      u.dir = u.aim = Math.atan2(WORLD_H / 2 - s.y, WORLD_W / 2 - s.x);
    }
    const r = spawnUnit('ranger', t, s.rally.x, s.rally.y + 50);
    r.dir = r.aim = Math.atan2(WORLD_H / 2 - s.y, WORLD_W / 2 - s.x);
  }
  updateTeams();
  updateFog();
}

/* ---------- entity creation ---------- */
function spawnUnit(type, team, x, y) {
  const d = UNITS[type];
  const u = {
    id: G.nextId++, kind: 'unit', type, d, team, x, y, hp: d.hp, maxHp: d.hp, cls: d.cls,
    radius: d.radius, air: d.cls === 'air', dir: 0, aim: 0, cd: Math.random() * d.rof,
    order: { type: 'idle' }, path: null, pi: 0, tgt: null, acq: Math.random() * 0.3, repath: 0,
    chase: false, moving: false, anim: Math.random() * 10, flash: 0, lastHit: -99, dead: false, role: null,
  };
  G.units.push(u);
  return u;
}

function makeBuilding(type, team, site, slot, instant) {
  const d = BUILDINGS[type];
  const p = slot < 0 ? { x: site.x, y: site.y } : World.slotPos(site, slot);
  const b = {
    id: G.nextId++, kind: 'bld', type, d, team, x: p.x, y: p.y, site, slot, cls: 'bld', radius: d.radius,
    maxHp: d.hp, hp: instant ? d.hp : d.hp * 0.1, building: !instant, bt: 0, queue: [], qt: 0,
    level: 1, upT: -1, cd: 0, acq: 0, tgt: null, aim: -Math.PI / 2, flash: 0, lastHit: -99, dead: false, anim: Math.random() * 10,
  };
  G.blds.push(b);
  return b;
}

/* ---------- economy / team helpers ---------- */
function updateTeams() {
  for (const T of G.teams) { T.pop = 0; T.tech = 0; T.income = 0; T.queued = 0; }
  for (const u of G.units) G.teams[u.team].pop += u.d.pop;
  for (const b of G.blds) {
    const T = G.teams[b.team];
    for (const q of b.queue) T.queued += UNITS[q].pop;
    if (b.building) continue;
    if (b.type === 'reactor') T.tech = Math.min(MAX_TECH, T.tech + 1);
    if (b.type === 'citadel') T.income += b.d.income;
    if (b.type === 'depot') T.income += b.level > 1 ? DEPOT_UP.income : b.d.income;
  }
  for (const T of G.teams) T.income *= T.incMult;
}

function canBuild(team, site, slot, type) {
  const d = BUILDINGS[type], T = G.teams[team];
  if (!site || site.owner !== team || !site.citadel || site.citadel.building) return 'Citadel not ready';
  if (site.slots[slot]) return 'Slot occupied';
  if (T.tech < d.tech) return 'Requires tech ' + d.tech;
  if (T.supplies < d.cost) return 'Not enough supplies';
  return null;
}
function build(team, site, slot, type) {
  if (canBuild(team, site, slot, type)) return null;
  G.teams[team].supplies -= BUILDINGS[type].cost;
  const b = makeBuilding(type, team, site, slot, false);
  site.slots[slot] = b;
  return b;
}

function canTrain(team, b, type) {
  const d = UNITS[type], T = G.teams[team];
  if (!b || b.dead || b.building || b.team !== team) return 'Not ready';
  if (!b.d.trains || !b.d.trains.includes(type)) return 'Wrong building';
  if (T.tech < d.tech) return 'Requires tech ' + d.tech;
  if (b.queue.length >= 5) return 'Queue full';
  if (T.pop + T.queued + d.pop > POP_CAP) return 'Population cap reached';
  if (T.supplies < d.cost) return 'Not enough supplies';
  return null;
}
function train(team, b, type) {
  if (canTrain(team, b, type)) return false;
  const T = G.teams[team];
  T.supplies -= UNITS[type].cost;
  T.queued += UNITS[type].pop;
  b.queue.push(type);
  return true;
}
function cancelTrain(b, i) {
  if (i < 0 || i >= b.queue.length) return;
  const type = b.queue.splice(i, 1)[0];
  G.teams[b.team].supplies += UNITS[type].cost;
  if (i === 0) b.qt = 0;
  updateTeams();
}

function canUpgradeDepot(team, b) {
  if (!b || b.type !== 'depot' || b.building || b.level > 1 || b.upT >= 0) return 'Unavailable';
  if (G.teams[team].supplies < DEPOT_UP.cost) return 'Not enough supplies';
  return null;
}
function upgradeDepot(team, b) {
  if (canUpgradeDepot(team, b)) return false;
  G.teams[team].supplies -= DEPOT_UP.cost;
  b.upT = 0;
  return true;
}

function recycle(b) {
  if (b.dead || b.type === 'citadel') return;
  const T = G.teams[b.team];
  let refund = b.d.cost * (b.building ? 1 : 0.5);
  for (const q of b.queue) refund += UNITS[q].cost;
  T.supplies += refund;
  b.queue = [];
  removeBuilding(b, false);
}

function canEstablish(team, site) {
  if (!site || site.owner !== -1) return 'Site is taken';
  if (G.teams[team].supplies < CITADEL_COST) return 'Not enough supplies';
  let friend = false;
  for (const u of G.units) {
    const d = dist(u.x, u.y, site.x, site.y);
    if (u.team === team && d < 330) friend = true;
    if (u.team !== team && d < 380) return 'Enemies are too close';
  }
  if (!friend) return 'Move a unit next to the site first';
  return null;
}
function establish(team, site) {
  if (canEstablish(team, site)) return null;
  G.teams[team].supplies -= CITADEL_COST;
  const c = makeBuilding('citadel', team, site, -1, false);
  site.owner = team; site.citadel = c;
  return c;
}

/* ---------- orders ---------- */
function setPath(u, x, y) {
  x = clamp(x, 40, WORLD_W - 40); y = clamp(y, 40, WORLD_H - 40);
  if (u.air) u.path = [{ x, y }];
  else u.path = findPath(u.x, u.y, x, y) || [{ x, y }];
  u.pi = 0;
}
function orderMove(u, x, y, type) {
  u.order = { type: type || 'move', x, y };
  u.tgt = null; u.chase = false;
  setPath(u, x, y);
}
function orderAttack(u, t) {
  if (!MULT[u.d.dtype][t.cls]) { orderMove(u, t.x, t.y, 'move'); return; }
  u.order = { type: 'attack', target: t };
  u.tgt = t; u.repath = 0; u.chase = true;
}
function orderStop(u) { u.order = { type: 'idle' }; u.path = null; u.tgt = null; u.chase = false; }

function formation(n, x, y) {
  const out = [];
  const sp = 44;
  let ring = 0, i = 0;
  while (out.length < n) {
    if (ring === 0) { out.push({ x, y }); ring = 1; continue; }
    const cnt = ring * 6;
    for (i = 0; i < cnt && out.length < n; i++) {
      const a = (i / cnt) * TAU + ring * 0.4;
      out.push({ x: x + Math.cos(a) * ring * sp, y: y + Math.sin(a) * ring * sp });
    }
    ring++;
  }
  return out;
}
function groupMove(units, x, y, type) {
  const pts = formation(units.length, x, y);
  // nearest-first assignment keeps the group from crossing itself
  const pool = pts.slice();
  for (const u of units) {
    let bi = 0, bd = 1e12;
    for (let i = 0; i < pool.length; i++) {
      const d = (pool[i].x - x - (u.x - avgX(units))) ** 2 + (pool[i].y - y - (u.y - avgY(units))) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    const p = pool.splice(bi, 1)[0];
    orderMove(u, p.x, p.y, type);
  }
}
let _avgCache = { k: null, x: 0, y: 0 };
function avgOf(units) {
  if (_avgCache.k !== units) {
    let x = 0, y = 0;
    for (const u of units) { x += u.x; y += u.y; }
    _avgCache = { k: units, x: x / units.length, y: y / units.length };
  }
  return _avgCache;
}
const avgX = (u) => avgOf(u).x;
const avgY = (u) => avgOf(u).y;

/* ---------- combat ---------- */
function findTarget(e, reach) {
  const dt = MULT[e.d.dtype];
  let best = null, bs = 1e9;
  const minR = e.d.minRange || 0;
  const scan = (list, bias) => {
    for (const t of list) {
      if (t.team === e.team || t.dead) continue;
      const m = dt[t.cls];
      if (!m) continue;
      const d = dist(e.x, e.y, t.x, t.y) - t.radius;
      if (d > reach || d < minR) continue;
      if (e.team === 0 && !Fog.visibleAt(t.x, t.y)) continue;
      let s = (d + 60) / (0.4 + m) * bias;
      if (t === e.tgt) s *= 0.7;
      if (s < bs) { bs = s; best = t; }
    }
  };
  scan(G.units, 1);
  scan(G.blds, 1.6);
  return best;
}

function damage(t, amt, dtype, src) {
  if (t.dead) return;
  const m = MULT[dtype][t.cls];
  if (!m) return;
  t.hp -= amt * m;
  t.flash = 0.12;
  t.lastHit = G.time;
  if (t.team === 0 && G.time - G.lastAlert > 12 && !Render.onScreen(t.x, t.y, -100)) {
    G.lastAlert = G.time;
    alertMsg(t.kind === 'bld' ? 'Base under attack!' : 'Units under attack!', t.x, t.y);
    Sfx.play('alert');
  }
  if (t.kind === 'unit' && src && !src.dead && t.order.type === 'idle' && !t.tgt && MULT[t.d.dtype][src.cls]) {
    if (t.team !== 0 || Fog.visibleAt(src.x, src.y)) { t.tgt = src; t.chase = true; t.repath = 0; }
  }
  if (t.hp <= 0) kill(t, src);
}

function kill(t, src) {
  if (t.dead) return;
  if (t.kind === 'unit') {
    t.dead = true;
    G.teams[t.team].lost++;
    if (src) G.teams[src.team].killed++;
    boom(t.x, t.y, t.cls === 'inf' ? 16 : t.radius * 1.9, t.cls !== 'inf', t.air ? AIR_H : 0);
  } else removeBuilding(t, true);
}

function removeBuilding(b, violent) {
  if (b.dead) return;
  b.dead = true;
  const s = b.site;
  if (violent) boom(b.x, b.y, b.radius * 2.2, true);
  if (b.type === 'citadel') {
    for (let i = 0; i < SLOTS; i++) if (s.slots[i]) removeBuilding(s.slots[i], true);
    s.citadel = null; s.owner = -1;
    if (b.team === 0) alertMsg('Citadel lost!', b.x, b.y);
    else alertMsg('Enemy Citadel destroyed!', b.x, b.y);
  } else s.slots[b.slot] = null;
}

function boom(x, y, r, big, h) {
  h = h || 0;
  if (G.fx.length < 700) {
    G.fx.push({ type: 'boom', x, y, h, r, t: 0, life: big ? 0.55 : 0.35 });
    const n = big ? 12 : 5;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = 30 + Math.random() * (big ? 150 : 70);
      G.fx.push({ type: 'p', x, y, h, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: 0.4 + Math.random() * 0.6, size: 2 + Math.random() * (big ? 5 : 2.5), col: Math.random() < 0.5 ? '#ffb347' : '#5b5560', drag: 2.5 });
    }
  }
  if (!h) World.scorch(x, y, r * (big ? 1.1 : 0.9));
  if (Render.onScreen(x, y, 100)) Sfx.play(big ? 'boom' : 'pop');
}

function fire(e, t) {
  const d = e.d;
  e.cd = d.rof * (0.9 + Math.random() * 0.2);
  const a = Math.atan2(t.y - e.y, t.x - e.x);
  const mr = e.kind === 'bld' ? 26 : e.radius * 0.9;
  const mx = e.x + Math.cos(a) * mr, my = e.y + Math.sin(a) * mr - (e.air ? 0 : 0);
  const vis = Render.onScreen(e.x, e.y, 60);
  const jx = (Math.random() - 0.5) * t.radius, jy = (Math.random() - 0.5) * t.radius;
  switch (d.dtype) {
    case 'bullet': case 'turret': case 'flak':
      damage(t, d.dmg, d.dtype, e);
      if (G.fx.length < 700) {
        G.fx.push({ type: 'flash', x: mx, y: my, h: hOf(e), t: 0, life: 0.06, r: d.dtype === 'bullet' ? 4.5 : 7 });
        G.fx.push({ type: 'tracer', x: mx, y: my, h: hOf(e), x2: t.x + jx, y2: t.y + jy, h2: hOf(t), t: 0, life: 0.07, col: d.dtype === 'flak' ? '#ffe9a8' : e.team ? '#ffc7a1' : '#c9fff6' });
        if (d.dtype === 'flak') G.fx.push({ type: 'puff', x: t.x + jx * 2, y: t.y + jy * 2, h: hOf(t), t: 0, life: 0.3, r: 9 });
      }
      if (vis) Sfx.play('shot');
      break;
    case 'flame':
      damage(t, d.dmg, d.dtype, e);
      if (G.fx.length < 700) {
        for (let i = 0; i < 2; i++) {
          const sp = 190 + Math.random() * 60, aa = a + (Math.random() - 0.5) * 0.3;
          G.fx.push({ type: 'p', x: mx, y: my, h: 4, vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp, t: 0, life: 0.45, size: 5 + Math.random() * 4, col: Math.random() < 0.5 ? '#ffd24a' : '#ff7a1f', drag: 1.5, glow: true });
        }
      }
      if (vis) Sfx.play('flame');
      break;
    default: {
      const spd = d.dtype === 'rocket' ? 430 : d.dtype === 'siege' ? 330 : 640;
      G.proj.push({
        x: mx, y: my, sx: mx, sy: my, h0: hOf(e), h1: hOf(t), tx: t.x + jx * 0.5, ty: t.y + jy * 0.5, tgt: d.dtype === 'rocket' ? t : null,
        spd, dmg: d.dmg, dtype: d.dtype, aoe: d.aoe || 0, team: e.team, src: e, t: 0, lob: d.dtype === 'siege' || (e.air && d.dtype === 'shell'),
        total: dist(mx, my, t.x, t.y) / spd,
      });
      if (G.fx.length < 700) G.fx.push({ type: 'flash', x: mx, y: my, h: hOf(e), t: 0, life: 0.09, r: d.dtype === 'rocket' ? 7 : 12 });
      if (vis) Sfx.play(d.dtype === 'rocket' ? 'rocket' : 'cannon');
    }
  }
}

function updateProjectiles(dt) {
  for (const p of G.proj) {
    p.t += dt;
    if (p.tgt) {
      if (p.tgt.dead) p.tgt = null;
      else { p.tx = p.tgt.x; p.ty = p.tgt.y; }
    }
    const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy), step = p.spd * dt;
    p.dir = Math.atan2(dy, dx);
    if (d <= step + 2) {
      p.dead = true;
      if (p.aoe) {
        for (const list of [G.units, G.blds]) for (const t of list) {
          if (t.team === p.team || t.dead) continue;
          const dd = dist(p.tx, p.ty, t.x, t.y) - t.radius;
          if (dd < p.aoe) damage(t, p.dmg * (dd < p.aoe * 0.4 ? 1 : 0.6), p.dtype, p.src);
        }
        boom(p.tx, p.ty, p.aoe * 0.8, p.aoe > 40);
      } else {
        if (p.tgt) damage(p.tgt, p.dmg, p.dtype, p.src);
        if (G.fx.length < 700) G.fx.push({ type: 'boom', x: p.tx, y: p.ty, h: p.h1, r: 13, t: 0, life: 0.25 });
        if (Render.onScreen(p.tx, p.ty, 50)) Sfx.play('pop');
      }
    } else {
      p.x += (dx / d) * step; p.y += (dy / d) * step;
      if (p.dtype === 'rocket' && G.fx.length < 700 && Math.random() < 0.7) G.fx.push({ type: 'puff', x: p.x, y: p.y, h: lerp(p.h0, p.h1, clamp(p.t / Math.max(0.01, p.total), 0, 1)) - 6, rise: 4, t: 0, life: 0.35, r: 4 });
    }
  }
  G.proj = G.proj.filter((p) => !p.dead);
}

/* ---------- units ---------- */
function followPath(u, dt) {
  if (!u.path || u.pi >= u.path.length) { u.path = null; return true; }
  const p = u.path[u.pi];
  const dx = p.x - u.x, dy = p.y - u.y, d = Math.hypot(dx, dy), step = u.d.speed * dt;
  u.moving = true;
  if (d <= step) {
    u.x = p.x; u.y = p.y; u.pi++;
    if (u.pi >= u.path.length) { u.path = null; return true; }
  } else {
    u.x += (dx / d) * step; u.y += (dy / d) * step;
    u.dir = turnToward(u.dir, Math.atan2(dy, dx), dt * (u.cls === 'veh' ? 5 : 9));
  }
  return false;
}

function updateUnit(u, dt) {
  const d = u.d;
  u.cd -= dt; u.acq -= dt; u.repath -= dt; u.anim += dt;
  if (u.flash > 0) u.flash -= dt;
  u.moving = false;
  let o = u.order;
  if (u.tgt && u.tgt.dead) u.tgt = null;
  if (o.type === 'attack') {
    if (!o.target || o.target.dead || (u.team === 0 && o.target.kind === 'unit' && !Fog.visibleAt(o.target.x, o.target.y))) {
      u.order = o = { type: 'idle' }; u.path = null; u.tgt = null;
    } else u.tgt = o.target;
  } else if (u.acq <= 0) {
    u.acq = 0.3;
    u.tgt = findTarget(u, o.type === 'move' ? d.range : d.range + 140);
  }
  const t = u.tgt;
  let inRange = false, tooClose = false;
  if (t) {
    const dd = dist(u.x, u.y, t.x, t.y) - t.radius;
    tooClose = dd < (d.minRange || 0);
    inRange = dd <= d.range && !tooClose;
    if (inRange) {
      u.aim = turnToward(u.aim, Math.atan2(t.y - u.y, t.x - u.x), dt * 8);
      if (u.cd <= 0) fire(u, t);
    }
  }
  if (o.type === 'move') {
    if (followPath(u, dt)) u.order = { type: 'idle' };
  } else if (t) {
    u.chase = true;
    if (inRange || tooClose) {
      u.path = null;
      if (u.cls !== 'veh') u.dir = turnToward(u.dir, u.aim, dt * 6);
    } else {
      if (u.repath <= 0 || !u.path) { setPath(u, t.x, t.y); u.repath = 0.6 + Math.random() * 0.4; }
      followPath(u, dt);
    }
  } else {
    if (u.chase) {
      u.chase = false;
      if (o.type === 'amove') setPath(u, o.x, o.y); else u.path = null;
    }
    if (o.type === 'amove') {
      if (!u.path) setPath(u, o.x, o.y);
      if (followPath(u, dt)) u.order = { type: 'idle' };
    }
  }
  if (!t || !inRange) u.aim = turnToward(u.aim, u.dir, dt * 5);
  u.x = clamp(u.x, 20, WORLD_W - 20); u.y = clamp(u.y, 20, WORLD_H - 20);
  // salvage
  if (!u.air) {
    for (const c of World.crates) {
      if (!c.taken && Math.abs(c.x - u.x) < 26 && Math.abs(c.y - u.y) < 26) {
        c.taken = true;
        G.teams[u.team].supplies += c.amt;
        if (u.team === 0) {
          G.fx.push({ type: 'text', x: c.x, y: c.y, t: 0, life: 1.4, txt: '+' + c.amt });
          Sfx.play('pickup');
        }
      }
    }
  }
}

function separate() {
  const us = G.units, n = us.length;
  for (let i = 0; i < n; i++) {
    const a = us[i];
    for (let j = i + 1; j < n; j++) {
      const b = us[j];
      if (a.air !== b.air) continue;
      const min = (a.radius + b.radius) * 0.92;
      const dx = b.x - a.x, dy = b.y - a.y;
      if (dx > min || dx < -min || dy > min || dy < -min) continue;
      let d = Math.hypot(dx, dy);
      if (d >= min) continue;
      let nx, ny;
      if (d < 0.01) { const r = Math.random() * TAU; nx = Math.cos(r); ny = Math.sin(r); d = 0; } else { nx = dx / d; ny = dy / d; }
      const push = (min - d) * 0.5;
      // moving units shoulder through idle ones
      const wa = a.moving && !b.moving ? 0.25 : !a.moving && b.moving ? 0.75 : 0.5;
      const ax = a.x - nx * push * wa * 2, ay = a.y - ny * push * wa * 2;
      const bx = b.x + nx * push * (1 - wa) * 2, by = b.y + ny * push * (1 - wa) * 2;
      if (a.air || !World.isBlocked(ax, ay)) { a.x = ax; a.y = ay; }
      if (b.air || !World.isBlocked(bx, by)) { b.x = bx; b.y = by; }
    }
  }
}

/* ---------- buildings ---------- */
function updateBuilding(b, dt) {
  b.anim += dt;
  if (b.flash > 0) b.flash -= dt;
  const T = G.teams[b.team];
  if (b.building) {
    b.bt += dt;
    b.hp = Math.min(b.maxHp, b.hp + (b.maxHp * 0.9 * dt) / b.d.time);
    if (b.bt >= b.d.time) {
      b.building = false;
      if (b.team === 0) { alertMsg(b.d.name + ' complete', b.x, b.y, true); Sfx.play('done'); }
    }
    return;
  }
  if (b.upT >= 0) {
    b.upT += dt;
    if (b.upT >= DEPOT_UP.time) { b.upT = -1; b.level = 2; if (b.team === 0) Sfx.play('done'); }
  }
  if (b.queue.length) {
    const type = b.queue[0], d = UNITS[type];
    b.qt += dt;
    if (b.qt >= d.time) {
      b.qt = 0; b.queue.shift();
      const s = b.site;
      const a = Math.atan2(s.rally.y - s.y, s.rally.x - s.x) + (Math.random() - 0.5) * 0.5;
      const u = spawnUnit(type, b.team, d.cls === 'air' ? b.x : s.x + Math.cos(a) * (BASE_BLOCK_R + 26), d.cls === 'air' ? b.y : s.y + Math.sin(a) * (BASE_BLOCK_R + 26));
      u.dir = u.aim = a;
      const off = formation(7, s.rally.x, s.rally.y)[(Math.random() * 7) | 0];
      orderMove(u, off.x, off.y, 'move');
      if (b.team === 0) Sfx.play('ready');
    }
  }
  if (b.d.dmg) {
    b.cd -= dt; b.acq -= dt;
    if (b.tgt && b.tgt.dead) b.tgt = null;
    if (b.acq <= 0) { b.acq = 0.35; b.tgt = findTarget(b, b.d.range); }
    if (b.tgt) {
      b.aim = turnToward(b.aim, Math.atan2(b.tgt.y - b.y, b.tgt.x - b.x), dt * 7);
      if (b.cd <= 0) fire(b, b.tgt);
    } else if (b.type === 'turret') b.aim += dt * 0.4;
  }
  // slow self-repair when out of combat
  if (b.hp < b.maxHp && G.time - b.lastHit > 12) b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.012 * dt);
  void T;
}

/* ---------- commander powers ---------- */
function canPower(team, key) {
  const T = G.teams[team], p = POWERS[key];
  if (T.cd[key] > 0) return 'Recharging';
  if (T.supplies < p.cost) return 'Not enough supplies';
  return null;
}
function castPower(team, key, x, y) {
  if (canPower(team, key)) return false;
  const T = G.teams[team], p = POWERS[key];
  T.supplies -= p.cost; T.cd[key] = p.cd;
  G.effects.push({ type: key, team, x, y, t: 0, hits: 0, life: key === 'strike' ? 3.4 : 8 });
  if (team === 1 && key === 'strike' && Fog.visibleAt(x, y)) { alertMsg('Enemy Rail Strike incoming!', x, y); Sfx.play('alert'); }
  if (Render.onScreen(x, y, 200)) Sfx.play('power');
  return true;
}
function updateEffects(dt) {
  for (const e of G.effects) {
    e.t += dt;
    if (e.type === 'strike') {
      const p = POWERS.strike;
      while (e.t > 1.3 + e.hits * 0.26 && e.hits < 8) {
        e.hits++;
        const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * p.radius * 0.75;
        const x = e.x + Math.cos(a) * r, y = e.y + Math.sin(a) * r;
        for (const list of [G.units, G.blds]) for (const t of list) {
          if (t.team === e.team || t.dead) continue;
          if (dist(x, y, t.x, t.y) - t.radius < 78) damage(t, 240, 'orbital', null);
        }
        G.fx.push({ type: 'beam', x, y, t: 0, life: 0.3 });
        boom(x, y, 60, true);
      }
    } else if (e.type === 'mend') {
      const p = POWERS.mend;
      for (const list of [G.units, G.blds]) for (const t of list) {
        if (t.team !== e.team || t.dead || t.building) continue;
        if (dist(e.x, e.y, t.x, t.y) < p.radius + t.radius) t.hp = Math.min(t.maxHp, t.hp + t.maxHp * 0.075 * dt);
      }
      if (Math.random() < 0.5 && G.fx.length < 700) {
        const a = Math.random() * TAU, r = Math.random() * p.radius;
        G.fx.push({ type: 'p', x: e.x + Math.cos(a) * r, y: e.y + Math.sin(a) * r, vx: 0, vy: 0, up: 50, t: 0, life: 0.9, size: 3, col: '#7dffb0', drag: 0, glow: true });
      }
    }
  }
  G.effects = G.effects.filter((e) => e.t < e.life);
}

/* ---------- misc ---------- */
function alertMsg(txt, x, y, quiet) {
  G.alerts.push({ txt, x, y, t: G.time, quiet: !!quiet });
  if (G.alerts.length > 4) G.alerts.shift();
}

function updateFog() {
  Fog.vis.fill(0);
  for (const u of G.units) if (u.team === 0) Fog.reveal(u.x, u.y, u.d.sight);
  for (const b of G.blds) if (b.team === 0) Fog.reveal(b.x, b.y, b.d.sight);
  for (const e of G.effects) if (e.team === 0) Fog.reveal(e.x, e.y, 200);
}

let fogT = 0, teamT = 0;
function simTick(dt) {
  G.time += dt;
  for (const T of G.teams) {
    T.supplies += T.income * dt;
    for (const k in T.cd) if (T.cd[k] > 0) T.cd[k] = Math.max(0, T.cd[k] - dt);
  }
  for (const u of G.units) if (!u.dead) updateUnit(u, dt);
  separate();
  for (const b of G.blds) if (!b.dead) updateBuilding(b, dt);
  updateProjectiles(dt);
  updateEffects(dt);
  if (G.units.some((u) => u.dead)) G.units = G.units.filter((u) => !u.dead);
  if (G.blds.some((b) => b.dead)) G.blds = G.blds.filter((b) => !b.dead);
  for (const f of G.fx) {
    f.t += dt;
    if (f.type === 'p') { f.x += f.vx * dt; f.y += f.vy * dt; const k = Math.max(0, 1 - f.drag * dt); f.vx *= k; f.vy *= k; }
  }
  G.fx = G.fx.filter((f) => f.t < f.life);
  teamT -= dt;
  if (teamT <= 0) { teamT = 0.2; updateTeams(); }
  fogT -= dt;
  if (fogT <= 0) { fogT = 0.2; updateFog(); }
  for (const ai of G.ais) ai.update(dt);
  // victory
  if (!G.over) {
    const has = [false, false];
    for (const b of G.blds) if (b.type === 'citadel') has[b.team] = true;
    if (!has[0]) G.over = 'defeat'; else if (!has[1]) G.over = 'victory';
  }
}
G.ais = [];
