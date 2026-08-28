# Field Gym prototype

## Purpose

Explore qualitative vacuum magnetic fields from arbitrary circular loops, solenoids, toroidal coil assemblies, and staggered activation schedules.

## Commands

```bash
npm start
npm test
npm run check
npm run build:wasm
```

## Agent interface

Use the project-local Pi tools `field_scene` and `field_compute`. Do not edit `.field-gym/scene.json` directly.

- Inspect before revision-sensitive or destructive changes.
- Use stable loop and group IDs returned by `field_scene`.
- Use `field_compute` timeline metrics for staggered-activation experiments.
- State that results are normalized and qualitative.
- Never infer circuit feasibility, plasma confinement, stability, forces, heating, or reactor performance from this model.

## Implementation

- `engine/`: Rust/WASM numerical kernel using Magba.
- `src/sim.mjs`: readable JavaScript reference kernel, schedules, tracing, and timelines.
- `src/scene.mjs`: scene domain operations and constructors.
- `src/store.mjs`: revisioned atomic scratch-state adapter.
- `.pi/extensions/field-gym.ts`: Pi adapter.
- `server.mjs`: browser HTTP adapter.
- `public/`: browser workbench.

Keep the scene and field modules deep: browser and Pi adapters should not duplicate physics or geometry rules.
