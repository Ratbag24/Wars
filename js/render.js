'use strict';
/* Canvas renderer */

const Render = {
  cv: null, ctx: null, W: 0, H: 0, cam: { x: 0, y: 0, z: 1 },
  fogCv: null, fogCtx: null, fogImg: null, mm: null, mmCtx: null, mmBg: null, frame: 0,

  init() {
    this.cv = document.getElementById('c');
    this.ctx = this.cv.getContext('2d');
    this.fogCv = document.createElement('canvas');
    this.fogCv.width = FW; this.fogCv.height = FH;
    this.fogCtx = this.fogCv.getContext('2d');
    this.fogImg = this.fogCtx.createImageData(FW, FH);
    this.mm = document.getElementById('mm');
    this.mmCtx = this.mm.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  },
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.W = window.innerWidth; this.H = window.innerHeight;
    this.cv.width = this.W * dpr; this.cv.height = this.H * dpr;
    this.clampCam();
  },
  newMap() {
    const c = document.createElement('canvas');
    c.width = this.mm.width; c.height = this.mm.height;
    c.getContext('2d').drawImage(World.terrain, 0, 0, c.width, c.height);
    this.mmBg = c;
  },
  clampCam() {
    const c = this.cam;
    const minZ = Math.max(this.W / WORLD_W, this.H / WORLD_H, 0.45);
    c.z = clamp(c.z, minZ, 1.6);
    c.x = clamp(c.x, 0, Math.max(0, WORLD_W - this.W / c.z));
    c.y = clamp(c.y, 0, Math.max(0, WORLD_H - this.H / c.z));
  },
  centerOn(x, y) { this.cam.x = x - this.W / this.cam.z / 2; this.cam.y = y - this.H / this.cam.z / 2; this.clampCam(); },
  toWorld(sx, sy) { return { x: this.cam.x + sx / this.cam.z, y: this.cam.y + sy / this.cam.z }; },
  onScreen(x, y, m) {
    const c = this.cam;
    return x > c.x - m && y > c.y - m && x < c.x + this.W / c.z + m && y < c.y + this.H / c.z + m;
  },

  draw() {
    const ctx = this.ctx, c = this.cam, z = c.z * this.dpr;
    this.frame++;
    ctx.setTransform(z, 0, 0, z, -c.x * z, -c.y * z);
    ctx.imageSmoothingEnabled = true;
    const vw = this.W / c.z, vh = this.H / c.z;
    // terrain (source canvas is half resolution)
    const sx = Math.max(0, c.x), sy = Math.max(0, c.y);
    ctx.drawImage(World.terrain, sx / 2, sy / 2, vw / 2, vh / 2, sx, sy, vw, vh);

    for (const cr of World.crates) if (!cr.taken && this.onScreen(cr.x, cr.y, 30) && Fog.seenAt(cr.x, cr.y)) this.crate(ctx, cr);
    for (const s of World.sites) if (this.onScreen(s.x, s.y, 200)) this.site(ctx, s);
    for (const e of G.effects) this.effect(ctx, e);
    for (const b of G.blds) if (this.onScreen(b.x, b.y, 110) && (b.team === 0 || Fog.seenAt(b.x, b.y))) this.building(ctx, b);
    for (const u of G.units) if (!u.air && this.onScreen(u.x, u.y, 50) && (u.team === 0 || Fog.visibleAt(u.x, u.y))) this.unit(ctx, u);
    this.projectiles(ctx);
    this.fxLayer(ctx);
    for (const u of G.units) if (u.air && this.onScreen(u.x, u.y, 70) && (u.team === 0 || Fog.visibleAt(u.x, u.y))) this.unit(ctx, u);
    this.bars(ctx);
    this.fog(ctx);
    this.overlay(ctx);
    if (this.frame % 3 === 0) this.minimap();
  },

  crate(ctx, c) {
    const b = Math.sin(G.time * 3 + c.x) * 1.5;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(c.x + 2, c.y + 8, 12, 5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d9b25f'; ctx.strokeStyle = '#3b2c12'; ctx.lineWidth = 1.5;
    ctx.fillRect(c.x - 9, c.y - 9 + b, 18, 15); ctx.strokeRect(c.x - 9, c.y - 9 + b, 18, 15);
    ctx.fillStyle = '#fff3c4'; ctx.fillRect(c.x - 9, c.y - 3 + b, 18, 3);
    ctx.globalAlpha = 0.25 + 0.2 * Math.sin(G.time * 4 + c.y);
    ctx.strokeStyle = '#ffe9a0'; ctx.beginPath(); ctx.arc(c.x, c.y, 17, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  },

  hex(ctx, x, y, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + (rot || 0);
      if (i) ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
  },

  site(ctx, s) {
    const sel = UI.sel;
    if (s.owner === -1) {
      if (!Fog.seenAt(s.x, s.y)) return;
      ctx.strokeStyle = sel.site === s ? '#fff' : 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 3; ctx.setLineDash([14, 10]);
      ctx.lineDashOffset = -G.time * 12;
      ctx.beginPath(); ctx.arc(s.x, s.y, 60, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '600 13px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('UNCLAIMED SITE', s.x, s.y + 4);
      return;
    }
    if (s.owner === 0 && s.citadel && !s.citadel.building) {
      for (let i = 0; i < SLOTS; i++) {
        if (s.slots[i]) continue;
        const p = World.slotPos(s, i);
        const on = sel.site === s && sel.slot === i;
        ctx.fillStyle = on ? 'rgba(53,224,200,0.22)' : 'rgba(255,255,255,0.05)';
        ctx.strokeStyle = on ? '#b5fff4' : 'rgba(181,255,244,0.45)';
        ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
        this.hex(ctx, p.x, p.y, 27, 0); ctx.fill(); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(p.x - 7, p.y); ctx.lineTo(p.x + 7, p.y); ctx.moveTo(p.x, p.y - 7); ctx.lineTo(p.x, p.y + 7); ctx.stroke();
      }
    }
    if (s.owner === 0 && (sel.bld && sel.bld.site === s || sel.site === s)) {
      const r = s.rally;
      ctx.strokeStyle = 'rgba(181,255,244,0.5)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(r.x, r.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#35e0c8';
      ctx.beginPath(); ctx.moveTo(r.x, r.y - 22); ctx.lineTo(r.x + 14, r.y - 16); ctx.lineTo(r.x, r.y - 10); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x, r.y - 22); ctx.stroke();
    }
  },

  building(ctx, b) {
    const col = TEAM_COL[b.team], x = b.x, y = b.y, t = b.anim;
    const selected = UI.sel.bld === b;
    ctx.save();
    if (b.building) ctx.globalAlpha = 0.5 + 0.35 * (b.bt / b.d.time);
    if (b.type === 'citadel') {
      const oct = (r, rot) => {
        ctx.beginPath();
        for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + rot; if (i) ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
        ctx.closePath();
      };
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.arc(x + 6, y + 10, 70, 0, TAU); ctx.fill();
      oct(68, TAU / 16); ctx.fillStyle = '#2c3039'; ctx.fill(); ctx.strokeStyle = '#14161b'; ctx.lineWidth = 3; ctx.stroke();
      oct(56, TAU / 16); ctx.fillStyle = '#4b515d'; ctx.fill();
      oct(42, 0); ctx.fillStyle = '#626978'; ctx.fill(); ctx.strokeStyle = '#2c3039'; ctx.lineWidth = 2; ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + TAU / 8;
        const px = x + Math.cos(a) * 56, py = y + Math.sin(a) * 56;
        ctx.fillStyle = '#1e2127'; ctx.fillRect(px - 8, py - 8, 16, 16);
        ctx.fillStyle = col.main; ctx.globalAlpha *= 0.6 + 0.4 * Math.sin(t * 3 + i); ctx.fillRect(px - 4, py - 4, 8, 8);
        ctx.globalAlpha = b.building ? 0.5 + 0.35 * (b.bt / b.d.time) : 1;
      }
      ctx.strokeStyle = col.main; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(x, y, 30, 0, TAU); ctx.stroke();
      ctx.strokeStyle = col.light; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 30, 0, TAU); ctx.stroke();
      ctx.fillStyle = col.dark; ctx.beginPath(); ctx.arc(x, y, 20, 0, TAU); ctx.fill();
      ctx.strokeStyle = col.light; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(t * 1.2) * 19, y + Math.sin(t * 1.2) * 19); ctx.stroke();
      ctx.fillStyle = col.light; ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; this.hex(ctx, x + 4, y + 7, 31, 0); ctx.fill();
      this.hex(ctx, x, y, 30, 0); ctx.fillStyle = '#3f444f'; ctx.fill();
      ctx.strokeStyle = col.main; ctx.lineWidth = 2.5; ctx.stroke();
      this.hex(ctx, x, y, 24, 0); ctx.fillStyle = '#565c69'; ctx.fill();
      switch (b.type) {
        case 'depot': {
          const cr = b.level > 1 ? [[-10, -9], [3, -11], [-12, 4], [1, 2], [-5, -3]] : [[-10, -8], [2, -4], [-6, 4]];
          for (const [cx, cy] of cr) {
            ctx.fillStyle = '#c99f52'; ctx.fillRect(x + cx, y + cy, 11, 10);
            ctx.strokeStyle = '#4a3714'; ctx.lineWidth = 1; ctx.strokeRect(x + cx, y + cy, 11, 10);
            ctx.fillStyle = col.main; ctx.fillRect(x + cx, y + cy + 4, 11, 2);
          }
          if (b.level > 1) { ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 2; this.hex(ctx, x, y, 20, 0); ctx.stroke(); }
          break;
        }
        case 'reactor': {
          const p = 0.6 + 0.4 * Math.sin(t * 4);
          ctx.fillStyle = '#20232a'; ctx.beginPath(); ctx.arc(x, y, 17, 0, TAU); ctx.fill();
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = 'rgba(120,220,255,' + 0.25 * p + ')'; ctx.beginPath(); ctx.arc(x, y, 22, 0, TAU); ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = '#7fe3ff'; ctx.beginPath(); ctx.arc(x, y, 8 + p * 2.5, 0, TAU); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.fill();
          ctx.strokeStyle = col.main; ctx.lineWidth = 2;
          for (let i = 0; i < 3; i++) { const a = t * 0.8 + (i / 3) * TAU; ctx.beginPath(); ctx.arc(x, y, 14, a, a + 1.1); ctx.stroke(); }
          break;
        }
        case 'barracks':
          ctx.fillStyle = col.dark; ctx.fillRect(x - 17, y - 12, 34, 24);
          ctx.strokeStyle = '#14161b'; ctx.lineWidth = 1.5; ctx.strokeRect(x - 17, y - 12, 34, 24);
          ctx.strokeStyle = col.light; ctx.lineWidth = 2.5;
          for (let i = 0; i < 2; i++) { ctx.beginPath(); ctx.moveTo(x - 8, y - 3 + i * 7); ctx.lineTo(x, y - 8 + i * 7); ctx.lineTo(x + 8, y - 3 + i * 7); ctx.stroke(); }
          break;
        case 'foundry':
          ctx.fillStyle = '#2a2d35'; ctx.fillRect(x - 18, y - 15, 36, 30);
          ctx.fillStyle = col.dark; ctx.fillRect(x - 18, y - 15, 36, 7);
          ctx.strokeStyle = col.light; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(x, y + 3, 8, 0, TAU); ctx.stroke();
          for (let i = 0; i < 6; i++) { const a = t * (b.queue.length ? 2 : 0.3) + (i / 6) * TAU; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 8, y + 3 + Math.sin(a) * 8); ctx.lineTo(x + Math.cos(a) * 12, y + 3 + Math.sin(a) * 12); ctx.stroke(); }
          break;
        case 'skyport':
          ctx.fillStyle = '#23262d'; ctx.beginPath(); ctx.arc(x, y, 20, 0, TAU); ctx.fill();
          ctx.strokeStyle = col.main; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, 15, 0, TAU); ctx.stroke();
          ctx.strokeStyle = col.light; ctx.lineWidth = 2; ctx.beginPath();
          ctx.moveTo(x - 7, y - 7); ctx.lineTo(x + 7, y + 7); ctx.moveTo(x + 7, y - 7); ctx.lineTo(x - 7, y + 7); ctx.stroke();
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * TAU;
            ctx.fillStyle = (Math.floor(t * 3) + i) % 4 === 0 ? '#fff' : '#555';
            ctx.beginPath(); ctx.arc(x + Math.cos(a) * 20, y + Math.sin(a) * 20, 2.2, 0, TAU); ctx.fill();
          }
          break;
        case 'turret':
          ctx.fillStyle = '#23262d'; ctx.beginPath(); ctx.arc(x, y, 17, 0, TAU); ctx.fill();
          ctx.translate(x, y); ctx.rotate(b.aim);
          ctx.fillStyle = '#9aa2b1'; ctx.fillRect(4, -7, 22, 4); ctx.fillRect(4, 3, 22, 4);
          ctx.fillStyle = col.main; ctx.beginPath(); ctx.arc(0, 0, 11, 0, TAU); ctx.fill();
          ctx.fillStyle = col.dark; ctx.fillRect(-6, -6, 12, 12);
          break;
      }
    }
    ctx.restore();
    if (b.flash > 0) { ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.arc(x, y, b.radius, 0, TAU); ctx.fill(); }
    if (b.hp < b.maxHp * 0.5 && !b.building && this.frame % 4 === 0 && G.fx.length < 700 && !G.paused) {
      G.fx.push({ type: 'puff', x: x + (Math.random() - 0.5) * b.radius, y: y + (Math.random() - 0.5) * b.radius, t: 0, life: 0.8, r: 10, dark: true });
    }
    if (selected) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]); ctx.lineDashOffset = -G.time * 14;
      ctx.beginPath(); ctx.arc(x, y, b.radius + 6, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      if (b.d.range) { ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.arc(x, y, b.d.range, 0, TAU); ctx.stroke(); }
    }
  },

  unit(ctx, u) {
    const col = TEAM_COL[u.team], x = u.x, y = u.y, d = u.d;
    const sel = u.selected;
    if (sel) {
      ctx.strokeStyle = col.light; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.ellipse(x, y + (u.air ? 0 : 2), u.radius + 5, (u.radius + 5) * (u.air ? 1 : 0.8), 0, 0, TAU); ctx.stroke();
    }
    const fl = u.flash > 0;
    if (u.cls === 'inf') {
      const n = Math.max(1, Math.ceil((d.squad * u.hp) / u.maxHp));
      const offs = d.squad === 5 ? [[6, 0], [-3, -9], [-3, 9], [-11, -4], [-11, 5]] : [[6, 0], [-5, -8], [-5, 8]];
      const cs = Math.cos(u.dir), sn = Math.sin(u.dir);
      const ax = Math.cos(u.aim), ay = Math.sin(u.aim);
      for (let i = 0; i < n; i++) {
        const o = offs[i];
        const bob = u.moving ? Math.sin(u.anim * 13 + i * 2) * 1.3 : 0;
        const px = x + o[0] * cs - o[1] * sn, py = y + o[0] * sn + o[1] * cs + bob;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.ellipse(px + 1.5, py + 3.5, 5, 2.8, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = u.type === 'lancer' ? '#cfd6e2' : u.type === 'scorcher' ? '#ff9d3b' : '#1a1d22';
        ctx.lineWidth = u.type === 'lancer' ? 2.6 : 2;
        ctx.beginPath(); ctx.moveTo(px - ax * 2, py - ay * 2); ctx.lineTo(px + ax * (u.type === 'lancer' ? 10 : 8), py + ay * (u.type === 'lancer' ? 10 : 8)); ctx.stroke();
        ctx.fillStyle = fl ? '#fff' : col.main; ctx.strokeStyle = '#0c0f12'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(px, py, 4.6, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = u.type === 'scorcher' ? '#5a2a10' : col.dark;
        ctx.beginPath(); ctx.arc(px + ax * 0.8, py + ay * 0.8, 2.6, 0, TAU); ctx.fill();
      }
      return;
    }
    if (u.air) {
      // ground shadow
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath(); ctx.ellipse(x + 20, y + 34, u.radius * 0.95, u.radius * 0.55, 0, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(x + 3, y + 5, u.radius * 1.05, u.radius * 0.8, 0, 0, TAU); ctx.fill();
    }
    ctx.save();
    ctx.translate(x, y + (u.air ? Math.sin(u.anim * 2.2) * 2 : 0));
    ctx.rotate(u.dir);
    const hull = fl ? '#fff' : '#39404a';
    const turret = (fn) => { ctx.save(); ctx.rotate(u.aim - u.dir); fn(); ctx.restore(); };
    const tracks = (l, w, off) => {
      ctx.fillStyle = '#17191d';
      ctx.fillRect(-l / 2, -off - w, l, w); ctx.fillRect(-l / 2, off, l, w);
      ctx.fillStyle = '#2b2e35';
      const ph = u.moving ? (u.anim * 30) % 6 : 0;
      for (let i = -l / 2 + ph; i < l / 2 - 1; i += 6) { ctx.fillRect(i, -off - w, 2, w); ctx.fillRect(i, off, 2, w); }
    };
    switch (u.type) {
      case 'ranger':
        ctx.fillStyle = '#15171a';
        ctx.fillRect(-13, -11, 8, 5); ctx.fillRect(6, -11, 8, 5); ctx.fillRect(-13, 6, 8, 5); ctx.fillRect(6, 6, 8, 5);
        ctx.fillStyle = hull; ctx.fillRect(-14, -7, 28, 14);
        ctx.fillStyle = col.main; ctx.fillRect(-14, -7, 9, 14); ctx.fillRect(8, -5, 5, 10);
        ctx.strokeStyle = '#0c0f12'; ctx.lineWidth = 1.2; ctx.strokeRect(-14, -7, 28, 14);
        turret(() => { ctx.fillStyle = '#c3cad6'; ctx.fillRect(0, -1.5, 13, 3); ctx.fillStyle = col.dark; ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, TAU); ctx.fill(); });
        break;
      case 'bastion':
        tracks(44, 7, 9);
        ctx.fillStyle = hull; ctx.fillRect(-20, -11, 40, 22);
        ctx.fillStyle = col.dark; ctx.fillRect(-20, -11, 40, 4); ctx.fillRect(-20, 7, 40, 4);
        ctx.strokeStyle = '#0c0f12'; ctx.lineWidth = 1.2; ctx.strokeRect(-20, -11, 40, 22);
        turret(() => {
          ctx.fillStyle = '#aeb6c4'; ctx.fillRect(6, -2.5, 24, 5);
          ctx.fillStyle = col.main; ctx.beginPath(); ctx.moveTo(-10, -8); ctx.lineTo(7, -8); ctx.lineTo(11, 0); ctx.lineTo(7, 8); ctx.lineTo(-10, 8); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = '#0c0f12'; ctx.stroke();
          ctx.fillStyle = col.dark; ctx.fillRect(-6, -3, 6, 6);
        });
        break;
      case 'flakker':
        tracks(36, 6, 8);
        ctx.fillStyle = hull; ctx.fillRect(-17, -10, 34, 20);
        ctx.strokeStyle = '#0c0f12'; ctx.lineWidth = 1.2; ctx.strokeRect(-17, -10, 34, 20);
        turret(() => {
          ctx.fillStyle = '#c3cad6'; ctx.fillRect(4, -6, 18, 2.5); ctx.fillRect(4, 3.5, 18, 2.5); ctx.fillRect(4, -1.2, 14, 2.4);
          ctx.fillStyle = col.main; ctx.fillRect(-8, -8, 15, 16);
          ctx.strokeStyle = '#0c0f12'; ctx.strokeRect(-8, -8, 15, 16);
          ctx.fillStyle = col.light; ctx.fillRect(-5, -2, 4, 4);
        });
        break;
      case 'thumper':
        tracks(42, 6, 9);
        ctx.fillStyle = hull; ctx.fillRect(-20, -10, 40, 20);
        ctx.fillStyle = col.main; ctx.fillRect(-20, -10, 10, 20);
        ctx.strokeStyle = '#0c0f12'; ctx.lineWidth = 1.2; ctx.strokeRect(-20, -10, 40, 20);
        turret(() => {
          ctx.fillStyle = '#22252b'; ctx.fillRect(-4, -5.5, 28, 11);
          ctx.fillStyle = '#8c94a3'; ctx.fillRect(20, -6.5, 5, 13);
          ctx.fillStyle = col.dark; ctx.beginPath(); ctx.arc(-2, 0, 7.5, 0, TAU); ctx.fill();
        });
        break;
      case 'kestrel':
        ctx.strokeStyle = '#2b2f37'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(-21, 0); ctx.stroke();
        ctx.fillStyle = col.dark; ctx.fillRect(-23, -5, 4, 10);
        ctx.fillStyle = '#2b2f37'; ctx.fillRect(-3, -14, 8, 28);
        ctx.fillStyle = fl ? '#fff' : col.main; ctx.beginPath(); ctx.ellipse(2, 0, 15, 6, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#0c0f12'; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.fillStyle = '#0f2a33'; ctx.beginPath(); ctx.ellipse(9, 0, 5, 3.4, 0, 0, TAU); ctx.fill();
        for (const s of [-14, 14]) {
          ctx.fillStyle = 'rgba(220,235,255,0.22)'; ctx.beginPath(); ctx.arc(1, s, 10, 0, TAU); ctx.fill();
          ctx.strokeStyle = 'rgba(240,248,255,0.7)'; ctx.lineWidth = 1.5;
          const a = u.anim * 38 * (s > 0 ? 1 : -1);
          ctx.beginPath(); ctx.moveTo(1 + Math.cos(a) * 10, s + Math.sin(a) * 10); ctx.lineTo(1 - Math.cos(a) * 10, s - Math.sin(a) * 10); ctx.stroke();
        }
        break;
      case 'condor':
        ctx.fillStyle = hull; ctx.beginPath();
        ctx.moveTo(8, -6); ctx.lineTo(-6, -30); ctx.lineTo(-16, -30); ctx.lineTo(-12, -6); ctx.lineTo(-12, 6); ctx.lineTo(-16, 30); ctx.lineTo(-6, 30); ctx.lineTo(8, 6); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#0c0f12'; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.fillStyle = fl ? '#fff' : col.main; ctx.beginPath(); ctx.ellipse(0, 0, 26, 8.5, 0, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = col.dark; ctx.fillRect(-12, -3, 18, 6);
        ctx.fillStyle = '#0f2a33'; ctx.beginPath(); ctx.ellipse(16, 0, 6, 4, 0, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
        for (const s of [-24, -14, 14, 24]) {
          ctx.fillStyle = 'rgba(120,210,255,' + (0.5 + 0.3 * Math.sin(u.anim * 20 + s)) + ')';
          ctx.beginPath(); ctx.ellipse(-17, s, 5, 2.6, 0, 0, TAU); ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
        break;
    }
    ctx.restore();
  },

  bars(ctx) {
    const bar = (x, y, w, f, col) => {
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 6);
      ctx.fillStyle = col; ctx.fillRect(x - w / 2, y, w * clamp(f, 0, 1), 4);
    };
    const hc = (f) => (f > 0.6 ? '#5df08a' : f > 0.3 ? '#ffd24a' : '#ff5a4a');
    for (const u of G.units) {
      if (!this.onScreen(u.x, u.y, 40)) continue;
      if (u.team !== 0 && !Fog.visibleAt(u.x, u.y)) continue;
      if (u.selected || u.hp < u.maxHp) bar(u.x, u.y - u.radius - 12, Math.max(22, u.radius * 1.8), u.hp / u.maxHp, hc(u.hp / u.maxHp));
    }
    for (const b of G.blds) {
      if (!this.onScreen(b.x, b.y, 90)) continue;
      if (b.team !== 0 && !Fog.seenAt(b.x, b.y)) continue;
      const top = b.y - b.radius - 14;
      if (b.hp < b.maxHp || UI.sel.bld === b) bar(b.x, top, b.radius * 1.6, b.hp / b.maxHp, hc(b.hp / b.maxHp));
      if (b.team !== 0) continue;
      if (b.building) bar(b.x, top - 8, b.radius * 1.6, b.bt / b.d.time, '#6fc3ff');
      else if (b.queue.length) bar(b.x, top - 8, b.radius * 1.6, b.qt / UNITS[b.queue[0]].time, '#6fc3ff');
      else if (b.upT >= 0) bar(b.x, top - 8, b.radius * 1.6, b.upT / DEPOT_UP.time, '#ffe08a');
    }
  },

  projectiles(ctx) {
    for (const p of G.proj) {
      if (!this.onScreen(p.x, p.y, 80)) continue;
      if (p.team !== 0 && !Fog.visibleAt(p.x, p.y)) continue;
      let y = p.y;
      if (p.lob) {
        const k = clamp(p.t / Math.max(0.01, p.total), 0, 1);
        y -= Math.sin(k * Math.PI) * Math.min(90, p.total * 70);
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(p.x, p.y, 4, 2.5, 0, 0, TAU); ctx.fill();
      }
      if (p.dtype === 'rocket') {
        ctx.save(); ctx.translate(p.x, y); ctx.rotate(p.dir || 0);
        ctx.fillStyle = '#e8edf5'; ctx.fillRect(-5, -1.5, 9, 3);
        ctx.fillStyle = '#ffb347'; ctx.fillRect(-9, -1, 4, 2);
        ctx.restore();
      } else {
        ctx.fillStyle = p.dtype === 'siege' ? '#ffcf70' : '#fff2c0';
        ctx.beginPath(); ctx.arc(p.x, y, p.dtype === 'siege' ? 4.5 : 3, 0, TAU); ctx.fill();
        if (!p.lob) {
          ctx.strokeStyle = 'rgba(255,230,160,0.6)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(p.x, y); ctx.lineTo(p.x - Math.cos(p.dir || 0) * 14, y - Math.sin(p.dir || 0) * 14); ctx.stroke();
        }
      }
    }
  },

  fxLayer(ctx) {
    for (const f of G.fx) {
      if (!this.onScreen(f.x, f.y, 120)) continue;
      if (f.type !== 'text' && f.type !== 'ring' && !Fog.visibleAt(f.x, f.y)) continue;
      const k = f.t / f.life;
      switch (f.type) {
        case 'tracer':
          ctx.strokeStyle = f.col; ctx.globalAlpha = 1 - k; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(lerp(f.x, f.x2, k * 0.5), lerp(f.y, f.y2, k * 0.5)); ctx.lineTo(f.x2, f.y2); ctx.stroke();
          break;
        case 'flash':
          ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(255,225,150,' + (1 - k) + ')';
          ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.6 + k), 0, TAU); ctx.fill();
          break;
        case 'boom': {
          ctx.globalCompositeOperation = 'lighter';
          const r = f.r * (0.35 + 0.65 * Math.sqrt(k));
          ctx.fillStyle = 'rgba(255,' + ((200 - 120 * k) | 0) + ',' + ((90 - 80 * k) | 0) + ',' + (1 - k) * 0.85 + ')';
          ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, TAU); ctx.fill();
          ctx.fillStyle = 'rgba(255,250,220,' + Math.max(0, 1 - k * 2.2) + ')';
          ctx.beginPath(); ctx.arc(f.x, f.y, r * 0.55, 0, TAU); ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = 'rgba(255,230,190,' + (1 - k) * 0.5 + ')'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.5 + k * 0.9), 0, TAU); ctx.stroke();
          break;
        }
        case 'puff':
          ctx.fillStyle = f.dark ? 'rgba(30,28,32,' + (1 - k) * 0.5 + ')' : 'rgba(210,205,200,' + (1 - k) * 0.4 + ')';
          ctx.beginPath(); ctx.arc(f.x, f.y - (f.dark ? k * 26 : 0), f.r * (0.6 + k), 0, TAU); ctx.fill();
          break;
        case 'p':
          if (f.glow) ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 1 - k; ctx.fillStyle = f.col;
          ctx.beginPath(); ctx.arc(f.x, f.y, f.size * (f.glow ? 0.6 + k : 1 - k * 0.5), 0, TAU); ctx.fill();
          break;
        case 'text':
          ctx.globalAlpha = 1 - k * k; ctx.fillStyle = '#ffe9a0'; ctx.font = '700 16px system-ui, sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(f.txt, f.x, f.y - 14 - k * 30);
          break;
        case 'ring':
          ctx.strokeStyle = f.col; ctx.globalAlpha = 1 - k; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.ellipse(f.x, f.y, 22 * (1 - k * 0.7), 15 * (1 - k * 0.7), 0, 0, TAU); ctx.stroke();
          break;
        case 'beam':
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = 'rgba(255,180,120,' + (1 - k) + ')'; ctx.lineWidth = 16 * (1 - k);
          ctx.beginPath(); ctx.moveTo(f.x + 160, f.y - 1400); ctx.lineTo(f.x, f.y); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,255,255,' + (1 - k) + ')'; ctx.lineWidth = 5 * (1 - k);
          ctx.beginPath(); ctx.moveTo(f.x + 160, f.y - 1400); ctx.lineTo(f.x, f.y); ctx.stroke();
          break;
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  },

  effect(ctx, e) {
    if (e.team !== 0 && !Fog.visibleAt(e.x, e.y)) return;
    const p = POWERS[e.type];
    if (e.type === 'strike') {
      const k = clamp(e.t / 1.3, 0, 1);
      ctx.strokeStyle = 'rgba(255,90,60,' + (0.5 + 0.4 * Math.sin(e.t * 20)) + ')'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(e.x, e.y, p.radius * (1.3 - 0.3 * k), 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(e.x, e.y, p.radius * 0.4 * (1 - k) + 6, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255,60,40,0.10)'; ctx.beginPath(); ctx.arc(e.x, e.y, p.radius, 0, TAU); ctx.fill();
    } else {
      const fade = Math.min(1, (e.life - e.t) * 2);
      ctx.fillStyle = 'rgba(90,255,160,' + 0.10 * fade + ')'; ctx.beginPath(); ctx.arc(e.x, e.y, p.radius, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(125,255,176,' + 0.8 * fade + ')'; ctx.lineWidth = 3; ctx.setLineDash([18, 12]); ctx.lineDashOffset = e.t * 40;
      ctx.beginPath(); ctx.arc(e.x, e.y, p.radius, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
  },

  fog(ctx) {
    if (!Fog.enabled) return;
    const px = this.fogImg.data, al = Fog.alpha;
    for (let i = 0; i < al.length; i++) {
      const target = Fog.vis[i] ? 0 : Fog.seen[i] ? 0.5 : 0.93;
      al[i] += (target - al[i]) * 0.12;
      const o = i * 4;
      px[o] = 6; px[o + 1] = 7; px[o + 2] = 14; px[o + 3] = al[i] * 255;
    }
    this.fogCtx.putImageData(this.fogImg, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.fogCv, 0, 0, WORLD_W, WORLD_H);
  },

  overlay(ctx) {
    // power targeting reticle
    if (UI.targeting) {
      const p = POWERS[UI.targeting], w = this.toWorld(UI.mouse.x, UI.mouse.y);
      ctx.strokeStyle = UI.targeting === 'strike' ? '#ff6a4a' : '#7dffb0'; ctx.lineWidth = 2.5;
      ctx.setLineDash([12, 8]); ctx.lineDashOffset = -G.time * 30;
      ctx.beginPath(); ctx.arc(w.x, w.y, p.radius, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(w.x - 12, w.y); ctx.lineTo(w.x + 12, w.y); ctx.moveTo(w.x, w.y - 12); ctx.lineTo(w.x, w.y + 12); ctx.stroke();
    }
    // screen space
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const d = UI.drag;
    if (d && d.box) {
      ctx.fillStyle = 'rgba(53,224,200,0.12)'; ctx.strokeStyle = '#b5fff4'; ctx.lineWidth = 1.2;
      ctx.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0); ctx.strokeRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
    }
    // vignette
    const g = ctx.createRadialGradient(this.W / 2, this.H / 2, this.H * 0.45, this.W / 2, this.H / 2, this.H * 0.95);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);
  },

  minimap() {
    const ctx = this.mmCtx, w = this.mm.width, h = this.mm.height, s = w / WORLD_W;
    if (this.mmBg) ctx.drawImage(this.mmBg, 0, 0);
    for (const st of World.sites) {
      if (st.owner !== -1 || !Fog.seenAt(st.x, st.y)) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1;
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
    if (Fog.enabled) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.fogCv, 0, 0, w, h);
    }
    for (const a of G.alerts) {
      const age = G.time - a.t;
      if (age > 6 || a.quiet) continue;
      ctx.strokeStyle = 'rgba(255,80,60,' + (1 - age / 6) + ')'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(a.x * s, a.y * s, 4 + (age * 14) % 14, 0, TAU); ctx.stroke();
    }
    const c = this.cam;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.strokeRect(c.x * s, c.y * s, (this.W / c.z) * s, (this.H / c.z) * s);
  },
};
