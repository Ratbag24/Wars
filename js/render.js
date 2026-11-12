'use strict';
/* 3D renderer (three.js) with a 2D overlay canvas for bars, rings and markers */

const CAM_PITCH = 0.92; // radians above the horizon
const CAM_FOV = 35;

const Render = {
  cv: null, ov: null, octx: null, W: 0, H: 0, dpr: 1, cam: { x: 0, y: 0, z: 1 },
  fogCv: null, fogCtx: null, fogImg: null, mm: null, mmCtx: null, mmBg: null, frame: 0,
  views: new Map(), corpses: [], scorches: [], lastT: 0, terrDirty: 0,

  init() {
    this.cv = document.getElementById('c');
    this.ov = document.getElementById('o');
    this.octx = this.ov.getContext('2d');
    this.mm = document.getElementById('mm');
    this.mmCtx = this.mm.getContext('2d');
    this.fogCv = document.createElement('canvas');
    this.fogCv.width = FW; this.fogCv.height = FH;
    this.fogCtx = this.fogCv.getContext('2d');
    this.fogImg = this.fogCtx.createImageData(FW, FH);

    M3.init();
    const gl = (this.gl = new THREE.WebGLRenderer({ canvas: this.cv, antialias: true, powerPreference: 'high-performance' }));
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07080d);
    this.camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 60, 14000);
    this.scene.add(new THREE.HemisphereLight(0xd6e2ff, 0x4a3628, 0.78));
    const sun = (this.sun = new THREE.DirectionalLight(0xffe6c8, 0.95));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -1300; sc.right = 1300; sc.top = 1300; sc.bottom = -1300; sc.near = 100; sc.far = 4000;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 1.5;
    this.scene.add(sun, sun.target);
    this.staticG = new THREE.Group(); this.dynG = new THREE.Group();
    this.scene.add(this.staticG, this.dynG);
    this.initFx();
    // bloom: bright things (tracers, explosions, reactor cores, engines) glow
    if (THREE.EffectComposer && !new URLSearchParams(location.search).has('nofx')) {
      const rt = new THREE.WebGLRenderTarget(4, 4, { samples: 4 });
      this.composer = new THREE.EffectComposer(gl, rt);
      this.composer.addPass(new THREE.RenderPass(this.scene, this.camera));
      this.bloom = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.55, 0.8);
      this.composer.addPass(this.bloom);
    }
    this.resize();
    window.addEventListener('resize', () => this.resize());
  },

  resize() {
    const dpr = (this.dpr = Math.min(window.devicePixelRatio || 1, 2));
    this.W = window.innerWidth; this.H = window.innerHeight;
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(this.W, this.H, false);
    if (this.composer) { this.composer.setPixelRatio(dpr); this.composer.setSize(this.W, this.H); }
    this.ov.width = this.W * dpr; this.ov.height = this.H * dpr;
    this.camera.aspect = this.W / this.H;
    this.camera.updateProjectionMatrix();
    this.clampCam();
  },

  /* ---------- camera ---------- */
  clampCam() {
    const c = this.cam;
    c.z = clamp(c.z, 0.5, 1.7);
    c.x = clamp(c.x, -this.W / c.z * 0.3, Math.max(0, WORLD_W - this.W / c.z * 0.7));
    c.y = clamp(c.y, -this.H / c.z * 0.3, Math.max(0, WORLD_H - this.H / c.z * 0.7));
    this.updateCamera();
  },
  updateCamera() {
    const c = this.cam, fx = c.x + this.W / c.z / 2, fy = c.y + this.H / c.z / 2;
    const D = this.H / c.z / (2 * Math.tan((CAM_FOV * Math.PI) / 360));
    this.focus = { x: fx, y: fy };
    this.camera.position.set(fx, D * Math.sin(CAM_PITCH), fy + D * Math.cos(CAM_PITCH));
    this.camera.lookAt(fx, 0, fy);
    this.camera.updateMatrixWorld();
  },
  centerOn(x, y) { this.cam.x = x - this.W / this.cam.z / 2; this.cam.y = y - this.H / this.cam.z / 2; this.clampCam(); },
  zoomAt(sx, sy, f) {
    const a = this.toWorld(sx, sy);
    this.cam.z = clamp(this.cam.z * f, 0.5, 1.7);
    this.updateCamera();
    const b = this.toWorld(sx, sy);
    this.cam.x += a.x - b.x; this.cam.y += a.y - b.y;
    this.clampCam();
  },
  toWorld(sx, sy) {
    const v = new THREE.Vector3((sx / this.W) * 2 - 1, 1 - (sy / this.H) * 2, 0.5).unproject(this.camera);
    const o = this.camera.position, dy = v.y - o.y;
    const t = dy < -1e-6 ? -o.y / dy : 1e5;
    return { x: o.x + (v.x - o.x) * t, y: o.z + (v.z - o.z) * t };
  },
  _v: null,
  toScreen(x, y, h) {
    const v = (this._v || (this._v = new THREE.Vector3())).set(x, h || 0, y).project(this.camera);
    return { x: (v.x + 1) * 0.5 * this.W, y: (1 - v.y) * 0.5 * this.H, ok: v.z < 1 };
  },
  onScreen(x, y, m) {
    const c = this.cam, vw = this.W / c.z, vh = this.H / c.z;
    return x > c.x - vw * 0.3 - m && y > c.y - vh * 0.7 - m && x < c.x + vw * 1.3 + m && y < c.y + vh * 1.15 + m;
  },

  /* ---------- static world ---------- */
  newMap() {
    for (const v of this.views.values()) this.dynG.remove(v.root);
    this.views.clear();
    for (const c of this.corpses) this.dynG.remove(c.h);
    this.corpses = [];
    while (this.staticG.children.length) {
      const o = this.staticG.children.pop();
      if (o.geometry && !o.userData.shared) o.geometry.dispose();
      if (o.material && o.material.map) o.material.map.dispose();
    }
    // ground
    // ground texture: the painted colour map upscaled, with a tiling surface-detail layer blended over it
    const maxT = this.gl.capabilities.maxTextureSize, ts = maxT >= 4096 ? 1 : 0.5;
    const gc = document.createElement('canvas');
    gc.width = WORLD_W * ts; gc.height = WORLD_H * ts;
    const gx = gc.getContext('2d');
    gx.imageSmoothingQuality = 'high';
    gx.drawImage(World.terrain, 0, 0, gc.width, gc.height);
    gx.globalCompositeOperation = 'overlay';
    gx.fillStyle = gx.createPattern(this.detailTile(), 'repeat');
    gx.fillRect(0, 0, gc.width, gc.height);
    gx.globalCompositeOperation = 'source-over';
    const tex = (this.terrTex = new THREE.CanvasTexture(gc));
    tex.anisotropy = Math.min(8, this.gl.capabilities.getMaxAnisotropy()); tex.generateMipmaps = true;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_W, WORLD_H), new THREE.MeshLambertMaterial({ map: tex }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(WORLD_W / 2, 0, WORLD_H / 2); ground.receiveShadow = true;
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_W * 4, WORLD_H * 4), new THREE.MeshBasicMaterial({ color: 0x0b0a10 }));
    skirt.rotation.x = -Math.PI / 2; skirt.position.set(WORLD_W / 2, -2, WORLD_H / 2);
    this.staticG.add(ground, skirt);
    // rocks: jittered low-poly boulders merged into one mesh
    const pos = [], col = [];
    const cLow = new THREE.Color('#3a3038'), cHigh = new THREE.Color('#b59a86'), c = new THREE.Color();
    const hash = (x, y, z, s) => { const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + s) * 43758.5453; return n - Math.floor(n); };
    for (const r of World.rocks) for (const b of r.blobs) {
      const g = new THREE.IcosahedronGeometry(1, 1), P = g.attributes.position.array;
      const hgt = b.r * (0.75 + hash(b.s, 1, 2, 3) * 0.6);
      for (let i = 0; i < P.length; i += 3) {
        const j = 0.8 + hash(Math.round(P[i] * 50), Math.round(P[i + 1] * 50), Math.round(P[i + 2] * 50), b.s) * 0.38;
        const y = P[i + 1] * j;
        const k = clamp(y * 0.5 + 0.5, 0, 1);
        c.copy(cLow).lerp(cHigh, k * k * (0.7 + hash(i, b.s, 3, 1) * 0.3));
        pos.push(r.x + b.x + P[i] * j * b.r, Math.max(-2, y * hgt + hgt * 0.15), r.y + b.y + P[i + 2] * j * b.r);
        col.push(c.r, c.g, c.b);
      }
      g.dispose();
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    rg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    rg.computeVertexNormals();
    const rocks = new THREE.Mesh(rg, M3.mat);
    rocks.castShadow = rocks.receiveShadow = true;
    this.staticG.add(rocks);
    // citadel foundations
    const parts = [];
    for (const s of World.sites) {
      parts.push(cyl(BASE_BLOCK_R - 4, BASE_BLOCK_R + 4, PAD_H, 14, '#3b3e49', s.x, PAD_H / 2, s.y));
      parts.push(cyl(SLOT_RING + 3, SLOT_RING + 3, 0.5, 28, '#2b2d36', s.x, PAD_H + 0.1, s.y), cyl(SLOT_RING - 3, SLOT_RING - 3, 0.6, 28, '#454852', s.x, PAD_H + 0.15, s.y));
      for (let i = 0; i < SLOTS; i++) { const p = World.slotPos(s, i); parts.push(cyl(33, 33, 0.9, 6, '#2b2d36', p.x, PAD_H + 0.3, p.y)); }
      for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; parts.push(box(10, 3, 5, '#e3b341', s.x + Math.cos(a) * (BASE_BLOCK_R - 12), PAD_H + 0.6, s.y + Math.sin(a) * (BASE_BLOCK_R - 12), 0, -a, 0)); }
    }
    const pads = new THREE.Mesh(M3.bake(parts), M3.mat);
    pads.receiveShadow = true; pads.castShadow = true;
    this.staticG.add(pads);
    // crystals (unlit, so they glow through the bloom pass) and loose stones
    const cp = [], pp = [];
    for (const k of World.crystals) {
      const n = 2 + ((k.r * 7) % 3 | 0);
      for (let i = 0; i < n; i++) {
        const a = k.r + i * 2.4, d = i ? 5 + ((k.r * (i + 3)) % 7) : 0, h = (7 + ((k.r * (i + 1)) % 9)) * k.s;
        cp.push(cyl(0.1, 2.4 * k.s, h, 5, i % 2 ? '#2fd0c0' : '#7ff5e6', k.x + Math.cos(a) * d, h / 2, k.y + Math.sin(a) * d, Math.sin(a) * 0.3, a, Math.cos(a) * 0.3));
      }
    }
    for (const k of World.pebbles) {
      pp.push({ g: new THREE.IcosahedronGeometry(k.s, 0), c: (k.r | 0) % 2 ? '#6d5c58' : '#4f444a', p: [k.x, k.s * 0.25, k.y], r: [k.r, k.r * 2, k.r * 3] });
    }
    const cm = new THREE.Mesh(M3.bake(cp), new THREE.MeshBasicMaterial({ vertexColors: true }));
    const pm = new THREE.Mesh(M3.bake(pp), M3.mat);
    pm.castShadow = pm.receiveShadow = true;
    this.staticG.add(cm, pm);
    // scorch decals
    for (const d of this.scorches) this.scene.remove(d);
    this.scorches = [];
    // crates
    this.crates = [];
    for (const cr of World.crates) {
      const m = M3.mesh('crate', () => [box(15, 12, 15, C_CRATE, 0, 6, 0), box(15.6, 3, 15.6, '#fff3c4', 0, 7, 0), box(4, 12.6, 15.8, '#7a5a22', 0, 6, 0)]);
      m.userData.shared = true;
      m.position.set(cr.x, 0, cr.y); this.staticG.add(m); this.crates.push([cr, m]);
    }
    // fog plane
    this.fogTex = new THREE.CanvasTexture(this.fogCv);
    this.fogTex.magFilter = this.fogTex.minFilter = THREE.LinearFilter; this.fogTex.generateMipmaps = false;
    const fog = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_W, WORLD_H), new THREE.MeshBasicMaterial({ map: this.fogTex, transparent: true, depthTest: false, depthWrite: false }));
    fog.rotation.x = -Math.PI / 2; fog.position.set(WORLD_W / 2, 1, WORLD_H / 2); fog.renderOrder = 5;
    this.fogMesh = fog; this.staticG.add(fog);
    // minimap backdrop
    const mc = document.createElement('canvas');
    mc.width = this.mm.width; mc.height = this.mm.height;
    const mx = mc.getContext('2d'), s = mc.width / WORLD_W;
    mx.drawImage(World.terrain, 0, 0, mc.width, mc.height);
    mx.fillStyle = '#6f6068';
    for (const r of World.rocks) for (const b of r.blobs) { mx.beginPath(); mx.arc((r.x + b.x) * s, (r.y + b.y) * s, b.r * s, 0, TAU); mx.fill(); }
    mx.fillStyle = '#3b3e49';
    for (const st of World.sites) { mx.beginPath(); mx.arc(st.x * s, st.y * s, BASE_BLOCK_R * s * 0.8, 0, TAU); mx.fill(); }
    this.mmBg = mc;
  },

  detailTile() {
    if (this._tile) return this._tile;
    const N = 512, c = document.createElement('canvas');
    c.width = c.height = N;
    const x = c.getContext('2d'), img = x.createImageData(N, N), d = img.data, rng = makeRng(99);
    const g = new Float32Array(N * N);
    // layered tileable grain
    for (const [cells, amp] of [[8, 0.35], [24, 0.3], [72, 0.22], [200, 0.16]]) {
      const lat = new Float32Array(cells * cells);
      for (let i = 0; i < lat.length; i++) lat[i] = rng();
      for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
        const fx = (px / N) * cells, fy = (py / N) * cells, x0 = fx | 0, y0 = fy | 0, x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
        let tx = fx - x0, ty = fy - y0; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
        const a = lat[y0 * cells + x0], b = lat[y0 * cells + x1], e = lat[y1 * cells + x0], f = lat[y1 * cells + x1];
        g[py * N + px] += (a + (b - a) * tx + (e - a + (a - b - e + f) * tx) * ty - 0.5) * amp;
      }
    }
    for (let i = 0; i < N * N; i++) {
      // fake relief: light the height field from the upper left
      const px = i % N, py = (i / N) | 0;
      const dx = g[py * N + ((px + 1) % N)] - g[py * N + ((px + N - 1) % N)], dy = g[((py + 1) % N) * N + px] - g[((py + N - 1) % N) * N + px];
      const v = clamp(128 + g[i] * 90 - (dx + dy) * 520 + (rng() - 0.5) * 22, 0, 255);
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    // cracks and small stones
    x.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      let px = rng() * N, py = rng() * N, a = rng() * TAU;
      x.strokeStyle = 'rgba(40,40,40,' + (0.25 + rng() * 0.3) + ')'; x.lineWidth = 0.6 + rng() * 1.2;
      x.beginPath(); x.moveTo(px, py);
      for (let s = 0; s < 9; s++) { a += (rng() - 0.5) * 1.3; px += Math.cos(a) * 9; py += Math.sin(a) * 9; x.lineTo(px, py); }
      x.stroke();
    }
    for (let i = 0; i < 260; i++) {
      const px = rng() * N, py = rng() * N, r = 0.8 + rng() * 2.6;
      x.fillStyle = 'rgba(60,60,60,0.5)'; x.beginPath(); x.arc(px + 1, py + 1.2, r, 0, TAU); x.fill();
      x.fillStyle = 'rgba(190,190,190,0.55)'; x.beginPath(); x.arc(px, py, r * 0.8, 0, TAU); x.fill();
    }
    return (this._tile = c);
  },

  addScorch(x, y, r) {
    if (!this.scene) return;
    let m;
    if (this.scorches.length >= 140) m = this.scorches.shift();
    else {
      m = new THREE.Mesh(this.scorchGeo, this.scorchMat);
      m.rotation.x = -Math.PI / 2; m.renderOrder = 1;
      this.scene.add(m);
    }
    m.position.set(x, 0.4 + this.scorches.length * 0.002, y); m.scale.setScalar(r * 2.3); m.rotation.z = Math.random() * TAU;
    this.scorches.push(m);
  },

  /* ---------- effect pools ---------- */
  initFx() {
    const dot = document.createElement('canvas'); dot.width = dot.height = 64;
    const dx = dot.getContext('2d'), gr = dx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    dx.fillStyle = gr; dx.fillRect(0, 0, 64, 64);
    const dotTex = new THREE.CanvasTexture(dot);
    this.scorchGeo = new THREE.PlaneGeometry(1, 1);
    this.scorchMat = new THREE.MeshBasicMaterial({ map: dotTex, color: 0x0a0808, transparent: true, opacity: 0.6, depthWrite: false });
    const mkPoints = (n, size, add) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
      const p = new THREE.Points(g, new THREE.PointsMaterial({ size, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, sizeAttenuation: true }));
      p.frustumCulled = false; p.renderOrder = 7; p.userData.n = n;
      this.scene.add(p);
      return p;
    };
    this.pGlow = mkPoints(700, 20, true);
    this.pSmoke = mkPoints(700, 34, false);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(500 * 6), 3));
    lg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(500 * 8), 4));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.lines.frustumCulled = false; this.lines.renderOrder = 7; this.scene.add(this.lines);
    const sg = new THREE.IcosahedronGeometry(1, 2);
    this.booms = [];
    for (let i = 0; i < 60; i++) {
      const m = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.visible = false; m.renderOrder = 6; this.scene.add(m); this.booms.push(m);
    }
    const bg = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    this.beams = [];
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ color: 0xffc090, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.visible = false; m.renderOrder = 6; this.scene.add(m); this.beams.push(m);
    }
    const pg = new THREE.BoxGeometry(9, 2.4, 2.4), sgeo = new THREE.IcosahedronGeometry(3.2, 0);
    const rm = new THREE.MeshBasicMaterial({ color: 0xf2f5fa }), sm = new THREE.MeshBasicMaterial({ color: 0xffe9a0 });
    this.projs = [];
    for (let i = 0; i < 80; i++) {
      const g = new THREE.Group(), a = new THREE.Mesh(pg, rm), b = new THREE.Mesh(sgeo, sm);
      g.add(a, b); g.visible = false; this.scene.add(g); this.projs.push({ g, a, b });
    }
  },

  drawFx() {
    const gp = this.pGlow.geometry.attributes, sp = this.pSmoke.geometry.attributes, lp = this.lines.geometry.attributes;
    let ng = 0, ns = 0, nl = 0, nb = 0, nbe = 0;
    const col = this._c || (this._c = new THREE.Color());
    const pt = (attr, n, x, h, y, c, a) => {
      attr.position.array[n * 3] = x; attr.position.array[n * 3 + 1] = h; attr.position.array[n * 3 + 2] = y;
      col.set(c);
      const o = n * 4; attr.color.array[o] = col.r; attr.color.array[o + 1] = col.g; attr.color.array[o + 2] = col.b; attr.color.array[o + 3] = a;
    };
    const boom = (x, h, y, r, c, a) => {
      if (nb >= this.booms.length) return;
      const m = this.booms[nb++]; m.visible = true; m.position.set(x, h, y); m.scale.setScalar(r); m.material.color.set(c); m.material.opacity = a;
    };
    for (const f of G.fx) {
      if (f.type === 'text' || f.type === 'ring') continue;
      if (!Fog.visibleAt(f.x, f.y)) continue;
      const k = f.t / f.life, h = f.h || 0;
      switch (f.type) {
        case 'tracer':
          if (nl < 500) {
            const P = lp.position.array, C = lp.color.array, o = nl * 6, q = nl * 8, k0 = k * 0.6;
            P[o] = lerp(f.x, f.x2, k0); P[o + 1] = lerp(f.h, f.h2, k0); P[o + 2] = lerp(f.y, f.y2, k0);
            P[o + 3] = f.x2; P[o + 4] = f.h2; P[o + 5] = f.y2;
            col.set(f.col);
            C[q] = C[q + 4] = col.r; C[q + 1] = C[q + 5] = col.g; C[q + 2] = C[q + 6] = col.b; C[q + 3] = (1 - k) * 0.5; C[q + 7] = 1 - k;
            nl++;
          }
          break;
        case 'flash': boom(f.x, h, f.y, f.r * (0.5 + k), '#ffe6a0', 1 - k); break;
        case 'boom': {
          const r = f.r * (0.3 + 0.7 * Math.sqrt(k));
          boom(f.x, h + r * 0.35, f.y, r * 0.75, k < 0.3 ? '#ffd27a' : '#ff7a2a', (1 - k) * 0.85);
          if (k < 0.45) boom(f.x, h + r * 0.35, f.y, r * 0.4, '#fff6d8', 1 - k * 2.2);
          break;
        }
        case 'puff':
          if (ns < 700) pt(sp, ns++, f.x, h + (f.rise || 14) * k + 6, f.y, f.dark ? '#2a282e' : f.dust ? '#a58a72' : '#d2cdc8', (1 - k) * (f.dark ? 0.55 : f.dust ? 0.3 : 0.4));
          break;
        case 'p':
          if (f.glow) { if (ng < 700) pt(gp, ng++, f.x, h + 10 + (f.up || 0) * k, f.y, f.col, 1 - k); }
          else if (ns < 700) pt(sp, ns++, f.x, h + 4 + Math.sin(k * Math.PI) * 26, f.y, f.col, 1 - k);
          break;
        case 'beam':
          if (nbe < this.beams.length) {
            const m = this.beams[nbe++]; m.visible = true;
            m.position.set(f.x, 700, f.y); m.scale.set(14 * (1 - k) + 1, 1400, 14 * (1 - k) + 1); m.material.opacity = 1 - k;
          }
          break;
      }
    }
    for (let i = nb; i < this.booms.length; i++) this.booms[i].visible = false;
    for (let i = nbe; i < this.beams.length; i++) this.beams[i].visible = false;
    this.pGlow.geometry.setDrawRange(0, ng); gp.position.needsUpdate = gp.color.needsUpdate = true;
    this.pSmoke.geometry.setDrawRange(0, ns); sp.position.needsUpdate = sp.color.needsUpdate = true;
    this.lines.geometry.setDrawRange(0, nl * 2); lp.position.needsUpdate = lp.color.needsUpdate = true;
    // projectiles
    let np = 0;
    for (const p of G.proj) {
      if (np >= this.projs.length) break;
      if (p.team !== 0 && !Fog.visibleAt(p.x, p.y)) continue;
      const o = this.projs[np++], k = clamp(p.t / Math.max(0.01, p.total), 0, 1);
      let h = lerp(p.h0, p.h1, k);
      if (p.lob && p.h0 < 40) h += Math.sin(k * Math.PI) * Math.min(160, p.total * 110);
      o.g.visible = true; o.g.position.set(p.x, h, p.y); o.g.rotation.y = -(p.dir || 0);
      o.a.visible = p.dtype === 'rocket'; o.b.visible = !o.a.visible;
      o.b.scale.setScalar(p.dtype === 'siege' ? 1.6 : 1);
    }
    for (let i = np; i < this.projs.length; i++) this.projs[i].g.visible = false;
  },

  /* ---------- frame ---------- */
  draw() {
    const now = performance.now(), dt = G.paused ? 0 : Math.min(0.1, (now - (this.lastT || now)) / 1000) * G.speed;
    this.lastT = now;
    this.frame++;
    this.updateCamera();
    const f = this.focus;
    this.sun.position.set(f.x - 700, 1500, f.y - 500);
    this.sun.target.position.set(f.x, 0, f.y);

    // entity views
    const stamp = this.frame;
    const sync = (e, make, visible) => {
      let v = this.views.get(e.id);
      if (!v) { v = make(e); this.views.set(e.id, v); this.dynG.add(v.root); }
      v.stamp = stamp;
      v.root.visible = visible;
      if (visible) v.update(e, dt);
    };
    for (const u of G.units) sync(u, makeUnitView, u.team === 0 || Fog.visibleAt(u.x, u.y));
    for (const b of G.blds) {
      sync(b, makeBldView, b.team === 0 || Fog.seenAt(b.x, b.y));
      if (b.hp < b.maxHp * 0.5 && !b.building && this.frame % 5 === 0 && G.fx.length < 700 && !G.paused) {
        G.fx.push({ type: 'puff', x: b.x + (Math.random() - 0.5) * b.radius, y: b.y + (Math.random() - 0.5) * b.radius, h: 24, rise: 60, t: 0, life: 1.1, r: 10, dark: true });
      }
    }
    for (const [id, v] of this.views) {
      if (v.stamp === stamp) continue;
      if (v.die && v.root.visible) { v.root.updateMatrixWorld(true); v.die(); }
      this.dynG.remove(v.root); this.views.delete(id);
    }
    this.updateCorpses(dt);
    for (const [cr, m] of this.crates) {
      m.visible = !cr.taken && Fog.seenAt(cr.x, cr.y);
      if (m.visible) { m.rotation.y = G.time * 0.8 + cr.x; m.position.y = 3 + Math.sin(G.time * 3 + cr.x) * 2; }
    }
    this.drawFx();
    this.fog();
    if (this.composer) this.composer.render(); else this.gl.render(this.scene, this.camera);
    this.overlay();
    if (this.frame % 3 === 0) this.minimap();
  },

  /* fallen units: play out a death animation where they fell, then sink away */
  addCorpse(a, o) {
    const h = a.holder;
    h.updateMatrixWorld(true);
    this.dynG.attach(h);
    this.corpses.push({ a, h, t: -(o.delay || 0), life: o.life, clip: o.clip, fall: o.fall, tumble: o.tumble, smoke: o.smoke, vy: 0, played: false, sm: 0 });
  },
  updateCorpses(dt) {
    for (const c of this.corpses) {
      c.t += dt;
      if (c.t < 0) { if (c.a.mixer) c.a.mixer.update(dt); continue; }
      if (c.clip && !c.played) { c.played = true; c.a.play(c.clip, true); }
      if (c.a.mixer) c.a.mixer.update(dt);
      if (c.fall && c.h.position.y > 2) {
        c.vy += 160 * dt; c.h.position.y = Math.max(2, c.h.position.y - c.vy * dt);
        if (c.tumble) { c.h.rotation.x += dt * 1.4; c.h.rotation.z += dt * 0.6; }
        if (c.h.position.y <= 2 && G.fx.length < 700) G.fx.push({ type: 'boom', x: c.h.position.x, y: c.h.position.z, h: 0, r: 34, t: 0, life: 0.45 });
      }
      if (c.smoke && (c.sm -= dt) <= 0 && G.fx.length < 700) {
        c.sm = 0.25;
        G.fx.push({ type: 'puff', x: c.h.position.x + (Math.random() - 0.5) * 14, y: c.h.position.z + (Math.random() - 0.5) * 14, h: c.h.position.y + 10, rise: 60, t: 0, life: 1.2, r: 10, dark: true });
      }
      if (c.t > c.life - 1.2) c.h.position.y -= dt * 14;
      c.h.visible = Fog.visibleAt(c.h.position.x, c.h.position.z);
      if (c.t >= c.life) { this.dynG.remove(c.h); c.dead = true; }
    }
    if (this.corpses.some((c) => c.dead)) this.corpses = this.corpses.filter((c) => !c.dead);
  },

  fog() {
    this.fogMesh.visible = Fog.enabled;
    if (!Fog.enabled) return;
    const px = this.fogImg.data, al = Fog.alpha;
    for (let i = 0; i < al.length; i++) {
      const target = Fog.vis[i] ? 0 : Fog.seen[i] ? 0.5 : 0.94;
      al[i] += (target - al[i]) * 0.12;
      const o = i * 4;
      px[o] = 6; px[o + 1] = 7; px[o + 2] = 14; px[o + 3] = al[i] * 255;
    }
    this.fogCtx.putImageData(this.fogImg, 0, 0);
    this.fogTex.needsUpdate = true;
  },

  /* ---------- 2D overlay ---------- */
  circle(ctx, x, y, r, h, n) {
    ctx.beginPath();
    n = n || 28;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU, p = this.toScreen(x + Math.cos(a) * r, y + Math.sin(a) * r, h);
      if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
    }
  },

  overlay() {
    const ctx = this.octx, sel = UI.sel;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.lineJoin = 'round';
    // commander power areas
    for (const e of G.effects) {
      if (e.team !== 0 && !Fog.visibleAt(e.x, e.y)) continue;
      const p = POWERS[e.type];
      if (e.type === 'strike') {
        const k = clamp(e.t / 1.3, 0, 1);
        ctx.strokeStyle = 'rgba(255,90,60,' + (0.55 + 0.4 * Math.sin(e.t * 20)) + ')'; ctx.lineWidth = 3;
        this.circle(ctx, e.x, e.y, p.radius * (1.3 - 0.3 * k), 1); ctx.stroke();
        ctx.fillStyle = 'rgba(255,60,40,0.12)'; this.circle(ctx, e.x, e.y, p.radius, 1); ctx.fill();
      } else {
        const fade = Math.min(1, (e.life - e.t) * 2);
        ctx.fillStyle = 'rgba(90,255,160,' + 0.12 * fade + ')'; this.circle(ctx, e.x, e.y, p.radius, 1); ctx.fill();
        ctx.strokeStyle = 'rgba(125,255,176,' + 0.85 * fade + ')'; ctx.lineWidth = 3; ctx.setLineDash([16, 10]); ctx.lineDashOffset = e.t * 40;
        ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // sites: unclaimed markers, empty pads, rally flag
    for (const s of World.sites) {
      if (!this.onScreen(s.x, s.y, 200)) continue;
      if (s.owner === -1) {
        if (!Fog.seenAt(s.x, s.y)) continue;
        ctx.strokeStyle = sel.site === s ? '#fff' : 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2.5;
        ctx.setLineDash([12, 9]); ctx.lineDashOffset = -G.time * 12;
        this.circle(ctx, s.x, s.y, 62, PAD_H); ctx.stroke(); ctx.setLineDash([]);
        const p = this.toScreen(s.x, s.y, PAD_H);
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('UNCLAIMED SITE', p.x, p.y + 4);
        continue;
      }
      if (s.owner !== 0) continue;
      if (s.citadel && !s.citadel.building) {
        for (let i = 0; i < SLOTS; i++) {
          if (s.slots[i]) continue;
          const q = World.slotPos(s, i), on = sel.site === s && sel.slot === i;
          ctx.fillStyle = on ? 'rgba(53,224,200,0.28)' : 'rgba(255,255,255,0.05)';
          ctx.strokeStyle = on ? '#b5fff4' : 'rgba(181,255,244,0.55)'; ctx.lineWidth = 2;
          ctx.setLineDash([6, 5]); this.circle(ctx, q.x, q.y, 28, PAD_H + 1, 6); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
          const p = this.toScreen(q.x, q.y, PAD_H + 1);
          ctx.beginPath(); ctx.moveTo(p.x - 7, p.y); ctx.lineTo(p.x + 7, p.y); ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x, p.y + 6); ctx.stroke();
        }
      }
      if ((sel.bld && sel.bld.site === s) || sel.site === s) {
        const a = this.toScreen(s.rally.x, s.rally.y, 0), b = this.toScreen(s.rally.x, s.rally.y, 38), c = this.toScreen(s.x, s.y, PAD_H);
        ctx.strokeStyle = 'rgba(181,255,244,0.5)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 6]);
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(a.x, a.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.fillStyle = '#35e0c8'; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + 15, b.y + 6); ctx.lineTo(b.x, b.y + 12); ctx.fill();
      }
    }
    // selection rings
    ctx.lineWidth = 2;
    for (const u of sel.units) {
      ctx.strokeStyle = TEAM_COL[0].light;
      this.circle(ctx, u.x, u.y, u.radius + 6, 1, 20); ctx.stroke();
      if (u.air) { const a = this.toScreen(u.x, u.y, 1), b = this.toScreen(u.x, u.y, AIR_H - 8); ctx.strokeStyle = 'rgba(181,255,244,0.35)'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    }
    if (sel.bld) {
      const b = sel.bld;
      ctx.strokeStyle = '#fff'; ctx.setLineDash([8, 6]); ctx.lineDashOffset = -G.time * 14;
      this.circle(ctx, b.x, b.y, b.radius + 8, PAD_H + 1); ctx.stroke(); ctx.setLineDash([]);
      if (b.d.range) { ctx.strokeStyle = 'rgba(255,255,255,0.22)'; this.circle(ctx, b.x, b.y, b.d.range + b.radius * 0, 1, 48); ctx.stroke(); }
    }
    // order markers and floating text
    for (const f of G.fx) {
      const k = f.t / f.life;
      if (f.type === 'ring') {
        ctx.strokeStyle = f.col; ctx.globalAlpha = 1 - k; ctx.lineWidth = 2.5;
        this.circle(ctx, f.x, f.y, 26 * (1 - k * 0.7), 1, 18); ctx.stroke();
      } else if (f.type === 'text') {
        const p = this.toScreen(f.x, f.y, 20 + k * 40);
        ctx.globalAlpha = 1 - k * k; ctx.fillStyle = '#ffe9a0'; ctx.font = '700 16px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(f.txt, p.x, p.y);
      }
      ctx.globalAlpha = 1;
    }
    // health / progress bars
    const bar = (x, y, w, f, col) => {
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 6);
      ctx.fillStyle = col; ctx.fillRect(x - w / 2, y, w * clamp(f, 0, 1), 4);
    };
    const hc = (f) => (f > 0.6 ? '#5df08a' : f > 0.3 ? '#ffd24a' : '#ff5a4a');
    const z = this.cam.z;
    for (const u of G.units) {
      if (!(u.selected || u.hp < u.maxHp)) continue;
      if (u.team !== 0 && !Fog.visibleAt(u.x, u.y)) continue;
      const p = this.toScreen(u.x, u.y, (u.air ? AIR_H + 22 : u.cls === 'inf' ? 26 : 34));
      if (!p.ok || p.x < -50 || p.y < -50 || p.x > this.W + 50 || p.y > this.H + 50) continue;
      bar(p.x, p.y - 4, Math.max(26, u.radius * 2 * z), u.hp / u.maxHp, hc(u.hp / u.maxHp));
    }
    for (const b of G.blds) {
      if (b.team !== 0 && !Fog.seenAt(b.x, b.y)) continue;
      const p = this.toScreen(b.x, b.y, PAD_H + (b.type === 'citadel' ? 110 : 56));
      if (!p.ok || p.x < -80 || p.y < -80 || p.x > this.W + 80 || p.y > this.H + 80) continue;
      const w = b.radius * 1.7 * z;
      if (b.hp < b.maxHp || sel.bld === b) bar(p.x, p.y, w, b.hp / b.maxHp, hc(b.hp / b.maxHp));
      if (b.team !== 0) continue;
      if (b.building) bar(p.x, p.y - 8, w, b.bt / b.d.time, '#6fc3ff');
      else if (b.queue.length) bar(p.x, p.y - 8, w, b.qt / UNITS[b.queue[0]].time, '#6fc3ff');
      else if (b.upT >= 0) bar(p.x, p.y - 8, w, b.upT / DEPOT_UP.time, '#ffe08a');
    }
    // power reticle
    if (UI.targeting) {
      const p = POWERS[UI.targeting], w = this.toWorld(UI.mouse.x, UI.mouse.y);
      ctx.strokeStyle = UI.targeting === 'strike' ? '#ff6a4a' : '#7dffb0'; ctx.lineWidth = 2.5;
      ctx.setLineDash([12, 8]); ctx.lineDashOffset = -G.time * 30;
      this.circle(ctx, w.x, w.y, p.radius, 1, 40); ctx.stroke(); ctx.setLineDash([]);
    }
    const d = UI.drag;
    if (d && d.box) {
      ctx.fillStyle = 'rgba(53,224,200,0.12)'; ctx.strokeStyle = '#b5fff4'; ctx.lineWidth = 1.2;
      ctx.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0); ctx.strokeRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
    }
  },

  minimap() {
    const ctx = this.mmCtx, w = this.mm.width, h = this.mm.height, s = w / WORLD_W;
    if (this.mmBg) ctx.drawImage(this.mmBg, 0, 0);
    for (const st of World.sites) {
      if (st.owner !== -1 || !Fog.seenAt(st.x, st.y)) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(st.x * s, st.y * s, 5, 0, TAU); ctx.stroke();
    }
    for (const b of G.blds) {
      if (b.team !== 0 && !Fog.seenAt(b.x, b.y)) continue;
      ctx.fillStyle = TEAM_COL[b.team].main;
      const r = b.type === 'citadel' ? 5 : 2.5;
      ctx.fillRect(b.x * s - r, b.y * s - r, r * 2, r * 2);
    }
    for (const u of G.units) {
      if (u.team !== 0 && !Fog.visibleAt(u.x, u.y)) continue;
      ctx.fillStyle = u.team === 0 ? (u.selected ? '#fff' : TEAM_COL[0].light) : TEAM_COL[1].main;
      ctx.fillRect(u.x * s - 1.5, u.y * s - 1.5, 3, 3);
    }
    if (Fog.enabled) { ctx.imageSmoothingEnabled = true; ctx.drawImage(this.fogCv, 0, 0, w, h); }
    for (const a of G.alerts) {
      const age = G.time - a.t;
      if (age > 6 || a.quiet) continue;
      ctx.strokeStyle = 'rgba(255,80,60,' + (1 - age / 6) + ')'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(a.x * s, a.y * s, 4 + (age * 14) % 14, 0, TAU); ctx.stroke();
    }
    // camera footprint (a trapezoid, because the view is in perspective)
    const cs = [[0, 0], [this.W, 0], [this.W, this.H], [0, this.H]].map(([x, y]) => this.toWorld(x, y));
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath();
    cs.forEach((c, i) => { if (i) ctx.lineTo(c.x * s, c.y * s); else ctx.moveTo(c.x * s, c.y * s); });
    ctx.closePath(); ctx.stroke(); ctx.restore();
  },
};
