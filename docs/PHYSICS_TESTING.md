# Physics test harness status

This branch now has a headless Node test harness using the same pinned Planck.js version as the browser prototype.

## Run locally

```sh
npm install
npm test
```

The GitHub Actions workflow runs the same command on Node 24.

## What is covered

- Seeded random-number determinism.
- Two-bone IK finite output, including clamped unreachable targets.
- Three-second active-rig simulations on 0°, 20°, 35°, and 50° slopes.
- Contact count, torso angle, COM position, stiffness, and stable-duration traces.

## Current result

The first real Planck runs show that the current experimental rig is not ready to integrate:

- 0°: fails the sustained-stability assertion.
- 20°: fails; the rig loses its stance and slides/falls.
- 35°: fails; the rig loses its stance.
- 50°: passes the expected unstable-stance assertion.

The deterministic RNG and IK finite-value tests pass. These are genuine physics failures, not dependency-installation failures. The harness is deliberately keeping the slope assertions red until the controller passes; do not weaken the assertions to make CI green.

## Important limitation

This is an isolated controller prototype, not yet the game character implementation. It currently includes torso, head, thighs, shins, feet, revolute joints, motor control, IK, support-span stepping, and a stiffness fall trigger. It does not yet implement the full production stance controller, get-up controller, turn-state integration, or gameplay renderer.

Do not integrate it into `src/main.js` until all four slope tests pass and the joint-angle/debug traces have been reviewed.
