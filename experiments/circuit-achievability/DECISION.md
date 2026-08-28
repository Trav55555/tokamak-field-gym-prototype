# Decision: circuit achievability

## Question

Can the adaptive satellite-loop currents be produced with finite voltage, mutual inductance, conductor clearance, copper heating, and a finite energy budget?

## Decision

**The original equal-radius inclined bundle fails physically, but the distinct-radius nested redesign passes the present field and circuit gates.**

The promoted design is:

- Main loop radius: 1.00 m.
- Six correction-loop radii: 0.82, 0.88, 0.94, 1.06, 1.12, and 1.18 m.
- Correction inclination: 45° around a six-direction cone.
- Copper radius: 20 mm.
- Representative current envelope: 8–22.5 kA.
- Coupling-aware voltage control.

## Experiment

Command:

```bash
npm run experiment:circuit
```

Sweep:

- Four seven-loop geometries.
- 1, 2, 5, 10, 15, 17, and 20 mm copper radii.
- 0.02, 0.10, 0.50, and 2.0 second modulation periods.
- 10, 50, 200, and 1000 V per-coil limits.
- Coupling-aware and naïve independent controllers.
- 896 circuit configurations.

Physical assumptions:

- 1 m main radius.
- 100 kA normalized-current unit.
- 50 MJ supply budget.
- 80°C thermal limit.
- 120 s cooling-time-constant proxy.

Full results: `results.json`

SHA-256: `0117ab4ac22ba1bb60ec6f2eb69f6ee8e3f705d2d3b6ef4352f1f69f641669f4`

## Combined field and circuit result

| Geometry | Adaptive worst field error | Clearance | Circuit result | Combined pass? |
|---|---:|---:|---|---|
| Equal-radius thin inclined | 7.44% | 5.71 mm | Thick conductors overlap; thin conductors overheat | No |
| Wider positional bundle | 16.12% | 42.30 mm | 17 mm wire tracks for ~66 s | No—field gate |
| Parallel bundle | 19.74% | 49.99 mm | 20 mm wire tracks for ~200 s | No—vector authority |
| **Nested distinct radii** | **4.56%** | **59.97 mm** | **20 mm wire tracks for ~62 s** | **Yes, candidate** |

## Nested candidate: representative circuit result

At a 0.1 second modulation period, 10 V limit, and full coupling compensation:

| Metric | Result |
|---|---:|
| Current tracking RMS | 0.35% |
| Field tracking RMS | 0.22% |
| Voltage saturation | 0% |
| Peak current density | 17.9 MA/m² |
| Copper loss | 202 kW |
| Positive supply power | 205 kW |
| 50 MJ energy runtime | 244 s |
| Thermal-limit runtime | **62 s** |
| Combined runtime | **62 s** |
| Mutual-coupling ratio proxy | 1.22 |
| Inductance regularization | None |

At a 20 ms modulation period:

- 50 V per coil passed without saturation.
- Coupling-aware current error was about 0.38%.
- Field error was about 0.24%.
- Thermal runtime remained approximately 62 seconds.

Thirty nested 20 mm configurations passed every circuit gate. The stricter current envelope reduced the total circuit-candidate count from the earlier low-current sweep, as intended.

## Why nested radii work

For two circles sharing a center but using distinct radii, any points on the circles differ in distance from the shared center. Their centerlines therefore cannot intersect. Plane inclination can supply vector control without requiring equal-radius conductors to cross.

The 6 cm radius spacing produced:

```text
minimum measured clearance: 59.97 mm
required for 20 mm wire:     48.00 mm
remaining margin:            11.97 mm
```

This is enough for the numerical gate, but not yet a complete insulation or structural clearance design.

## Coupling control

For the nested 20 mm system at a 0.1 s period:

- Coupling-aware current error: approximately 0.35%.
- Naïve independent current error: approximately 0.85%.
- Coupling-aware field error: approximately 0.22%.
- Naïve field error: approximately 0.53%.

Both passed this smooth-waveform test, but full-matrix compensation should remain mandatory for fault transients.

All inductance matrices passed the positive-definite check without diagonal regularization.

## What this establishes

Candidate-level support for:

- A physically nonintersecting inclined circular-loop arrangement.
- Adaptive vector-field error below 5% across the tested volume and failures.
- Finite-voltage tracking of representative 8–22.5 kA dynamics.
- Current density below 100 MA/m².
- Approximately one minute of thermal runtime under the assumed cooling proxy.

## What remains unproven

- The circuit run tracks a representative multiphase current envelope, not the exact adaptive controller trajectory during every fault.
- Mechanical forces may consume the 12 mm clearance margin.
- Cooling, insulation, switching, buswork, and quench protection are placeholders.
- Skin and proximity effects are omitted.
- Supply regeneration and conversion losses are simplified.
- Plasma, vessel, equilibrium, and MHD stability remain absent.

## Next gate

Run one integrated simulation in which:

1. Field probes drive the adaptive allocator.
2. The allocator emits current references.
3. The full `L/R/M` plant and voltage limits produce achievable currents.
4. Achievable currents update the field.
5. Sensor noise, delay, thermal derating, and failures feed back into the next control step.

That integrated loop—not an ideal allocator plus a separate waveform test—is required before promoting the design beyond candidate status.

## Submission status

No external submission, commit, push, publication, or deployment occurred.
