'use strict';
/* Procedural 3D models and their animations. Model space: +x forward, +y up, +z right. */

const PAD_H = 6;

const M3 = {
  cache: {}, mat: null, glow: null, tc: [],
  init() {
    this.mat = new THREE.MeshPhongMaterial({ color: 0xa6a6a6, vertexColors: true, flatShading: true, shininess: 24, specular: 0x1c1e22 });
    this.glow = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.tc = TEAM_COL.map((c) => ({ main: c.main, dark: c.dark, light: c.light }));
  },
  bake(parts) {
    const pos = [], nor = [], col = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3(), c = new THREE.Color();
    for (const p of parts) {
      const g = p.g.index ? p.g.toNonIndexed() : p.g;
      e.set(p.r[0], p.r[1], p.r[2]);
      m.compose(v.set(p.p[0], p.p[1], p.p[2]), q.setFromEuler(e), one);
      g.applyMatrix4(m);
      const P = g.attributes.position.array, N = g.attributes.normal.array;
      c.set(p.c);
      for (let i = 0; i < P.length; i += 3) { pos.push(P[i], P[i + 1], P[i + 2]); nor.push(N[i], N[i + 1], N[i + 2]); col.push(c.r, c.g, c.b); }
      p.g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return out;
  },
  mesh(key, fn, glow) {
    let g = this.cache[key];
    if (!g) g = this.cache[key] = this.bake(fn());
    const m = new THREE.Mesh(g, glow ? this.glow : this.mat);
    m.castShadow = !glow;
    return m;
  },
};

const box = (w, h, d, c, x, y, z, rx, ry, rz) => ({ g: new THREE.BoxGeometry(w, h, d), c, p: [x || 0, y || 0, z || 0], r: [rx || 0, ry || 0, rz || 0] });
const cyl = (rt, rb, h, n, c, x, y, z, rx, ry, rz) => ({ g: new THREE.CylinderGeometry(rt, rb, h, n), c, p: [x || 0, y || 0, z || 0], r: [rx || 0, ry || 0, rz || 0] });
const cylX = (r, len, n, c, x, y, z) => cyl(r, r, len, n, c, x, y, z, 0, 0, Math.PI / 2);
const ball = (r, c, x, y, z) => ({ g: new THREE.IcosahedronGeometry(r, 1), c, p: [x || 0, y || 0, z || 0], r: [0, 0, 0] });

const C_HULL = '#56606e', C_HULL2 = '#3c434d', C_DARK = '#1b1e23', C_METAL = '#a4adbb', C_GLASS = '#3fd4ff', C_CRATE = '#c99f52';

function firedNow(v, e) {
  const f = e.cd > (v.lastCd === undefined ? 1e9 : v.lastCd) + 0.02;
  v.lastCd = e.cd;
  return f;
}

/* ================= units ================= */
function makeUnitView(u) {
  const v = { root: new THREE.Group(), rec: 0 };
  if (u.cls === 'inf') squadView(u, v);
  else if (u.type === 'ranger') rangerView(u, v);
  else if (u.type === 'kestrel') kestrelView(u, v);
  else if (u.type === 'condor') condorView(u, v);
  else trackedView(u, v);
  return v;
}

function squadView(u, v) {
  const T = M3.tc[u.team], k = u.type + ':' + u.team, n = u.d.squad;
  const offs = n === 5 ? [[7, 0], [-3, -10], [-3, 10], [-13, -5], [-13, 6]] : [[7, 0], [-6, -9], [-6, 9]];
  const bodyParts = () => {
    const p = [
      box(4, 5.2, 5.6, T.main, 0, 8.6, 0), box(1, 3, 4.2, T.dark, 2.2, 9, 0),
      box(3.4, 3.2, 3.6, T.dark, 0.2, 12.9, 0), box(0.7, 1.1, 2.8, C_GLASS, 1.9, 13, 0),
      box(1.4, 1.2, 6.8, C_HULL2, 0, 10.8, 0),
    ];
    if (u.type === 'scorcher') p.push(cyl(1.7, 1.7, 5, 6, '#e0762a', -3.2, 9.2, 0), box(1, 1, 1, C_METAL, -3.2, 12, 0));
    else if (u.type === 'lancer') p.push(box(2.2, 4.4, 4.6, C_HULL, -3, 9, 0), box(1.2, 2, 1.2, '#d9483a', -3.2, 12, 1.2));
    else p.push(box(2, 4, 4.2, C_HULL, -3, 9, 0));
    return p;
  };
  const legParts = () => [box(2.1, 6.2, 2.1, C_HULL2, 0, -3.1, 0), box(2.8, 1.3, 2.3, C_DARK, 0.5, -5.6, 0)];
  const gunParts = () => {
    const arms = [box(4.6, 1.5, 1.5, T.main, 2.2, 9.6, -2.6, 0, 0.35, 0), box(4.6, 1.5, 1.5, T.main, 2.2, 9.6, 2.6, 0, -0.35, 0)];
    if (u.type === 'lancer') return arms.concat([cylX(1.5, 13, 6, C_HULL2, 2.5, 12.4, 2.4), cylX(1.9, 2, 6, C_METAL, 9, 12.4, 2.4), box(1, 2.2, 1, C_DARK, 3, 10.8, 2.4)]);
    if (u.type === 'scorcher') return arms.concat([box(7, 1.6, 1.6, C_DARK, 5, 9.4, 0.8), box(1.6, 2.2, 2.2, '#ff9d3b', 9, 9.4, 0.8)]);
    return arms.concat([box(8.5, 1.5, 1.3, C_DARK, 5, 9.6, 0.8), box(1.2, 2.4, 1.1, C_DARK, 3.4, 8.4, 0.8), box(2.4, 0.8, 0.8, C_METAL, 9.8, 9.9, 0.8)]);
  };
  v.members = [];
  for (let i = 0; i < n; i++) {
    const g = new THREE.Group();
    g.position.set(offs[i][0], 0, offs[i][1]);
    g.scale.setScalar(1.25);
    const body = M3.mesh('sol-body:' + k, bodyParts), gun = M3.mesh('sol-gun:' + k, gunParts);
    const legL = M3.mesh('sol-leg', legParts), legR = M3.mesh('sol-leg', legParts);
    legL.position.set(0, 6.2, -1.5); legR.position.set(0, 6.2, 1.5);
    g.add(body, gun, legL, legR);
    v.root.add(g);
    v.members.push({ g, body, gun, legL, legR, ph: i * 1.9, rec: 0 });
  }
  v.shot = 0;
  v.update = (u, dt) => {
    v.root.position.set(u.x, 0, u.y);
    v.root.rotation.y = -u.dir;
    const alive = Math.max(1, Math.ceil((n * u.hp) / u.maxHp));
    if (firedNow(v, u)) { v.members[v.shot % alive].rec = 1; v.shot++; }
    for (let i = 0; i < n; i++) {
      const m = v.members[i];
      m.g.visible = i < alive;
      if (!m.g.visible) continue;
      m.rec = Math.max(0, m.rec - dt * 9);
      const ph = u.anim * 13 + m.ph;
      const sw = u.moving ? Math.sin(ph) * 0.75 : 0;
      m.legL.rotation.z = sw; m.legR.rotation.z = -sw;
      m.g.position.y = u.moving ? Math.abs(Math.cos(ph)) * 0.9 : 0;
      m.body.position.y = u.moving ? 0 : Math.sin(u.anim * 2.2 + m.ph) * 0.18;
      m.body.rotation.z = u.moving ? -0.12 : 0;
      m.g.rotation.y = -(u.aim - u.dir);
      m.gun.position.x = -m.rec * 1.4;
      m.gun.rotation.z = m.rec * 0.12 + (u.moving ? Math.sin(ph * 2) * 0.03 : 0);
    }
  };
}

function wheelMesh(r, w) {
  return M3.mesh('wheel:' + r + ':' + w, () => [cyl(r, r, w, 10, C_DARK, 0, 0, 0, Math.PI / 2), box(r * 1.5, r * 0.45, w + 0.5, C_METAL), box(r * 0.45, r * 1.5, w + 0.5, C_METAL)]);
}

function rangerView(u, v) {
  const T = M3.tc[u.team], k = 'ranger:' + u.team;
  const body = M3.mesh(k, () => [
    box(27, 4, 13, C_HULL2, 0, 7, 0), box(9, 3.4, 12, T.main, 9, 10.2, 0, 0, 0, -0.12), box(8, 3, 12, T.main, -9.5, 10, 0),
    box(1, 8, 1, C_DARK, 3.5, 13, -5.6), box(1, 8, 1, C_DARK, 3.5, 13, 5.6), box(1, 8, 1, C_DARK, -5, 13, -5.6), box(1, 8, 1, C_DARK, -5, 13, 5.6),
    box(10, 0.9, 12.4, C_DARK, -0.8, 17.2, 0), box(1, 4, 9, C_GLASS, 4.4, 12.5, 0, 0, 0, 0.3),
    box(4, 3, 4, C_HULL, -1.5, 9.5, -3), box(4, 3, 4, C_HULL, -1.5, 9.5, 3),
    box(2, 2, 12, C_METAL, 14, 6.5, 0), box(1, 1.4, 2, '#fff3c4', 13.8, 9.2, -4.5), box(1, 1.4, 2, '#fff3c4', 13.8, 9.2, 4.5),
  ]);
  const gun = M3.mesh('ranger-gun:' + u.team, () => [cyl(1.2, 1.6, 5, 6, C_DARK, 0, 2.5, 0), box(5, 3, 3.4, T.dark, 0, 6, 0), cylX(0.8, 12, 6, C_METAL, 7, 6.2, 0), box(2, 4, 5, C_HULL, -1.5, 6.5, 0)]);
  gun.position.set(-9.5, 11, 0);
  v.root.add(body, gun);
  v.wheels = [];
  for (const [x, z] of [[9.5, -8], [9.5, 8], [-9.5, -8], [-9.5, 8]]) {
    const w = wheelMesh(4.6, 3.6); w.position.set(x, 4.6, z); v.root.add(w); v.wheels.push(w);
  }
  v.update = (u, dt) => {
    v.root.position.set(u.x, 0, u.y); v.root.rotation.y = -u.dir;
    if (firedNow(v, u)) v.rec = 1;
    v.rec = Math.max(0, v.rec - dt * 10);
    gun.rotation.y = -(u.aim - u.dir); gun.rotation.z = v.rec * 0.08;
    const bounce = u.moving ? Math.sin(u.anim * 17) * 0.45 : 0;
    body.position.y = bounce; gun.position.y = 11 + bounce;
    body.rotation.z = u.moving ? Math.sin(u.anim * 9) * 0.02 : 0;
    if (u.moving) for (const w of v.wheels) w.rotation.z -= (u.d.speed * dt) / 4.6;
  };
}

function trackedView(u, v) {
  const T = M3.tc[u.team], t = u.type, k = t + ':' + u.team;
  const L = t === 'bastion' ? 46 : t === 'thumper' ? 44 : 38, W = t === 'bastion' ? 11.5 : 9.5;
  const tracks = () => {
    const p = [];
    for (const s of [-1, 1]) {
      p.push(box(L, 7, 6.5, C_DARK, 0, 4, s * W), box(L - 6, 1.2, 7.2, C_HULL2, 0, 8, s * W));
      p.push(box(4, 5, 6.5, C_DARK, L / 2, 4.8, s * W, 0, 0, 0.6), box(4, 5, 6.5, C_DARK, -L / 2, 4.8, s * W, 0, 0, -0.6));
    }
    return p;
  };
  let hull, turret, barrel, extra = null, by = 0, bx = 0;
  if (t === 'bastion') {
    hull = M3.mesh(k, () => tracks().concat([
      box(40, 7, 18, C_HULL, 0, 10, 0), box(10, 6, 18, C_HULL, 19, 8.5, 0, 0, 0, 0.5), box(40, 1, 3, T.main, 0, 13.6, -7.4), box(40, 1, 3, T.main, 0, 13.6, 7.4),
      box(8, 3, 14, C_HULL2, -17, 13.5, 0), cylX(1.3, 6, 6, C_DARK, -21, 12, -5), cylX(1.3, 6, 6, C_DARK, -21, 12, 5),
    ]));
    turret = M3.mesh('bastion-tur:' + u.team, () => [
      box(19, 7, 15, T.main, -1, 3.5, 0), box(7, 6, 11, T.main, 9.5, 3.2, 0, 0, 0, -0.35), box(6, 3, 6, T.dark, -4, 8, 3), box(1, 7, 1, C_DARK, -9, 9, -5.5),
      box(5, 4, 5, C_HULL2, 11, 3.5, 0), box(8, 2.4, 3, C_HULL2, -6, 7.6, -4.5),
    ]);
    barrel = M3.mesh('bastion-bar', () => [cylX(1.7, 26, 8, C_METAL, 13, 0, 0), cylX(2.5, 5, 8, C_DARK, 24, 0, 0)]);
    turret.position.set(-2, 14, 0); bx = 11; by = 3.5;
  } else if (t === 'flakker') {
    hull = M3.mesh(k, () => tracks().concat([box(34, 6, 15, C_HULL, 0, 9.5, 0), box(9, 4, 14, T.main, 12, 13, 0, 0, 0, -0.2), box(6, 3, 13, C_HULL2, -14, 13, 0)]));
    turret = M3.mesh('flak-tur:' + u.team, () => [cyl(6.5, 7.5, 3, 8, C_HULL2, 0, 1.5, 0), box(11, 8, 4, T.main, 0, 7, -5.5), box(11, 8, 4, T.main, 0, 7, 5.5), box(6, 5, 7, T.dark, -1, 6, 0), box(1, 4, 1, C_GLASS, 3, 10, 0)]);
    barrel = M3.mesh('flak-bar', () => [cylX(0.9, 20, 6, C_METAL, 10, 1.6, -5.5), cylX(0.9, 20, 6, C_METAL, 10, -1.6, -5.5), cylX(0.9, 20, 6, C_METAL, 10, 1.6, 5.5), cylX(0.9, 20, 6, C_METAL, 10, -1.6, 5.5)]);
    turret.position.set(-3, 12.5, 0); bx = 3; by = 7;
    extra = M3.mesh('flak-dish:' + u.team, () => [box(1, 5, 1, C_DARK, 0, 2.5, 0), box(1.2, 4, 7, T.light, 0.6, 6, 0, 0, 0, -0.3)]);
    extra.position.set(-4, 9, 0);
  } else {
    hull = M3.mesh(k, () => tracks().concat([
      box(40, 6, 16, C_HULL, 0, 9.5, 0), box(10, 8, 15, T.main, 14, 15, 0), box(1, 4, 12, C_GLASS, 19.2, 16.5, 0), box(26, 2, 15, C_HULL2, -6, 13.2, 0),
      box(3, 5, 3, C_DARK, -18, 9, -9, 0, 0, 0.3), box(3, 5, 3, C_DARK, -18, 9, 9, 0, 0, 0.3),
    ]));
    turret = M3.mesh('thump-tur:' + u.team, () => [cyl(7.5, 8.5, 4, 8, C_HULL2, 0, 2, 0), box(9, 7, 3, T.dark, 0, 6, -5.5), box(9, 7, 3, T.dark, 0, 6, 5.5)]);
    barrel = M3.mesh('thump-bar', () => [cylX(4, 24, 8, C_DARK, 8, 0, 0), cylX(4.8, 4, 8, C_METAL, 19, 0, 0), cylX(4.6, 4, 8, C_HULL, -3, 0, 0)]);
    turret.position.set(-8, 14, 0); bx = 0; by = 7;
  }
  barrel.position.set(bx, by, 0);
  const pitch = t === 'thumper' ? 0.8 : t === 'flakker' ? 0.45 : 0.03;
  barrel.rotation.z = pitch;
  turret.add(barrel);
  if (extra) turret.add(extra);
  v.root.add(hull, turret);
  v.update = (u, dt) => {
    v.root.position.set(u.x, 0, u.y); v.root.rotation.y = -u.dir;
    if (firedNow(v, u)) v.rec = 1;
    v.rec = Math.max(0, v.rec - dt * (t === 'flakker' ? 12 : 3.2));
    turret.rotation.y = -(u.aim - u.dir);
    const k2 = v.rec * (t === 'thumper' ? 6 : t === 'bastion' ? 5 : 1.6);
    barrel.position.set(bx - Math.cos(pitch) * k2, by - Math.sin(pitch) * k2, 0);
    const rumble = u.moving ? Math.sin(u.anim * 22) * 0.25 : 0;
    hull.position.y = rumble;
    // the hull rocks back against the recoil
    const kick = t === 'flakker' ? 0 : v.rec * v.rec * 0.05;
    hull.rotation.z = kick * Math.cos(u.aim - u.dir);
    hull.rotation.x = kick * Math.sin(u.aim - u.dir);
    if (extra) extra.rotation.y = u.anim * 3;
  };
}

function kestrelView(u, v) {
  const T = M3.tc[u.team];
  const body = new THREE.Group();
  const hull = M3.mesh('kestrel:' + u.team, () => [
    box(22, 6.5, 7.5, T.main, 0, 0, 0), box(8, 5, 6.5, T.main, 14, -0.6, 0, 0, 0, -0.18), box(7, 3.4, 5.6, C_GLASS, 9, 3.2, 0, 0, 0, -0.25),
    box(18, 2.4, 2.6, C_HULL2, -19, 1, 0), box(5, 7, 1, T.dark, -27, 4, 0, 0, 0, 0.4), box(4, 1, 10, T.dark, -27, 1.5, 0),
    box(7, 1.6, 32, C_HULL, 0, 2.6, 0), cyl(3.4, 3.4, 5, 8, C_HULL2, 0, 3.4, -16), cyl(3.4, 3.4, 5, 8, C_HULL2, 0, 3.4, 16),
    box(9, 2.6, 3, C_DARK, 3, -1.2, -9), box(9, 2.6, 3, C_DARK, 3, -1.2, 9), cylX(0.7, 8, 6, C_METAL, 18, -3.4, 0), box(4, 2, 3, C_DARK, 12, -3.4, 0),
    box(14, 1, 1, C_DARK, 0, -5.6, -3.4), box(14, 1, 1, C_DARK, 0, -5.6, 3.4), box(1, 2.4, 1, C_DARK, 5, -4.2, -3.4), box(1, 2.4, 1, C_DARK, 5, -4.2, 3.4), box(1, 2.4, 1, C_DARK, -5, -4.2, -3.4), box(1, 2.4, 1, C_DARK, -5, -4.2, 3.4),
  ]);
  body.add(hull);
  v.rotors = [];
  for (const z of [-16, 16]) {
    const r = M3.mesh('rotor', () => [box(27, 0.5, 2.2, '#dfe6ee'), box(2.2, 0.5, 27, '#dfe6ee'), cyl(1.4, 1.4, 1.6, 6, C_DARK)]);
    r.position.set(0, 6.6, z); r.castShadow = false; body.add(r); v.rotors.push(r);
  }
  v.root.add(body);
  v.pd = u.dir; v.roll = 0;
  v.update = (u, dt) => {
    v.root.position.set(u.x, AIR_H + Math.sin(u.anim * 2.2) * 2.5, u.y); v.root.rotation.y = -u.dir;
    const turn = dt > 0 ? angDiff(v.pd, u.dir) / dt : 0; v.pd = u.dir;
    v.roll += (clamp(turn * 0.18, -0.5, 0.5) - v.roll) * Math.min(1, dt * 6);
    body.rotation.x = v.roll;
    v.pitch = (v.pitch || 0) + ((u.moving ? -0.2 : 0) - (v.pitch || 0)) * Math.min(1, dt * 4);
    body.rotation.z = v.pitch;
    v.rotors[0].rotation.y += dt * 34; v.rotors[1].rotation.y -= dt * 34;
  };
}

function condorView(u, v) {
  const T = M3.tc[u.team];
  const body = new THREE.Group();
  const hull = M3.mesh('condor:' + u.team, () => [
    box(52, 8, 15, T.main, 0, 0, 0), box(12, 6, 12, T.main, 30, -0.8, 0, 0, 0, -0.14), box(9, 3.6, 9, C_GLASS, 25, 4, 0, 0, 0, -0.2),
    box(20, 2.4, 36, C_HULL, -4, 2, -24, 0, -0.35, 0), box(20, 2.4, 36, C_HULL, -4, 2, 24, 0, 0.35, 0),
    box(16, 1, 30, T.dark, -6, 3.4, -24, 0, -0.35, 0), box(16, 1, 30, T.dark, -6, 3.4, 24, 0, 0.35, 0),
    box(9, 10, 1.4, T.dark, -24, 7, -5, 0, 0, 0.35), box(9, 10, 1.4, T.dark, -24, 7, 5, 0, 0, 0.35),
    box(26, 3, 10, C_DARK, 0, -4.6, 0), box(30, 3, 3, C_HULL2, 0, 5, 0),
    cylX(3.6, 12, 8, C_HULL2, -10, -1, -18), cylX(3.6, 12, 8, C_HULL2, -10, -1, 18), cylX(3.6, 12, 8, C_HULL2, -15, -1, -32), cylX(3.6, 12, 8, C_HULL2, -15, -1, 32),
  ]);
  body.add(hull);
  body.scale.setScalar(0.8);
  v.jets = [];
  for (const [x, z] of [[-17, -18], [-17, 18], [-22, -32], [-22, 32]]) {
    const j = M3.mesh('jet', () => [cylX(2.8, 5, 8, '#7fd8ff')], true);
    j.position.set(x, -1, z); body.add(j); v.jets.push(j);
  }
  v.root.add(body);
  v.pd = u.dir; v.roll = 0;
  v.update = (u, dt) => {
    v.root.position.set(u.x, AIR_H + 10 + Math.sin(u.anim * 1.3) * 2, u.y); v.root.rotation.y = -u.dir;
    const turn = dt > 0 ? angDiff(v.pd, u.dir) / dt : 0; v.pd = u.dir;
    v.roll += (clamp(turn * 0.25, -0.35, 0.35) - v.roll) * Math.min(1, dt * 3);
    body.rotation.x = v.roll;
    for (let i = 0; i < 4; i++) { const s = (u.moving ? 1.5 : 0.8) + Math.sin(u.anim * 30 + i) * 0.25; v.jets[i].scale.set(s, 1, 1); }
  };
}

/* ================= buildings ================= */
function makeBldView(b) {
  const T = M3.tc[b.team], v = { root: new THREE.Group(), rec: 0 }, R = v.root, k = b.type + ':' + b.team;
  const base = () => [cyl(29, 31, 4, 6, C_HULL2, 0, 2, 0), cyl(31.5, 31.5, 1.2, 6, T.main, 0, 0.6, 0)];
  let anim = null;
  R.position.set(b.x, PAD_H, b.y);
  switch (b.type) {
    case 'citadel': {
      R.add(M3.mesh(k, () => {
        const p = [
          cyl(64, 70, 12, 8, C_HULL2, 0, 6, 0), cyl(66, 66, 2, 8, T.main, 0, 12.5, 0), cyl(50, 56, 16, 8, C_HULL, 0, 21, 0),
          cyl(34, 40, 20, 8, T.dark, 0, 39, 0), cyl(36, 36, 2.5, 8, T.main, 0, 49.5, 0), cyl(22, 28, 12, 8, C_HULL, 0, 56, 0), cyl(5, 9, 26, 6, C_HULL2, 0, 75, 0),
        ];
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU + TAU / 8, x = Math.cos(a) * 54, z = Math.sin(a) * 54;
          p.push(box(13, 30, 13, C_HULL2, x, 15, z, 0, -a, 0), box(15, 3, 15, C_DARK, x, 31, z, 0, -a, 0));
          p.push(box(4, 12, 20, C_GLASS, Math.cos(a) * 45, 34, Math.sin(a) * 45, 0, -a, 0));
        }
        for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; p.push(box(3, 10, 8, C_DARK, Math.cos(a) * 53, 20, Math.sin(a) * 53, 0, -a, 0)); }
        return p;
      }));
      const lights = [];
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + TAU / 8;
        const l = M3.mesh('cit-light:' + b.team, () => [box(7, 5, 7, T.light)], true);
        l.position.set(Math.cos(a) * 54, 35, Math.sin(a) * 54); R.add(l); lights.push(l);
      }
      const dish = M3.mesh('cit-dish:' + b.team, () => [box(2, 8, 2, C_DARK, 0, 4, 0), box(3, 12, 26, T.light, 3, 13, 0, 0, 0, -0.35), box(10, 2, 2, C_METAL, 7, 12, 0)]);
      dish.position.y = 86; R.add(dish);
      anim = (b) => { dish.rotation.y = b.anim * 1.2; lights.forEach((l, i) => { l.visible = Math.sin(b.anim * 3 + i * 1.6) > -0.3; }); };
      break;
    }
    case 'depot': {
      R.add(M3.mesh(k, () => base().concat([
        box(11, 9, 11, C_CRATE, -10, 8.5, -8), box(11, 9, 11, C_CRATE, 3, 8.5, -10, 0, 0.3, 0), box(11, 9, 11, C_CRATE, -9, 8.5, 6, 0, -0.2, 0),
        box(10, 8, 10, '#b98d42', -6, 17, -3, 0, 0.5, 0), box(11.4, 2, 11.4, T.main, -10, 10, -8), box(11.4, 2, 11.4, T.main, -9, 10, 6, 0, -0.2, 0),
        cyl(8, 8, 12, 8, C_HULL, 12, 10, 9), cyl(8.4, 8.4, 2, 8, T.main, 12, 13, 9), cyl(2.5, 3, 30, 6, C_DARK, 15, 19, -12),
      ])));
      const crane = M3.mesh('depot-crane:' + b.team, () => [box(24, 2.4, 2.4, '#e3b341', -8, 0, 0), box(5, 4, 4, C_DARK, 4, 0, 0), box(0.6, 12, 0.6, C_DARK, -18, -6, 0), box(4, 3, 4, C_CRATE, -18, -13, 0)]);
      crane.position.set(15, 34, -12); R.add(crane);
      const heavy = M3.mesh('depot-heavy:' + b.team, () => [box(11, 9, 11, C_CRATE, 6, 8.5, 22, 0, 0.2, 0), box(10, 8, 10, '#b98d42', 4, 17, -9, 0, -0.3, 0), cyl(33, 33, 1.6, 6, '#ffd66b', 0, 3.4, 0), cyl(5, 5, 14, 8, T.light, 12, 23, 9)]);
      R.add(heavy);
      anim = (b) => { crane.rotation.y = Math.sin(b.anim * 0.5) * 1.3 + 2.2; heavy.visible = b.level > 1; };
      break;
    }
    case 'reactor': {
      R.add(M3.mesh(k, () => {
        const p = base().concat([cyl(17, 20, 9, 8, C_HULL, 0, 8.5, 0), cyl(11, 13, 4, 8, C_DARK, 0, 15, 0)]);
        for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU; p.push(box(5, 30, 5, C_HULL2, Math.cos(a) * 20, 18, Math.sin(a) * 20, 0, -a, 0), box(9, 3, 5, T.main, Math.cos(a) * 17.5, 33, Math.sin(a) * 17.5, 0, -a, 0)); }
        return p;
      }));
      const core = M3.mesh('reactor-core', () => [ball(8, '#8fe9ff')], true);
      const halo = new THREE.Mesh(M3.cache['reactor-core'], new THREE.MeshBasicMaterial({ color: 0x4fc8ff, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
      core.position.y = halo.position.y = 26; R.add(core, halo);
      const rings = [];
      for (let i = 0; i < 2; i++) {
        const r = new THREE.Mesh(M3.cache['torus'] || (M3.cache['torus'] = new THREE.TorusGeometry(13, 1.1, 5, 18)), new THREE.MeshPhongMaterial({ color: T.main, flatShading: true, emissive: T.dark }));
        r.position.y = 26; r.castShadow = true; R.add(r); rings.push(r);
      }
      anim = (b) => {
        const p = 1 + Math.sin(b.anim * 4) * 0.12;
        core.scale.setScalar(p); halo.scale.setScalar(1.5 + Math.sin(b.anim * 4) * 0.25);
        rings[0].rotation.set(b.anim * 1.3, b.anim * 0.7, 0); rings[1].rotation.set(Math.PI / 2 + b.anim * 0.9, 0, b.anim * 1.6);
      };
      break;
    }
    case 'barracks': {
      R.add(M3.mesh(k, () => base().concat([
        box(38, 14, 28, T.dark, 0, 11, 0), box(40, 3, 30, C_HULL2, 0, 19.5, 0), box(30, 4, 20, C_HULL, 0, 23, 0), box(1, 9, 9, C_DARK, 19.2, 8.5, 0),
        box(1, 3, 22, C_GLASS, 19.2, 15.5, 0), box(40.4, 2, 4, T.main, 0, 14, -12), box(40.4, 2, 4, T.main, 0, 14, 12),
        box(8, 6, 8, C_HULL2, -10, 28, -4), box(1, 18, 1, C_DARK, -12, 33, 6), box(10, 10, 3, C_HULL2, 22, 6, -11, 0, 0.4, 0), box(10, 10, 3, C_HULL2, 22, 6, 11, 0, -0.4, 0),
      ])));
      const flag = M3.mesh('flag:' + b.team, () => [box(9, 5, 0.5, T.main, 4.5, 0, 0)]);
      flag.position.set(-12, 39, 6); R.add(flag);
      const lamp = M3.mesh('lamp:' + b.team, () => [box(3, 3, 3, T.light)], true);
      lamp.position.set(19.5, 15, 0); R.add(lamp);
      anim = (b) => { flag.rotation.y = Math.sin(b.anim * 3) * 0.35; flag.scale.x = 1 + Math.sin(b.anim * 7) * 0.06; lamp.visible = !b.queue.length || Math.sin(b.anim * 10) > 0; };
      break;
    }
    case 'foundry': {
      R.add(M3.mesh(k, () => base().concat([
        box(38, 18, 30, C_HULL, 0, 13, 0), box(40, 3, 32, T.main, 0, 23, 0), box(24, 6, 32.4, C_HULL2, -4, 27, 0, 0, 0, 0.2),
        box(1, 13, 16, C_DARK, 19.2, 10.5, 0), box(1.4, 2, 18, '#e3b341', 19.4, 18, 0),
        cyl(3.4, 4, 26, 8, C_HULL2, -12, 36, -9), cyl(3.4, 4, 22, 8, C_HULL2, -12, 34, 3), cyl(4.4, 4.4, 2, 8, C_DARK, -12, 49, -9), cyl(4.4, 4.4, 2, 8, C_DARK, -12, 45, 3),
        box(10, 8, 12, T.dark, 8, 30, 6),
      ])));
      const gear = M3.mesh('gear', () => { const p = [cyl(8, 8, 2.4, 10, C_METAL, 0, 0, 0, Math.PI / 2), cyl(3, 3, 3.4, 8, C_DARK, 0, 0, 0, Math.PI / 2)]; for (let i = 0; i < 6; i++) p.push(box(3.2, 20, 2.4, C_METAL, 0, 0, 0, 0, 0, (i / 6) * Math.PI)); return p; });
      gear.position.set(6, 16, -16.6); gear.scale.setScalar(0.8); R.add(gear);
      v.smoke = 0;
      anim = (b, dt) => {
        gear.rotation.z += dt * (b.queue.length ? 3 : 0.3);
        if (b.queue.length && !b.building && (v.smoke -= dt) <= 0 && G.fx.length < 700) {
          v.smoke = 0.22;
          G.fx.push({ type: 'puff', x: b.x - 12, y: b.y - 9 + (Math.random() < 0.5 ? 12 : 0), h: 60, rise: 50, t: 0, life: 1.3, r: 9, dark: true });
        }
      };
      break;
    }
    case 'skyport': {
      R.add(M3.mesh(k, () => base().concat([
        cyl(25, 26, 4, 12, C_DARK, 0, 6, 0), cyl(20, 20, 0.8, 12, T.main, 0, 8.2, 0), cyl(16, 16, 1, 12, C_HULL2, 0, 8.4, 0),
        box(22, 0.6, 3, '#e6edf2', 0, 9.1, 0), box(3, 0.6, 14, '#e6edf2', -9, 9.1, 0), box(3, 0.6, 14, '#e6edf2', 9, 9.1, 0),
        box(7, 30, 7, C_HULL, -21, 19, -14), box(10, 6, 10, C_GLASS, -21, 36, -14), box(11, 1.6, 11, T.main, -21, 40, -14), box(1, 9, 1, C_DARK, -21, 45, -14),
      ])));
      const beacon = M3.mesh('beacon:' + b.team, () => [box(9, 1.6, 1.6, T.light, 3, 0, 0), box(2, 2, 2, C_DARK)]);
      beacon.position.set(-21, 50, -14); R.add(beacon);
      const lights = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU, l = M3.mesh('padlight', () => [box(2.4, 1.6, 2.4, '#ffffff')], true);
        l.position.set(Math.cos(a) * 23, 9, Math.sin(a) * 23); R.add(l); lights.push(l);
      }
      anim = (b) => { beacon.rotation.y = b.anim * 2.5; const s = Math.floor(b.anim * (b.queue.length ? 9 : 3)); lights.forEach((l, i) => { l.visible = (s + i) % 3 === 0; }); };
      break;
    }
    case 'turret': {
      R.add(M3.mesh(k, () => base().concat([cyl(13, 17, 9, 8, C_HULL, 0, 8.5, 0), cyl(9, 9, 5, 8, C_DARK, 0, 15, 0)])));
      const head = M3.mesh('turret-head:' + b.team, () => [box(17, 9, 15, T.main, -1, 5, 0), box(6, 7, 17, T.dark, -6, 5.5, 0), box(5, 5, 9, C_HULL2, 9, 5, 0), box(2, 3, 2, C_GLASS, 2, 10.5, 4)]);
      const barrels = M3.mesh('turret-bar', () => [cylX(1.5, 22, 6, C_METAL, 18, 5.4, -4), cylX(1.5, 22, 6, C_METAL, 18, 5.4, 4), box(3, 4, 12, C_DARK, 27, 5.4, 0)]);
      head.position.y = 17; head.add(barrels); R.add(head);
      anim = (b, dt) => {
        if (firedNow(v, b)) v.rec = 1;
        v.rec = Math.max(0, v.rec - dt * 12);
        head.rotation.y = -b.aim; barrels.position.x = -v.rec * 2.5;
      };
      break;
    }
  }
  v.update = (b, dt) => {
    const k2 = b.building ? clamp(b.bt / b.d.time, 0, 1) : 1;
    R.scale.y = 0.08 + 0.92 * k2;
    if (anim) anim(b, dt);
  };
  return v;
}
