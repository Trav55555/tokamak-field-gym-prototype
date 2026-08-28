# Circuit-achievability experiment program

## Question

Can the dynamically stable satellite-loop current patterns be produced by finite-voltage coupled circuits for a useful thermal and energy-limited runtime?

## Geometry gates

Compare:

1. **Field-optimal inclined bundle:** six satellites, `rho/R=0.05`, 30° inclination.
2. **Clearer inclined bundle:** six satellites, `rho/R=0.30`, 30° inclination.
3. **Parallel-pipe control:** six satellites, `rho/R=0.05`, 0° inclination.
4. **Nested inclined candidate:** six correction loops at radii `1 + 0.06×{-3,-2,-1,+1,+2,+3}`, 45° inclination.

Reject physical conductor combinations whose minimum centerline clearance is below `2.4 × wire radius`.

## Physical scale

- Main-loop radius: 1 meter.
- Current unit: 100 kA.
- Copper resistivity at 20°C: `1.68e-8 ohm meter`.
- Copper density: `8960 kg/m^3`.
- Copper heat capacity: `385 J/(kg K)`.
- Resistance temperature coefficient: `0.00393/K`.
- Ambient: 20°C.
- Thermal limit: 80°C.
- Cooling time constant proxy: 120 seconds.
- Supply-energy budget: 50 MJ.

## Electromagnetic circuit

Use:

```text
L dI/dt + R(T) I = V
```

- Self-inductance: thin circular-loop approximation.
- Mutual inductance: softened Neumann line integral over arbitrary transformed circular loops.
- Inductance matrix must pass a positive-definite check; diagonal regularization is recorded if needed.

## Tracking command

Drive a positive six-phase current modulation around the satellite bundle:

- Main normalized current: 0.20.
- Satellite normalized mean current: 0.18.
- Satellite modulation depth: 25%.

This envelope reaches approximately 22.5 kA with the 100 kA current unit, covering the promoted nested controller's observed 8–22 kA mean-current range.
- Periods: 0.02, 0.10, 0.50, and 2.0 seconds.

Compare:

- **Coupling-aware:** full inductance feedforward and feedback decoupling.
- **Naive:** each supply uses only its own self-inductance while the plant retains full coupling.

## Hardware sweep

- Wire radius: 1, 2, 5, 10, 15, 17, and 20 mm.
- Voltage limit: 10, 50, 200, and 1000 V per coil.
- Current waveform period: 0.02, 0.10, 0.50, and 2.0 s.

## Metrics

- Current and field tracking RMS error.
- Voltage saturation.
- Mutual-inductance strength and matrix conditioning proxy.
- Current density.
- Copper loss and positive supply power.
- Energy-budget runtime.
- Thermal-limit runtime.
- Minimum of thermal and energy runtime.
- Physical-clearance validity.

## Decision gate

A configuration is a circuit candidate only if:

- Geometry clears the conductor-radius gate.
- Current and field tracking RMS error are each ≤5%.
- Voltage saturation ≤1% of samples.
- Peak current density ≤100 MA/m².
- Thermal and energy runtime proxy is at least 30 seconds.
- Inductance matrix is positive definite without material regularization.

## Model boundary

This is still a lumped proxy. It omits skin/proximity effects, buswork, insulation, switching topology, quench behavior, mechanical forces, coolant design, plasma response, and vessel eddy currents.
