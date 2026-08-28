# Concentric inclined-plane experiment program

## Question

How do mutual plane inclination and concentric/nested circular-coil geometry affect the ability of staggered prescribed currents to maintain magnetic-field magnitude and direction?

## Scope and terminology

- **Concentric:** every circular loop shares the same center.
- **Equal-radius concentric:** loops occupy different planes but the same radius.
- **Nested concentric:** loops share a center but use different radii.
- **Fan:** loop normals vary from negative to positive inclination about one common line of nodes.
- **Cone:** loop normals share one polar inclination while their lines of nodes are distributed azimuthally.
- **Mutual inclination:** the angle between two loop planes, equivalently the angle between their normals up to orientation.

The study separates two goals:

1. **Static-axis maintenance:** keep a nonzero field aligned with the common `+y` reference axis.
2. **Rotating-vector maintenance:** keep field magnitude approximately constant while its direction precesses.

## Model boundary

This is a normalized vacuum-filament study using prescribed currents. It does not establish circuit achievability, plasma confinement, equilibrium, stability, vessel response, force, heating, insulation, or reactor feasibility. Geometrically intersecting inclined loops are allowed mathematically even where real conductors would require separation.

## Hypotheses

- **H1 — one-at-a-time inclination rotates the field:** Sequential activation of equal-radius inclined loops can preserve central magnitude but generally rotates or rocks the field direction.
- **H2 — symmetric pairing preserves an axis:** Simultaneously activating loops with opposite transverse normal components cancels the transverse central field and can preserve the reference axis.
- **H3 — cone systems support rotating fields:** A conical distribution activated azimuthally should produce a central vector that precesses at nearly constant polar inclination and magnitude.
- **H4 — fan systems are harder to equalize:** When fan loops use different inclination magnitudes, their axial projections differ; current compensation or simultaneous symmetry is needed for low ripple.
- **H5 — nested radii create off-axis handoff error:** Scaling current by radius can equalize central fields, but different radii retain different spatial field profiles, so a finite target volume still experiences ripple.
- **H6 — large inclination is expensive for static axial fields:** Axial compensation grows approximately as `1/cos(inclination)` and becomes singular near 90 degrees.

## Experiment ladder

### 1. Algebraic smoke controls

- Parallel, equal-radius loops.
- Equal-radius cone systems with one loop active at a time.
- Diametrically opposed cone pairs active together.
- Synchronized-pulse negative controls.

### 2. Geometry sweep

Sweep:

- Families: fan and cone.
- Loop counts: 2, 4, 6, 8, and 12.
- Maximum/polar inclination: 0, 5, 15, 30, 45, 60, 75, and 90 degrees.
- Radius half-spread: 0%, 10%, 25%, and 50% about radius 1.
- Current policies: fixed current, equal central magnitude, and equal central axial projection where finite.

### 3. Activation ablations

- Continuous DC symmetry control.
- One-at-a-time uniform staggering.
- Two-window uniform overlap.
- Symmetry-paired staggering.
- Uniform triangle-wave staggering.
- Synchronized 50%-duty negative control.

### 4. Target and metrics

Evaluate the center plus a `0.6 × 0.6 × 0.6` central cube using the Magba Rust/WASM kernel.

Report:

- Central and worst-volume magnitude ripple.
- Minimum axial projection relative to mean.
- Field dropout and reversal fractions.
- Mean and maximum angular deviation from `+y`.
- Spatial coefficient of variation.
- Transverse-field ratio.
- Circular concentration of center-field azimuth for rotating-field behavior.
- Mean and peak current and current-squared proxies.

## Decision gates

A configuration qualifies as **static-axis maintaining** only if:

- No direction reversal.
- No samples below 50% of mean axial projection.
- Worst-volume magnitude ripple ≤10%.
- Maximum center-axis deviation ≤5 degrees.

A configuration qualifies as a **rotating-vector candidate** only if:

- Central magnitude ripple ≤5%.
- Central field never drops below 90% of its mean magnitude.
- Center-field azimuth samples the full conical sequence rather than remaining synchronized.

## Artifacts

- `run.mjs`: deterministic sweep runner.
- `results.json`: complete machine-readable results.
- `DECISION.md`: findings, strongest configurations, failures, and next tests.
