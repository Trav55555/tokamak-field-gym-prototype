# Decision: nested inclined control geometry

## Question

Can distinct-radius concentric inclined loops retain adaptive vector-field authority while clearing practical conductors?

## Decision

**Yes. This is the first tested geometry to pass both the ideal adaptive-field gate and the subsequent lumped circuit gate.**

Use one radius-1 main loop plus six correction loops at:

```text
0.82, 0.88, 0.94, 1.06, 1.12, 1.18 meters
```

The six correction-plane normals are distributed around a 45-degree cone. Every circular loop has a distinct radius, preventing the equal-radius plane intersections that invalidated the earlier design.

## Adaptive sweep

Command:

```bash
npm run experiment:nested
```

Coverage:

- 30 nested geometries.
- 1,080 bounded feedback controllers.
- Five scenarios per controller.
- 96 control samples per scenario.
- 305 field-qualified controllers.
- 213 controllers also clearing the initial 20 mm conductor gate.

Full results: `results.json`

SHA-256: `955356944270cfa7456392ed20e6a1e83f1cf41386ee4ba1b73363c2deec1aaf`

## Best stability configuration

```text
radius spacing:       0.06 m
inclination:          45°
cone orientation:     0°
lambda_energy:        0
lambda_slew:          0.001
max current delta:    0.10 per sample
```

| Metric | Result |
|---|---:|
| Mean scenario RMS field error | 2.36% |
| Worst scenario RMS field error | **4.56%** |
| Worst individual probe error | 8.23% |
| Dropout | 0% |
| Reversal | 0% |
| Equal-gauge runtime proxy | 2.94× main-only |
| Fixed-total-copper runtime proxy | 0.42× main-only |

Scenario worst errors:

| Scenario | Worst RMS | Worst center direction error |
|---|---:|---:|
| Steady | 2.49% | 0.36° |
| Amplitude tracking | 2.49% | 0.36° |
| Main derating | 2.49% | 0.36° |
| One correction coil failed | 4.56% | 0.38° |
| Rotating correction | 4.11% | 0.60° |

Mean normalized currents ranged from approximately 0.084 to 0.221, corresponding to roughly 8.4–22.1 kA with the experiment's 100 kA current unit. The main loop carried about 20.3 kA, so unlike the prior equal-radius solution it remained an active part of the field system.

## Endurance-biased controller

With `lambda_energy=0.1`, `lambda_slew=0.001`, and `max_delta=0.1`:

- Worst scenario error: 8.70%.
- No dropout or reversal.
- Equal-gauge runtime proxy: 3.80×.
- Fixed-total-copper runtime proxy: 0.54×.

This is the field-error versus loss Pareto control mode. It stays inside the 10% gate but gives up about four percentage points of worst-case accuracy.

## Physical clearance

The measured minimum centerline clearance was approximately **59.97 mm**, between the two outer correction loops.

For 20 mm wire radius:

```text
required clearance = 2.4 × 20 mm = 48 mm
available clearance = 59.97 mm
margin = 11.97 mm
```

This passes the experiment's clearance factor. Real insulation, supports, cooling channels, and force deflection require a larger mechanical design margin.

## Circuit promotion result

The nested candidate was added to `circuit-achievability` using a 20 mm copper radius and an 8–22.5 kA current envelope.

Representative coupling-aware result at a 0.1 s modulation period and 10 V limit:

| Metric | Result |
|---|---:|
| Current tracking RMS | 0.35% |
| Field tracking RMS | 0.22% |
| Voltage saturation | 0% |
| Peak current density | 17.9 MA/m² |
| Copper loss | 202 kW |
| 50 MJ energy runtime | 244 s |
| Thermal-limit runtime | **62 s** |
| Combined estimated runtime | **62 s** |

At a 20 ms modulation period, 50 V per coil was sufficient; the thermal runtime remained about 62 seconds. Thirty circuit configurations for the 20 mm nested system passed all circuit gates.

## Interpretation

The geometry solves the prior conflict by using **radius separation instead of positional separation**:

- Plane inclination supplies vector-control authority.
- Distinct radii prevent centerline intersections.
- Six correction directions preserve redundancy after one failure.
- The central loop participates in baseline field production.

The cost is a wide radial coil pack spanning 0.82–1.18 m and seven independently driven high-current circuits.

## Remaining risks

- The 12 mm clearance margin is modest once insulation, coolant, supports, and force deflection are included.
- The circuit current waveform is a representative 8–22.5 kA multiphase envelope, not a closed-loop replay of every adaptive fault trajectory.
- Thermal runtime uses lumped cooling rather than a coolant design.
- No electromagnetic force or stress calculation is present.
- No skin/proximity effect, switching loss, buswork, or quench analysis.
- No vessel, plasma-equilibrium, or MHD response.

## Next gate

Promote this geometry to an integrated controller-in-the-loop circuit simulation:

1. Feed the adaptive allocator's time-varying current references directly into the coupled circuit plant.
2. Add sensor delay and field noise.
3. Add force and mechanical-clearance margins.
4. Optimize wire cross-section and coolant mass under a fixed system-mass budget.
5. Only then test plasma or vessel response.

## Submission status

No external submission, commit, push, publication, or deployment occurred.
