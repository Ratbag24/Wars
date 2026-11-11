'use strict';
/* Ashline Command — core constants, helpers and game data */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
function turnToward(a, b, max) {
  const d = angDiff(a, b);
  return Math.abs(d) <= max ? b : a + Math.sign(d) * max;
}

const CELL = 32;
const MW = 120;
const MH = 90;
const WORLD_W = MW * CELL;
const WORLD_H = MH * CELL;

const SLOTS = 7;
const SLOT_RING = 112;
const BASE_BLOCK_R = 158;
const POP_CAP = 40;
const MAX_TECH = 3;
const CITADEL_COST = 400;
const AIR_H = 70;
const hOf = (e) => (e.air ? AIR_H : e.kind === 'bld' ? (e.type === 'citadel' ? 62 : 30) : e.cls === 'inf' ? 13 : 20);

const TEAM_COL = [
  { main: '#35e0c8', dark: '#12665c', light: '#b5fff4', name: 'Vanguard Accord' },
  { main: '#ff7043', dark: '#7a2a12', light: '#ffd2c2', name: 'Sable Dominion' },
];

/* damage type -> multiplier per target class (0 = cannot target) */
const MULT = {
  bullet: { inf: 1.0, veh: 0.45, air: 0.9, bld: 0.3 },
  flame: { inf: 2.1, veh: 0.4, air: 0, bld: 1.3 },
  rocket: { inf: 0.4, veh: 1.9, air: 0.7, bld: 1.0 },
  shell: { inf: 0.7, veh: 1.25, air: 0, bld: 1.0 },
  flak: { inf: 0.5, veh: 0.35, air: 2.3, bld: 0.2 },
  siege: { inf: 0.6, veh: 0.8, air: 0, bld: 2.6 },
  turret: { inf: 1.0, veh: 0.9, air: 1.1, bld: 0 },
  orbital: { inf: 1.0, veh: 1.0, air: 0.6, bld: 1.4 },
};

const UNITS = {
  trooper: {
    name: 'Troopers', cls: 'inf', from: 'barracks', cost: 100, pop: 1, time: 9, tech: 0,
    hp: 330, speed: 72, range: 155, dmg: 8, rof: 0.3, dtype: 'bullet', squad: 5, radius: 15, sight: 330,
    desc: 'Rifle squad. Cheap all-rounders, decent against aircraft.',
  },
  scorcher: {
    name: 'Scorchers', cls: 'inf', from: 'barracks', cost: 150, pop: 1, time: 11, tech: 1,
    hp: 400, speed: 76, range: 112, dmg: 7, rof: 0.15, dtype: 'flame', squad: 3, radius: 14, sight: 300,
    desc: 'Flame squad. Burns infantry and structures at close range.',
  },
  lancer: {
    name: 'Lancers', cls: 'inf', from: 'barracks', cost: 175, pop: 1, time: 12, tech: 1,
    hp: 300, speed: 66, range: 200, dmg: 58, rof: 1.6, dtype: 'rocket', squad: 3, radius: 14, sight: 340,
    desc: 'Rocket squad. Hard counter to vehicles.',
  },
  ranger: {
    name: 'Ranger', cls: 'veh', from: 'foundry', cost: 150, pop: 1, time: 10, tech: 0,
    hp: 440, speed: 158, range: 165, dmg: 9, rof: 0.28, dtype: 'bullet', radius: 16, sight: 420,
    desc: 'Fast scout buggy. Great for raids and grabbing salvage.',
  },
  bastion: {
    name: 'Bastion', cls: 'veh', from: 'foundry', cost: 350, pop: 3, time: 18, tech: 1,
    hp: 1350, speed: 62, range: 205, dmg: 115, rof: 2.0, dtype: 'shell', aoe: 26, radius: 22, sight: 340,
    desc: 'Main battle tank. Tough backbone of any ground army.',
  },
  flakker: {
    name: 'Flakker', cls: 'veh', from: 'foundry', cost: 275, pop: 2, time: 14, tech: 1,
    hp: 720, speed: 84, range: 240, dmg: 26, rof: 0.36, dtype: 'flak', radius: 19, sight: 380,
    desc: 'Anti-air track. Shreds aircraft, weak against everything else.',
  },
  thumper: {
    name: 'Thumper', cls: 'veh', from: 'foundry', cost: 400, pop: 3, time: 20, tech: 2,
    hp: 620, speed: 50, range: 430, minRange: 130, dmg: 170, rof: 3.6, dtype: 'siege', aoe: 62, radius: 21, sight: 360,
    desc: 'Siege mortar. Outranges turrets and levels structures.',
  },
  kestrel: {
    name: 'Kestrel', cls: 'air', from: 'skyport', cost: 300, pop: 2, time: 15, tech: 2,
    hp: 560, speed: 150, range: 185, dmg: 46, rof: 1.0, dtype: 'rocket', radius: 18, sight: 420,
    desc: 'Gunship. Fast tank hunter that ignores terrain.',
  },
  condor: {
    name: 'Condor', cls: 'air', from: 'skyport', cost: 600, pop: 4, time: 26, tech: 3,
    hp: 1550, speed: 78, range: 150, dmg: 150, rof: 1.8, dtype: 'shell', aoe: 52, radius: 26, sight: 420,
    desc: 'Heavy bomber. Devastates ground targets, cannot hit aircraft.',
  },
};

const BUILDINGS = {
  citadel: {
    name: 'Citadel', hp: 6500, radius: 72, time: 32, income: 3,
    range: 280, dmg: 15, rof: 0.3, dtype: 'turret', sight: 520,
    desc: 'Command hub. Lose every Citadel and the battle is over.',
  },
  depot: {
    name: 'Supply Depot', cost: 150, time: 14, tech: 0, hp: 950, radius: 30, income: 4, sight: 300,
    desc: 'Generates a steady stream of supplies.',
  },
  reactor: {
    name: 'Reactor', cost: 250, time: 22, tech: 0, hp: 950, radius: 30, sight: 300,
    desc: 'Each Reactor raises your tech level (max 3).',
  },
  barracks: {
    name: 'Barracks', cost: 150, time: 14, tech: 0, hp: 900, radius: 30, sight: 300,
    trains: ['trooper', 'scorcher', 'lancer'],
    desc: 'Trains infantry squads.',
  },
  foundry: {
    name: 'Foundry', cost: 250, time: 18, tech: 0, hp: 1150, radius: 30, sight: 300,
    trains: ['ranger', 'bastion', 'flakker', 'thumper'],
    desc: 'Assembles ground vehicles.',
  },
  skyport: {
    name: 'Skyport', cost: 300, time: 20, tech: 1, hp: 1050, radius: 30, sight: 300,
    trains: ['kestrel', 'condor'],
    desc: 'Launches aircraft. Requires tech 1.',
  },
  turret: {
    name: 'Turret', cost: 200, time: 14, tech: 0, hp: 1250, radius: 30, sight: 380,
    range: 290, dmg: 22, rof: 0.3, dtype: 'turret',
    desc: 'Automated base defence against ground and air.',
  },
};
const BUILD_ORDER = ['depot', 'reactor', 'barracks', 'foundry', 'skyport', 'turret'];
const DEPOT_UP = { cost: 225, time: 18, income: 7 };

const POWERS = {
  strike: { name: 'Rail Strike', cost: 400, cd: 75, radius: 105, key: 'Z', desc: 'Orbital bombardment on the target area.' },
  mend: { name: 'Nanite Mend', cost: 250, cd: 50, radius: 175, key: 'X', desc: 'Repairs friendly units and structures in the area.' },
};

const DIFFS = {
  easy: { minT: 240, inc: 0.7, first: 7, grow: 4, think: 1.6, maxWave: 22, strike: false, label: 'Recruit' },
  normal: { minT: 170, inc: 1.0, first: 7, grow: 4, think: 1.0, maxWave: 30, strike: true, label: 'Veteran' },
  hard: { minT: 130, inc: 1.4, first: 8, grow: 5, think: 0.6, maxWave: 36, strike: true, label: 'Warlord' },
};
