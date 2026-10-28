// Drawing the blueprint, everything on it, and level thumbnails.
import { ROLES, GUARD_VIEW, CAMERA_VIEW, guardAt, cameraAngle, laserOn, laserBeam, viewPolygon,
         TAKEDOWN_REACH } from "./sim.js";

export const COLORS = {
  bg: "#061127", grid: "rgba(110, 160, 240, 0.07)", grid4: "rgba(110, 160, 240, 0.14)",
  floor: "rgba(40, 80, 140, 0.16)", wall: "#0f2a52", wallEdge: "#8fc3ff", hatch: "rgba(143, 195, 255, 0.13)",
  exit: "#4ade80", gold: "#ffd166", purple: "#c49bff", red: "#ff4d6d", door: "#ffb347",
  terminal: "#4fd1ff", guard: "#ff6b5a", cone: "255, 214, 102", camCone: "120, 220, 255",
};

export function fitView(L, w, h, pad = 24) {
  const cs = Math.max(8, Math.floor(Math.min((w - pad * 2) / L.w, (h - pad * 2) / L.h)));
  return { cs, ox: Math.round((w - cs * L.w) / 2), oy: Math.round((h - cs * L.h) / 2), w, h };
}

// ------------------------------------------------------------ static map --
export function drawStatic(L, view, dpr) {
  const c = document.createElement("canvas");
  c.width = Math.round(view.w * dpr); c.height = Math.round(view.h * dpr);
  const g = c.getContext("2d");
  g.scale(dpr, dpr);
  const { cs, ox, oy } = view;
  // paper
  const grad = g.createRadialGradient(view.w / 2, view.h / 2, 0, view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.7);
  grad.addColorStop(0, "#0b1f42"); grad.addColorStop(1, COLORS.bg);
  g.fillStyle = grad; g.fillRect(0, 0, view.w, view.h);
  // fine grid across the whole sheet
  g.lineWidth = 1;
  for (let x = ox % cs; x < view.w; x += cs) {
    const k = Math.round((x - ox) / cs);
    g.strokeStyle = k % 4 === 0 ? COLORS.grid4 : COLORS.grid;
    g.beginPath(); g.moveTo(Math.round(x) + 0.5, 0); g.lineTo(Math.round(x) + 0.5, view.h); g.stroke();
  }
  for (let y = oy % cs; y < view.h; y += cs) {
    const k = Math.round((y - oy) / cs);
    g.strokeStyle = k % 4 === 0 ? COLORS.grid4 : COLORS.grid;
    g.beginPath(); g.moveTo(0, Math.round(y) + 0.5); g.lineTo(view.w, Math.round(y) + 0.5); g.stroke();
  }
  const cell = (x, y) => [ox + x * cs, oy + y * cs];
  // floor
  g.fillStyle = COLORS.floor;
  for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
    if (L.grid[y][x] !== 1 && L.grid[y][x] !== 2) { const [px, py] = cell(x, y); g.fillRect(px, py, cs, cs); }
  }
  // exit
  for (const [x, y] of L.exits) {
    const [px, py] = cell(x, y);
    g.save(); g.beginPath(); g.rect(px, py, cs, cs); g.clip();
    g.fillStyle = "rgba(74, 222, 128, 0.12)"; g.fillRect(px, py, cs, cs);
    g.strokeStyle = "rgba(74, 222, 128, 0.35)"; g.lineWidth = 2;
    for (let k = -cs; k < cs * 2; k += cs / 3) { g.beginPath(); g.moveTo(px + k, py); g.lineTo(px + k - cs, py + cs); g.stroke(); }
    g.restore();
  }
  if (L.exits.length) {
    const xs = L.exits.map(e => e[0]), ys = L.exits.map(e => e[1]);
    const [ax, ay] = cell(Math.min(...xs), Math.min(...ys));
    const bw = (Math.max(...xs) - Math.min(...xs) + 1) * cs, bh = (Math.max(...ys) - Math.min(...ys) + 1) * cs;
    g.strokeStyle = COLORS.exit; g.lineWidth = 2; g.setLineDash([6, 4]);
    g.strokeRect(ax + 2, ay + 2, bw - 4, bh - 4); g.setLineDash([]);
    g.fillStyle = COLORS.exit; g.font = `700 ${Math.max(10, cs * 0.38)}px "Chakra Petch", sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("EXIT", ax + bw / 2, ay + bh / 2);
  }
  // walls: hatched blocks with bright edges where they meet the floor
  for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
    if (L.grid[y][x] !== 1) continue;
    const [px, py] = cell(x, y);
    g.fillStyle = COLORS.wall; g.fillRect(px, py, cs, cs);
    g.save(); g.beginPath(); g.rect(px, py, cs, cs); g.clip();
    g.strokeStyle = COLORS.hatch; g.lineWidth = 1;
    for (let k = -cs; k < cs * 2; k += Math.max(4, cs / 4)) {
      g.beginPath(); g.moveTo(px + k, py + cs); g.lineTo(px + k + cs, py); g.stroke();
    }
    g.restore();
  }
  g.strokeStyle = COLORS.wallEdge; g.lineWidth = Math.max(1.5, cs / 14); g.lineCap = "square";
  const solid = (x, y) => L.grid[y]?.[x] === 1;
  const open = (x, y) => { const v = L.grid[y]?.[x]; return v !== undefined && v !== 1 && v !== 2; };
  g.beginPath();
  for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
    if (!solid(x, y)) continue;
    const [px, py] = cell(x, y);
    if (open(x, y - 1)) { g.moveTo(px, py); g.lineTo(px + cs, py); }
    if (open(x, y + 1)) { g.moveTo(px, py + cs); g.lineTo(px + cs, py + cs); }
    if (open(x - 1, y)) { g.moveTo(px, py); g.lineTo(px, py + cs); }
    if (open(x + 1, y)) { g.moveTo(px + cs, py); g.lineTo(px + cs, py + cs); }
  }
  g.stroke();
  // spawn marks
  g.setLineDash([3, 3]); g.lineWidth = 1.5;
  L.spawns.forEach(([x, y], i) => {
    const role = L.crew[i];
    if (!role) return;
    g.strokeStyle = ROLES[role].colour;
    g.beginPath(); g.arc(ox + (x + 0.5) * cs, oy + (y + 0.5) * cs, cs * 0.4, 0, Math.PI * 2); g.stroke();
  });
  g.setLineDash([]);
  // title block, like a real blueprint
  g.fillStyle = "rgba(143, 195, 255, 0.35)";
  g.font = `600 11px "IBM Plex Mono", monospace`;
  g.textAlign = "right"; g.textBaseline = "bottom";
  g.fillText(`SHEET ${L.def.id.toUpperCase()}  ·  SCALE 1:50`, view.w - 12, view.h - 8);
  return c;
}

// ------------------------------------------------------------ the scene --
function circle(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); }

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

export function drawScene(g, L, view, frame, o) {
  const { cs, ox, oy } = view;
  const P = (x, y) => [ox + x * cs, oy + y * cs];
  const t = frame.t, now = o.now || 0;

  // planned routes (under everything else)
  if (o.paths) {
    L.crew.forEach((role, i) => {
      const col = ROLES[role].colour, sel = o.selected === i;
      const pts = [[L.spawns[i][0] + 0.5, L.spawns[i][1] + 0.5]];
      const marks = [];
      (o.paths[i] || []).forEach((p, si) => {
        if (p.path) p.path.forEach(([x, y]) => pts.push([x + 0.5, y + 0.5]));
        marks.push({ si, at: p.at, step: o.plan[i][si] });
      });
      g.save();
      g.globalAlpha = sel ? 0.95 : 0.4;
      g.strokeStyle = col; g.lineWidth = sel ? 3 : 2; g.lineJoin = "round"; g.lineCap = "round";
      g.setLineDash(sel ? [] : [6, 6]);
      g.beginPath();
      pts.forEach(([x, y], k) => { const [px, py] = P(x, y); k ? g.lineTo(px, py) : g.moveTo(px, py); });
      g.stroke(); g.setLineDash([]);
      // step markers: numbered dots at move targets, icons for actions
      let n = 0;
      const stacked = new Map();
      for (const m of marks) {
        n++;
        const key = m.at[0] + "," + m.at[1], k = stacked.get(key) || 0;
        stacked.set(key, k + 1);
        if (m.step.type === "move" && !sel) continue;
        const [px, py] = P(m.at[0] + 0.5, m.at[1] + 0.5);
        const off = k * cs * 0.32;
        if (m.step.type === "move") {
          circle(g, px, py, cs * 0.17); g.fillStyle = col; g.fill();
          if (cs >= 22) { g.fillStyle = "#04122a"; g.font = `700 ${cs * 0.2}px "IBM Plex Mono"`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(n, px, py + 0.5); }
        } else {
          const ic = { wait: "⏱", grab: "◆", hack: "⌁", ambush: "✊" }[m.step.type];
          const bx = px + cs * 0.3 + off, by = py - cs * 0.42;
          roundRect(g, bx - cs * 0.2, by - cs * 0.16, cs * 0.4, cs * 0.32, 4);
          g.fillStyle = "#04122a"; g.fill(); g.strokeStyle = col; g.lineWidth = 1.5; g.stroke();
          g.fillStyle = col; g.font = `${cs * 0.22}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
          g.fillText(ic, bx, by + 1);
        }
      }
      g.restore();
    });
  }

  // hover preview of the next move
  if (o.hoverPath && o.selected != null) {
    const col = ROLES[L.crew[o.selected]].colour;
    g.save(); g.strokeStyle = col; g.globalAlpha = 0.7; g.lineWidth = 2; g.setLineDash([3, 5]);
    g.beginPath();
    o.hoverPath.forEach(([x, y], k) => { const [px, py] = P(x + 0.5, y + 0.5); k ? g.lineTo(px, py) : g.moveTo(px, py); });
    g.stroke(); g.restore();
  }
  if (o.hover) {
    const [hx, hy] = o.hover;
    const [px, py] = P(hx, hy);
    g.strokeStyle = o.hoverOk ? "rgba(219, 233, 255, 0.8)" : "rgba(255, 77, 109, 0.8)";
    g.lineWidth = 1.5; g.strokeRect(px + 1.5, py + 1.5, cs - 3, cs - 3);
  }

  // doors
  for (const d of L.doors) {
    const [px, py] = P(d.x, d.y);
    const shut = frame.doorShut.has(d.y * L.w + d.x);
    const horiz = L.grid[d.y]?.[d.x - 1] === 1 || L.grid[d.y]?.[d.x + 1] === 1;
    g.save();
    if (shut) {
      g.fillStyle = COLORS.door; g.shadowColor = COLORS.door; g.shadowBlur = 10;
      if (horiz) g.fillRect(px, py + cs * 0.38, cs, cs * 0.24); else g.fillRect(px + cs * 0.38, py, cs * 0.24, cs);
      g.shadowBlur = 0; g.fillStyle = "#04122a";
      circle(g, px + cs / 2, py + cs / 2, cs * 0.09); g.fill();
    } else {
      g.strokeStyle = "rgba(255, 179, 71, 0.45)"; g.setLineDash([3, 3]); g.lineWidth = 1.5;
      if (horiz) { g.strokeRect(px + 1, py + cs * 0.38, cs * 0.18, cs * 0.24); g.strokeRect(px + cs * 0.82 - 1, py + cs * 0.38, cs * 0.18, cs * 0.24); }
      else { g.strokeRect(px + cs * 0.38, py + 1, cs * 0.24, cs * 0.18); g.strokeRect(px + cs * 0.38, py + cs * 0.82 - 1, cs * 0.24, cs * 0.18); }
    }
    g.restore();
  }

  // terminals
  for (const tm of L.terminals) {
    const [px, py] = P(tm.x, tm.y);
    const done = frame.hacked.has(tm.id);
    g.save();
    roundRect(g, px + cs * 0.12, py + cs * 0.18, cs * 0.76, cs * 0.64, 4);
    g.fillStyle = "#04122a"; g.fill();
    g.strokeStyle = done ? COLORS.exit : COLORS.terminal; g.lineWidth = 2;
    g.shadowColor = g.strokeStyle; g.shadowBlur = 8; g.stroke(); g.shadowBlur = 0;
    g.fillStyle = done ? COLORS.exit : COLORS.terminal;
    if (done) {
      g.font = `700 ${cs * 0.4}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("✓", px + cs / 2, py + cs / 2 + 1);
    } else {
      for (let k = 0; k < 3; k++) {
        const w = (0.3 + 0.2 * Math.abs(Math.sin(now * 3 + k * 1.7))) * cs;
        g.globalAlpha = 0.8; g.fillRect(px + cs * 0.22, py + cs * (0.3 + k * 0.14), w, cs * 0.06);
      }
    }
    g.restore();
    if (o.linksFor === tm.id || o.showLinks) {
      // what this terminal controls
      for (const id of L.links[tm.id] || []) {
        let tx, ty;
        if (id[0] === "D") { const d = L.doors.find(dd => dd.id === id); if (d) [tx, ty] = [d.x + 0.5, d.y + 0.5]; }
        if (id[0] === "C") { const c = L.cameras.find(cc => cc.id === id); if (c) [tx, ty] = [c.x + 0.5, c.y + 0.5]; }
        if (id[0] === "L") { const l = L.lasers.find(ll => ll.id === id); if (l) { const b = laserBeam(l); [tx, ty] = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; } }
        if (tx == null) continue;
        const [ax, ay] = P(tm.x + 0.5, tm.y + 0.5), [bx, by] = P(tx, ty);
        g.save(); g.strokeStyle = "rgba(79, 209, 255, 0.55)"; g.setLineDash([2, 4]); g.lineWidth = 1.5;
        g.lineDashOffset = -now * 20;
        g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); g.restore();
      }
    }
  }

  // loot
  L.loot.forEach(l => {
    if (frame.lootTaken.has(l.id)) return;
    const [px, py] = P(l.x + 0.5, l.y + 0.5);
    const col = l.required ? COLORS.gold : COLORS.purple;
    const bob = Math.sin(now * 2.5 + l.id) * cs * 0.04, r = cs * (l.required ? 0.3 : 0.24);
    g.save(); g.translate(px, py + bob);
    g.shadowColor = col; g.shadowBlur = 16;
    g.beginPath(); g.moveTo(0, -r); g.lineTo(r * 0.8, 0); g.lineTo(0, r); g.lineTo(-r * 0.8, 0); g.closePath();
    g.fillStyle = col; g.fill(); g.shadowBlur = 0;
    g.strokeStyle = "rgba(255,255,255,0.8)"; g.lineWidth = 1.2; g.stroke();
    g.beginPath(); g.moveTo(-r * 0.8, 0); g.lineTo(r * 0.8, 0); g.moveTo(0, -r); g.lineTo(-r * 0.3, 0); g.lineTo(0, r);
    g.strokeStyle = "rgba(4, 18, 42, 0.35)"; g.stroke();
    // a glint
    const gl = (now * 0.6 + l.id * 0.37) % 1;
    if (gl < 0.15) { g.globalAlpha = 1 - gl / 0.15; g.fillStyle = "#fff"; circle(g, r * 0.3, -r * 0.4, cs * 0.05); g.fill(); }
    g.restore();
  });

  // lasers
  for (const l of L.lasers) {
    const [x0, y0, x1, y1] = laserBeam(l);
    const off = frame.laserOff.has(l.id), on = !off && laserOn(l, t);
    const [ax, ay] = P(x0, y0), [bx, by] = P(x1, y1);
    g.save();
    if (on) {
      g.strokeStyle = COLORS.red; g.shadowColor = COLORS.red; g.shadowBlur = 14;
      g.lineWidth = 2 + Math.sin(now * 40) * 0.6;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      g.shadowBlur = 0; g.strokeStyle = "#ffd3dc"; g.lineWidth = 0.8; g.stroke();
    } else {
      g.strokeStyle = off ? "rgba(255, 77, 109, 0.15)" : "rgba(255, 77, 109, 0.35)";
      g.setLineDash([2, 5]); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
    }
    g.restore();
    for (const [ex, ey] of [[ax, ay], [bx, by]]) {
      g.fillStyle = off ? "#3a2030" : COLORS.red;
      g.fillRect(ex - cs * 0.08, ey - cs * 0.08, cs * 0.16, cs * 0.16);
    }
    if (!off && l.off && o.mode === "plan" && cs >= 20) {
      // a little timer showing when it flips
      const per = l.on + l.off, u = (((t + (l.offset || 0)) % per) + per) % per;
      const frac = on ? u / l.on : (u - l.on) / l.off;
      const mx = (ax + bx) / 2 + (x0 === x1 ? cs * 0.32 : 0), my = (ay + by) / 2 - (y0 === y1 ? cs * 0.32 : 0);
      g.beginPath(); g.arc(mx, my, cs * 0.13, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - frac));
      g.strokeStyle = on ? COLORS.red : "rgba(255,255,255,0.5)"; g.lineWidth = 2; g.stroke();
    }
  }

  // vision: cameras, then guards
  const seenGlow = o.seen || 0;
  for (const cam of L.cameras) {
    const off = frame.camOff.has(cam.id);
    const ox_ = cam.x + 0.5, oy_ = cam.y + 0.5, ang = cameraAngle(cam, t);
    if (!off) {
      const poly = viewPolygon(L, frame, ox_, oy_, ang, CAMERA_VIEW, 40);
      fillCone(g, P, poly, ox_, oy_, CAMERA_VIEW.range * cs, COLORS.camCone, o.mode === "live" ? 0.22 : 0.17);
    }
    const [px, py] = P(ox_, oy_);
    g.save(); g.translate(px, py); g.rotate(ang);
    roundRect(g, -cs * 0.22, -cs * 0.16, cs * 0.44, cs * 0.32, 3);
    g.fillStyle = off ? "#24324a" : "#cfe6ff"; g.fill();
    g.fillStyle = off ? "#4b5a72" : COLORS.red;
    circle(g, cs * 0.2, 0, cs * 0.08); g.fill();
    g.restore();
    if (!off && Math.floor(now * 2) % 2 === 0) { g.fillStyle = COLORS.red; circle(g, px - cs * 0.1, py - cs * 0.2, 2.2); g.fill(); }
  }
  L.guards.forEach((gd, gi) => {
    const down = frame.down.get(gi);
    if (down) {
      const [px, py] = P(down.x, down.y);
      g.save(); g.translate(px, py); g.rotate(down.angle + Math.PI / 2);
      g.fillStyle = "#5a3a40"; g.strokeStyle = "#a06070"; g.lineWidth = 1.5;
      roundRect(g, -cs * 0.34, -cs * 0.18, cs * 0.68, cs * 0.36, cs * 0.18); g.fill(); g.stroke();
      g.restore();
      g.fillStyle = "rgba(255, 200, 210, 0.8)"; g.font = `700 ${cs * 0.26}px "Chakra Petch"`;
      g.textAlign = "center"; g.fillText("z z", px + cs * 0.1, py - cs * 0.32 - Math.sin(now * 2) * 2);
      return;
    }
    const s = guardAt(gd, t);
    const poly = viewPolygon(L, frame, s.x, s.y, s.angle, GUARD_VIEW, 44);
    fillCone(g, P, poly, s.x, s.y, GUARD_VIEW.range * cs, COLORS.cone, o.mode === "live" ? 0.26 : 0.2);
  });
  // patrol routes (planning)
  if (o.mode === "plan") {
    g.save(); g.strokeStyle = "rgba(255, 107, 90, 0.28)"; g.lineWidth = 1.5; g.setLineDash([2, 6]);
    for (const gd of L.guards) {
      const pts = gd.legs.filter(l => l.kind === "walk");
      if (!pts.length) continue;
      g.beginPath();
      pts.forEach((leg, k) => {
        const [ax, ay] = P(leg.from[0], leg.from[1]), [bx, by] = P(leg.to[0], leg.to[1]);
        if (!k) g.moveTo(ax, ay);
        g.lineTo(bx, by);
      });
      g.stroke();
    }
    g.restore();
  }
  L.guards.forEach((gd, gi) => {
    if (frame.down.has(gi)) return;
    const s = guardAt(gd, t);
    const [px, py] = P(s.x, s.y);
    g.save(); g.translate(px, py);
    g.shadowColor = COLORS.guard; g.shadowBlur = 12;
    circle(g, 0, 0, cs * 0.32); g.fillStyle = COLORS.guard; g.fill(); g.shadowBlur = 0;
    g.lineWidth = 2; g.strokeStyle = "#2a0a10"; g.stroke();
    g.rotate(s.angle);
    g.fillStyle = "#fff4c2";
    g.beginPath(); g.moveTo(cs * 0.14, -cs * 0.12); g.lineTo(cs * 0.4, 0); g.lineTo(cs * 0.14, cs * 0.12); g.closePath(); g.fill();
    g.restore();
    // a cap
    g.fillStyle = "#2a0a10"; circle(g, px, py, cs * 0.12); g.fill();
  });

  // brick's reach while waiting in ambush
  frame.crew.forEach((c, i) => {
    if (c.escaped || c.busyKind !== "ambush") return;
    const [px, py] = P(c.x, c.y);
    g.save(); g.strokeStyle = "rgba(255, 179, 71, 0.6)"; g.setLineDash([4, 4]); g.lineWidth = 1.5;
    g.lineDashOffset = -now * 10;
    circle(g, px, py, TAKEDOWN_REACH * cs); g.stroke(); g.restore();
  });

  // crew
  frame.crew.forEach((c, i) => {
    if (c.escaped) return;
    const role = L.crew[i], col = ROLES[role].colour, [px, py] = P(c.x, c.y);
    g.save();
    if (c.seen > 0) {
      g.fillStyle = `rgba(255, 77, 109, ${0.25 + 0.5 * c.seen})`;
      circle(g, px, py, cs * (0.45 + 0.25 * c.seen)); g.fill();
    }
    g.shadowColor = col; g.shadowBlur = o.selected === i ? 22 : 12;
    circle(g, px, py, cs * 0.31); g.fillStyle = col; g.fill(); g.shadowBlur = 0;
    g.lineWidth = o.selected === i ? 3 : 2; g.strokeStyle = o.selected === i ? "#fff" : "#04122a"; g.stroke();
    g.fillStyle = "#04122a"; g.font = `700 ${cs * 0.32}px "Chakra Petch"`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(ROLES[role].name[0], px, py + 1);
    if (c.busyKind && c.busyKind !== "ambush" && c.busyTotal > 0) {
      const f = 1 - c.busy / c.busyTotal;
      const rc = { wait: "rgba(219,233,255,0.7)", hack: COLORS.terminal, grab: COLORS.gold, takedown: COLORS.door }[c.busyKind];
      g.beginPath(); g.arc(px, py, cs * 0.42, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f);
      g.strokeStyle = rc; g.lineWidth = 3; g.stroke();
    }
    if (c.carry > 0) {
      g.fillStyle = COLORS.gold;
      for (let k = 0; k < c.carry; k++) {
        const ax = px + cs * 0.3 - k * cs * 0.16, ay = py - cs * 0.3;
        g.beginPath(); g.moveTo(ax, ay - 4); g.lineTo(ax + 3.5, ay); g.lineTo(ax, ay + 4); g.lineTo(ax - 3.5, ay); g.fill();
      }
    }
    if (c.blocked) {
      g.fillStyle = COLORS.door; g.font = `700 ${cs * 0.34}px "Chakra Petch"`;
      g.fillText("…", px, py - cs * 0.55);
    }
    g.restore();
  });

  // effects (live): bursts and rings
  for (const fx of o.effects || []) {
    const age = now - fx.at;
    if (age < 0 || age > fx.life) continue;
    const f = age / fx.life, [px, py] = P(fx.x, fx.y);
    g.save(); g.globalAlpha = 1 - f;
    g.strokeStyle = fx.colour; g.lineWidth = 2.5;
    circle(g, px, py, cs * (0.3 + f * (fx.size || 1.2))); g.stroke();
    if (fx.text) {
      g.fillStyle = fx.colour; g.font = `700 ${Math.max(12, cs * 0.34)}px "Chakra Petch"`;
      g.textAlign = "center"; g.fillText(fx.text, px, py - cs * (0.6 + f * 0.6));
    }
    g.restore();
  }

  // the alarm
  if (o.alarm) {
    const [px, py] = P(o.alarm.x, o.alarm.y), age = now - o.alarm.shownAt;
    g.save();
    for (let k = 0; k < 3; k++) {
      const f = ((age * 0.8 + k / 3) % 1);
      g.globalAlpha = 1 - f; g.strokeStyle = COLORS.red; g.lineWidth = 3;
      circle(g, px, py, cs * (0.4 + f * 2.2)); g.stroke();
    }
    g.globalAlpha = 1; g.fillStyle = COLORS.red; g.font = `700 ${cs * 0.9}px "Chakra Petch"`;
    g.textAlign = "center"; g.textBaseline = "alphabetic";
    g.shadowColor = COLORS.red; g.shadowBlur = 20;
    g.fillText("!", px, py - cs * 0.5);
    g.restore();
  }
}

function fillCone(g, P, poly, ox, oy, rpx, rgb, alpha) {
  const [cx, cy] = P(ox, oy);
  const grad = g.createRadialGradient(cx, cy, 0, cx, cy, rpx);
  grad.addColorStop(0, `rgba(${rgb}, ${alpha * 1.6})`);
  grad.addColorStop(0.7, `rgba(${rgb}, ${alpha})`);
  grad.addColorStop(1, `rgba(${rgb}, ${alpha * 0.25})`);
  g.beginPath();
  poly.forEach(([x, y], k) => { const [px, py] = P(x, y); k ? g.lineTo(px, py) : g.moveTo(px, py); });
  g.closePath();
  g.fillStyle = grad; g.fill();
  g.strokeStyle = `rgba(${rgb}, ${alpha * 1.8})`; g.lineWidth = 1; g.stroke();
}

// ------------------------------------------------------------ thumbnails --
export function drawThumb(canvas, L) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 320, h = canvas.clientHeight || 170;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const view = fitView(L, w, h, 12);
  const st = drawStatic(L, view, dpr);
  const g = canvas.getContext("2d");
  g.drawImage(st, 0, 0);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const frame = {
    t: 2, doorShut: new Set(L.doors.map(d => d.y * L.w + d.x)), camOff: new Set(), laserOff: new Set(),
    hacked: new Set(), lootTaken: new Map(), down: new Map(),
    crew: L.crew.map((r, i) => ({ x: L.spawns[i][0] + 0.5, y: L.spawns[i][1] + 0.5, escaped: false, busy: 0, seen: 0, carry: 0 })),
  };
  drawScene(g, L, view, frame, { mode: "thumb", now: 0 });
}
