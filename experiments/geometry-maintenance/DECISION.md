# Decision: concentric inclined-plane systems

## Question

How do mutual plane inclination and concentric/nested circular-loop geometry affect staggered field maintenance?

## Decision

**Use different geometries for different field goals.**

- For a **fixed-axis field**, activate geometrically opposed inclination pairs together, or use many smoothly overlapping currents. Hard one-loop-at-a-time staggering is the wrong schedule because the field direction follows the active loop normal.
- For a **rotating field**, use an equal-radius conical distribution of loop normals and activate the planes sequentially. This gives an exceptionally clean rotating vector at the exact center, but not a uniform rotating field over the tested volume.
- Keep nested-radius spread modest. Equalizing each loop's center field does not equalize its off-axis field profile.
- Treat inclinations above roughly 15 degrees as increasingly demanding for hard pairwise handoffs in this target volume. Many-loop smooth overlap can extend the static-axis regime, but at the cost of simultaneous currents and geometry-dependent current compensation.

Evidence is **candidate numerical evidence**, not engineering validation.

## Runs and artifacts

Command:

```bash
npm run experiment:inclination
```

Run completed with:

- Engine: `magba-rust-wasm`
- 5,520 configurations
- 2,880 nontrivial inclined, dynamically activated configurations
- 144 activation samples per cycle
- 27 probes: center plus a `0.6 × 0.6 × 0.6` central cube
- Runtime: 4.28 seconds
- Static-axis gate qualifiers: 334
- Rotating-vector gate qualifiers: 169
- Full results: `results.json`
- Results SHA-256: `9080ec5f89e7830bd52c40b00d5ad60af0540d8f26f3be9e46ec1676fc82b6ce`
- Git state: project is not a Git worktree

## Main results

### 1. Equal-radius cone: perfect center rotation, poor volume handoff

Eight loops at 30-degree polar inclination, one active at a time:

| Metric | Result |
|---|---:|
| Center magnitude ripple | effectively 0% |
| Center polar inclination | 30° |
| Azimuth positions visited | 8 |
| Worst tested-volume magnitude ripple | 50.66% |
| Minimum axial projection / mean | 68.12% |
| Dropout | 0% |

This is a clean **precessing central field vector**, not a maintained static-axis field. Increasing loop count adds angular resolution, but does not remove the off-axis profile change while only one plane is active.

At 60 degrees the center still rotates at effectively constant magnitude, but tested-volume ripple remains about 50.15%. At 75 degrees, 11.11% of tested point-times fall below half the mean axial projection.

### 2. Symmetry-paired cone: center axis locks exactly

Activating diametrically opposed cone loops together cancels their transverse central components.

For eight equal-radius loops:

| Inclination | Center angle | Worst volume ripple | Static gate |
|---:|---:|---:|---|
| 5° | 0° | 0.74% | Pass |
| 15° | 0° | 6.36% | Pass |
| 30° | 0° | 21.74% | Fail |
| 45° | 0° | 39.34% | Fail |
| 60° | 0° | 54.24% | Fail |

The cancellation is exact only at the center. Off-axis, each inclined pair has a different field profile, producing a geometric handoff penalty.

### 3. Fan systems benefit from axial current compensation and smooth overlap

A fan contains several opposite-angle pairs at different inclination magnitudes. Fixed-current pair handoffs ripple because each pair contributes a different `cos(inclination)` axial component.

For an eight-loop fan with pairwise hard handoffs:

| Maximum inclination | Fixed-current ripple | Axially compensated ripple |
|---:|---:|---:|
| 15° | 6.25% | 3.02% |
| 30° | 23.80% | 10.61% |
| 45° | 50.50% | 19.68% |
| 60° | 85.90% | 27.45% |

A twelve-loop fan with staggered triangle currents and axial compensation performed much better:

| Maximum inclination | Worst volume ripple | Max center angle | Mean absolute-current proxy |
|---:|---:|---:|---:|
| 15° | 1.26% | 0.64° | 1.015 |
| 30° | 3.55% | 1.39° | 1.063 |
| 45° | 6.66% | 2.43° | 1.159 |
| 60° | 9.38% | 4.20° | 1.349 |

This is the strongest static-axis family in the sweep. It is not a one-coil-at-a-time system: several prescribed triangle currents overlap continuously.

### 4. Nested radii preserve the center but damage finite-volume continuity

For an eight-loop, 15-degree cone using balanced pairs and radius-scaled center-magnitude equalization:

| Radius half-spread | Worst volume ripple | Minimum axial / mean | Dropout |
|---:|---:|---:|---:|
| 0% | 6.36% | 90.5% | 0% |
| 10% | 8.94% | 88.4% | 0% |
| 25% | 15.86% | 83.8% | 0% |
| 50% | 41.50% | 45.6% | 7.4% |

All four cases have zero center ripple. The degradation appears only when the finite volume is inspected. Center-only optimization would therefore give a misleading answer.

### 5. Static axial compensation becomes expensive near orthogonal planes

For an equal-radius cone, the prescribed current needed to preserve central axial field follows the expected `sec(inclination)` growth:

| Inclination | Mean absolute-current proxy | Current-squared proxy |
|---:|---:|---:|
| 15° | 1.035 | 0.536 |
| 30° | 1.155 | 0.667 |
| 45° | 1.414 | 1.000 |
| 60° | 2.000 | 2.000 |
| 75° | 3.864 | 7.464 |

At 90 degrees, axial compensation is singular because the central field has no `+y` projection.

## Hypothesis disposition

| Hypothesis | Result |
|---|---|
| H1: sequential inclined loops preserve center magnitude but rotate direction | Supported for equal-radius loops; finite-volume ripple remains large. |
| H2: opposed pairs preserve the reference axis | Supported exactly at center; only small inclinations pass the finite-volume hard-handoff gate. |
| H3: cone systems support rotating fields | Supported at the center. Not yet supported as a volume-uniform rotating field. |
| H4: fan systems need compensation or overlap | Supported. Axial compensation and many-loop triangle overlap substantially reduce ripple. |
| H5: nested radii create off-axis handoff error | Supported strongly; center equality hides up to 41.5% volume ripple in the tested sweep. |
| H6: large inclination is costly for static axial fields | Supported by `1/cos(inclination)` current growth and rapidly increasing current-squared proxy. |

## Recommended geometry

### If the goal is a fixed direction

Start with:

- 8–12 loops.
- Opposite-inclination symmetry.
- Equal or nearly equal radii; keep radius half-spread around 10% or less.
- Inclination around 15 degrees for hard pairwise switching.
- For larger fan angles, use smoothly overlapping multiphase currents and compensate axial projection.

### If the goal is a rotating field

Start with:

- A cone of at least 6 equal-radius loop planes.
- Uniform azimuth spacing.
- One-at-a-time activation for a stepped rotating vector, or sinusoidal multiphase currents for a smoother vector.
- Optimize over a volume, not only at the shared center.

## Failure modes and uncertainty

- Inclined concentric loops physically intersect; real coils require axial/radial offsets, conductor clearance, or noncircular routing.
- The 27-point cube is a sparse local target, not a complete field-volume proof.
- Hard pulse and ideal triangle schedules assume unlimited voltage and bandwidth.
- Current-squared is only a proxy; differing loop radius changes conductor length and resistance.
- No mutual inductance, induced vessel current, force, heating, plasma, or stability model is present.
- The rotating-field gate is center-focused; off-axis ripple is reported but not used to qualify rotation.

## Next experiments

1. Add conductor-clearance offsets while preserving approximate concentric symmetry.
2. Optimize sinusoidal multiphase amplitudes and phases over a dense spherical target volume.
3. Add mutual inductance and voltage-limited current tracking before calling any schedule achievable.
4. Test finite-thickness coil packs and mechanical-force proxies.
5. Promote only configurations that survive larger target radii and denser probes.

## Submission status

No external submission, publication, commit, push, or deployment occurred.
