# Physics harness

## Current architecture

The headless Planck.js harness now contains two separate physics experiments:

1. **Reference locomotion model** — a port of the lower-body control pattern from Gymnasium's Box2D BipedalWalker. It is retained as a known-good motor/gait reference and runs the existing seeded slope and uneven-terrain locomotion cases.
2. **Character-proportion stance rig** — a separate upright torso with two upper legs, two lower legs, and two articulated feet. Its dimensions and joint limits are based on the production ragdoll geometry in `src/main.js`. It uses the shared joint driver, two-bone IK, terrain-derived pelvis target height, planted foot targets, contact-aware support checks, and a lifted swing target when the center of mass leaves the support interval.

The stance rig has six revolute joints: hips, knees, and ankles. The ankle limits are ±0.6 radians and the feet use high friction. All motor commands pass through the same bounded, stiffness-scaled joint driver:

```js
function driveJoint(j, target, kp, wMax, tauMax, stiffness) {
  const err = wrapAngle(target - j.getJointAngle());
  j.setMotorSpeed(Math.max(-wMax, Math.min(wMax, kp * err)));
  j.setMaxMotorTorque(tauMax * stiffness);
}
```

The two-bone IK solver clamps unreachable targets and has geometry tests for both bend directions. A separate Planck test verifies the revolute-motor sign convention.

## Important current limitation

**The stance rig is not physically stable yet. Do not treat its passing diagnostic tests as proof that it can stand.**

The latest stance traces show the rig initially supporting itself, then losing one or both foot contacts and rotating/falling. The current tests for this experiment only assert finite simulation output; they do not assert successful standing. This is intentional while the controller is being debugged. Flat ground must pass first, followed by 20° and 35° slopes, before the stance controller can be considered validated.

The main unresolved behavior is loss of foot contact during the balance step. The controller now uses actual foot contacts to determine the support interval and moves the foot on the side of the center-of-mass escape, holding its swing target until landing. A raised swing arc is included. These changes have not yet produced a reliable stand.

The reference gait controller and its existing slope results remain separate from this stance result. Passing the locomotion tests does not imply that the new stance rig is stable.

## Reference locomotion cases

Reference implementation:
https://github.com/Farama-Foundation/Gymnasium/blob/main/gymnasium/envs/box2d/bipedal_walker.py

The reference model uses a hull, upper/lower leg segments, revolute hip/knee motors, a three-phase gait heuristic, normalized joint feedback, a 50 Hz fixed timestep, and a high solver iteration budget (180 velocity / 60 position iterations). It is designed for forward locomotion, not static standing.

The existing locomotion suite runs three-second cases on 0°, 20°, 35°, and 50° downhill slopes. Eight fixed seeds vary the spawn offset and initial upper-leg angle, for 32 physical runs total. The 0°, 20°, and 35° cases are also repeated on gently uneven deterministic terrain for 24 additional runs. A repeatability test runs the same seed twice and compares physical metrics.

- 0°, 20°, and 35° locomotion cases must remain physically upright and accumulate at least 1.5 seconds of ground-supported time, measured relative to the terrain normal.
- 50° must exceed the controlled locomotion envelope through excessive downhill speed or prolonged airtime.
- Uneven 0°, 20°, and 35° cases must remain upright and accumulate at least 1.5 seconds of ground-supported time.

The 50° test measures loss of controlled gait, not a completed knockdown animation. The uneven profile is a smooth analytic surface represented by short Planck edge segments; it does not yet test abrupt cliffs, craters, or terrain destruction.

## Running

Requires Node 24 and the pinned Planck.js dependency.

```sh
npm install
npm test
```

GitHub Actions is the authoritative execution environment when local dependency installation is unavailable. The suite currently includes the reference locomotion cases, rig structure and motor coverage, IK geometry, motor-sign verification, and finite-output stance/posture diagnostics.

## Scope and next steps

The harness remains isolated. The production game still uses its existing character implementation; `src/main.js` has not been modified by this experiment.

Do not integrate the stance rig until it passes real physical acceptance criteria: stable for three seconds on 0°, 20°, and 35° terrain; no unintended limp transition at spawn; and deterministic results across fixed seeds. Once that is achieved, proceed to fall triggers, hit-driven limp, recovery, turn-safety handling, and only then walking/jumping.
