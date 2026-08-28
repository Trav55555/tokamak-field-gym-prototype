# Nested inclined hybrid control program

## Geometry

One main loop at radius 1 is surrounded by six inclined correction loops on distinct concentric radii:

```text
radii = 1 + spacing * {-3, -2, -1, +1, +2, +3}
```

The correction-loop normals are uniformly distributed around a cone. Because every loop has a distinct radius and shares one center, the centerline distance between any pair is bounded below by their radius difference. This removes the crossing singularity of equal-radius inclined loops.

## Sweep

- Radius spacing: 0.04, 0.06, 0.08, 0.10, and 0.12 m.
- Inclination: 15°, 30°, and 45°.
- Cone orientation: 0° and 30°.
- Main plus six correction loops.
- Same 36 bounded-controller settings and five stress scenarios as `adaptive-field-control`.

## Physical gate

Assume an initial 20 mm wire radius for all seven loops and require centerline separation of at least `2.4 × wire radius = 48 mm`. Therefore spacing below 48 mm is rejected before circuit promotion.

## Promotion gate

- Worst scenario normalized RMS field error ≤10%.
- No reversal.
- Dropout ≤1%.
- Beats main-only steady error.
- Passes 20 mm conductor-clearance gate.

Promoted geometries are then passed to the coupled `L/R/M`, voltage, thermal, and energy model.

## Model boundary

The field-control stage still assumes current commands are achieved. Circuit promotion separately tests that assumption. Plasma and structural stability remain out of scope.
