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

The two-bone IK solver clamps unreachable targets and has geometry tests for both bend directions. A separate Planck test verifies the revolute-motor sign convention. A regression test also verifies that a swing foot retains its computed lift; a previous assignment accidentally flattened the target back to planted height.

## Important current limitation

**The stance rig is only partially validated.** It now passes three-second flat-ground and 20° slope tests across eight fixed seeds. It still does not pass the 35° slope requirement.

The current acceptance tests verify three seconds of support on flat ground and 20° terrain across eight fixed seeds. The 20° case uses a narrower stance and a torso target aligned to the terrain. The 35° case is retained as a characterization test and still falls. The original ±0.6-radian ankle limits leave the high-side foot unable to align to the 35° surface; the target ankle angle is about 0.9 radians in the initial pose.

The balance controller now measures the actual planted foot contact-patch bounds, rather than treating each foot as a point. This eliminated premature swing initiation and is the change that made the 20° test pass. Swing targets remain fixed until landing, and a regression test verifies that the swing lift is preserved. The remaining 35° issue is no longer an early-step trigger: the high-side ankle saturates before it can align the foot to the terrain.

A bilateral diagnostic confirms that the rig's initial geometry and a free-flight physics step are mirror-symmetric. Independent terrain edge fixtures produced seam-sensitive results; the harness now simplifies collinear terrain samples before creating a connected Planck chain, matching the production terrain contour simplification. A separate diagnostic confirms that a 60-step controlled settling phase is not needed for the flat-ground acceptance case.

The reference gait controller and its existing slope results remain separate from this stance result. Passing the locomotion tests does not imply that the new stance rig is stable. A diagnostic ankle-limit sweep shows that ±0.8 radians improves 35° behavior but still does not produce a stable three-second stand; increasing ankle motor torque from 1.5 to 6 Nm has negligible effect. No change to the production ragdoll or its ±0.6-radian test limits has been made.

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

GitHub Actions is the authoritative execution environment when local dependency installation is unavailable. The suite currently contains 27 passing tests. It covers reference locomotion, rig structure and motor coverage, IK geometry, motor-sign verification, swing-clearance regression, bilateral symmetry, spawn settling, three-second flat/20° stance acceptance, and a 35° failure characterization. The 35° acceptance criterion remains unmet.

## Scope and next steps

The harness remains isolated. The production game still uses its existing character implementation; `src/main.js` has not been modified by this experiment.

Do not integrate the stance rig until it passes real physical acceptance criteria: stable for three seconds on 0°, 20°, and 35° terrain; no unintended limp transition at spawn; and deterministic results across fixed seeds. The unresolved design choice is whether the torso may lean with the local terrain and whether the ankle range/leg geometry may change to support 35° terrain. Once that is achieved, proceed to fall triggers, hit-driven limp, recovery, turn-safety handling, and only then walking/jumping.
