# Angle Artillery Strike

A mobile-first, landscape 2D artillery tactics game built around physics-driven combat, destructible terrain, procedural battlefields, and tactical AI.

## Project status

**Early playable prototype.** Current work validates movement, projectile physics, destructible terrain, hit regions, prototype health/damage, and knockback before building the full game. Ragdolls and the full match loop are still future work.

## Design and development notes

- [Game Design Brief](docs/GAME_DESIGN.md)
- [Technical Plan](docs/TECHNICAL_PLAN.md)

## Running the physics prototype

1. Open `index.html` in a modern browser.
2. Keep an internet connection available so the pinned Planck.js physics library can load from jsDelivr.
3. Use A/D or the arrow keys to move, W/Up/Space to jump, adjust angle and power, and fire. The prototype enforces one action per turn; use **End turn** to switch combatants.

The prototype currently includes eight combatants, randomized starting positions and turn order, destructible terrain, direct head/chest/leg hit regions, health bars, floating damage numbers, and distance-falloff blast damage. Direct-hit damage is currently higher than splash damage; these are provisional prototype values, not final weapon balance. Full roster/drafting, camera zoom/pan, AI, scoring, and the complete match loop remain planned. Direct projectile hits now trigger a ten-piece articulated ragdoll with independently moving arms and legs, impact impulses, and automatic recovery after settling. Mobile landscape uses a fixed full-screen game surface to prevent browser page scrolling during aiming.

## License

MIT. See [LICENSE](LICENSE).
