# Decision: integrated adaptive circuit loop

## Question

Does the nested inclined system remain stable when field feedback is closed through delayed/noisy sensors, an adaptive allocator, a coupled voltage-limited circuit, thermal derating, and failures?

## Decision

**Yes, at candidate level.** The integrated model retained the field target through all short stress scenarios and sustained useful operation for approximately **72.3 seconds** before thermal derating pushed field error above the 10% gate.

The limiting resource was thermal control authority, not voltage or the 50 MJ energy budget.

## Experiment

Command:

```bash
npm run experiment:integrated
```

The closed loop was:

```text
target field
 -> delayed/noisy 27-probe measurement
 -> adaptive constrained allocator
 -> current references
 -> full L/R/M voltage controller
 -> achieved currents
 -> copper temperature and energy
 -> achieved field
 -> probes
```

Sweep:

- 64 controller/circuit configurations.
- Five short stress scenarios each.
- 5 ms and 20 ms control intervals.
- 10 V and 50 V limits.
- 0 and 20 ms sensor delay.
- 0% and 1% sensor noise.
- Two allocator energy penalties.
- 10 ms and 50 ms inner current time constants.

Results:

- Dynamically qualified: 24/64.
- Endurance-tested finalists: 5.
- Endurance gate passes: 5/5.

Full results: `results.json`

SHA-256: `c366df8c7bed61658dca25f8056a3a783774fe76a778087aa5bff052f7d23d6d`

## Best short-scenario controller

```text
control interval:             5 ms
voltage limit:                10 V
sensor delay:                 0 ms
sensor noise:                 0%
allocator energy penalty:     0.001
current-control time constant: 10 ms
```

| Aggregate metric | Result |
|---|---:|
| Mean RMS field error | 2.39% |
| Worst RMS field error | **7.58%** |
| Worst individual-probe error | 13.88% |
| Dropout | 0% |
| Reversal | 0% |
| Voltage saturation | 0% |
| Peak current density | 27.4 MA/m² |
| Maximum short-run temperature | 24.98°C |

### Stress scenarios

| Scenario | Mean RMS | Worst RMS | Worst center angle |
|---|---:|---:|---:|
| Steady | 2.08% | 2.73% | 0.37° |
| Amplitude tracking | 2.16% | 2.73% | 0.37° |
| Main derating | 2.07% | 2.73% | 0.37° |
| Correction-coil failure | 3.10% | **7.58%** | 3.00° |
| Rotating correction | 2.54% | 4.45% | 0.64° |

The correction-coil failure remained the limiting transient. The failed circuit used a dump-resistance model rather than disappearing instantaneously.

## Noise and delay robustness

With 20 ms sensor delay, 1% RMS field noise, 50 V, and otherwise the same controller:

- Mean aggregate error: 2.48%.
- Worst error: 7.63%.
- Correction-failure center angle: 3.03°.
- Dropout/reversal: 0%.
- Voltage saturation: 0%.

The tested noise and delay had little effect because the field dynamics and feedback gain remained well below the unstable regime. This should not be extrapolated to larger delays without another sweep.

At a 20 ms control interval, some configurations still passed, but worst error rose to approximately 9.1%. The 5 ms loop provides substantially more margin.

## Endurance result

All five promoted controllers reached approximately the same useful runtime:

```text
useful runtime:       72.33 s
stop reason:          sustained field error above 10%
maximum temperature: 77.74°C
energy used:          12.05 MJ of 50 MJ
peak current density: 23.7–23.8 MA/m²
voltage saturation:   0%
dropout:              0%
```

Thermal derating began at 60°C. As several loops approached 78°C, their allowed current declined. The allocator redistributed current until the remaining authority could no longer keep RMS field error under 10% for 0.5 seconds.

The run ended because of **thermal loss of control authority**, before:

- The 80°C hard thermal limit.
- The 50 MJ energy budget.
- Voltage saturation.
- Field dropout or reversal.

Final temperatures were uneven: several coils reached about 77.7°C while two remained near 48–57°C. This indicates an opportunity to improve runtime through conductor and cooling allocation by coil rather than uniformly increasing all wire sizes.

## Control parameter findings

Qualified configurations were concentrated around:

- 5 ms control interval: 16 passes.
- 20 ms control interval: 8 passes.
- Energy penalty 0.001: 16 passes.
- Energy penalty 0.01: 8 passes.
- 10 ms current time constant: 16 passes.
- 50 ms current time constant: 8 passes.

Both 10 V and 50 V produced 12 passes, confirming that voltage was not the active constraint for these dynamics.

## What is now supported

Within the modeled boundary, the nested distinct-radius geometry supports:

- Closed-loop volume-field regulation.
- Main-loop derating compensation.
- Correction-coil failure recovery with inductive decay.
- Rotating transverse commands.
- 20 ms field-sensor delay and 1% measurement noise.
- Full mutual-inductance circuit dynamics.
- Temperature-dependent resistance and thermal current derating.
- More than one minute of useful operation.

## What remains unproven

- Mechanical force, torque, vibration, and support deflection.
- Whether deflection consumes the 12 mm clearance margin.
- Real cooling-channel geometry and coolant pumping power.
- Switching topology, busbars, insulation, and quench protection.
- Skin/proximity loss at the faster modulation settings.
- Sparse-probe state estimation; the simulation directly observes all 27 field vectors.
- Conductive vessel response.
- Plasma equilibrium or MHD stability.

## Next engineering gate

The highest-value next work is **force-aware thermal optimization**:

1. Compute pairwise Lorentz force and torque over the current envelope and failures.
2. Convert force into support stress and clearance deflection.
3. Allocate conductor cross-section and coolant per coil based on observed heat load.
4. Include coolant and support mass in runtime optimization.
5. Re-run the integrated loop with the resulting temperature and geometry changes.

The present candidate should not proceed to plasma claims until it survives that mechanical/thermal gate.

## Submission status

No external submission, commit, push, publication, or deployment occurred.
