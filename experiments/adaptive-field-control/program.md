# Adaptive field-control experiment program

## Objective

Test whether a main circular loop plus three triangularly arrayed satellite loops can dynamically allocate current to maximize field stability while reducing a runtime proxy.

## Meaning of stability and runtime

### Stability proxy

Track a desired vector field over the center and 26 points in a `0.6 × 0.6 × 0.6` cube. Measure:

- RMS and worst vector-field tracking error.
- Axial dropout and reversal.
- Center magnitude and direction error.
- Recovery under main-coil derating and satellite failure.
- Current saturation and slew-limit activity.

### Runtime proxy

Use normalized copper-loss power:

```text
P_loss = sum(radius_i * current_i^2)
```

Radius approximates conductor length and therefore resistance for equal conductor cross-section and material. Under a fixed stored-energy budget, estimated runtime is inversely proportional to mean `P_loss`.

This is not a battery, thermal, voltage, or circuit-runtime model.

## Geometry sweep

- Satellite counts: 3 (requested triangular bundle), 4, and 6 (redundancy ablations).
- Bundle radius `rho/R`: 0.05, 0.10, 0.20, 0.30.
- Satellite plane inclination: 0°, 5°, 15°, 30°.
- Cross-section orientation: 0° and 30°.
- Main loop: radius 1, center `[0,0,0]`, normal `+y`.
- Satellites: regular-polygon cross-sectional offsets and conical plane normals.

The higher satellite counts test whether the three-satellite system's single-failure weakness is a fundamental lack of redundancy.

## Controller

At each time step, solve a constrained quadratic allocation problem:

```text
minimize
  volume_field_error
  + lambda_energy * sum(radius_i * current_i^2)
  + lambda_slew * sum((current_i - previous_i)^2)

subject to
  0 <= current_i <= available_capacity_i
  abs(current_i - previous_i) <= max_delta
```

The implementation uses deterministic projected-gradient iterations on the four current commands. It is a bounded feedback allocator, not a full predictive circuit controller.

## Controller sweep

- Energy penalty: 0, 0.001, 0.01, 0.1.
- Slew penalty: 0.001, 0.01, 0.1.
- Maximum current change per sample: 0.02, 0.05, 0.10.

## Stress scenarios

1. **Steady:** constant uniform `+y` target.
2. **Amplitude tracking:** sinusoidally varying axial target.
3. **Main derating:** main-loop capacity ramps from 1.0 to 0.2.
4. **Satellite failure:** one satellite becomes unavailable halfway through.
5. **Rotating correction:** small rotating transverse target around the axial field.

## Baselines

- Main loop only.
- Fixed nominal four-loop allocation with no feedback to faults or target changes.
- Unconstrained instantaneous allocation as an optimistic oracle.

## Gates

A candidate is promoted only if:

- Worst scenario normalized RMS vector error ≤10%.
- No field reversal.
- Dropout below half target axial field ≤1% of point-times.
- Steady-case RMS error beats the main-only baseline.
- Loss/runtime is compared only among candidates passing the stability gates.

## Model boundary

The field response is instantaneous and linear. The study omits inductance, voltage, mutual coupling, eddy currents, sensor noise, delays, force, heat, plasma response, and MHD. A later circuit model must replace command slew with achievable current dynamics.
