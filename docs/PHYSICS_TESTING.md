# Physics harness

## Controller foundation

The earlier custom 12-body IK/stance experiment has been removed from the active test suite. The isolated prototype now ports the lower-body architecture and control pattern of Gymnasium's Box2D BipedalWalker into Planck.js:

- one hull/torso, two upper-leg bodies, two lower-leg bodies, and two separate foot bodies
- six revolute joints: hips, knees, and ankles
- the reference model's joint anchors, segment proportions, density/friction relationships, limits, and hip/knee motor model
- compact high-friction feet (0.9) with ankle limits of approximately ±0.6 radians
- ankle target tracking through a bounded, stiffness-scaled joint driver
- ground contact detected on the foot bodies
- three-phase gait: stay on one leg, put the other down, push off
- joint-angle feedback with normalized joint-speed damping
- torso-angle/angular-velocity feedback shared by both hips
- vertical-velocity damping shared by both knees
- bounded motor speed and torque
- 50 Hz fixed timestep and the reference's high solver iteration budget (180 velocity / 60 position iterations)
- deterministic seeded spawn offset

Reference implementation:
https://github.com/Farama-Foundation/Gymnasium/blob/main/gymnasium/envs/box2d/bipedal_walker.py

The controller is based on a successful Box2D walker, but this is a Planck.js port and not a claim of identical simulation behavior. In particular, the reference heuristic is designed for forward locomotion, not static standing.

## Running

Requires Node 24 and the pinned Planck.js dependency.

```sh
npm install
npm test
```

## Slope cases

The headless Planck suite runs three-second locomotion cases on 0°, 20°, 35°, and 50° downhill slopes (the direction of travel is downhill). Each uniform slope is exercised with eight fixed seeds that vary the spawn offset and initial upper-leg angle, for 32 physical runs total. The 0°, 20°, and 35° cases are also repeated over eight seeds on gently uneven, deterministic terrain (24 additional runs). The uneven profile is a low-amplitude blend of two smooth waves over the base slope. A repeatability test also runs the same seed twice and compares the resulting physical metrics.

- 0°, 20°, and 35° must remain physically upright and accumulate at least 1.5 seconds of ground-supported time, measured relative to the terrain normal
- 50° must exceed the controlled locomotion envelope (excessive downhill speed or a prolonged airborne interval)
- On gently uneven 0°, 20°, and 35° terrain, all eight seeds must remain upright and accumulate at least 1.5 seconds of ground-supported time

The 50° test currently measures loss of controlled gait across all eight seeds using excessive downhill speed or prolonged airtime, not a completed knockdown animation. Physical fall detection and ragdoll response are separate integration work. The uneven-terrain cases use a smooth analytic profile represented by short Planck edge segments; they are not yet a test of abrupt cliffs, craters, or terrain destruction.

GitHub Actions is the authoritative execution environment when local dependency installation is unavailable. The current headless Planck run result is reported by the latest GitHub Actions workflow.

## Scope

The harness is deliberately isolated. The production game still uses its existing character implementation; `src/main.js` has not been modified by this experiment. The next step is to add head, arms, feet, hit-driven limp behavior, and recovery around this proven lower-body foundation without replacing the locomotion controller.
