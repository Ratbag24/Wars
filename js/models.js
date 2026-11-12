'use strict';
/* Procedural 3D models and their animations. Model space: +x forward, +y up, +z right. */

const PAD_H = 6;

const M3 = {
  cache: {}, mat: null, glow: null, tc: [],
  init() {
    this.mat = new THREE.MeshPhongMaterial({ color: 0xa6a6a6, vertexColors: true, flatShading: true, shininess: 24, specular: 0x1c1e22 });
    this.glow = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.tc = TEAM_COL.map((c) => ({ main: c.main, dark: c.dark, light: c.light }));
    this.ringMat = TEAM_COL.map((c) => new THREE.MeshBasicMaterial({ color: c.main, transparent: true, opacity: 0.55, depthWrite: false }));
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

/* ================= model assets (CC0 glTF, see assets/models/README.md) ================= */
const MODELS = {
  soldier: { fit: 'y', size: 13.5 },
  tank_heavy: { fit: 'h', size: 50 },
  robot_gunner: { fit: 'h', size: 40 },
  mech: { fit: 'y', size: 34 },
  robot_flyer_gun: { fit: 'h', size: 42 },
  speeder_b: { fit: 'h', size: 36 },
  cargo_ship: { fit: 'h', size: 76 },
};
const TINT = {
  soldier: { Character_Main: 'main', Pants: 'dark' },
  tank_heavy: { Main: 'main', Main_Light: 'light', Main_Dark: 'dark' },
  robot_gunner: { Main: 'main' },
  robot_flyer_gun: { 'Material.001': 'main', Main: 'main' },
  mech: { Atlas: 'wash' },
  speeder_b: { metalRed: 'main', metal: 'dim', metalDark: 'dim', dark: 'dim' },
  cargo_ship: { metalRed: 'main', metal: 'dim', metalDark: 'dim', dark: 'dim' },
};

const Assets = {
  m: {},
  load() {
    return new Promise((res) => {
      const loader = new THREE.GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const names = Object.keys(MODELS);
      let left = names.length;
      const done = () => { if (!--left) res(); };
      for (const n of names) {
        const bin = atob(MODEL_DATA[n]), buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        loader.parse(buf.buffer, '', (g) => { this.prep(n, g); done(); }, (e) => { console.error('model failed: ' + n, e); done(); });
      }
    });
  },
  prep(n, g) {
    const cfg = MODELS[n], sc = g.scene, v = new THREE.Vector3();
    // some files ship their own lamps; the game lights the scene itself
    const lamps = [];
    sc.traverse((o) => { if (o.isLight) lamps.push(o); });
    for (const l of lamps) l.parent.remove(l);
    sc.updateMatrixWorld(true);
    const box = new THREE.Box3();
    let bones = false;
    sc.traverse((o) => { if (o.isBone && !/^(PoleTarget|PT)/.test(o.name)) { bones = true; box.expandByPoint(o.getWorldPosition(v)); } });
    if (!bones) box.setFromObject(sc);
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const s = cfg.size / (cfg.fit === 'y' ? size.y : Math.max(size.x, size.z));
    const mats = new Set();
    sc.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      if (o.isSkinnedMesh) o.frustumCulled = false;
      mats.add(o.material);
    });
    // the game renders without colour management, so bring the glTF colours into that space
    for (const m of mats) {
      m.color.convertLinearToSRGB(); m.metalness = 0; m.roughness = 0.85;
      if (m.map) { m.map.encoding = THREE.LinearEncoding; m.map.needsUpdate = true; }
    }
    const clips = {};
    for (const a of g.animations) clips[a.name.split('|').pop()] = a;
    this.m[n] = { scene: sc, clips, s, off: new THREE.Vector3(-c.x * s, -box.min.y * s, -c.z * s), mats: [new Map(), new Map()] };
  },
  // a fresh, team-tinted instance wrapped in a holder that faces +x
  make(n, team, yaw) {
    const A = this.m[n], obj = THREE.SkeletonUtils.clone(A.scene), map = A.mats[team], T = M3.tc[team];
    obj.traverse((o) => {
      if (!o.isMesh) return;
      let m = map.get(o.material);
      if (!m) {
        m = o.material.clone();
        const role = (TINT[n] || {})[m.name], c = new THREE.Color(T.main);
        if (role === 'main') m.color.copy(c).multiplyScalar(0.82);
        else if (role === 'light') m.color.copy(c).lerp(new THREE.Color('#ffffff'), 0.3).multiplyScalar(0.85);
        else if (role === 'dark') m.color.set(T.dark).lerp(c, 0.25);
        else if (role === 'wash') m.color.set('#ffffff').lerp(c, 0.8);
        else if (role === 'dim') m.color.multiplyScalar(0.55);
        map.set(o.material, m);
      }
      o.material = m;
    });
    obj.scale.setScalar(A.s); obj.position.copy(A.off);
    const holder = new THREE.Group();
    holder.rotation.y = yaw === undefined ? Math.PI / 2 : yaw;
    holder.add(obj);
    const a = { holder, obj, mixer: null, acts: {}, cur: null };
    if (Object.keys(A.clips).length) {
      a.mixer = new THREE.AnimationMixer(obj);
      a.play = (name, once, speed) => {
        if (a.cur === name || !A.clips[name]) return;
        const next = a.acts[name] || (a.acts[name] = a.mixer.clipAction(A.clips[name]));
        next.reset();
        if (once) { next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true; }
        next.timeScale = speed || 1;
        if (a.cur) next.crossFadeFrom(a.acts[a.cur], 0.16, false);
        next.play();
        a.cur = name;
      };
    }
    return a;
  },
};

function dust(v, u, dt, r) {
  if (!u.moving || (v.dustT = (v.dustT || 0) - dt) > 0 || G.fx.length > 600) return;
  v.dustT = 0.09;
  G.fx.push({ type: 'puff', x: u.x - Math.cos(u.dir) * u.radius + (Math.random() - 0.5) * 10, y: u.y - Math.sin(u.dir) * u.radius + (Math.random() - 0.5) * 10, h: 0, rise: 16, t: 0, life: 0.7, r, dust: true });
}
const WRECK = () => M3.wreck || (M3.wreck = new THREE.MeshLambertMaterial({ color: 0x1d1b1c }));
function teamRing(u, r) {
  const g = M3.cache['ring'] || (M3.cache['ring'] = new THREE.RingGeometry(0.8, 1, 28));
  const m = new THREE.Mesh(g, M3.ringMat[u.team]);
  m.rotation.x = -Math.PI / 2; m.position.y = 0.7; m.scale.setScalar(r);
  return m;
}

/* ================= units ================= */
function makeUnitView(u) {
  const v = { root: new THREE.Group(), shotT: 0 };
  if (u.cls === 'inf') squadView(u, v);
  else if (u.type === 'bastion') tankView(u, v);
  else if (u.type === 'flakker') walkerView(u, v, 'robot_gunner', 'Walk', 'Shoot', 1.5);
  else if (u.type === 'thumper') walkerView(u, v, 'mech', 'Walk', 'Shoot_Big', 1.1);
  else if (u.type === 'kestrel') flyerView(u, v);
  else craftView(u, v);
  return v;
}

const WEAPONS = ['Revolver', 'Sniper', 'Revolver_Small', 'Pistol', 'SMG', 'GrenadeLauncher', 'ShortCannon', 'Shotgun', 'Sniper_2', 'RocketLauncher', 'AK', 'Shovel', 'Knife_2', 'Knife_1'];
function squadView(u, v) {
  const n = Math.min(4, u.d.squad);
  const offs = n === 4 ? [[7, -7], [7, 7], [-8, -7], [-8, 7]] : [[8, 0], [-6, -8], [-6, 8]];
  const weapon = { trooper: 'AK', scorcher: 'ShortCannon', lancer: 'RocketLauncher' }[u.type];
  const spawn = (i) => {
    const a = Assets.make('soldier', u.team);
    a.obj.traverse((o) => { if (WEAPONS.includes(o.name)) o.visible = o.name === weapon; });
    a.holder.position.set(offs[i][0], 0, offs[i][1]);
    a.play('Idle'); a.mixer.update(Math.random());
    v.root.add(a.holder);
    return a;
  };
  v.members = [];
  for (let i = 0; i < n; i++) v.members.push(spawn(i));
  v.root.add(teamRing(u, u.radius + 3));
  const drop = (i, delay) => {
    const a = v.members[i];
    if (!a) return;
    v.members[i] = null;
    Render.addCorpse(a, { clip: 'Death', life: 3.4, delay });
  };
  v.update = (u, dt) => {
    v.root.position.set(u.x, 0, u.y); v.root.rotation.y = -u.dir;
    if (firedNow(v, u)) v.shotT = Math.max(0.5, u.d.rof * 1.5);
    v.shotT -= dt;
    const alive = Math.max(1, Math.ceil((n * u.hp) / u.maxHp));
    for (let i = 0; i < n; i++) {
      if (i >= alive) { drop(i, 0); continue; }
      const a = v.members[i] || (v.members[i] = spawn(i));
      a.play(u.moving ? 'Run_Gun' : v.shotT > 0 ? 'Idle_Shoot' : 'Idle', false, u.moving ? 1.25 : 1);
      a.holder.rotation.y = Math.PI / 2 - (u.moving ? 0 : u.aim - u.dir);
      a.mixer.update(dt);
    }
  };
  v.die = () => { for (let i = 0; i < n; i++) drop(i, i * 0.12); };
}

function tankView(u, v) {
  const a = Assets.make('tank_heavy', u.team, Math.PI);
  v.root.add(a.holder, teamRing(u, u.radius + 6));
  a.obj.updateMatrixWorld(true);
  const turret = a.obj.getObjectByName('Tank_Turret'), gun = a.obj.getObjectByName('Tank_Gun');
  // the cannon is a sibling of the turret in the file: hang it off the turret so both traverse together
  const pivot = new THREE.Group();
  turret.parent.add(pivot); pivot.position.copy(turret.position);
  pivot.attach(turret); pivot.attach(gun);
  const gunHome = gun.position.clone();
  a.play('Tank_Forward');
  const tracks = a.acts.Tank_Forward;
  v.rec = 0;
  v.update = (u, dt) => {
    v.root.position.set(u.x, 0, u.y); v.root.rotation.y = -u.dir;
    if (firedNow(v, u)) v.rec = 1;
    v.rec = Math.max(0, v.rec - dt * 3.5);
    pivot.rotation.y = -(u.aim - u.dir);
    gun.position.copy(gunHome); gun.translateY(v.rec * 0.7);
    a.holder.rotation.z = v.rec * v.rec * 0.035 * Math.cos(u.aim - u.dir);
    a.holder.position.y = u.moving ? Math.sin(u.anim * 24) * 0.2 : 0;
    tracks.paused = !u.moving;
    dust(v, u, dt, 12);
    a.mixer.update(dt * 1.6);
  };
  v.die = () => {
    a.obj.traverse((o) => { if (o.isMesh) o.material = WRECK(); });
    pivot.rotation.x = 0.25; pivot.rotation.z = 0.2;
    Render.addCorpse(a, { life: 7, smoke: true });
  };
}

function walkerView(u, v, model, walk, shoot, speed) {
  const a = Assets.make(model, u.team);
  v.root.add(a.holder, teamRing(u, u.radius + 5));
  v.face = u.dir;
  a.play('Idle');
  v.update = (u, dt) => {
    if (firedNow(v, u)) v.shotT = Math.max(0.7, u.d.rof * 1.2);
    v.shotT -= dt;
    v.face = turnToward(v.face, v.shotT > 0 && !u.moving ? u.aim : u.dir, dt * 7);
    v.root.position.set(u.x, 0, u.y); v.root.rotation.y = -v.face;
    a.play(u.moving ? walk : v.shotT > 0 ? shoot : 'Idle', false, u.moving ? speed : 1);
    a.mixer.update(dt);
  };
  v.die = () => Render.addCorpse(a, { clip: 'Death', life: 4.5 });
}

function flyerView(u, v) {
  const a = Assets.make('robot_flyer_gun', u.team);
  v.root.add(a.holder);
  a.play('Idle');
  v.pd = u.dir; v.roll = 0;
  v.update = (u, dt) => {
    if (firedNow(v, u)) v.shotT = Math.max(0.7, u.d.rof * 1.2);
    v.shotT -= dt;
    v.root.position.set(u.x, AIR_H - 10 + Math.sin(u.anim * 2.2) * 2.5, u.y); v.root.rotation.y = -u.dir;
    const turn = dt > 0 ? angDiff(v.pd, u.dir) / dt : 0; v.pd = u.dir;
    v.roll += (clamp(turn * 0.18, -0.5, 0.5) - v.roll) * Math.min(1, dt * 6);
    a.holder.rotation.x = v.roll;
    a.holder.rotation.z = u.moving ? -0.22 : 0;
    a.play(v.shotT > 0 ? 'Shoot' : u.moving ? 'Run' : 'Idle');
    a.mixer.update(dt);
  };
  v.die = () => Render.addCorpse(a, { clip: 'Dead', life: 4, fall: true });
}

function craftView(u, v) {
  const condor = u.type === 'condor';
  const a = Assets.make(condor ? 'cargo_ship' : 'speeder_b', u.team, -Math.PI / 2);
  const body = new THREE.Group();
  body.add(a.holder);
  v.jets = [];
  for (const z of condor ? [-13, 13] : [-7, 7]) {
    const j = M3.mesh('jet', () => [cylX(2.6, 6, 8, '#7fd8ff')], true);
    j.position.set(condor ? -38 : -19, condor ? 10 : 5, z); body.add(j); v.jets.push(j);
  }
  v.root.add(body);
  if (!condor) v.root.add(teamRing(u, u.radius + 5));
  v.pd = u.dir; v.roll = 0;
  const alt = condor ? AIR_H - 4 : 5;
  v.update = (u, dt) => {
    v.root.position.set(u.x, 0, u.y); v.root.rotation.y = -u.dir;
    body.position.y = alt + Math.sin(u.anim * (condor ? 1.3 : 3)) * (condor ? 2 : 1);
    const turn = dt > 0 ? angDiff(v.pd, u.dir) / dt : 0; v.pd = u.dir;
    v.roll += (clamp(turn * 0.2, -0.45, 0.45) - v.roll) * Math.min(1, dt * 4);
    body.rotation.x = v.roll;
    body.rotation.z = !condor && u.moving ? -0.07 : 0;
    if (!condor) dust(v, u, dt, 8);
    for (let i = 0; i < v.jets.length; i++) v.jets[i].scale.set((u.moving ? 1.6 : 0.7) + Math.sin(u.anim * 30 + i) * 0.25, 1, 1);
  };
  if (condor) v.die = () => { a.obj.traverse((o) => { if (o.isMesh) o.material = WRECK(); }); Render.addCorpse({ holder: body }, { life: 5, fall: true, tumble: true, smoke: true }); };
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
