# Angle Artillery Strike

A mobile-first, landscape 2D artillery tactics game built around physics-driven combat, destructible terrain, procedural battlefields, and tactical AI.

## Project status

**Pre-production / physics prototype.** The initial work is focused on validating movement, projectile physics, terrain destruction, explosions, knockback, and ragdolls before building the full game.

## Design and development notes

- [Game Design Brief](docs/GAME_DESIGN.md)
- [Technical Plan](docs/TECHNICAL_PLAN.md)

## Running the physics prototype

1. Open `index.html` in a modern browser.
2. Keep an internet connection available so the pinned Planck.js physics library can load from jsDelivr.
3. Use A/D or the arrow keys to move, W/Up/Space to jump, adjust angle and power, and fire. The prototype enforces one action per turn; use **End turn** to switch combatants.

The prototype is intentionally an early physics sandbox. It currently uses a destructible terrain surface profile; full polygon terrain, true ragdoll joints, damage, AI, and match systems are still planned.

## License

MIT. See [LICENSE](LICENSE).
