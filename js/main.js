import { LEVELS } from "./levels.js";
import { ROLES, parseLevel, simulate, frameAt, stars, findPath, planPaths, walkable, DT } from "./sim.js";
import { fitView, drawStatic, drawScene, drawThumb, COLORS } from "./render.js";
import { sfx, startSiren, stopSiren, isMuted, setMuted, unlock } from "./audio.js";

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem("heist:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("heist:" + k, JSON.stringify(v)); } catch {} },
};
const fmt = (t) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
};

// ---------------------------------------------------------------- screens --
let screen = "title";
function show(name) {
  for (const s of ["title", "select", "game"]) $(s).classList.toggle("hidden", s !== name);
  screen = name;
  if (name === "select") buildSelect();
}

function soundIcon() {
  for (const b of [$("sound-title"), $("sound-game")]) b.textContent = isMuted() ? "🔇" : "🔊";
}
for (const b of [$("sound-title"), $("sound-game")])
  b.addEventListener("click", () => { setMuted(!isMuted()); soundIcon(); sfx.click(); });
soundIcon();

document.addEventListener("pointerdown", unlock, { once: true });
document.addEventListener("keydown", unlock, { once: true });

$("play-btn").onclick = () => { sfx.click(); show("select"); };
$("how-btn").onclick = () => { sfx.click(); openHelp(); };
$("select-back").onclick = () => { sfx.click(); show("title"); };
$("help-close").onclick = () => { sfx.click(); $("help").classList.add("hidden"); };
$("help").addEventListener("click", (e) => { if (e.target === $("help")) $("help").classList.add("hidden"); });

function crewCardHTML(role, extra = "") {
  const r = ROLES[role];
  return `<div class="avatar">${r.name[0]}</div>
    <div><div class="who">${r.name}<small>${r.title}</small></div><div class="ability">${r.ability}</div></div>${extra}`;
}

function openHelp() {
  $("crew-help").innerHTML = Object.keys(ROLES).map(role =>
    `<div class="crew-card" style="--c:${ROLES[role].colour}">${crewCardHTML(role)}</div>`).join("");
  $("help").classList.remove("hidden");
}

// ----------------------------------------------------------- level select --
const progress = () => store.get("progress", {});
function unlocked(i) { return i === 0 || (progress()[LEVELS[i - 1].id]?.stars || 0) > 0; }

function buildSelect() {
  const grid = $("level-grid"), prog = progress();
  grid.innerHTML = "";
  let total = 0;
  LEVELS.forEach((def, i) => {
    const p = prog[def.id] || {}, open = unlocked(i);
    total += p.stars || 0;
    const card = document.createElement("button");
    card.className = "level-card" + (open ? "" : " locked");
    card.innerHTML = `<canvas></canvas><div class="info">
      <div class="num">JOB ${String(i + 1).padStart(2, "0")}</div>
      <div class="name">${def.name}</div>
      <div class="brief">${def.brief}</div>
      <div class="meta">
        <div class="stars">${[0, 1, 2].map(k => `<span class="${k < (p.stars || 0) ? "on" : ""}">★</span>`).join("")}</div>
        <div class="crew-dots">${def.crew.map(r => `<span style="background:${ROLES[r].colour}" title="${ROLES[r].name}"></span>`).join("")}</div>
        <div class="best">${p.best ? "best " + fmt(p.best) : "par " + fmt(def.par)}</div>
      </div></div>`;
    if (open) card.onclick = () => { sfx.click(); startLevel(i); };
    card.onmouseenter = () => open && sfx.hover();
    grid.appendChild(card);
    requestAnimationFrame(() => drawThumb(card.querySelector("canvas"), parseLevel(def)));
  });
  $("total-stars").textContent = `★ ${total} / ${LEVELS.length * 3}`;
}

// ------------------------------------------------------------------ game --
const G = {
  idx: 0, def: null, L: null, plan: [], selected: 0, undo: [], redo: [],
  preview: null, t: 0, playing: false, speed: 1,
  mode: "plan", live: null, liveT: 0, evIdx: 0, effects: [], alarmFx: null,
  hover: null, hoverPath: null, hoverOk: false, lastFail: null,
  view: null, staticImg: null, dpr: 1, hint: 0, flash: 0, stepped: 0,
};

function startLevel(i) {
  G.idx = i;
  G.def = LEVELS[i];
  G.L = parseLevel(G.def);
  const saved = store.get("plan:" + G.def.id, null);
  G.plan = (saved && saved.length === G.L.crew.length) ? saved : G.L.crew.map(() => []);
  G.selected = 0; G.undo = []; G.redo = []; G.t = 0; G.playing = false;
  G.mode = "plan"; G.live = null; G.lastFail = null; G.effects = [];
  $("level-name").textContent = `${String(i + 1).padStart(2, "0")} · ${G.def.name}`;
  show("game");
  layout();
  replan(false);
  // tips
  G.hint = 0;
  const seen = store.get("hints-seen", {});
  if (G.def.hints?.length && !seen[G.def.id]) showHint(); else $("coach").classList.add("hidden");
  $("result").classList.add("hidden");
  setMode("plan");
}

function showHint() {
  const h = G.def.hints;
  $("coach").classList.remove("hidden");
  $("coach-text").textContent = h[G.hint];
  $("coach-count").textContent = `TIP ${G.hint + 1}/${h.length}`;
  $("coach-next").textContent = G.hint + 1 < h.length ? "Next tip" : "Done";
}
$("coach-next").onclick = () => {
  sfx.click();
  if (G.hint + 1 < G.def.hints.length) { G.hint++; showHint(); }
  else closeHints();
};
$("coach-close").onclick = () => { sfx.click(); closeHints(); };
function closeHints() {
  $("coach").classList.add("hidden");
  const seen = store.get("hints-seen", {}); seen[G.def.id] = true; store.set("hints-seen", seen);
}

function layout() {
  const c = $("map"), r = c.getBoundingClientRect();
  G.dpr = window.devicePixelRatio || 1;
  c.width = Math.round(r.width * G.dpr); c.height = Math.round(r.height * G.dpr);
  if (!G.L) return;
  G.view = fitView(G.L, r.width, r.height, 28);
  G.staticImg = drawStatic(G.L, G.view, G.dpr);
  const tl = $("timeline"), tr = tl.getBoundingClientRect();
  tl.width = Math.round(tr.width * G.dpr); tl.height = Math.round(tr.height * G.dpr);
}
window.addEventListener("resize", () => { if (screen === "game") layout(); });
// the top bar can grow (objectives wrap), so watch the stage itself
new ResizeObserver(() => { if (screen === "game") layout(); }).observe($("stage"));
new ResizeObserver(() => { if (screen === "game") layout(); }).observe($("timeline"));

// -------------------------------------------------------------- planning --
function snapshot() { return JSON.stringify(G.plan); }
function edit(fn, sound = true) {
  const before = snapshot();
  const ok = fn();
  if (ok === false) return false;
  if (snapshot() === before) return false;
  G.undo.push(before); if (G.undo.length > 200) G.undo.shift();
  G.redo = [];
  G.lastFail = null;
  replan();
  if (sound) sfx.place(G.L.crew[G.selected]);
  return true;
}
function undo() {
  if (!G.undo.length || G.mode !== "plan") return;
  G.redo.push(snapshot()); G.plan = JSON.parse(G.undo.pop()); replan(); sfx.remove();
}
function redo() {
  if (!G.redo.length || G.mode !== "plan") return;
  G.undo.push(snapshot()); G.plan = JSON.parse(G.redo.pop()); replan(); sfx.place(G.L.crew[G.selected]);
}

function replan(save = true) {
  G.preview = simulate(G.L, G.plan, { detect: false });
  G.paths = planPaths(G.L, G.plan);
  if (save) store.set("plan:" + G.def.id, G.plan);
  renderSidebar();
  renderObjectives();
}

function lastCell(i) {
  const steps = G.paths?.[i] || [];
  return steps.length ? steps[steps.length - 1].at : G.L.spawns[i];
}

function toast(text, bad = false) {
  const el = $("toast");
  el.textContent = text;
  el.className = "toast show" + (bad ? " bad" : "");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), 2200);
}

function addMove(x, y) {
  const from = lastCell(G.selected);
  if (from[0] === x && from[1] === y) return false;
  if (!walkable(G.L, x, y)) return false;
  if (!findPath(G.L, from, [x, y])) { toast("No way to get there.", true); sfx.error(); return false; }
  return edit(() => { G.plan[G.selected].push({ type: "move", x, y }); });
}

// walk next to something (loot, a terminal) and act on it, in one click
function goAndDo(tx, ty, act) {
  const from = lastCell(G.selected);
  const near = Math.abs(from[0] - tx) <= 1 && Math.abs(from[1] - ty) <= 1;
  let best = null;
  if (!near) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx, y = ty + dy;
      if ((dx || dy) && walkable(G.L, x, y)) {
        const p = findPath(G.L, from, [x, y]);
        if (p && (!best || p.length < best.len)) best = { x, y, len: p.length };
      }
    }
    if (!best) { toast("Can't reach that.", true); sfx.error(); return; }
  }
  edit(() => {
    if (best) G.plan[G.selected].push({ type: "move", x: best.x, y: best.y });
    G.plan[G.selected].push({ type: act });
  });
}

function addAction(act) {
  if (G.mode !== "plan") return;
  const role = G.L.crew[G.selected];
  if (act === "hack" && role !== "wire") { toast("Only Wire can hack.", true); sfx.error(); return; }
  if (act === "ambush" && role !== "brick") { toast("Only Brick can ambush.", true); sfx.error(); return; }
  if (act === "wait") {
    edit(() => {
      const steps = G.plan[G.selected], last = steps[steps.length - 1];
      if (last && last.type === "wait") last.t = Math.min(30, +(last.t + 1).toFixed(2));
      else steps.push({ type: "wait", t: 1 });
    }, false);
    sfx.wait();
    return;
  }
  edit(() => { G.plan[G.selected].push({ type: act }); });
}

function removeLast() {
  if (G.mode !== "plan") return;
  if (edit(() => { G.plan[G.selected].pop(); }, false)) sfx.remove();
}

function select(i) {
  if (i < 0 || i >= G.L.crew.length || i === G.selected) return;
  G.selected = i;
  sfx.select(G.L.crew[i]);
  renderSidebar();
}

document.querySelectorAll(".act").forEach(b => b.addEventListener("click", () => { sfx.click(); addAction(b.dataset.act); }));
$("undo-btn").onclick = undo;
$("redo-btn").onclick = redo;
$("reset-btn").onclick = () => {
  if (G.mode !== "plan") return;
  if (edit(() => { G.plan = G.L.crew.map(() => []); }, false)) { sfx.remove(); toast("Plan cleared. Undo brings it back."); }
};
$("game-back").onclick = () => { sfx.click(); leaveGame(); };
function leaveGame() { stopSiren(); G.playing = false; show("select"); }

// ---------------------------------------------------------------- sidebar --
const STEP_ICON = { move: "→", wait: "⏱", grab: "◆", hack: "⌁", ambush: "✊" };
function stepLabel(s) {
  if (s.type === "move") return `Walk to ${s.x}, ${s.y}`;
  if (s.type === "wait") return "Wait";
  if (s.type === "grab") return "Grab loot";
  if (s.type === "hack") return "Hack terminal";
  if (s.type === "ambush") return "Ambush a guard";
  return s.type;
}

function renderSidebar() {
  const L = G.L, list = $("crew-list");
  list.innerHTML = "";
  L.crew.forEach((role, i) => {
    const b = document.createElement("button");
    b.className = "crew-card" + (i === G.selected ? " on" : "");
    b.style.setProperty("--c", ROLES[role].colour);
    const n = G.plan[i].length;
    b.innerHTML = crewCardHTML(role, `<div class="key">${i + 1}</div>`);
    b.title = `${n} step${n === 1 ? "" : "s"}`;
    b.onclick = () => select(i);
    list.appendChild(b);
  });
  const role = L.crew[G.selected], r = ROLES[role];
  $("plan-title").textContent = `${r.name}'s plan`;
  $("plan-title").style.color = r.colour;
  const times = G.preview.stepTimes[G.selected];
  const fin = times.length && times[times.length - 1].end != null ? times[times.length - 1].end : null;
  $("plan-sub").textContent = G.plan[G.selected].length ? (fin != null ? `done at ${fmt(fin)}` : "") : "";
  const ol = $("steps");
  ol.innerHTML = "";
  G.plan[G.selected].forEach((s, si) => {
    const li = document.createElement("li");
    li.className = "step";
    const tm = times[si] || {};
    const when = tm.start != null ? `${fmt(tm.start)}${tm.end != null ? "–" + fmt(tm.end) : "…"}` : "never";
    let extra = "";
    if (tm.error) extra = `<span class="err">${tm.error}</span>`;
    else if (tm.blocked > 0.05) extra = `<span class="blk">waits ${tm.blocked.toFixed(1)}s at a locked door</span>`;
    else if (s.type === "ambush" && tm.end == null && tm.start != null) extra = `<span class="blk">no guard ever comes close</span>`;
    const mid = s.type === "wait"
      ? `<span class="wait-ctl">Wait <button data-d="-0.5" title="Shorter">−</button><b>${s.t.toFixed(1)}s</b><button data-d="0.5" title="Longer">+</button></span>`
      : stepLabel(s);
    li.innerHTML = `<span class="n">${si + 1}</span><span class="ic">${STEP_ICON[s.type]}</span><span class="main">${mid}<span class="t">${when}</span>${extra}</span><button class="x" title="Remove step">×</button>`;
    li.querySelector(".x").onclick = () => { if (G.mode === "plan" && edit(() => { G.plan[G.selected].splice(si, 1); }, false)) sfx.remove(); };
    li.querySelectorAll(".wait-ctl button").forEach(btn => btn.onclick = () => {
      if (G.mode !== "plan") return;
      const d = +btn.dataset.d;
      edit(() => { const w = G.plan[G.selected][si]; w.t = Math.max(0.5, Math.min(30, +(w.t + d).toFixed(2))); }, false);
      sfx.wait();
    });
    li.onmouseenter = () => { G.hotStep = si; };
    li.onmouseleave = () => { G.hotStep = null; };
    li.onclick = (e) => {
      if (e.target.closest("button")) return;
      if (tm.start != null) { G.t = tm.start; G.playing = false; }
    };
    ol.appendChild(li);
  });
  ol.scrollTop = ol.scrollHeight;
  document.querySelectorAll(".act").forEach(b => {
    const a = b.dataset.act;
    b.disabled = G.mode !== "plan" || (a === "hack" && role !== "wire") || (a === "ambush" && role !== "brick");
    b.classList.toggle("hidden", (a === "hack" && !L.crew.includes("wire")) || (a === "ambush" && !L.crew.includes("brick")));
  });
  $("undo-btn").disabled = !G.undo.length || G.mode !== "plan";
  $("redo-btn").disabled = !G.redo.length || G.mode !== "plan";
}

function renderObjectives() {
  const L = G.L, req = L.loot.filter(l => l.required).length, bonus = L.loot.length - req;
  const chips = [
    `<span class="chip">◆ steal the score</span>`,
    bonus ? `<span class="chip" style="color:${COLORS.purple}">◆ bonus ×${bonus}</span>` : "",
    `<span class="chip">everyone to the exit</span>`,
    `<span class="chip" style="color:${COLORS.gold}">par ${fmt(G.def.par)}</span>`,
    `<span class="chip">limit ${fmt(G.def.limit)}</span>`,
  ];
  $("objectives").innerHTML = chips.join("");
}

// ----------------------------------------------------------------- the map --
function cellAt(e) {
  const r = $("map").getBoundingClientRect(), v = G.view;
  const x = Math.floor((e.clientX - r.left - v.ox) / v.cs), y = Math.floor((e.clientY - r.top - v.oy) / v.cs);
  if (x < 0 || y < 0 || x >= G.L.w || y >= G.L.h) return null;
  return [x, y];
}

$("map").addEventListener("pointermove", (e) => {
  if (screen !== "game" || !G.view) return;
  const c = cellAt(e);
  G.hover = c;
  G.hoverPath = null; G.hoverOk = false;
  G.linksFor = null;
  if (c && G.mode === "plan") {
    const term = G.L.terminals.find(t => t.x === c[0] && t.y === c[1]);
    if (term) G.linksFor = term.id;
    const target = walkable(G.L, c[0], c[1]);
    if (target) {
      const p = findPath(G.L, lastCell(G.selected), c);
      G.hoverOk = !!p;
      if (p) G.hoverPath = [lastCell(G.selected), ...p];
    } else {
      G.hoverOk = !!(term || G.L.loot.find(l => l.x === c[0] && l.y === c[1]));
    }
  }
  $("map").style.cursor = G.mode === "plan" && c && (G.hoverOk || crewAt(e) != null) ? "pointer" : "default";
});
$("map").addEventListener("pointerleave", () => { G.hover = null; G.hoverPath = null; });

function crewAt(e) {
  const r = $("map").getBoundingClientRect(), v = G.view;
  const px = (e.clientX - r.left - v.ox) / v.cs, py = (e.clientY - r.top - v.oy) / v.cs;
  const frame = frameAt(G.preview, G.t);
  for (let i = 0; i < G.L.crew.length; i++) {
    const c = frame.crew[i];
    if (!c.escaped && Math.hypot(c.x - px, c.y - py) < 0.45) return i;
  }
  return null;
}

$("map").addEventListener("pointerdown", (e) => {
  if (screen !== "game" || G.mode !== "plan") return;
  if (e.button === 2) { removeLast(); return; }
  if (e.button !== 0) return;
  const who = crewAt(e);
  if (who != null && who !== G.selected) { select(who); return; }
  const c = cellAt(e);
  if (!c) return;
  const [x, y] = c;
  const loot = G.L.loot.find(l => l.x === x && l.y === y);
  const term = G.L.terminals.find(t => t.x === x && t.y === y);
  if (term) {
    if (G.L.crew[G.selected] !== "wire") { toast("Only Wire can hack terminals.", true); sfx.error(); return; }
    goAndDo(x, y, "hack");
    return;
  }
  if (loot && !(lastCell(G.selected)[0] === x && lastCell(G.selected)[1] === y)) {
    // stand on it or next to it, then grab
    addMove(x, y) && edit(() => { G.plan[G.selected].push({ type: "grab" }); }, false);
    return;
  }
  if (walkable(G.L, x, y)) addMove(x, y);
});
$("map").addEventListener("contextmenu", (e) => e.preventDefault());

// --------------------------------------------------------------- timeline --
const TL = { pad: 16, ruler: 20 };
function tlSpan() {
  let end = 0;
  G.preview.stepTimes.forEach(ts => ts.forEach(s => { if (s.end != null) end = Math.max(end, s.end); else if (s.start != null) end = Math.max(end, s.start + 3); }));
  if (G.mode !== "plan" && G.live) end = Math.max(end, G.live.endTime);
  if (G.lastFail) end = Math.max(end, G.lastFail.t);
  return Math.min(G.def.limit, Math.max(12, Math.ceil((end + 4) / 2) * 2));
}
function tlX(t, w, span) { return TL.pad + (t / span) * (w - TL.pad * 2); }
function tlT(x, w, span) { return Math.max(0, Math.min(span, ((x - TL.pad) / (w - TL.pad * 2)) * span)); }

let scrubbing = false;
$("timeline").addEventListener("pointerdown", (e) => {
  if (G.mode !== "plan") return;
  scrubbing = true;
  $("timeline").setPointerCapture(e.pointerId);
  scrubTo(e);
  G.playing = false;
});
$("timeline").addEventListener("pointermove", (e) => { if (scrubbing) scrubTo(e); });
$("timeline").addEventListener("pointerup", () => { scrubbing = false; });
function scrubTo(e) {
  const r = $("timeline").getBoundingClientRect();
  const t = tlT(e.clientX - r.left, r.width, tlSpan());
  if (Math.abs(t - G.t) > 0.25) sfx.hover();
  G.t = t;
}

function drawTimeline() {
  const c = $("timeline"), g = c.getContext("2d"), w = c.width / G.dpr, h = c.height / G.dpr;
  g.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const span = tlSpan(), L = G.L;
  const rows = L.crew.length, top = TL.ruler + 4, rowH = Math.min(30, (h - top - 18) / rows);
  // ruler
  g.fillStyle = "#0a1a36"; g.fillRect(0, 0, w, TL.ruler);
  const step = span > 60 ? 10 : span > 24 ? 5 : span > 12 ? 2 : 1;
  g.font = '11px "IBM Plex Mono"'; g.textBaseline = "middle";
  for (let s = 0; s <= span + 1e-6; s += step / (step >= 5 ? 5 : 2)) {
    const x = tlX(s, w, span), major = Math.abs(s / step - Math.round(s / step)) < 1e-6;
    g.strokeStyle = major ? "rgba(143,195,255,0.35)" : "rgba(143,195,255,0.12)";
    g.beginPath(); g.moveTo(x + 0.5, major ? 6 : 13); g.lineTo(x + 0.5, h); g.stroke();
    if (major) { g.fillStyle = "#7f9cc7"; g.textAlign = "left"; g.fillText(fmt(s).replace(/\.0$/, ""), x + 4, 10); }
  }
  // par
  if (G.def.par <= span) {
    const x = tlX(G.def.par, w, span);
    g.strokeStyle = "rgba(255, 209, 102, 0.6)"; g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(x + 0.5, TL.ruler); g.lineTo(x + 0.5, h); g.stroke(); g.setLineDash([]);
    g.fillStyle = COLORS.gold; g.textAlign = "center"; g.fillText("PAR", x, h - 8);
  }
  // tracks
  const run = G.mode === "plan" ? G.preview : G.live;
  L.crew.forEach((role, i) => {
    const y = top + i * rowH, col = ROLES[role].colour, sel = i === G.selected;
    g.fillStyle = sel ? "rgba(79, 209, 255, 0.06)" : "rgba(255,255,255,0.015)";
    g.fillRect(0, y, w, rowH - 3);
    g.fillStyle = col; g.fillRect(0, y, 3, rowH - 3);
    const steps = (G.mode === "plan" ? G.plan : G.livePlan)[i];
    run.stepTimes[i].forEach((tm, si) => {
      if (tm.start == null) return;
      const s = steps[si], end = tm.end ?? Math.min(span, run.endTime);
      const x0 = tlX(tm.start, w, span), x1 = Math.max(x0 + 2, tlX(end, w, span));
      const hot = sel && G.hotStep === si;
      if (tm.error) { g.strokeStyle = COLORS.red; g.strokeRect(x0, y + 4, Math.max(6, x1 - x0), rowH - 11); return; }
      if (s.type === "move") {
        g.fillStyle = col; g.globalAlpha = hot ? 1 : 0.55;
        g.fillRect(x0, y + rowH / 2 - 3, x1 - x0, 4);
        if (tm.blocked > 0.05) {
          const bx = tlX(end - tm.blocked, w, span);
          g.fillStyle = COLORS.door; g.globalAlpha = 0.8;
          for (let k = bx; k < x1; k += 5) g.fillRect(k, y + 5, 2, rowH - 13);
        }
        g.globalAlpha = 1;
        g.fillStyle = col; g.beginPath(); g.arc(x1, y + rowH / 2 - 1, 3, 0, Math.PI * 2); g.fill();
      } else {
        const fill = { wait: "rgba(219,233,255,0.16)", grab: COLORS.gold, hack: COLORS.terminal, ambush: COLORS.door }[s.type];
        g.fillStyle = fill; g.globalAlpha = s.type === "wait" ? 1 : (hot ? 1 : 0.85);
        const bw = Math.max(4, x1 - x0);
        g.fillRect(x0, y + 4, bw, rowH - 11);
        if (s.type === "wait") {
          g.strokeStyle = "rgba(219,233,255,0.35)"; g.save(); g.beginPath(); g.rect(x0, y + 4, bw, rowH - 11); g.clip();
          for (let k = x0 - rowH; k < x1; k += 6) { g.beginPath(); g.moveTo(k, y + rowH - 7); g.lineTo(k + rowH, y + 4 - 7 + 7); g.stroke(); }
          g.restore();
        }
        g.globalAlpha = 1;
        if (bw > 16) {
          g.fillStyle = s.type === "wait" ? "#dbe9ff" : "#04122a"; g.textAlign = "center"; g.font = '600 11px "Chakra Petch"';
          g.fillText(s.type === "wait" ? s.t.toFixed(1) + "s" : STEP_ICON[s.type], x0 + bw / 2, y + rowH / 2 - 1);
        }
        if (hot) { g.strokeStyle = "#fff"; g.strokeRect(x0 + 0.5, y + 4.5, bw - 1, rowH - 12); }
      }
    });
    // escape mark
    const esc = run.events.find(ev => ev.kind === "escape" && ev.crew === i);
    if (esc) { const x = tlX(esc.t, w, span); g.fillStyle = COLORS.exit; g.font = '700 11px "Chakra Petch"'; g.textAlign = "left"; g.fillText("OUT", x + 3, y + rowH / 2 - 1); }
  });
  // events
  for (const ev of run.events) {
    if (ev.kind === "escape" || ev.kind === "alarm") continue;
    const x = tlX(ev.t, w, span), y = h - 9;
    const col = { hack: COLORS.terminal, grab: COLORS.gold, takedown: COLORS.door }[ev.kind] || "#fff";
    g.fillStyle = col; g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 4, y); g.lineTo(x, y + 5); g.lineTo(x - 4, y); g.fill();
  }
  // where the last run went wrong
  const fail = G.mode !== "plan" ? (G.live.outcome.alarm && G.liveT >= G.live.outcome.t ? G.live.outcome : null) : G.lastFail;
  if (fail && fail.t <= span) {
    const x = tlX(fail.t, w, span);
    g.strokeStyle = COLORS.red; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, TL.ruler); g.lineTo(x, h); g.stroke(); g.lineWidth = 1;
    g.fillStyle = COLORS.red; g.font = '700 11px "Chakra Petch"'; g.textAlign = "left";
    g.fillText(G.mode !== "plan" ? "ALARM" : "BUSTED HERE", x + 4, h - 8);
  }
  // playhead
  const t = G.mode === "plan" ? G.t : G.liveT, x = tlX(Math.min(t, span), w, span);
  g.strokeStyle = "#fff"; g.lineWidth = 2;
  g.beginPath(); g.moveTo(x, TL.ruler - 2); g.lineTo(x, h); g.stroke(); g.lineWidth = 1;
  g.fillStyle = "#fff"; g.beginPath(); g.moveTo(x - 6, 0); g.lineTo(x + 6, 0); g.lineTo(x, 9); g.fill();
}

// --------------------------------------------------------------- running --
function setMode(m) {
  G.mode = m;
  const live = m !== "plan";
  $("live").classList.toggle("hidden", m !== "live");
  $("plan-tools").style.visibility = live ? "hidden" : "visible";
  $("execute-btn").textContent = live ? "Abort ✕" : "Execute ▶";
  $("execute-btn").classList.toggle("danger", live);
  $("execute-btn").classList.toggle("primary", !live);
  $("execute-btn").classList.toggle("hidden", m === "result");
  $("sidebar").classList.toggle("locked", live);
  if (live) $("coach").classList.add("hidden");
  $("tl-note").textContent = live ? "No touching now. It's all up to the plan." :
    "Drag the timeline to see every moment of the plan.";
  if (G.L) renderSidebar();
}

function execute() {
  if (G.mode === "live") { abort(); return; }
  if (G.plan.every(s => !s.length)) { toast("Plan something first: click the blueprint.", true); sfx.error(); return; }
  G.livePlan = JSON.parse(JSON.stringify(G.plan));
  G.live = simulate(G.L, G.livePlan, { detect: true });
  G.liveT = 0; G.evIdx = 0; G.effects = []; G.alarmFx = null; G.flash = 0; G.stepped = 0;
  G.endAt = null; G.paused = false;
  G.playing = false;
  $("result").classList.add("hidden");
  setMode("live");
  sfx.go();
  banner("Go time.", 1400);
}
function abort() {
  stopSiren();
  setMode("plan");
  $("result").classList.add("hidden");
  $("banner").classList.add("hidden");
}
$("execute-btn").onclick = () => { sfx.click(); execute(); };

function banner(text, ms) {
  const b = $("banner");
  b.textContent = text; b.classList.remove("hidden");
  clearTimeout(banner.t);
  banner.t = setTimeout(() => b.classList.add("hidden"), ms);
}

function liveEvents(now) {
  const evs = G.live.events;
  while (G.evIdx < evs.length && evs[G.evIdx].t <= G.liveT) {
    const ev = evs[G.evIdx++];
    const L = G.L;
    if (ev.kind === "grab") { sfx.grab(); G.effects.push({ x: ev.x, y: ev.y, at: now, life: 0.8, colour: COLORS.gold, text: "+LOOT" }); }
    if (ev.kind === "hack") {
      sfx.hackDone();
      G.effects.push({ x: ev.x, y: ev.y, at: now, life: 0.9, colour: COLORS.terminal, size: 2, text: "HACKED" });
      const links = L.links[L.terminals.find(t => Math.abs(t.x + 0.5 - ev.x) < 0.1 && Math.abs(t.y + 0.5 - ev.y) < 0.1)?.id] || [];
      if (links.some(id => id[0] === "D")) setTimeout(() => sfx.door(), 120);
    }
    if (ev.kind === "takedown") { sfx.takedown(); G.effects.push({ x: ev.x, y: ev.y, at: now, life: 0.7, colour: COLORS.door, size: 1.6, text: "THUD" }); }
    if (ev.kind === "escape") { sfx.escape(); G.effects.push({ x: ev.x, y: ev.y, at: now, life: 0.8, colour: COLORS.exit, text: "OUT" }); }
    if (ev.kind === "alarm") {
      G.alarmFx = { x: ev.x, y: ev.y, shownAt: now };
      startSiren();
      G.flash = 1;
      banner(ev.text, 4000);
    }
  }
}

function finish() {
  const run = G.live, o = run.outcome, L = G.L, def = G.def;
  setMode("result");
  const card = document.createElement("div");
  const win = o.result === "success";
  const s = stars(L, run);
  const prog = progress(), p = prog[def.id] || {};
  let newBest = false;
  if (win) {
    newBest = !p.best || o.t < p.best;
    prog[def.id] = { stars: Math.max(p.stars || 0, s), best: Math.min(p.best || Infinity, o.t) };
    store.set("progress", prog);
  }
  const bonusTotal = L.loot.filter(l => !l.required).length;
  const why = {
    success: newBest && p.best ? "A new best. Clean getaway." : "Clean getaway.",
    alarm: o.alarm?.reason + ".",
    noloot: "Everyone got out, but without the score.",
    timeout: "Time ran out before everyone made it to the exit.",
  }[o.result];
  card.className = "result-card " + (win ? "win" : "lose");
  card.innerHTML = `
    <h2>${win ? "SCORE!" : "BUSTED"}</h2>
    <div class="why">${why}</div>
    ${win ? `<div class="result-stars">${[0, 1, 2].map(k => `<span class="${k < s ? "on" : ""}" style="animation-delay:${0.2 + k * 0.22}s">★</span>`).join("")}</div>` : ""}
    <div class="result-rows">
      <span>Time</span><span class="v ${win && o.t <= def.par ? "good" : "meh"}">${fmt(o.t)} <small>/ par ${fmt(def.par)}</small></span>
      <span>The score</span><span class="v ${win ? "good" : "meh"}">${win ? "stolen" : "not yet"}</span>
      ${bonusTotal ? `<span>Bonus loot</span><span class="v ${run.bonus === bonusTotal ? "good" : "meh"}">${run.bonus} / ${bonusTotal}</span>` : ""}
    </div>
    <div class="result-buttons">
      ${win && G.idx + 1 < LEVELS.length ? `<button class="btn primary" data-r="next">Next job →</button>` : ""}
      ${win && G.idx + 1 >= LEVELS.length ? `<button class="btn primary" data-r="jobs">All jobs</button>` : ""}
      ${!win ? `<button class="btn primary" data-r="fix">Show me what went wrong</button>` : ""}
      <button class="btn" data-r="replay">Watch again</button>
      <button class="btn ghost" data-r="plan">${win ? "Improve the plan" : "Back to the plan"}</button>
    </div>`;
  const wrap = $("result");
  wrap.innerHTML = "";
  wrap.appendChild(card);
  wrap.classList.remove("hidden");
  $("live").classList.add("hidden");
  if (win) { sfx.success(); for (let k = 0; k < s; k++) setTimeout(() => sfx.star(k), 450 + k * 220); }
  else sfx.fail();
  card.querySelectorAll("button").forEach(b => b.onclick = () => {
    sfx.click();
    stopSiren();
    const r = b.dataset.r;
    if (r === "next") startLevel(G.idx + 1);
    else if (r === "jobs") show("select");
    else if (r === "replay") { G.liveT = 0; G.evIdx = 0; G.effects = []; G.alarmFx = null; G.flash = 0; G.endAt = null; G.paused = false; wrap.classList.add("hidden"); setMode("live"); }
    else {
      G.lastFail = win ? null : { t: o.t, alarm: o.alarm };
      setMode("plan");
      wrap.classList.add("hidden");
      if (r === "fix") {
        // jump to just before it went wrong, with the culprit selected
        G.t = Math.max(0, o.t - 1.2);
        if (o.alarm?.crew != null) G.selected = o.alarm.crew;
        renderSidebar();
        toast("This is the moment. Drag the timeline to see it unfold.");
      }
    }
  });
}

// ------------------------------------------------------------- keyboard --
document.addEventListener("keydown", (e) => {
  if (e.key === "m" || e.key === "M") { setMuted(!isMuted()); soundIcon(); return; }
  if (screen !== "game") {
    if (e.key === "Escape" && screen === "select") show("title");
    if (e.key === "Enter" && screen === "title") show("select");
    return;
  }
  if (!$("help").classList.contains("hidden")) { if (e.key === "Escape") $("help").classList.add("hidden"); return; }
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && (e.key === "z" || e.key === "Z")) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (ctrl && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); return; }
  if (e.key === "Escape") {
    if (G.mode === "live") abort();
    else if (G.mode === "result") { $("result").classList.add("hidden"); stopSiren(); setMode("plan"); }
    else leaveGame();
    return;
  }
  if (e.key === "Enter") { e.preventDefault(); if (G.mode !== "result") execute(); return; }
  if (e.key === " ") {
    e.preventDefault();
    if (G.mode === "plan") {
      if (!G.playing && G.t >= tlSpan() - 0.05) G.t = 0;
      G.playing = !G.playing;
      sfx.click();
    }
    return;
  }
  if (G.mode !== "plan") return;
  if (e.key >= "1" && e.key <= "3") select(+e.key - 1);
  else if (e.key === "w" || e.key === "W") addAction("wait");
  else if (e.key === "g" || e.key === "G") addAction("grab");
  else if (e.key === "h" || e.key === "H") addAction("hack");
  else if (e.key === "a" || e.key === "A") addAction("ambush");
  else if (e.key === "Backspace" || e.key === "Delete") removeLast();
  else if (e.key === "Tab") { e.preventDefault(); select((G.selected + 1) % G.L.crew.length); }
  else if (e.key === "ArrowRight") G.t = Math.min(tlSpan(), G.t + (e.shiftKey ? 1 : 0.1));
  else if (e.key === "ArrowLeft") G.t = Math.max(0, G.t - (e.shiftKey ? 1 : 0.1));
});

$("play-preview").onclick = () => {
  sfx.click();
  if (G.mode === "plan") {
    if (!G.playing && G.t >= tlSpan() - 0.05) G.t = 0;
    G.playing = !G.playing;
  } else if (G.mode === "live") G.paused = !G.paused;
};
document.querySelectorAll("#speeds button").forEach(b => b.onclick = () => {
  sfx.click();
  G.speed = +b.dataset.speed;
  document.querySelectorAll("#speeds button").forEach(o => o.classList.toggle("on", o === b));
});

// ------------------------------------------------------------- main loop --
let lastTime = performance.now();
function frame(nowMs) {
  const dt = Math.min(0.25, (nowMs - lastTime) / 1000);   // runs are precomputed, so big steps are fine
  lastTime = nowMs;
  const now = nowMs / 1000;
  if (screen === "title") drawTitle(now);
  if (screen === "game" && G.L && G.view) {
    if (G.mode === "plan" && G.playing) {
      G.t += dt * G.speed;
      const span = tlSpan();
      if (G.t >= span) { G.t = span; G.playing = false; }
    }
    if (G.mode === "live" && !G.paused) {
      const before = G.liveT;
      G.liveT = Math.min(G.live.endTime, G.liveT + dt * G.speed);
      // footsteps, gently
      G.stepped += (G.liveT - before) * 3;
      if (G.stepped > 1) { G.stepped = 0; sfx.step(); }
      liveEvents(now);
      if (G.liveT >= G.live.endTime) {
        const delay = G.live.outcome.result === "alarm" ? 1.4 : 0.6;
        if (!G.endAt) G.endAt = now + delay;
        if (now >= G.endAt) { G.endAt = null; finish(); }
      }
    }
    $("play-preview").innerHTML = (G.mode === "plan" ? G.playing : G.mode === "live" && !G.paused) ? "❚❚" : "▶";
    $("clock").textContent = fmt(G.mode === "plan" ? G.t : G.liveT);
    drawMap(now);
    drawTimeline();
  }
  requestAnimationFrame(frame);
}

function drawMap(now) {
  const c = $("map"), g = c.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(G.staticImg, 0, 0);
  g.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
  const live = G.mode !== "plan";
  const run = live ? G.live : G.preview;
  const t = live ? G.liveT : G.t;
  const fr = frameAt(run, t);
  drawScene(g, G.L, G.view, fr, {
    mode: live ? "live" : "plan", now, plan: live ? G.livePlan : G.plan,
    paths: live ? null : G.paths, selected: live ? null : G.selected,
    hover: !live && G.hover, hoverOk: G.hoverOk, hoverPath: !live && G.hoverPath,
    effects: G.effects, alarm: live && G.liveT >= (G.live.outcome.alarm ? G.live.outcome.t : Infinity) ? G.alarmFx : null,
    linksFor: G.linksFor,
  });
  // the moment it went wrong, marked on the plan
  if (!live && G.lastFail?.alarm) {
    const { cs, ox, oy } = G.view, a = G.lastFail.alarm;
    const px = ox + a.x * cs, py = oy + a.y * cs;
    g.save(); g.strokeStyle = COLORS.red; g.setLineDash([4, 4]); g.lineWidth = 2;
    g.beginPath(); g.arc(px, py, cs * 0.6, 0, Math.PI * 2); g.stroke();
    g.fillStyle = COLORS.red; g.font = `700 ${Math.max(11, cs * 0.3)}px "Chakra Petch"`; g.textAlign = "center";
    g.fillText("SPOTTED", px, py - cs * 0.75);
    g.restore();
  }
  // red flash when the alarm goes
  if (G.flash > 0) {
    const w = c.width / G.dpr, h = c.height / G.dpr;
    const grad = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    grad.addColorStop(0, "rgba(255, 77, 109, 0)");
    grad.addColorStop(1, `rgba(255, 77, 109, ${0.45 * G.flash})`);
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    G.flash = Math.max(0, G.flash - 0.012);
    if (G.mode === "live" && G.alarmFx) G.flash = Math.max(G.flash, 0.5 + 0.3 * Math.sin(now * 8));
  }
}

// ---------------------------------------------------------------- title --
const T = { L: parseLevel(LEVELS[LEVELS.length - 1]), view: null, img: null, w: 0, h: 0, dpr: 1 };
function drawTitle(now) {
  const c = $("title-bg"), r = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (r.width !== T.w || r.height !== T.h || dpr !== T.dpr) {
    T.w = r.width; T.h = r.height; T.dpr = dpr;
    c.width = r.width * dpr; c.height = r.height * dpr;
    // the vault's blueprint, big enough to fill the screen
    T.view = fitView(T.L, r.width * 1.25, r.height * 1.25, 0);
    T.view.ox -= r.width * 0.125; T.view.oy -= r.height * 0.125;
    T.view.w = r.width; T.view.h = r.height;
    T.img = drawStatic(T.L, T.view, dpr);
    T.demo = simulate(T.L, T.L.crew.map(() => []), { detect: false });
  }
  const g = c.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(T.img, 0, 0);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const fr = { ...frameAt(T.demo, 0), t: now % 60, crew: [] };   // just the guards, cameras and lasers
  drawScene(g, T.L, T.view, fr, { mode: "live", now });
  const grad = g.createRadialGradient(r.width / 2, r.height / 2, 0, r.width / 2, r.height / 2, Math.max(r.width, r.height) * 0.6);
  grad.addColorStop(0, "rgba(6, 17, 39, 0.82)"); grad.addColorStop(1, "rgba(6, 17, 39, 0.55)");
  g.fillStyle = grad; g.fillRect(0, 0, r.width, r.height);
}

requestAnimationFrame(frame);
