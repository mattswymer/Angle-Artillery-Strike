# Physics test harness status

This branch has a headless Node test harness using the same pinned Planck.js 1.5.1 version as the browser prototype.

## Run locally

```sh
npm install
npm test
```

GitHub Actions runs the same command on Node 24.

## What is covered

- Seeded random-number determinism.
- Two-bone IK finite output, including clamped unreachable targets.
- A complete articulated test rig from spawn: torso, head, upper/lower arms, upper/lower legs, feet, and revolute joints.
- Planck reference-angle-zero joints, mirrored/selected knee IK branches, and explicit hip/knee/ankle limit checks at spawn.
- 90 controller warm-up steps before the measured interval.
- Three seconds of continuous-stability testing on 0°, 20°, 35°, and 50° slopes.
- Foot-contact normals relative to world vertical, planted-foot support span, full-rig COM/velocity, protective stepping, stiffness, and limp transitions.

## Current result

The latest CI run executes seven tests: four pass and three fail.

- 0°: fails sustained stability. The rig initially stands, then its COM leaves the planted-foot support interval; the protective step does not recover balance before the 0.25-second fall threshold.
- 20°: fails; downhill momentum and torso rotation overwhelm the current step controller.
- 35°: fails; the rig loses support and falls.
- 50°: passes the expected loss-of-stance assertion.
- Seeded RNG, IK finite-value, and supporting harness checks pass.

These are genuine Planck simulation results, not dependency-installation failures. The tests intentionally remain red; do not weaken the assertions to make CI green.

## Important findings so far

The harness caught several implementation errors that were corrected:

- Planck contact lists are not populated until the world has stepped; the controller now starts only after initial contacts are established.
- Revolute joints use the configured reference angle; IK targets are converted to the same zero-reference convention used by the game rig.
- A foot that is swinging is not counted as part of the support interval.
- Protective stepping now moves the non-supporting foot in the direction needed to recover the COM.
- Spawn IK selects a knee branch that fits the hip, knee, and ankle limits where possible.
- The no-foot-contact timeout measures continuous time without contact, rather than elapsed match time.

These fixes improved the diagnostics but have not yet produced a stable 0°/20°/35° stance. The next task is to correct the balance/foot-plant controller based on the remaining traces, not to tune damage or integrate gameplay.

## Integration gate

This is an isolated controller prototype, not yet the game character implementation. It does not implement the get-up controller, turn-state integration, or gameplay renderer.

Do not integrate it into `src/main.js` until all four slope tests pass and the joint-angle/contact traces have been reviewed.
