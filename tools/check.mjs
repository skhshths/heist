// Proves every level can be beaten: each solution below is a plan with
// some wait times left open ("w?"), and a search fills them in until the
// plan succeeds. Run: node tools/check.mjs [level-id]
import { LEVELS } from "../js/levels.js";
import { parseLevel, simulate, stars } from "../js/sim.js";

// steps: "m x y" move, "w 2" wait, "w?" wait to search, "g" grab, "h" hack, "a" ambush
export const SOLUTIONS = {
  "corner-store": [["m 7 5", "w?", "m 13 2", "g", "w?", "m 10 5", "g", "w?", "m 7 5", "m 2 2"]],
  "eye-in-the-sky": [
    ["w?", "m 19 3", "g", "w?", "m 11 8", "g", "m 2 5"],
    ["m 9 3", "h", "m 2 6"],
  ],
  "locked-down": [
    ["w?", "m 16 3", "w?", "m 21 3", "g", "m 22 3", "g", "w?", "m 16 3", "w?", "m 2 1"],
    ["w?", "m 11 3", "w?", "h", "w?", "m 2 2"],
  ],
  "lights-out": [
    ["w?", "m 18 4", "h", "w?", "m 13 4", "g", "g", "m 2 1"],
    ["m 5 4", "a", "w?", "m 11 5", "w?", "m 10 5", "a", "m 2 2"],
  ],
  "laser-show": [
    ["w?", "m 10 3", "w?", "m 12 2", "g", "w?", "m 15 3", "w?", "m 19 3", "g", "w?", "m 15 3", "w?", "m 9 3", "w?", "m 2 1"],
    ["w?", "m 10 4", "h", "w?", "m 2 2"],
  ],
  "the-vault": [
    ["w?", "m 18 3", "w?", "m 24 2", "g", "m 25 2", "g", "w?", "m 13 5", "w?", "m 2 1"],
    ["w?", "m 18 9", "h", "w?", "m 13 3", "w?", "h", "w?", "m 2 2"],
    ["w?", "m 13 5", "w?", "m 16 3", "a", "w?", "m 1 1"],
  ],
};

function parseStep(s) {
  const [k, a, b] = s.split(" ");
  if (k === "m") return { type: "move", x: +a, y: +b };
  if (k === "w") return { type: "wait", t: a === undefined ? null : +a };
  if (k === "w?") return { type: "wait", t: null };
  return { type: { g: "grab", h: "hack", a: "ambush" }[k] };
}

export function solve(level, template, { tries = 12000, seed = 1 } = {}) {
  const L = parseLevel(level);
  const plan = template.map(crew => crew.map(parseStep));
  const vars = [];
  plan.forEach(steps => steps.forEach(s => { if (s.type === "wait" && s.t == null) vars.push(s); }));
  let rnd = seed;
  const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
  const score = (run) => {
    const o = run.outcome;
    if (o.result === "success") return 10000 - o.t + (run.bonus * 50);
    if (o.result === "noloot") return 5000;
    // otherwise: how far into the plan it got before going wrong
    let done = 0;
    run.stepTimes.forEach(ts => ts.forEach(s => { if (s.end != null && !s.error) done++; }));
    return done * 100 - o.t;
  };
  const evaluate = (vals) => { vars.forEach((v, i) => (v.t = vals[i])); return simulate(L, plan); };
  let best = vars.map(() => 0), bestRun = evaluate(best), bestScore = score(bestRun);
  // coordinate descent from zero, then random restarts around the best
  const grid = [];
  for (let v = 0; v <= 16; v += 0.25) grid.push(v);
  for (let round = 0; round < 10; round++) {
    for (let i = 0; i < vars.length; i++) {
      for (const g of grid) {
        const vals = best.slice(); vals[i] = g;
        const run = evaluate(vals), sc = score(run);
        if (sc > bestScore) { best = vals; bestRun = run; bestScore = sc; }
      }
    }
    if (bestRun.outcome.result === "success" && round >= 3) break;   // a few rounds to speed it up
    for (let k = 0; k < tries / 10; k++) {
      const spread = k % 3 === 0 ? 16 : 5;
      const vals = best.map(v => Math.min(16, Math.max(0, Math.round((v + (rand() - 0.5) * spread) * 4) / 4)));
      const run = evaluate(vals), sc = score(run);
      if (sc > bestScore) { best = vals; bestRun = run; bestScore = sc; }
    }
  }
  vars.forEach((v, i) => (v.t = best[i]));
  return { L, plan, run: bestRun, waits: best };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/").replace(/^([A-Z]):/, "/$1:")}` ||
    process.argv[1].endsWith("check.mjs")) {
  const only = process.argv[2];
  let ok = true;
  for (const level of LEVELS) {
    if (only && level.id !== only) continue;
    const t0 = Date.now();
    const { L, run, waits } = solve(level, SOLUTIONS[level.id]);
    const o = run.outcome;
    const s = stars(L, run);
    const tag = o.result === "success" ? "SOLVED" : "FAILED";
    if (o.result !== "success") ok = false;
    console.log(`${tag} ${level.id}: ${o.result} at ${o.t.toFixed(2)}s (par ${level.par}), ` +
                `${s} stars, bonus ${run.bonus}, waits [${waits.join(", ")}] (${Date.now() - t0}ms)`);
    if (o.alarm) console.log(`   ${o.alarm.reason} at (${o.alarm.x.toFixed(1)}, ${o.alarm.y.toFixed(1)}) by ${JSON.stringify(o.alarm.by)}`);
    run.stepTimes.forEach((ts, i) => ts.forEach((st, j) => {
      if (st.error) console.log(`   crew ${i} step ${j}: ${st.error}`);
    }));
  }
  process.exit(ok ? 0 : 1);
}
