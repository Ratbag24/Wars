'use strict';
/* Map generation, pathfinding and fog of war */

const World = {
  blocked: new Uint8Array(MW * MH),
  sites: [],
  rocks: [],
  crates: [],
  terrain: null, // offscreen canvas at half resolution
  seed: 1,

  cell(x, y) {
    const cx = clamp((x / CELL) | 0, 0, MW - 1);
    const cy = clamp((y / CELL) | 0, 0, MH - 1);
    return cy * MW + cx;
  },
  isBlocked(x, y) {
    if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return true;
    return this.blocked[this.cell(x, y)] === 1;
  },

  gen(seed) {
    const sitePos = [
      [540, 2340], [1420, 2470], [610, 1180], [1920, 1440],
    ];
    for (let attempt = 0; attempt < 30; attempt++) {
      const rng = makeRng(seed + attempt * 977);
      this.blocked.fill(0);
      this.rocks = [];
      this.sites = [];
      this.crates = [];
      const pts = [];
      sitePos.forEach((p, i) => {
        pts.push(p);
        if (i < 3) pts.push([WORLD_W - p[0], WORLD_H - p[1]]);
      });
      // order: 0 player main, 1 enemy main, then expansions
      const ordered = [pts[0], pts[1], pts[2], pts[3], pts[4], pts[5], pts[6]];
      for (const p of ordered) {
        const cx = WORLD_W / 2, cy = WORLD_H / 2;
        let a = Math.atan2(cy - p[1], cx - p[0]);
        if (dist(p[0], p[1], cx, cy) < 10) a = Math.PI / 2;
        this.sites.push({
          x: p[0], y: p[1], owner: -1, citadel: null, slots: new Array(SLOTS).fill(null),
          rally: { x: p[0] + Math.cos(a) * 250, y: p[1] + Math.sin(a) * 250 },
        });
      }
      // rocks, mirrored through the map centre
      let tries = 0;
      while (this.rocks.length < 46 && tries++ < 900) {
        const x = 120 + rng() * (WORLD_W - 240);
        const y = 120 + rng() * (WORLD_H - 240);
        if (x + y * 1.333 > WORLD_W + 40) continue; // generate one half only
        let ok = true;
        for (const s of this.sites) if (dist(x, y, s.x, s.y) < 420 || dist(x, y, s.rally.x, s.rally.y) < 230) ok = false;
        for (const r of this.rocks) if (dist(x, y, r.x, r.y) < 250) ok = false;
        if (!ok) continue;
        const blobs = [];
        const n = 2 + ((rng() * 4) | 0);
        const dir = rng() * TAU;
        for (let i = 0; i < n; i++) {
          const off = (i - (n - 1) / 2) * 58;
          blobs.push({
            x: Math.cos(dir) * off + (rng() - 0.5) * 40,
            y: Math.sin(dir) * off + (rng() - 0.5) * 40,
            r: 42 + rng() * 44, s: rng() * 1000,
          });
        }
        this.rocks.push({ x, y, blobs });
        this.rocks.push({
          x: WORLD_W - x, y: WORLD_H - y,
          blobs: blobs.map((b) => ({ x: -b.x, y: -b.y, r: b.r, s: b.s + 7 })),
        });
      }
      // rasterise blocking
      for (let cy = 0; cy < MH; cy++) {
        for (let cx = 0; cx < MW; cx++) {
          const x = cx * CELL + CELL / 2, y = cy * CELL + CELL / 2;
          let b = cx === 0 || cy === 0 || cx === MW - 1 || cy === MH - 1;
          if (!b) for (const s of this.sites) if (dist(x, y, s.x, s.y) < BASE_BLOCK_R) { b = true; break; }
          if (!b) {
            outer: for (const r of this.rocks) {
              if (Math.abs(x - r.x) > 330 || Math.abs(y - r.y) > 330) continue;
              for (const bl of r.blobs) if (dist(x, y, r.x + bl.x, r.y + bl.y) < bl.r + 8) { b = true; break outer; }
            }
          }
          this.blocked[cy * MW + cx] = b ? 1 : 0;
        }
      }
      // connectivity check between every site rally point
      let good = true;
      const a = this.sites[0].rally;
      for (let i = 1; i < this.sites.length && good; i++) {
        const r = this.sites[i].rally;
        if (!findPath(a.x, a.y, r.x, r.y, true)) good = false;
      }
      if (!good) continue;
      // salvage crates (mirrored)
      let ct = 0;
      while (this.crates.length < 20 && ct++ < 500) {
        const x = 150 + rng() * (WORLD_W - 300), y = 150 + rng() * (WORLD_H - 300);
        if (this.isBlocked(x, y)) continue;
        if (dist(x, y, this.sites[0].x, this.sites[0].y) < 500 || dist(x, y, this.sites[1].x, this.sites[1].y) < 500) continue;
        this.crates.push({ x, y, amt: 75 });
        this.crates.push({ x: WORLD_W - x, y: WORLD_H - y, amt: 75 });
      }
      this.seed = seed + attempt * 977;
      break;
    }
    this.paint();
  },

  slotPos(site, i) {
    const a = (i / SLOTS) * TAU - Math.PI / 2;
    return { x: site.x + Math.cos(a) * SLOT_RING, y: site.y + Math.sin(a) * SLOT_RING };
  },

  paint() {
    const S = 0.5;
    const w = WORLD_W * S, h = WORLD_H * S;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    const rng = makeRng(this.seed ^ 0x51ed);
    const L = 256;
    const lat = new Float32Array(L * L);
    for (let i = 0; i < lat.length; i++) lat[i] = rng();
    const noise = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      let fx = x - xi, fy = y - yi;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      const x0 = xi & 255, x1 = (xi + 1) & 255, y0 = (yi & 255) * L, y1 = ((yi + 1) & 255) * L;
      const a = lat[y0 + x0], b = lat[y0 + x1], c = lat[y1 + x0], d = lat[y1 + x1];
      return a + (b - a) * fx + (c - a + (a - b - c + d) * fx) * fy;
    };
    const img = ctx.createImageData(w, h);
    const px = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n1 = noise(x / 170, y / 170) * 0.55 + noise(x / 60, y / 60) * 0.28 + noise(x / 19, y / 19) * 0.17;
        const n2 = noise(x / 260 + 40, y / 260 + 40);
        const g = noise(x / 3.1, y / 3.1);
        // dusk badlands: ash-violet lowlands to rust dunes, teal mineral veins
        let r = lerp(46, 122, n1), gg = lerp(42, 86, n1), b = lerp(58, 66, n1);
        const vein = Math.abs(n2 - 0.5);
        if (vein < 0.035) { const k = 1 - vein / 0.035; r = lerp(r, 40, k * 0.6); gg = lerp(gg, 120, k * 0.6); b = lerp(b, 118, k * 0.6); }
        const ridge = Math.abs(noise(x / 90 + 9, y / 90 + 9) - 0.5);
        const sh = ridge < 0.03 ? 0.82 : 1;
        const k = (0.9 + g * 0.2) * sh;
        const i = (y * w + x) * 4;
        px[i] = r * k; px[i + 1] = gg * k; px[i + 2] = b * k; px[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    ctx.scale(S, S);
    // glowing crystal clusters grow along the mineral veins, loose stones everywhere else
    this.crystals = []; this.pebbles = [];
    for (let i = 0; i < 9000 && this.crystals.length < 170; i++) {
      const x = 60 + rng() * (WORLD_W - 120), y = 60 + rng() * (WORLD_H - 120);
      if (Math.abs(noise((x * S) / 260 + 40, (y * S) / 260 + 40) - 0.5) > 0.022) continue;
      if (this.sites.some((s) => dist(x, y, s.x, s.y) < BASE_BLOCK_R + 30)) continue;
      this.crystals.push({ x, y, s: 0.6 + rng() * 1.1, r: rng() * 1000 });
    }
    for (let i = 0; i < 700; i++) {
      const x = 40 + rng() * (WORLD_W - 80), y = 40 + rng() * (WORLD_H - 80);
      if (this.sites.some((s) => dist(x, y, s.x, s.y) < BASE_BLOCK_R + 10)) continue;
      this.pebbles.push({ x, y, s: 2 + rng() * rng() * 9, r: rng() * 1000 });
    }
    // craters / decoration
    for (let i = 0; i < 90; i++) {
      const x = rng() * WORLD_W, y = rng() * WORLD_H, r = 10 + rng() * 34;
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.7, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,220,180,0.10)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(x, y - 1, r, r * 0.7, 0, Math.PI, TAU); ctx.stroke();
    }
    // rocks: shadow pass, then bodies, then lit caps
    const poly = (cx, cy, r, s, squash) => {
      const rr = makeRng(s * 131 + 7);
      ctx.beginPath();
      const n = 11;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU, q = r * (0.82 + rr() * 0.26);
        const X = cx + Math.cos(a) * q, Y = cy + Math.sin(a) * q * squash;
        if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
      }
      ctx.closePath();
    };
    // soft contact shadow under each boulder and foundation (the 3D meshes sit on top)
    for (const r of this.rocks) for (const b of r.blobs) this.scorchOn(ctx, r.x + b.x, r.y + b.y, b.r * 1.35, 0.5);
    for (const s of this.sites) this.scorchOn(ctx, s.x, s.y, BASE_BLOCK_R * 1.25, 0.5);
    this.terrain = cv;
    this.tctx = ctx;
    return;
    // eslint-disable-next-line no-unreachable
    ctx.fillStyle = 'rgba(8,6,14,0.45)';
    for (const r of this.rocks) for (const b of r.blobs) { poly(r.x + b.x + 16, r.y + b.y + 22, b.r, b.s, 0.92); ctx.fill(); }
    for (const r of this.rocks) for (const b of r.blobs) {
      poly(r.x + b.x, r.y + b.y, b.r, b.s, 0.92); ctx.fillStyle = '#2b2530'; ctx.fill();
    }
    for (const r of this.rocks) for (const b of r.blobs) {
      poly(r.x + b.x - 4, r.y + b.y - 9, b.r * 0.84, b.s, 0.9); ctx.fillStyle = '#5a4d52'; ctx.fill();
    }
    for (const r of this.rocks) for (const b of r.blobs) {
      poly(r.x + b.x - 8, r.y + b.y - 16, b.r * 0.6, b.s + 3, 0.86); ctx.fillStyle = '#857069'; ctx.fill();
      poly(r.x + b.x - 12, r.y + b.y - 21, b.r * 0.34, b.s + 5, 0.84); ctx.fillStyle = '#a58c7c'; ctx.fill();
    }
    // foundation pads for every citadel site
    for (const s of this.sites) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.arc(s.x + 6, s.y + 10, BASE_BLOCK_R + 4, 0, TAU); ctx.fill();
      const g = ctx.createRadialGradient(s.x, s.y, 20, s.x, s.y, BASE_BLOCK_R);
      g.addColorStop(0, '#4a4d58'); g.addColorStop(1, '#30323c');
      ctx.fillStyle = g;
      ctx.beginPath();
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TAU + TAU / 28;
        const X = s.x + Math.cos(a) * BASE_BLOCK_R, Y = s.y + Math.sin(a) * BASE_BLOCK_R;
        if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#191a20'; ctx.lineWidth = 5; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 2;
      for (let i = 0; i < SLOTS; i++) {
        const p = this.slotPos(s, i);
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(s.x, s.y, SLOT_RING, 0, TAU); ctx.stroke();
    }
    this.terrain = cv;
    this.tctx = ctx;
  },

  scorch(x, y, r) {
    if (!this.tctx) return;
    Render.addScorch(x, y, r);
  },
  scorchOn(ctx, x, y, r, a) {
    const g = ctx.createRadialGradient(x, y, r * 0.15, x, y, r);
    g.addColorStop(0, 'rgba(8,6,6,' + a + ')'); g.addColorStop(1, 'rgba(8,6,6,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  },
};

/* ---------- pathfinding (A* on the cell grid, with string pulling) ---------- */
const PF = {
  g: new Float32Array(MW * MH),
  from: new Int32Array(MW * MH),
  stamp: new Uint32Array(MW * MH),
  closed: new Uint32Array(MW * MH),
  sid: 0,
};

function nearestFree(c) {
  if (!World.blocked[c]) return c;
  const cx = c % MW, cy = (c / MW) | 0;
  let best = -1, bd = 1e9;
  for (let r = 1; r < 16 && best < 0; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= MW || y >= MH) continue;
        const n = y * MW + x;
        if (World.blocked[n]) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = n; }
      }
    }
  }
  return best < 0 ? c : best;
}

function lineClear(ax, ay, bx, by) {
  const d = dist(ax, ay, bx, by);
  if (d < 1) return true;
  const n = Math.ceil(d / 12);
  const nx = (-(by - ay) / d) * 11, ny = ((bx - ax) / d) * 11;
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
    if (World.isBlocked(x, y) || World.isBlocked(x + nx, y + ny) || World.isBlocked(x - nx, y - ny)) return false;
  }
  return true;
}

function findPath(sx, sy, gx, gy, strict) {
  const B = World.blocked;
  let sc = World.cell(sx, sy), gc = World.cell(gx, gy);
  if (B[sc]) sc = nearestFree(sc);
  if (B[gc]) {
    gc = nearestFree(gc);
    gx = (gc % MW) * CELL + CELL / 2; gy = ((gc / MW) | 0) * CELL + CELL / 2;
  }
  if (sc === gc) return [{ x: gx, y: gy }];
  if (!strict && lineClear(sx, sy, gx, gy)) return [{ x: gx, y: gy }];
  const sid = ++PF.sid;
  const gX = gc % MW, gY = (gc / MW) | 0;
  const heap = [], hf = [];
  const push = (n, f) => {
    let i = heap.length; heap.push(n); hf.push(f);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hf[p] <= f) break;
      heap[i] = heap[p]; hf[i] = hf[p]; i = p;
    }
    heap[i] = n; hf[i] = f;
  };
  const pop = () => {
    const top = heap[0], n = heap.pop(), f = hf.pop();
    const len = heap.length;
    if (len) {
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= len) break;
        if (c + 1 < len && hf[c + 1] < hf[c]) c++;
        if (hf[c] >= f) break;
        heap[i] = heap[c]; hf[i] = hf[c]; i = c;
      }
      heap[i] = n; hf[i] = f;
    }
    return top;
  };
  const H = (c) => {
    const dx = Math.abs((c % MW) - gX), dy = Math.abs(((c / MW) | 0) - gY);
    return (dx + dy) + (1.4142 - 2) * Math.min(dx, dy);
  };
  PF.g[sc] = 0; PF.from[sc] = -1; PF.stamp[sc] = sid;
  push(sc, H(sc));
  let found = false;
  while (heap.length) {
    const c = pop();
    if (c === gc) { found = true; break; }
    if (PF.closed[c] === sid) continue;
    PF.closed[c] = sid;
    const cx = c % MW, cy = (c / MW) | 0, g0 = PF.g[c];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= MW || y >= MH) continue;
        const n = y * MW + x;
        if (B[n] || PF.closed[n] === sid) continue;
        if (dx && dy && (B[cy * MW + x] || B[y * MW + cx])) continue;
        const g = g0 + (dx && dy ? 1.4142 : 1);
        if (PF.stamp[n] !== sid || g < PF.g[n]) {
          PF.g[n] = g; PF.from[n] = c; PF.stamp[n] = sid;
          push(n, g + H(n) * 1.05);
        }
      }
    }
  }
  if (!found) return null;
  const pts = [];
  for (let c = gc; c !== -1; c = PF.from[c]) pts.push({ x: (c % MW) * CELL + CELL / 2, y: ((c / MW) | 0) * CELL + CELL / 2 });
  pts.reverse();
  pts[pts.length - 1] = { x: gx, y: gy };
  // string pulling
  const out = [];
  let ax = sx, ay = sy, i = 0;
  if (World.isBlocked(sx, sy)) { out.push(pts[0]); ax = pts[0].x; ay = pts[0].y; }
  while (i < pts.length) {
    let j = Math.min(pts.length - 1, i + 24);
    while (j > i && !lineClear(ax, ay, pts[j].x, pts[j].y)) j--;
    out.push(pts[j]);
    ax = pts[j].x; ay = pts[j].y;
    i = j + 1;
  }
  return out;
}

/* ---------- fog of war (player view) ---------- */
const FOG_CELL = 64;
const FW = WORLD_W / FOG_CELL;
const FH = WORLD_H / FOG_CELL;
const Fog = {
  vis: new Uint8Array(FW * FH),
  seen: new Uint8Array(FW * FH),
  alpha: new Float32Array(FW * FH).fill(1),
  enabled: true,
  reset() { this.vis.fill(0); this.seen.fill(0); this.alpha.fill(1); },
  reveal(x, y, r) {
    const x0 = Math.max(0, ((x - r) / FOG_CELL) | 0), x1 = Math.min(FW - 1, ((x + r) / FOG_CELL) | 0);
    const y0 = Math.max(0, ((y - r) / FOG_CELL) | 0), y1 = Math.min(FH - 1, ((y + r) / FOG_CELL) | 0);
    const r2 = r * r;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const dx = cx * FOG_CELL + 32 - x, dy = cy * FOG_CELL + 32 - y;
        if (dx * dx + dy * dy <= r2) { this.vis[cy * FW + cx] = 1; this.seen[cy * FW + cx] = 1; }
      }
    }
  },
  visibleAt(x, y) {
    if (!this.enabled) return true;
    const cx = clamp((x / FOG_CELL) | 0, 0, FW - 1), cy = clamp((y / FOG_CELL) | 0, 0, FH - 1);
    return this.vis[cy * FW + cx] === 1;
  },
  seenAt(x, y) {
    if (!this.enabled) return true;
    const cx = clamp((x / FOG_CELL) | 0, 0, FW - 1), cy = clamp((y / FOG_CELL) | 0, 0, FH - 1);
    return this.seen[cy * FW + cx] === 1;
  },
};
