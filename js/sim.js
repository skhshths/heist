// The heist simulation. Pure and deterministic: the same level and plan
// always play out the same way, so the planner can preview any moment and
// the run you watch is exactly the one you planned. No DOM in here.

export const DT = 1 / 60;
export const ROLES = {
  ghost:  { name: "Ghost",  title: "Runner",  speed: 3.4, grab: 0.8, colour: "#4fd1ff",
            ability: "Fastest on foot and grabs loot in a blink." },
  wire:   { name: "Wire",   title: "Hacker",  speed: 2.6, grab: 1.6, colour: "#7cff8a",
            ability: "Hacks terminals to open doors and kill cameras and lasers." },
  brick:  { name: "Brick",  title: "Muscle",  speed: 2.8, grab: 1.6, colour: "#ffb347",
            ability: "Ambushes guards that walk within arm's reach." },
};
export const HACK_TIME = 2.5;
export const TAKEDOWN_TIME = 1.0;
export const TAKEDOWN_REACH = 1.25;   // cells
export const CREW_R = 0.3;            // crew radius, cells
export const SPOT_TIME = 0.35;        // seconds in plain view before the alarm
export const GUARD_VIEW = { range: 5.5, half: 38 * Math.PI / 180 };
export const CAMERA_VIEW = { range: 7, half: 24 * Math.PI / 180 };

// ------------------------------------------------------------- level setup --
export function parseLevel(def) {
  const rows = def.map;
  const h = rows.length, w = Math.max(...rows.map(r => r.length));
  const grid = [];           // 0 floor, 1 wall, 2 void (outside), 3 terminal desk
  const L = { def, w, h, grid, exits: [], spawns: [], loot: [], doors: [], terminals: [] };
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      const c = rows[y][x] || " ";
      let v = 0;
      if (c === "#") v = 1;
      else if (c === " ") v = 2;
      else if (c === "E") L.exits.push([x, y]);
      else if (c === "S") L.spawns.push([x, y]);
      else if (c === "$" || c === "*")
        L.loot.push({ id: L.loot.length, x, y, required: c === "$" });
      else if (c === "D") L.doors.push({ id: "D" + L.doors.length, x, y });
      else if (c === "T") { L.terminals.push({ id: "T" + L.terminals.length, x, y }); v = 3; }
      row.push(v);
    }
    grid.push(row);
  }
  L.isExit = new Set(L.exits.map(([x, y]) => y * w + x));
  L.guards = (def.guards || []).map((g, i) => buildGuard(g, i));
  L.cameras = (def.cameras || []).map((c, i) => ({ id: "C" + i, ...c }));
  L.lasers = (def.lasers || []).map((l, i) => ({ id: "L" + i, ...l, cells: laserCells(l) }));
  L.links = def.links || {};
  L.crew = def.crew;
  return L;
}

function laserCells(l) {
  const [ax, ay] = l.a, [bx, by] = l.b, out = [];
  for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++)
    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) out.push([x, y]);
  return out;
}

// Guards walk straight lines between their path points at a steady speed,
// pausing where told, round in a loop or back and forth.
function buildGuard(g, i) {
  let pts = g.path.map(p => [p[0] + 0.5, p[1] + 0.5]);
  if (pts.length === 1) {
    // a guard on post, turning between the directions in `looks`
    const looks = g.looks || [g.angle || 0], hold = g.waits || looks.map(() => 2);
    let t = 0;
    const legs = looks.map((a, k) => {
      const leg = { t0: t, t1: t + hold[k], from: pts[0], to: pts[0], kind: "wait", angle: a * Math.PI / 180 };
      t += hold[k];
      return leg;
    });
    return { id: "G" + i, legs, period: Math.max(t, 0.001), offset: g.offset || 0, start: pts[0] };
  }
  let waits = g.waits || pts.map(() => 0);
  if (g.mode === "pingpong" && pts.length > 1) {
    const back = pts.slice(1, -1).reverse(), bw = waits.slice(1, -1).reverse();
    pts = pts.concat(back);
    waits = waits.concat(bw);
  }
  const legs = [];          // {t0, t1, from, to, kind: "walk"|"wait", angle}
  let t = 0;
  const n = pts.length;
  for (let k = 0; k < n; k++) {
    const a = pts[k], b = pts[(k + 1) % n];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const look = g.look && g.look[k] != null ? g.look[k] * Math.PI / 180 : null;
    if (waits[k] > 0) {
      legs.push({ t0: t, t1: t + waits[k], from: a, to: a, kind: "wait", angle: look ?? ang });
      t += waits[k];
    }
    if (n > 1) {
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d > 0) {
        legs.push({ t0: t, t1: t + d / g.speed, from: a, to: b, kind: "walk", angle: ang });
        t += d / g.speed;
      }
    }
  }
  const period = Math.max(t, 0.001);
  return { id: "G" + i, legs, period, offset: g.offset || 0, start: pts[0] };
}

export function guardAt(g, t) {
  let u = ((t + g.offset) % g.period + g.period) % g.period;
  for (const leg of g.legs) {
    if (u <= leg.t1) {
      const f = leg.t1 > leg.t0 ? (u - leg.t0) / (leg.t1 - leg.t0) : 0;
      return { x: leg.from[0] + (leg.to[0] - leg.from[0]) * f,
               y: leg.from[1] + (leg.to[1] - leg.from[1]) * f, angle: leg.angle };
    }
  }
  const last = g.legs[g.legs.length - 1];
  return { x: last.to[0], y: last.to[1], angle: last.angle };
}

export function cameraAngle(c, t) {
  const base = c.dir * Math.PI / 180, sweep = (c.sweep || 0) * Math.PI / 180;
  return base + sweep * Math.sin(2 * Math.PI * (t / (c.period || 6)) + (c.phase || 0));
}

// a beam across a row or a column of cells, through their centres
export function laserBeam(l) {
  const [ax, ay] = l.a, [bx, by] = l.b;
  if (ay === by) return [Math.min(ax, bx), ay + 0.5, Math.max(ax, bx) + 1, ay + 0.5];
  return [ax + 0.5, Math.min(ay, by), ax + 0.5, Math.max(ay, by) + 1];
}

export function laserOn(l, t) {
  if (!l.off) return true;
  const u = ((t + (l.offset || 0)) % (l.on + l.off) + (l.on + l.off)) % (l.on + l.off);
  return u < l.on;
}

// ------------------------------------------------------------- pathfinding --
// Planning treats doors as passable (you plan for them to be opened); the
// run itself makes the crew wait at a door that's still shut.
export function walkable(L, x, y) {
  if (x < 0 || y < 0 || x >= L.w || y >= L.h) return false;
  const v = L.grid[y][x];
  return v === 0;
}

export function findPath(L, from, to) {
  const [sx, sy] = from, [tx, ty] = to;
  if (!walkable(L, tx, ty)) return null;
  if (sx === tx && sy === ty) return [];
  const W = L.w, start = sy * W + sx, goal = ty * W + tx;
  const g = new Map([[start, 0]]), came = new Map();
  const open = [[Math.abs(tx - sx) + Math.abs(ty - sy), start]];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [, cur] = open.splice(bi, 1)[0];
    if (cur === goal) break;
    const cx = cur % W, cy = (cur / W) | 0;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (!walkable(L, nx, ny)) continue;
      // no cutting corners past walls
      if (dx && dy && (!walkable(L, cx + dx, cy) || !walkable(L, cx, cy + dy))) continue;
      const nk = ny * W + nx, cost = g.get(cur) + (dx && dy ? Math.SQRT2 : 1);
      if (cost < (g.get(nk) ?? Infinity)) {
        g.set(nk, cost);
        came.set(nk, cur);
        const hx = Math.abs(tx - nx), hy = Math.abs(ty - ny);
        open.push([cost + Math.max(hx, hy) + (Math.SQRT2 - 1) * Math.min(hx, hy), nk]);
      }
    }
  }
  if (!came.has(goal)) return null;
  const out = [];
  for (let k = goal; k !== start; k = came.get(k)) out.push([k % W, (k / W) | 0]);
  return out.reverse();
}

// Where each crew member stands after their steps, step by step, for the
// planner (a move step's path starts from wherever the previous one ended).
export function planPaths(L, plan) {
  return L.crew.map((role, i) => {
    let at = L.spawns[i];
    return (plan[i] || []).map(step => {
      if (step.type !== "move") return { at };
      const path = findPath(L, at, [step.x, step.y]);
      if (path) at = [step.x, step.y];
      return { at, path, from: path ? null : at };
    });
  });
}

// ---------------------------------------------------------------- the run --
function lineOfSight(L, st, ax, ay, bx, by) {
  const d = Math.hypot(bx - ax, by - ay), n = Math.ceil(d / 0.2);
  for (let k = 1; k < n; k++) {
    const x = ax + (bx - ax) * k / n, y = ay + (by - ay) * k / n;
    const cx = Math.floor(x), cy = Math.floor(y);
    const v = L.grid[cy]?.[cx];
    if (v === 1 || v === 2) return false;
    if (st.doorShut.has(cy * L.w + cx)) return false;
  }
  return true;
}

function inCone(ox, oy, ang, view, px, py) {
  const dx = px - ox, dy = py - oy, d = Math.hypot(dx, dy);
  if (d > view.range || d < 1e-6) return d < 1e-6;
  let diff = Math.atan2(dy, dx) - ang;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  return Math.abs(diff) <= view.half + Math.atan2(CREW_R, d);
}

export function viewPolygon(L, st, ox, oy, ang, view, rays = 48) {
  // the cone as a polygon, clipped by walls and shut doors, for drawing
  const pts = [[ox, oy]];
  for (let k = 0; k <= rays; k++) {
    const a = ang - view.half + (2 * view.half) * k / rays;
    const ca = Math.cos(a), sa = Math.sin(a);
    let r = 0;
    for (; r < view.range; r += 0.05) {
      const x = ox + ca * r, y = oy + sa * r;
      const cx = Math.floor(x), cy = Math.floor(y);
      const v = L.grid[cy]?.[cx];
      if (v === 1 || v === 2 || v === undefined || st.doorShut.has(cy * L.w + cx)) break;
    }
    pts.push([ox + ca * r, oy + sa * r]);
  }
  return pts;
}

// simulate(L, plan, {detect}) plays the whole heist. It returns a frame
// recorder (state at any time) plus the outcome and per-step timings.
export function simulate(L, plan, opts = {}) {
  const detect = opts.detect !== false;
  const limit = L.def.limit;
  const paths = planPaths(L, plan);
  const st = {
    t: 0,
    doorShut: new Set(L.doors.map(d => d.y * L.w + d.x)),
    camOff: new Set(), laserOff: new Set(), hacked: new Set(),
    lootTaken: new Map(),          // loot id -> crew index
    down: new Map(),               // guard index -> {x, y, angle, t}
    alarm: null,                   // {t, by, crew, x, y, reason}
    events: [],
  };
  const crew = L.crew.map((role, i) => ({
    i, role, speed: ROLES[role].speed,
    x: L.spawns[i][0] + 0.5, y: L.spawns[i][1] + 0.5,
    steps: plan[i] || [], si: 0, queue: null, busy: 0, busyKind: null, busyTotal: 0,
    blocked: false, escaped: false, escapedAt: null, carry: [], seen: 0, facing: 0,
    stepTimes: (plan[i] || []).map(() => ({ start: null, end: null, blocked: 0, error: null })),
    target: null,
  }));
  const frames = [];
  const record = () => {
    frames.push({
      t: st.t,
      crew: crew.map(c => ({ x: c.x, y: c.y, escaped: c.escaped, busy: c.busy, busyKind: c.busyKind,
                             busyTotal: c.busyTotal, blocked: c.blocked, seen: c.seen,
                             carry: c.carry.length, facing: c.facing })),
      doorShut: new Set(st.doorShut), camOff: new Set(st.camOff), laserOff: new Set(st.laserOff),
      hacked: new Set(st.hacked), lootTaken: new Map(st.lootTaken), down: new Map(st.down),
    });
  };
  const event = (kind, text, extra = {}) => st.events.push({ t: st.t, kind, text, ...extra });

  const startStep = (c) => {
    while (c.si < c.steps.length) {
      const step = c.steps[c.si], times = c.stepTimes[c.si];
      if (times.start == null) times.start = st.t;
      if (step.type === "move") {
        const p = paths[c.i][c.si].path;
        if (!p) { times.error = "No way there"; times.end = st.t; c.si++; continue; }
        c.queue = p.slice();
        return;
      }
      if (step.type === "wait") { c.busy = step.t; c.busyTotal = step.t; c.busyKind = "wait"; return; }
      if (step.type === "grab") {
        const cx = Math.floor(c.x), cy = Math.floor(c.y);
        const loot = L.loot.find(l => !st.lootTaken.has(l.id) && Math.abs(l.x - cx) <= 1 && Math.abs(l.y - cy) <= 1);
        if (!loot) { times.error = "Nothing to grab here"; times.end = st.t; c.si++; continue; }
        c.pending = { kind: "grab", loot };
        c.busy = ROLES[c.role].grab; c.busyTotal = c.busy; c.busyKind = "grab";
        return;
      }
      if (step.type === "hack") {
        if (c.role !== "wire") { times.error = "Only Wire can hack"; times.end = st.t; c.si++; continue; }
        const cx = Math.floor(c.x), cy = Math.floor(c.y);
        const term = L.terminals.find(tm => !st.hacked.has(tm.id) && Math.abs(tm.x - cx) <= 1 && Math.abs(tm.y - cy) <= 1);
        if (!term) { times.error = "No terminal in reach"; times.end = st.t; c.si++; continue; }
        c.pending = { kind: "hack", term };
        c.busy = HACK_TIME; c.busyTotal = HACK_TIME; c.busyKind = "hack";
        return;
      }
      if (step.type === "ambush") {
        if (c.role !== "brick") { times.error = "Only Brick can ambush"; times.end = st.t; c.si++; continue; }
        c.busyKind = "ambush"; c.busy = Infinity; c.busyTotal = 0;
        return;
      }
      c.si++;
    }
  };

  const finishStep = (c) => {
    c.stepTimes[c.si].end = st.t;
    c.si++;
    c.busy = 0; c.busyKind = null; c.queue = null; c.blocked = false;
    startStep(c);
  };

  const guardState = (gi) => {
    if (st.down.has(gi)) return null;
    return guardAt(L.guards[gi], st.t);
  };

  const raise = (reason, c, by, x, y) => {
    if (st.alarm) return;
    st.alarm = { t: st.t, reason, crew: c?.i ?? null, by, x, y };
    event("alarm", reason, { crew: c?.i, x, y });
  };

  crew.forEach(startStep);
  record();
  let outcome = null;
  const steps = Math.ceil(limit / DT);
  for (let n = 0; n < steps; n++) {
    st.t = (n + 1) * DT;

    // crew
    for (const c of crew) {
      if (c.escaped) continue;
      if (c.busyKind) {
        if (c.busyKind === "ambush") {
          // wait for a guard to come within reach, then take them down
          for (let gi = 0; gi < L.guards.length; gi++) {
            const g = guardState(gi);
            if (g && Math.hypot(g.x - c.x, g.y - c.y) <= TAKEDOWN_REACH) {
              st.down.set(gi, { x: g.x, y: g.y, angle: g.angle, t: st.t });
              event("takedown", `${ROLES[c.role].name} took down a guard`, { crew: c.i, x: g.x, y: g.y });
              c.busyKind = "takedown"; c.busy = TAKEDOWN_TIME; c.busyTotal = TAKEDOWN_TIME;
              c.facing = Math.atan2(g.y - c.y, g.x - c.x);
              break;
            }
          }
          continue;
        }
        c.busy -= DT;
        if (c.busy <= 1e-9) {
          const p = c.pending;
          if (c.busyKind === "grab" && p) {
            if (!st.lootTaken.has(p.loot.id)) {
              st.lootTaken.set(p.loot.id, c.i);
              c.carry.push(p.loot.id);
              event("grab", `${ROLES[c.role].name} grabbed ${p.loot.required ? "the score" : "a bonus"}`,
                    { crew: c.i, x: p.loot.x + 0.5, y: p.loot.y + 0.5 });
            }
          } else if (c.busyKind === "hack" && p) {
            st.hacked.add(p.term.id);
            for (const id of L.links[p.term.id] || []) {
              if (id[0] === "D") {
                const d = L.doors.find(dd => dd.id === id);
                if (d) st.doorShut.delete(d.y * L.w + d.x);
              } else if (id[0] === "C") st.camOff.add(id);
              else if (id[0] === "L") st.laserOff.add(id);
            }
            event("hack", `${ROLES[c.role].name} hacked ${p.term.id}`, { crew: c.i, x: p.term.x + 0.5, y: p.term.y + 0.5 });
          }
          c.pending = null;
          finishStep(c);
        }
        continue;
      }
      if (c.queue) {
        let move = c.speed * DT;
        c.blocked = false;
        while (move > 0 && c.queue.length) {
          const [nx, ny] = c.queue[0];
          if (st.doorShut.has(ny * L.w + nx)) { c.blocked = true; c.stepTimes[c.si].blocked += DT; break; }
          const tx = nx + 0.5, ty = ny + 0.5, dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy);
          if (d > 1e-9) c.facing = Math.atan2(dy, dx);
          if (d <= move) { c.x = tx; c.y = ty; move -= d; c.queue.shift(); }
          else { c.x += dx / d * move; c.y += dy / d * move; move = 0; }
        }
        if (!c.queue.length) finishStep(c);
      }
      if (c.si >= c.steps.length && !c.busyKind && !c.queue?.length) {
        const k = Math.floor(c.y) * L.w + Math.floor(c.x);
        if (L.isExit.has(k)) {
          c.escaped = true; c.escapedAt = st.t;
          event("escape", `${ROLES[c.role].name} is out`, { crew: c.i, x: c.x, y: c.y });
        }
      }
    }

    // being seen
    if (detect && !st.alarm) {
      const seenNow = new Set();
      for (let gi = 0; gi < L.guards.length; gi++) {
        const g = guardState(gi);
        if (!g) continue;
        for (const c of crew) {
          if (c.escaped) continue;
          if (inCone(g.x, g.y, g.angle, GUARD_VIEW, c.x, c.y) && lineOfSight(L, st, g.x, g.y, c.x, c.y))
            seenNow.add(c.i), c.seenBy = { kind: "guard", gi };
        }
        for (const [bi, body] of st.down) {
          if (inCone(g.x, g.y, g.angle, GUARD_VIEW, body.x, body.y) &&
              lineOfSight(L, st, g.x, g.y, body.x, body.y))
            raise("A guard found a body", null, { kind: "guard", gi }, body.x, body.y);
        }
      }
      for (const cam of L.cameras) {
        if (st.camOff.has(cam.id)) continue;
        const ox = cam.x + 0.5, oy = cam.y + 0.5, ang = cameraAngle(cam, st.t);
        for (const c of crew) {
          if (c.escaped) continue;
          if (inCone(ox, oy, ang, CAMERA_VIEW, c.x, c.y) && lineOfSight(L, st, ox, oy, c.x, c.y))
            seenNow.add(c.i), c.seenBy = { kind: "camera", id: cam.id };
        }
        for (const [, body] of st.down) {
          if (inCone(ox, oy, ang, CAMERA_VIEW, body.x, body.y) && lineOfSight(L, st, ox, oy, body.x, body.y))
            raise("A camera caught a body on tape", null, { kind: "camera", id: cam.id }, body.x, body.y);
        }
      }
      for (const c of crew) {
        if (seenNow.has(c.i)) {
          c.seen = Math.min(1, c.seen + DT / SPOT_TIME);
          if (c.seen >= 1)
            raise(`${ROLES[c.role].name} was spotted by ${c.seenBy.kind === "camera" ? "a camera" : "a guard"}`,
                  c, c.seenBy, c.x, c.y);
        } else c.seen = Math.max(0, c.seen - DT * 1.5);
      }
      for (const l of L.lasers) {
        if (st.laserOff.has(l.id) || !laserOn(l, st.t)) continue;
        const [x0, y0, x1, y1] = laserBeam(l);
        for (const c of crew) {
          if (c.escaped) continue;
          // distance from the crew member to the beam (a segment)
          const qx = Math.max(x0, Math.min(c.x, x1)), qy = Math.max(y0, Math.min(c.y, y1));
          if (Math.hypot(qx - c.x, qy - c.y) < CREW_R)
            raise(`${ROLES[c.role].name} tripped a laser`, c, { kind: "laser", id: l.id }, c.x, c.y);
        }
      }
    }

    record();
    if (st.alarm) { outcome = { result: "alarm", t: st.t, alarm: st.alarm }; break; }
    if (crew.every(c => c.escaped)) {
      const required = L.loot.filter(l => l.required);
      const got = required.every(l => st.lootTaken.has(l.id));
      if (got) { outcome = { result: "success", t: st.t }; break; }
      outcome = { result: "noloot", t: st.t }; break;
    }
  }
  if (!outcome) outcome = { result: "timeout", t: limit };
  const bonus = L.loot.filter(l => !l.required && st.lootTaken.has(l.id) &&
                                   crew[st.lootTaken.get(l.id)].escaped).length;
  return {
    frames, outcome, events: st.events, bonus,
    stepTimes: crew.map(c => c.stepTimes),
    endTime: frames[frames.length - 1].t,
    paths,
  };
}

export function frameAt(run, t) {
  const i = Math.max(0, Math.min(run.frames.length - 1, Math.round(t / DT)));
  return run.frames[i];
}

export function stars(L, run) {
  if (run.outcome.result !== "success") return 0;
  let s = 1;
  if (run.outcome.t <= L.def.par) s++;
  const bonusTotal = L.loot.filter(l => !l.required).length;
  if (bonusTotal === 0 || run.bonus === bonusTotal) s++;
  return s;
}
