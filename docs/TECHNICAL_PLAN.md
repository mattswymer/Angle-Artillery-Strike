# Technical Plan

## Guiding principles

1. Prove the core physics before building the full game.
2. Use established libraries for rigid-body simulation and geometry operations rather than writing a physics engine.
3. Keep simulation, terrain, weapons, characters, AI, match flow, and presentation separated.
4. Keep the first build easy to run in a browser. Avoid introducing a build pipeline or package manager until a demonstrated need justifies it.
5. Make random generation deterministic from a stored seed.
6. Keep rendering independent from simulation so camera movement, zoom, and off-screen ragdolls cannot alter gameplay rules.
7. Design data structures so online multiplayer could be added later, without implementing networking now.

## Initial technology direction

### Physics: Planck.js

Use Planck.js, a JavaScript/TypeScript rewrite of Box2D, for fixed-step rigid-body simulation, collision detection, character bodies, projectiles, and debris. Its chain shapes are designed for efficient static world boundaries and terrain contours.

Reference: https://piqnt.dev/planck.js/docs/

### Terrain geometry: destructible occupancy grid and contour chains

The first surface-profile prototype has been replaced with a two-dimensional solid/empty occupancy grid. The current cell size is 0.05 world units. Explosions remove cells inside a circular blast region; the remaining solid cells are converted into closed boundary contours.

Planck.js chain fixtures represent the resulting terrain boundaries. The outer terrain boundary is intentionally left open along the left, right, and deep bottom edges so those world exits remain lethal rather than becoming invisible walls. Internal contours represent cave walls, holes, and disconnected terrain sections. Detached sections remain static; they do not fall under gravity.

This representation supports caves, tunnels, holes, and multiple disconnected regions without relying on polygon boolean operations or convex decomposition. It is a practical step toward Worms-style terrain destruction. Its tradeoffs are grid resolution, contour complexity, and the cost of rebuilding collision boundaries after an explosion. The current implementation rebuilds the terrain boundary after each blast; profile this on mobile before increasing resolution or blast frequency.

Planck chain shapes are two-sided and support connected terrain contours. Their loops must not self-intersect, and very short adjacent edges should be avoided.

References:
- https://piqnt.com/planck.js/docs/shape/chain.html
- https://piqnt.com/planck.js/docs/api/classes/ChainShape.html

### Rendering

Use Canvas 2D initially. Keep rendering as a view over simulation state:
- World coordinates are independent of screen pixels.
- Camera transform controls pan and zoom.
- The camera may follow a ragdoll above the visible battlefield.
- World death checks use left, right, and bottom world boundaries only; there is no top boundary.
- UI overlays remain in screen space.

### Runtime and dependencies

Start with browser-native HTML, CSS, and JavaScript modules. Pin CDN dependency versions while the prototype is dependency-light. Do not add a bundler, TypeScript, npm, or a framework until there is a concrete benefit. If browser module loading or dependency management becomes awkward, revisit the decision deliberately.

## Prototype milestone 1: physics sandbox

Build a small playable sandbox with:
- Landscape canvas and responsive scaling.
- Deterministic random seed display/replay.
- Random terrain profile with fixed world dimensions.
- Two simple stick-figure test characters placed randomly on opposite sides.
- Walk and small jump controls.
- Aiming indicator with angle and power.
- A basic ballistic projectile.
- Wind disabled initially; gravity fixed initially.
- Grid-based terrain with contour collision, terrain holes, and disconnected sections that remain in place.\n- Terrain impact craters and collision rebuild.
- Explosion impulse and character knockback.
- Ragdoll response.
- Left, right, and bottom lethal boundaries; open top.
- Reset/regenerate control.

This milestone is a physics test, not a complete match. It does not include drafting, AI strategy, the full roster, special weapons, health balancing, or polished match UI. The current terrain is a 2D occupancy grid with contour-chain collision, not a continuous vector-polygon system.

## Physics acceptance tests

1. Characters reliably stand and walk on generated slopes without jittering or tunneling.
2. A modest jump repositions a character without becoming a major traversal ability.
3. Projectiles follow repeatable ballistic trajectories.
4. At 100 power and 45 degrees with no wind, a shot can traverse the intended lower-right to upper-left battlefield benchmark.
5. An explosion creates a visible and physically meaningful crater.
6. Characters receive consistent knockback and can ragdoll.
7. Terrain edits do not leave invisible collision surfaces or create unstable physics.
8. Characters launched above the camera remain alive and can return.
9. Crossing the left, right, or bottom world boundary eliminates a character.
10. Replaying the same seed produces the same terrain and starting positions.

## Subsequent milestones

### 2. Combat foundation
Health, direct/splash damage, hit locations, friendly fire, elimination, kill credit, and weapon cooldowns.

### 3. Terrain and environmental systems
Robust polygon terrain destruction, disconnected terrain persistence, material properties, explosive barrels, mines, and fire.

### 4. Match flow
Four-character teams, draft, randomized fixed turn order, move-or-attack turns, timers, health settings, and local player modes.

### 5. Character roster and weapons
Fifteen distinct characters, team-colored clothing, standard attacks, unique specials, and cooldown balancing.

### 6. AI
Difficulty tiers, personalities, imperfect information, movement decisions, tactical terrain destruction, and AI takeover of a human turn.

### 7. Presentation and release
Polished mobile-first UI, sound, camera, replay, match statistics, settings, accessibility, performance, and deployment.

## Known risks to test early

- Polygon boolean operations can produce multiple polygons and holes. Physics fixture generation must handle them robustly.
- Rebuilding terrain collision can be expensive if too much geometry is rebuilt after every explosion.
- Ragdolls and character control must coexist without unstable joints or excessive jitter.
- Random maps need validation to avoid unfair starts and unusable terrain.
- Mobile performance must be measured on real devices, not inferred from desktop performance.
- CDN-hosted libraries make the first prototype easy to run but introduce an external availability dependency. Consider vendoring or a build step before a production release.

## Working method

- Keep changes small and focused.
- Test each milestone before layering on the next.
- Record decisions and known limitations in this document.
- Do not tune weapon damage before the physics feel is established.
- Do not add features merely because they are possible.
