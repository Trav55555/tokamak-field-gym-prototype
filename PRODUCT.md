# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: a local Node.js application with a browser interface, project-local Pi extension, and dependency-free Rust numerical kernel compiled to WebAssembly. Browser and Pi adapters share the same kernel, scene module, and revisioned scratch scene file.

## Users

A technically curious individual exploring speculative magnetic-confinement geometries on a desktop browser.

## Product Purpose

Provide an interactive qualitative playground for arranging current loops and coil assemblies in three dimensions, scheduling their activation over time, and seeing how geometry and timing change their combined magnetic field.

## Positioning

Unlike a conventional axisymmetric tokamak calculator, the gym makes arbitrary loop orientation, solenoid/toroid construction, vertical stacking, and staggered activation the primary interaction.

## Operating Context

The user experiments by constructing circular loops, solenoids, and crude toroidal coil assemblies; changing their position, size, current, orientation, and activation schedule; orbiting a three-dimensional view; scrubbing time; and inspecting field traces, planar samples, and probe timelines.

## Capabilities and Constraints

- Represent coils and plasma rings as discretized circular current filaments in arbitrary 3D orientations.
- Add, duplicate, remove, tilt, rotate, offset, and vertically stack loops.
- Construct solenoids from loop windings and crude toroidal field-coil assemblies from oriented loop arrays.
- Assign DC, pulse, ramp, sine, or triangle activation schedules with delay, phase, period, and duty cycle.
- Compute a qualitative time-dependent magnetic field with an analytic circular-loop kernel compiled from Rust to WebAssembly; retain segmented Biot–Savart integration as a reference implementation.
- Render loop geometry, field traces, a field-sampling plane, and probe timelines.
- Compare field magnitude, target-axis projection, ripple, and worst dropout over a requested time range.
- Include presets for a single ring, stacked solenoids, staggered solenoids, tilted stacks, and stacked toroidal assemblies.
- Use normalized units and clearly state that this is not an MHD, equilibrium, materials, or reactor-engineering model.
- Keep one revisioned scratch scene on local disk so the browser and multiple Pi processes can coordinate; no database or durable project data.

## Evidence on Hand

No reactor geometry, validation dataset, visual identity, or performance claims are available. Demonstrations are synthetic and normalized.

## Product Principles

1. Make spatial geometry faster to manipulate than to describe.
2. Keep field direction, current polarity, activation state, and time visually unambiguous.
3. Expose model assumptions instead of implying engineering accuracy.
4. Prefer immediate qualitative feedback over numerical sophistication.
5. Keep the prototype disposable and runnable with one command.

## Accessibility & Inclusion

All geometry parameters must remain available through labeled keyboard-accessible controls even when direct canvas manipulation is provided. Motion should respect reduced-motion preferences and text contrast should meet WCAG AA.
