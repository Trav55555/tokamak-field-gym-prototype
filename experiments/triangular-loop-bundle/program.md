# Main-loop plus triangular satellite-bundle experiments

## Geometry

A main circular loop has radius 1, center `[0,0,0]`, and normal `+y`. Three satellite circular loops surround its centerline in an equilateral cross-section:

```text
                 satellite
                    ○

          satellite ○   ● main   ○ satellite
```

More exactly, satellite `i` uses cross-sectional offset

```text
(delta radius, delta y) = rho * (cos(orientation + i*120°), sin(orientation + i*120°))
```

Therefore each satellite has:

- Radius `1 + delta radius`.
- Center `[0, delta y, 0]`.
- Optional conical plane inclination whose azimuth follows its cross-sectional position.

This is called a **coaxial triangular loop bundle** here. It approximates four pipes following the same circular route: one main pipe and three satellite pipes around it.

## Questions

1. Can sequential satellite activation maintain the main loop's axial field?
2. How much DC bias in the main loop is needed to suppress satellite handoff ripple?
3. How does bundle thickness `rho` affect central and finite-volume continuity?
4. Does current equalization hide off-axis errors, as it did for nested concentric rings?
5. Do inclined satellites create a useful three-step rotating component or merely unwanted field-direction wobble?

## Sweep

- Bundle radius `rho`: 0, 0.05, 0.1, 0.2, 0.3, 0.5 main-loop radii.
- Triangle orientation: 0° and 30°.
- Satellite plane inclination: 0°, 5°, 15°, 30°, and 45°.
- Main DC current fraction: 0%, 25%, 50%, and 75% of mean nominal excitation.
- Current policies: fixed satellite current and center-axial-equalized satellite current.
- Schedules:
  - Satellite one-at-a-time with main DC bias.
  - Three-phase satellite triangle currents with main DC bias.
  - Three-phase raised-cosine currents whose summed satellite command is constant.
  - All satellites DC with main DC bias.
  - Synchronized satellite pulse negative control.
  - All four loops one-at-a-time.

## Metrics and gates

Use the center and 26 points in the same `0.6 × 0.6 × 0.6` cube as the inclined-concentric study.

A dynamic configuration qualifies as static-axis maintaining only if:

- No axial reversal or dropout below half mean axial field.
- Worst-volume magnitude ripple ≤10%.
- Maximum center deviation from `+y` ≤5°.

A rotating-component candidate requires:

- Center magnitude ripple ≤5%.
- At least three occupied transverse azimuth sectors.
- A center direction excursion of at least 3°.

## Model boundary

This remains a normalized prescribed-current vacuum-filament experiment. It permits conductor intersections and ignores resistance, inductance, voltage, force, heating, vessel response, and plasma physics.
