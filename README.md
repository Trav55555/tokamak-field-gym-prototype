# Field Gym prototype

A local 3D workbench for qualitative magnetic coil geometry and activation experiments. It supports arbitrary circular loops, stacked solenoids, crude toroidal coil assemblies, staggered waveforms, field traces, probes, and timeline continuity metrics.

The field kernel uses [Magba](https://github.com/p-sira/magba) in Rust compiled to WebAssembly. Values are normalized. This is a vacuum-field exploration tool, not a plasma equilibrium, circuit-feasibility, materials, force, thermal, or reactor model.

## Run

Requirements: Node.js, Rust, Cargo, and the `wasm32-unknown-unknown` Rust target.

```bash
npm start
```

Open <http://127.0.0.1:4317>.

The first run downloads Rust crate dependencies and builds `public/field_gym_engine.wasm`.

## Use from Pi

Start Pi in this directory and approve the project-local extension:

```bash
pi --approve
```

The extension registers:

- `field_scene`: inspect and mutate geometry, schedules, probes, presets, and variants.
- `field_compute`: sample fields, trace lines, evaluate timelines, and compare variants.
- `/field-gym`: show scene and engine status.

The browser polls the same revisioned scratch scene used by the tools, so agent changes appear automatically.

Example requests to Pi:

```text
Load the staggered solenoids preset, inspect its schedules, and evaluate field continuity from t=0 to t=10.

Create three vertically stacked toroidal assemblies. Stagger each group by 0.8 time units and report magnitude ripple, dropout, and whether the core field reverses.

Save the current geometry as baseline, change the middle assembly to a triangle waveform, and compare it with baseline.
```

## Checks

```bash
npm test
npm run check
```

Tests compare the Rust/WASM Magba kernel against the JavaScript analytic reference, a segmented Biot–Savart calculation, and known circular-loop values.

## Model boundary

Present model:

- prescribed ideal circular current filaments;
- analytic vacuum magnetic field;
- user-defined activation waveforms;
- regularized behavior near an ideal wire;
- field-line tracing and probe timelines.

Important missing physics:

- resistance, self/mutual inductance, voltage and power limits;
- induced currents, eddy currents and skin effect;
- plasma current, pressure, equilibrium and MHD stability;
- finite conductor geometry, forces, heating and materials.

The next engineering layer should solve the coupled circuit system `L dI/dt + R I = V(t)` so commanded schedules can be separated from physically achievable currents.
