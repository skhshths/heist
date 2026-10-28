# HEIST

A planning game. Draw the plan on a blueprint, time every step, then press
**Execute** and watch it play out. You can't touch anything once it starts.

**Play it:** open `index.html` through any static web server, or the GitHub
Pages site for this repo once Pages is turned on.

## How it plays

- **Plan.** Pick a crew member and click the blueprint to walk them there.
  Add waits and actions: Grab, Hack, Ambush. Every crew member's plan runs at
  the same time.
- **Check.** Drag the timeline to see exactly where everyone will be at any
  moment: your crew, the guards, where the cameras point and which lasers are
  on. Press Space to watch it move.
- **Execute.** Stay out of every flashlight and camera, never cross a live
  laser, and don't leave a knocked-out guard where someone will see him.
- **Escape.** Get the score and everyone to the exit. Bonus loot and beating
  par earn the other two stars.

If it goes wrong, **Show me what went wrong** takes you back to the plan a
moment before the alarm, with the spot marked.

## The crew

| | Role | Can |
|---|---|---|
| Ghost | Runner | Fastest on foot; grabs loot in a blink |
| Wire | Hacker | Hacks terminals: opens doors, kills cameras and lasers |
| Brick | Muscle | Ambushes guards who walk within arm's reach |

## Controls

| Key | Does |
|---|---|
| Click | walk there (click loot to grab it, a terminal to hack it) |
| Right-click / Backspace | remove the last step |
| 1 2 3 / Tab | pick a crew member |
| W G H A | wait 1s, grab, hack, ambush |
| Space | preview the plan |
| ← → | step the timeline (Shift for whole seconds) |
| Ctrl+Z / Ctrl+Y | undo / redo |
| Enter | execute |
| M | sound on or off |

## Making levels

Levels live in `js/levels.js` as ASCII maps plus guards, cameras, lasers and
which terminal controls what (the key is at the top of that file).

Everything runs on a deterministic simulation in `js/sim.js`, so a plan
always plays out the same way. That also lets a script prove every level can
be beaten:

```
node tools/check.mjs          # solves every level from the plans in it
node tools/sweep.mjs <level>  # shows how forgiving each wait is
```

No build step and no dependencies: plain JavaScript modules and a canvas.
