---
name: Field Gym — Magnetic Plotting Table
description: A ruled laboratory workbench for manipulating coil geometry, activation timing, and field-continuity measurements.
colors:
  plotting-paper: "#f4f2eb"
  fresh-stock: "#fffefa"
  instrument-ink: "#152127"
  secondary-copy: "#5c686c"
  ruled-line: "#b9c2c0"
  structural-rule: "#506168"
  drive-cobalt: "#164bd6"
  drive-cobalt-dark: "#0c3196"
  reverse-vermilion: "#e33a20"
  field-aqua: "#00a89d"
  inactive-metal: "#899395"
  working-panel: "#e8ece8"
typography:
  display:
    fontFamily: "DejaVu Sans Condensed, Noto Sans Display, sans-serif"
    fontSize: "clamp(1.65rem, 2.3vw, 2.45rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.04em"
  body:
    fontFamily: "Noto Sans, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 400
    lineHeight: 1.25
  label:
    fontFamily: "DejaVu Sans Condensed, sans-serif"
    fontSize: "0.68rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.06em"
rounded:
  square: "0px"
spacing:
  tight: "4px"
  control: "8px"
  panel: "16px"
components:
  action-primary:
    backgroundColor: "{colors.drive-cobalt}"
    textColor: "{colors.fresh-stock}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "0 13px"
    height: "38px"
  action-danger:
    backgroundColor: "{colors.reverse-vermilion}"
    textColor: "{colors.fresh-stock}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
  field-input:
    backgroundColor: "{colors.fresh-stock}"
    textColor: "{colors.instrument-ink}"
    rounded: "{rounded.square}"
    padding: "6px 8px"
    height: "35px"
---

# Design System: Field Gym — Magnetic Plotting Table

## Overview

**Creative North Star: "The Magnetic Plotting Table"**

Field Gym behaves like a physical laboratory plotting surface: crisp working stock, hard instrument rails, colored current paths, and measurements sharing one continuous desk. It is dense because the user is operating a model, but the hierarchy keeps the 3D field table dominant and places geometry and continuity evidence immediately beside it.

The visual anti-reference is the generic dark, neon simulation dashboard. Field Gym uses daylight laboratory materials instead of theatrical glow.

**Key Characteristics:**
- Ruled, square, full-width operating surfaces
- Cobalt for positive drive and vermilion for reversal or warning
- Aqua field traces over a pale measurement grid
- Condensed labels paired with neutral reading text
- State shown through geometry, timelines, and explicit numerical readouts

## Colors

Drive Cobalt carries active controls and positive current. Reverse Vermilion marks negative current, warnings, and time control. Field Aqua is reserved for traced field lines. Plotting Paper, Fresh Stock, Working Panel, and structural gray rules create the instrument body.

**The Polarity Rule.** Cobalt means positive drive; vermilion means reversal or warning. Do not exchange these roles for decoration.

**The Measurement Rule.** Field Aqua belongs to computed field traces, not ordinary buttons or labels.

## Typography

**Display Font:** DejaVu Sans Condensed, with Noto Sans Display fallback  
**Body Font:** Noto Sans, with Helvetica Neue and Arial fallbacks  
**Label Font:** DejaVu Sans Condensed

**Character:** Condensed uppercase lettering makes rails and readouts feel instrument-made. Neutral sans text keeps caveats and values legible at high density.

### Hierarchy
- **Display** (700, responsive 1.65–2.45rem, line-height 1): product name.
- **Headline** (700, 1.18rem): register and measurement headings.
- **Body** (400, 0.7–0.78rem): notices and supporting context.
- **Label** (800, 0.62–0.72rem, uppercase): controls, fields, metrics, and state.

**The Two-Voice Rule.** Use condensed type for operation and hierarchy; use the neutral body face for explanation.

## Layout

Desktop uses a sticky 74px instrument masthead, a dominant plotting table, a 330px coil register, and a 222px continuity strip. The plotting table itself stacks a tool rail, flexible canvas, and timeline scrubber. At 1040px the register narrows. At 760px the surface becomes a vertical sequence: compact disclaimer, horizontally scrollable tools, canvas and scrubber, register, then measurements.

Spacing is deliberately compact inside control groups and generous only between functional regions. Borders, not floating containers, establish the workspace.

## Elevation & Depth

The system is flat. Depth comes from tonal layers, hard rules, canvas projection, and the physical overlap of computed geometry. Shadows appear only on the mobile toolbar cue where they communicate hidden horizontal overflow.

**The Flat Instrument Rule.** Do not add persistent card shadows or glass surfaces; structure comes from ruled planes.

## Shapes

All controls, fields, rails, notices, and panels are square. One- and two-pixel rules establish hierarchy. Focus uses a 3px blue outline with a 2px offset. The only curved forms are the simulated coils and field lines themselves.

## Components

### Buttons
- **Shape:** Square, condensed uppercase labels.
- **Primary:** Drive Cobalt with white text; Reverse Vermilion for playback and danger-related actions.
- **Hover / Focus:** Ink-black hover treatment and a visible blue focus outline.

### Inputs / Fields
- **Style:** Fresh Stock background, one-pixel structural border, compact 6px × 8px padding.
- **Focus:** Shared 3px blue outline; browser-native input behavior remains intact.
- **Disabled:** Reduced opacity while preserving the square silhouette.

### Navigation
The tool rail is a continuous ruled strip rather than a menu container. It scrolls horizontally on mobile and exposes a canvas-level swipe cue. The masthead keeps the qualitative-model warning visible at every breakpoint.

### Plotting Table
The canvas is the signature component. It combines a real measurement grid, colored axes, coil polarity, activation opacity, field vectors, traces, group labels, keyboard focus, and live geometry summary.

### Continuity Trace
Magnitude and target-axis projection share one chart. A dashed current-time marker ties timeline evidence to the scrubbed frame. Five tabular metrics expose mean field, worst dip, ripple, dropout, and direction reversal.

## Do's and Don'ts

### Do:
- **Do** keep the qualitative-model boundary visible near the work surface.
- **Do** make current polarity, inactive state, selected geometry, and current time visually distinct.
- **Do** preserve direct access to numeric geometry and schedule fields alongside canvas interaction.
- **Do** use hard rules and tonal planes to organize dense controls.

### Don't:
- **Don't** turn the interface into a dark neon sci-fi dashboard.
- **Don't** use aqua field-trace color for unrelated controls.
- **Don't** replace operating regions with rounded cards or pills.
- **Don't** imply circuit feasibility, plasma equilibrium, or reactor performance through visual language.
