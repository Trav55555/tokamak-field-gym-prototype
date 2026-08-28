# Decision: adaptive field control and runtime trade-off

## Question

Can a main loop plus satellite loops dynamically allocate current to maximize field stability and runtime?

## Decision

**Adaptive allocation works in the vacuum-field model, but the requested three-satellite bundle is not sufficiently fault tolerant under the strict 10% gate.**

- Main + 3 satellites: no controller passed all five stress scenarios; best worst-scenario RMS error was 16.59%.
- Main + 4 satellites: no bounded controller passed; best was 11.82%. The instantaneous oracle reached 10.04%, making this a borderline design worth finer tuning.
- Main + 6 satellites: 55 controllers passed. Best worst-scenario error was 7.44%, with no dropout or reversal.

The strongest tested geometry was a thin satellite bundle at `rho/R = 0.05` with 30-degree conical satellite inclination.

## Experiment

Command:

```bash
npm run experiment:adaptive
```

The sweep covered:

- 96 geometries.
- 3, 4, and 6 satellites around one main loop.
- 3,456 bounded feedback controllers.
- Five scenarios per controller.
- 96 control samples per scenario.
- Approximately 1.66 million adaptive scenario steps.
- Magba Rust/WASM field kernel.

Full results: `results.json`

SHA-256: `67b8dc822432e61f6a03ed058679c295eff610b91f73a1831c9df5b13b669d75`

## Baseline failure

A main loop alone had:

| Scenario | RMS field error | Other failure |
|---|---:|---|
| Steady field | 15.99% | Spatial nonuniformity |
| Amplitude tracking | 15.99% | Spatial nonuniformity remains |
| Main derating | Up to 75.56% | 49.1% axial dropout |
| Rotating correction | 19.85% | 6.84° center direction error |

A fixed multi-loop allocation substantially improved the steady field but failed changing targets and satellite loss because it could not redistribute current.

## Best stability configuration

```text
satellites:          6
bundle radius:       0.05 R
satellite tilt:      30°
orientation:         0°
lambda_energy:       0.001
lambda_slew:         0.001
max current delta:   0.10 per sample
```

### Aggregate result

| Metric | Result |
|---|---:|
| Mean scenario RMS error | 6.31% |
| Worst scenario RMS error | 7.44% |
| Worst single-probe error | 14.54% |
| Dropout | 0% |
| Reversal | 0% |
| Equal-gauge runtime proxy | 3.73× main-only |
| Fixed-total-copper runtime proxy | 0.53× main-only |

### Stress slices

| Scenario | Mean RMS | Worst RMS | Worst center angle |
|---|---:|---:|---:|
| Steady | 6.10% | 7.07% | 0.12° |
| Amplitude tracking | 6.10% | 7.07% | 0.12° |
| Main derating | 6.10% | 7.07% | 0.12° |
| One satellite failed | 6.33% | 7.32% | 0.67° |
| Rotating correction | 6.92% | 7.44% | 0.51° |

In this solution the main loop carried almost no steady current—about `0.0017`—while satellite currents ranged from approximately `0.14` to `0.19`. The optimizer treated the main loop as a reserve/shaping actuator rather than the primary field source.

After a satellite failure, it redistributed current toward the remaining symmetric partners. The simulated recovery occurred within one sample, but that result assumes instantaneous sensing and current response.

## Best qualified runtime setting

```text
satellites:          6
bundle radius:       0.05 R
satellite tilt:      30°
orientation:         30°
lambda_energy:       0.10
lambda_slew:         0.01
max current delta:   0.05 per sample
```

| Metric | Result |
|---|---:|
| Mean scenario RMS error | 8.47% |
| Worst scenario RMS error | 9.93% |
| Dropout/reversal | 0% / 0% |
| Mean loss proxy | 0.1026 |
| Equal-gauge runtime proxy | 5.08× |
| Fixed-total-copper runtime proxy | 0.73× |

This sits near the stability gate: it saves more loss proxy but permits almost 10% worst-case error.

## The runtime accounting matters

The apparent 3.7–5.1× runtime gain assumes **every added coil retains the same conductor gauge as the original main loop**. That means the seven-loop system uses roughly seven parallel conductor allocations and substantially more copper.

If total copper cross-section is held fixed and divided among all seven coils, resistance rises. Under that accounting:

- Best-stability runtime falls to about 0.53× main-only.
- Best-runtime qualified setting reaches about 0.73× main-only.

Therefore the controller does not create free runtime. It trades additional copper, channels, and power electronics for lower current per path and greater control authority. Real optimization must include conductor mass, resistance, thermal capacity, switching loss, and supply energy.

## Redundancy result

| Satellites | Best bounded-controller worst error | Best oracle worst error | Passed 10% gate? |
|---:|---:|---:|---|
| 3 | 16.59% | 15.19% | No |
| 4 | 11.82% | 10.04% | No, but borderline |
| 6 | 7.44% | 7.41% | Yes |

The single-satellite failure was the limiting scenario for three and four satellites. Six satellites retained enough geometric symmetry and independent control directions after one failure.

## Recommended architecture

For the next prototype, use:

- One central loop plus six independently driven satellite loops.
- Satellite cross-section radius around 5% of main-loop radius.
- Approximately 30° conical plane inclination if rotating correction authority is required.
- Closed-loop field probes distributed over the target volume, not only at the center.
- Constrained current allocation with explicit field-error, energy, and slew penalties.
- A Pareto control mode:
  - **Stability mode:** low energy penalty, faster reallocation.
  - **Endurance mode:** higher energy penalty, accepting up to the allowed field-error boundary.
- Fault detection and automatic removal of failed actuators from the allocation matrix.

If the central loop must remain the primary source, add a minimum-main-current or main-field-fraction constraint; the current unconstrained stability optimum prefers the six satellites.

## What is and is not proven

Supported in the present model:

- Adaptive current allocation improves volume-field tracking.
- Redundant satellites suppress main derating and single-satellite failure effects.
- Energy penalties expose a stability-versus-loss Pareto frontier.
- Three satellites are insufficient for the chosen robust gate; six work in the tested geometry.

Not yet supported:

- Actual electrical runtime.
- Voltage-achievable current trajectories.
- Robustness to sensor delay/noise.
- Mutual-inductance and vessel-current response.
- Thermal or structural survival.
- Plasma equilibrium, confinement, or MHD stability.

## Highest-value next test

Add the coupled circuit equation

```text
L dI/dt + R I + M dI_other/dt = V
```

with voltage, temperature, and stored-energy limits. Then run the same controller against achievable currents rather than ideal commands. This is the minimum next step before making a runtime claim.

## Submission status

No external submission, commit, push, publication, or deployment occurred.
