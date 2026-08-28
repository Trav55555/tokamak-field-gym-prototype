# Decision: main loop with a triangular satellite bundle

## Geometry name

The tested geometry is a **coaxial triangular loop bundle** or **main loop with three satellite loops**. In the local cross-section of the main circular route, one conductor is central and three conductors occupy an equilateral triangle around it.

For bundle radius `rho`, satellite positions are represented by:

```text
(delta radius, delta y) = rho * (cos psi, sin psi)
psi = orientation + {0°, 120°, 240°}
```

The parallel-loop version corresponds most closely to four pipes following one circular route. Tilting the satellite planes is a separate orbit-plane experiment; those tilted loops no longer remain parallel pipes around the main route.

## Question

Can the three satellite loops be staggered around the main loop while maintaining a useful axial field?

## Decision

**Yes, but only when the bundle is thin or the main loop supplies a substantial continuous bias.** The triangular arrangement does not by itself make one-at-a-time handoffs spatially uniform.

- For a fixed field, keep the satellite pipes nearly parallel and close to the main centerline.
- Use center-axial current equalization and a three-phase raised-cosine schedule rather than hard one-at-a-time pulses.
- A continuously driven main loop is an effective stabilizer, but any resulting continuity must be attributed to that DC bias rather than to the satellite stagger alone.
- Tilting the three satellites creates a controllable three-phase rotating transverse component. That can be useful if rotation is the goal, but it works against strict fixed-axis maintenance.
- Do not switch all four loops one at a time for a finite target volume; that was consistently poor once the bundle had meaningful thickness.

## Runs and artifacts

Command:

```bash
npm run experiment:bundle
```

Run completed with:

- Engine: `magba-rust-wasm`
- 2,520 configurations
- 1,560 nontrivial dynamic candidate configurations
- 144 activation samples per cycle
- 27 probes in the center and a `0.6 × 0.6 × 0.6` cube
- Runtime: 1.66 seconds
- Static-axis qualifiers: 234
- Rotating-component candidates: 424
- Full results: `results.json`
- Results SHA-256: `fe48c66d9a9ddfc5408361dbd155a4cd1ca0649bb7fca6e7f8d5e6d99b2b394f`

## Results

### 1. Hard satellite handoffs degrade rapidly with bundle thickness

Three parallel satellites, no main-loop bias, one satellite active at a time, with each satellite current equalized to produce the same axial center field:

| Bundle radius `rho/R` | Center ripple | Worst volume ripple | Minimum axial / mean | Dropout |
|---:|---:|---:|---:|---:|
| 0% | 0% | 0% | 89.5% | 0% |
| 5% | 0% | 10.53% | 85.7% | 0% |
| 10% | 0% | 22.09% | 81.9% | 0% |
| 20% | 0% | 47.75% | 71.4% | 0% |
| 30% | 0% | 75.07% | 60.4% | 0% |
| 50% | 0% | 120.96% | 44.5% | 19.8% |

Center equalization makes the center look perfect while the surrounding volume becomes progressively worse. This repeats the central lesson from the nested-concentric experiment: **a center probe is not enough**.

The 5% bundle is close to the 10% static gate. Rotating the triangular cross-section by 30 degrees reduced the sampled worst ripple from 10.53% to 9.88%, but that small difference should not be treated as robust until the target grid is made denser and rotationally symmetric.

### 2. Three-phase raised-cosine currents outperform hard or triangle handoffs

The raised-cosine satellite commands are nonnegative and phase shifted by 120 degrees. Their sum is constant, unlike the three triangle waves used in the ablation.

With parallel satellites, no main bias, and center-axial equalization:

| Bundle radius `rho/R` | Raised-cosine volume ripple | Hard handoff volume ripple |
|---:|---:|---:|
| 5% | 6.15% | 10.53% |
| 10% | 12.90% | 22.09% |
| 20% | 27.99% | 47.75% |
| 30% | 44.26% | 75.07% |
| 50% | 72.24% | 120.96% |

The cosine schedule roughly halves the geometric handoff penalty in the thicker cases, but it does not remove it.

### 3. Main-loop bias creates a practical operating region

For a 10%-radius parallel bundle using the raised-cosine schedule:

- 25% main-loop DC bias: approximately 9.38% worst-volume ripple.
- 50% main-loop DC bias: approximately 6.25% worst-volume ripple.

Both pass the experiment's 10% ripple gate. At 20% bundle radius, even a 50% bias was insufficient in the inclined example; 75% bias was needed to pass.

The interpretation must remain honest: with 75% bias, the main loop—not the satellite sequence—is maintaining most of the field.

### 4. Inclined satellites make a three-phase rotating perturbation

For `rho/R = 0.1`, 15-degree satellite inclination, 50% main bias, center-axial equalization:

| Schedule | Center ripple | Center angle | Azimuth sectors | Worst volume ripple |
|---|---:|---:|---:|---:|
| Hard one-at-a-time | 0.022% | about 7.6° | 3 | 20.23% |
| Triangle overlap | 10.62% | about 3.1° mean | 12 | 20.17% |
| Raised cosine | 0.008% | about 3.8° | 12 | 12.89% |

The raised-cosine case produces the cleanest rotating transverse component at the center. It still misses the static volume gate because the surrounding field changes by 12.89%.

At `rho/R = 0.2`, 15-degree inclination, raised-cosine satellites:

| Main bias | Center ripple | Max center angle | Worst volume ripple |
|---:|---:|---:|---:|
| 0% | 0.139% | 7.77° | 38.63% |
| 25% | 0.079% | 5.84° | 28.76% |
| 50% | 0.035% | 3.90° | 18.97% |
| 75% | 0.009% | 1.95° | 9.34% |

This is a useful control knob: main bias sets the axial background, while satellite inclination and amplitude set a rotating perturbation around it.

### 5. Switching all four loops sequentially is not recommended

At `rho/R = 0.2` with center-axial equalization:

- Parallel planes: 47.99% worst-volume ripple.
- 15-degree satellite inclination: 62.61% worst-volume ripple, despite only 3.44% center-magnitude ripple.
- 30-degree satellite inclination: 70.78% worst-volume ripple.

The central loop's field profile differs too much from the offset satellite profiles for clean one-for-one handoffs over a volume.

## Recommended starting configurations

### Fixed axial field

Use:

- Bundle radius `rho/R ≤ 0.05` without relying on the main loop, or around `0.1` with main-loop bias.
- Parallel satellite planes, or at most about 5 degrees of inclination.
- Center-axial current equalization.
- Three-phase raised-cosine satellite currents.
- 25–50% continuous main-loop excitation for a 10%-radius bundle.

### Rotating transverse perturbation around an axial bias

Use:

- Three satellite planes distributed at 120-degree azimuths.
- Satellite inclination around 5–15 degrees initially.
- Raised-cosine currents separated by 120 degrees.
- A continuously driven main loop to set the axial field.
- Optimize satellite amplitude against allowed direction wobble and finite-volume ripple.

This resembles a three-phase magnetic-vector actuator more than a replacement for the main field coil.

## Failure modes and uncertainty

- The probe cube is sparse and aligned to Cartesian axes; triangle orientation differences may partly reflect sampling orientation.
- Ideal circular filaments ignore the physical pipe diameter and clearances that motivate the geometry.
- Inclined satellite circles can intersect one another or the main conductor.
- Current equalization assumes arbitrary independent current commands.
- Raised-cosine tracking requires voltage and mutual-inductance capability not modeled here.
- Current-squared values are only proxies because loop circumference and resistance vary with radius.
- No plasma, MHD, vessel, force, thermal, insulation, or structural model is included.

## Next tests

1. Replace the cube with dense spherical and toroidal target volumes.
2. Add finite pipe diameter and reject intersecting geometries.
3. Add mutual inductance and voltage-limited tracking for the four coupled loops.
4. Optimize main-bias fraction and three cosine amplitudes rather than using a coarse grid.
5. Test helical or noncircular satellite paths if the physical goal is three pipes twisting around a main toroidal route.

## Submission status

No external submission, publication, commit, push, or deployment occurred.
