'use strict';
/* Computer opponent. One controller per team (also drives the demo/autoplay mode). */

const AI_PLAN = ['depot', 'barracks', 'depot', 'reactor', 'foundry', 'depot', 'skyport', 'reactor', 'depot', 'turret', 'reactor', 'depot', 'turret', 'depot', 'depot', 'turret', 'depot', 'turret', 'depot', 'depot', 'turret'];

class AIController {
  constructor(team, diff) {
    this.team = team;
    this.foe = 1 - team;
    this.p = DIFFS[diff];
    this.t = 1 + Math.random();
    this.state = 'gather';
    this.threshold = this.p.first;
    this.launchPop = 0;
    this.lastAttack = 0;
    this.target = null;
  }

  update(dt) {
    this.t -= dt;
    if (this.t > 0 || G.over) return;
    this.t = this.p.think;
    const T = G.teams[this.team];
    const mySites = World.sites.filter((s) => s.owner === this.team && s.citadel);
    if (!mySites.length) return;
    this.construct(T, mySites);
    this.expand(T, mySites);
    this.trainUnits(T);
    this.command(T, mySites);
    this.powers(T);
  }

  construct(T, mySites) {
    const have = {};
    for (const b of G.blds) if (b.team === this.team) have[b.type] = (have[b.type] || 0) + 1;
    let want = null;
    const used = {};
    for (const type of AI_PLAN) {
      used[type] = (used[type] || 0) + 1;
      if ((have[type] || 0) < used[type]) { want = type; break; }
    }
    this.pending = 0;
    if (want) {
      const d = BUILDINGS[want];
      let spot = null;
      for (const s of mySites) {
        if (s.citadel.building) continue;
        const i = s.slots.indexOf(null);
        if (i >= 0) { spot = [s, i]; break; }
      }
      if (spot && T.tech >= d.tech) {
        if (T.supplies >= d.cost) build(this.team, spot[0], spot[1], want);
        else this.pending = d.cost;
      }
    }
    if (T.supplies > 450 + this.pending) {
      for (const b of G.blds) if (b.team === this.team && !canUpgradeDepot(this.team, b)) { upgradeDepot(this.team, b); break; }
    }
  }

  trainUnits(T) {
    const armyPop = T.pop + T.queued;
    if (this.pending && armyPop >= 6 && T.supplies < this.pending + 150) return;
    let inf = 0, veh = 0, air = 0, tur = 0, tot = 0;
    for (const u of G.units) if (u.team === this.foe) {
      tot += u.d.pop;
      if (u.cls === 'inf') inf += u.d.pop; else if (u.cls === 'veh') veh += u.d.pop; else air += u.d.pop;
    }
    for (const b of G.blds) if (b.team === this.foe && b.type === 'turret') tur++;
    tot = Math.max(1, tot);
    inf /= tot; veh /= tot; air /= tot;
    const w = {
      trooper: 2.5 + air * 3, scorcher: 1 + inf * 4, lancer: 1.5 + veh * 4.5, ranger: G.time < 240 ? 1.5 : 0.4,
      bastion: 3 + inf * 2, flakker: 0.3 + air * 8, thumper: 0.8 + tur * 0.9, kestrel: 2 + veh * 3.5, condor: 2.2,
    };
    const prod = G.blds.filter((b) => b.team === this.team && !b.building && b.d.trains && b.queue.length < 2);
    if (!prod.length) return;
    const opts = [];
    let sum = 0;
    for (const b of prod) for (const type of b.d.trains) {
      if (canTrain(this.team, b, type) && UNITS[type].tech > T.tech) continue;
      if (T.tech < UNITS[type].tech) continue;
      const ww = w[type] / (1 + b.queue.length);
      opts.push([b, type, ww]); sum += ww;
    }
    if (!opts.length) return;
    let r = Math.random() * sum;
    for (const o of opts) {
      r -= o[2];
      if (r <= 0) { train(this.team, o[0], o[1]); break; }
    }
  }

  expand(T, mySites) {
    const cap = G.time > 480 ? 3 : G.time > 140 ? 2 : 1;
    if (mySites.length >= cap) { this.releaseScouts(); return; }
    const home = mySites[0];
    let best = null, bd = 1e9;
    for (const s of World.sites) {
      if (s.owner !== -1) continue;
      const d = dist(s.x, s.y, home.x, home.y);
      if (d < bd) { bd = d; best = s; }
    }
    if (!best) return;
    this.pending = Math.max(this.pending, CITADEL_COST);
    if (T.supplies >= CITADEL_COST && !canEstablish(this.team, best)) { establish(this.team, best); this.releaseScouts(); return; }
    let scouts = G.units.filter((u) => u.team === this.team && u.role === 'scout');
    if (scouts.length < 2) {
      const cands = G.units.filter((u) => u.team === this.team && !u.role && !u.air)
        .sort((a, b) => dist(a.x, a.y, best.x, best.y) - dist(b.x, b.y, best.x, best.y));
      for (const u of cands.slice(0, 2 - scouts.length)) { u.role = 'scout'; scouts.push(u); }
    }
    for (const u of scouts) {
      if (dist(u.x, u.y, best.rally.x, best.rally.y) > 120 && (u.order.type === 'idle' || u.order.site !== best)) {
        orderMove(u, best.rally.x + (Math.random() - 0.5) * 60, best.rally.y + (Math.random() - 0.5) * 60, 'amove');
        u.order.site = best;
      }
    }
  }
  releaseScouts() { for (const u of G.units) if (u.team === this.team && u.role === 'scout') u.role = null; }

  nearestFoeBuilding(x, y) {
    let best = null, bd = 1e9;
    for (const b of G.blds) {
      if (b.team !== this.foe) continue;
      const d = dist(b.x, b.y, x, y) * (b.type === 'citadel' ? 0.8 : 1);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  command(T, mySites) {
    const army = G.units.filter((u) => u.team === this.team && !u.role);
    let pop = 0, cx = 0, cy = 0;
    for (const u of army) { pop += u.d.pop; cx += u.x; cy += u.y; }
    if (army.length) { cx /= army.length; cy /= army.length; }
    const home = mySites[0];

    // defend: answer any attack on our buildings
    let hurt = null;
    for (const b of G.blds) if (b.team === this.team && G.time - b.lastHit < 3) { hurt = b; break; }
    if (hurt) {
      for (const u of army) {
        if (u.tgt) continue;
        if (this.state === 'attack' && dist(u.x, u.y, hurt.x, hurt.y) > 1300) continue;
        if (u.order.type === 'idle' || (u.order.type === 'amove' && !u.order.def)) {
          orderMove(u, hurt.x + (Math.random() - 0.5) * 240, hurt.y + (Math.random() - 0.5) * 240, 'amove');
          u.order.def = true;
        }
      }
      if (this.state === 'gather') return;
    }

    if (this.state === 'gather') {
      const ready = G.time < this.p.minT ? false : pop >= Math.min(this.threshold, this.p.maxWave) || (G.time - this.lastAttack > 200 && pop >= 5) || T.pop >= POP_CAP - 3;
      if (ready && army.length) {
        const tb = this.nearestFoeBuilding(cx, cy);
        if (tb) {
          this.state = 'attack';
          this.target = tb;
          this.launchPop = pop;
          this.lastAttack = G.time;
          // stage up first so the wave arrives together
          for (const u of army) orderMove(u, tb.x + (Math.random() - 0.5) * 200, tb.y + (Math.random() - 0.5) * 200, 'amove');
        }
      } else {
        // keep idle troops loosely grouped at the forward rally
        const r = mySites[mySites.length - 1].rally;
        for (const u of army) {
          if (u.order.type === 'idle' && !u.tgt && dist(u.x, u.y, r.x, r.y) > 330 && dist(u.x, u.y, home.rally.x, home.rally.y) > 330) {
            orderMove(u, r.x + (Math.random() - 0.5) * 220, r.y + (Math.random() - 0.5) * 220, 'amove');
          }
        }
      }
    } else {
      if (!this.target || this.target.dead) this.target = this.nearestFoeBuilding(cx, cy);
      if (!this.target || pop < Math.max(2, this.launchPop * 0.3)) {
        this.state = 'gather';
        this.threshold = Math.min(this.p.maxWave, this.threshold + this.p.grow);
        const r = home.rally;
        for (const u of army) if (!u.tgt) orderMove(u, r.x + (Math.random() - 0.5) * 220, r.y + (Math.random() - 0.5) * 220, 'move');
        return;
      }
      const tb = this.target;
      for (const u of army) {
        if (u.order.type === 'idle' && !u.tgt) orderMove(u, tb.x + (Math.random() - 0.5) * 200, tb.y + (Math.random() - 0.5) * 200, 'amove');
      }
    }
  }

  powers(T) {
    if (!this.p.strike) return;
    if (!canPower(this.team, 'strike') && T.supplies > 750 && this.state === 'attack') {
      // hit the densest cluster of enemies near our army
      let best = null, bs = 2.5;
      for (const b of [...G.units, ...G.blds]) {
        if (b.team !== this.foe) continue;
        let near = false;
        for (const u of G.units) if (u.team === this.team && dist(u.x, u.y, b.x, b.y) < 450) { near = true; break; }
        if (!near) continue;
        let s = b.type === 'turret' ? 2 : b.kind === 'bld' ? 1 : 0;
        for (const o of G.units) if (o.team === this.foe && !o.air && dist(o.x, o.y, b.x, b.y) < 100) s += o.d.pop * 0.6;
        if (s > bs) { bs = s; best = b; }
      }
      if (best) castPower(this.team, 'strike', best.x, best.y);
    }
    if (!canPower(this.team, 'mend') && T.supplies > 600) {
      for (const u of G.units) {
        if (u.team !== this.team || u.hp > u.maxHp * 0.5 || u.d.pop < 2) continue;
        let n = 0;
        for (const o of G.units) if (o.team === this.team && o.hp < o.maxHp * 0.7 && dist(o.x, o.y, u.x, u.y) < 170) n++;
        if (n >= 3) { castPower(this.team, 'mend', u.x, u.y); break; }
      }
    }
  }
}
