# Integrated controller-in-the-loop experiment

## Goal

Close the full simulated feedback loop for the promoted nested inclined system:

```text
field target
  -> delayed/noisy field probes
  -> adaptive current allocator
  -> current references
  -> coupled L/R/M voltage-limited plant
  -> achieved currents
  -> temperature and energy state
  -> achieved field
  -> probes
```

## Geometry

- Main loop: radius 1.00 m.
- Six 45° correction loops: radii 0.82, 0.88, 0.94, 1.06, 1.12, and 1.18 m.
- Copper radius: 20 mm.
- Minimum centerline clearance: approximately 60 mm.

## Sweep

- Control interval: 5 ms and 20 ms.
- Voltage limit: 10 V and 50 V per coil.
- Sensor delay: 0 and 20 ms.
- Sensor noise: 0% and 1% RMS of nominal field.
- Allocator energy penalty: 0.001 and 0.01.
- Inner current-control time constant: 10 ms and 50 ms.
- Reference-current slew limit: 10 normalized current units per second.

## Scenarios

1. Steady field.
2. Sinusoidal axial amplitude tracking.
3. Main-loop current-capacity derating from 100% to 20%.
4. One correction-coil failure with a dump resistor.
5. Rotating transverse correction around the axial target.

Promoted controllers then run an endurance scenario until field error, dropout, thermal limit, or the 50 MJ energy budget ends useful operation.

## Gates

- Worst scenario RMS field error ≤10%.
- No reversal.
- Dropout ≤1%.
- Voltage saturation ≤1%.
- Peak current density ≤100 MA/m².
- Useful integrated runtime ≥30 s.

## Boundaries

The controller uses all 27 simulated field probes and an exact field influence model. Sensor placement, state estimation, switching details, coolant flow, forces, vessel currents, and plasma response remain absent.
