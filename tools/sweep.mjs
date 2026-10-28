// How forgiving is a level? Fills every "w?" of its solution with the same
// grid of values (one at a time, others at their solved values) and shows
// which work. Run: node tools/sweep.mjs level-id
import { LEVELS } from "../js/levels.js";
import { simulate } from "../js/sim.js";
import { SOLUTIONS, solve } from "./check.mjs";

const id = process.argv[2];
const level = LEVELS.find(l => l.id === id);
const { L, plan, waits } = solve(level, SOLUTIONS[id]);
const vars = [];
plan.forEach(steps => steps.forEach(s => { if (s.type === "wait") vars.push(s); }));
console.log("solved waits", waits);
vars.forEach((v, i) => {
  if (waits[i] === undefined) return;
  const keep = v.t;
  let line = "";
  for (let t = 0; t <= 12; t += 0.25) {
    v.t = t;
    const o = simulate(L, plan).outcome.result;
    line += o === "success" ? "#" : ".";
  }
  v.t = keep;
  console.log(`wait ${i}: ${line}   (0s to 12s, 0.25s each)`);
});
