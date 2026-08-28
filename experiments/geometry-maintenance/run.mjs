import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEngine } from "../../src/engine.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../..");
const engine = await loadEngine(projectRoot);
const STEPS = 144;
const TIMES = Array.from({ length: STEPS }, (_, index) => (index + 0.5) / STEPS);
const DEG = Math.PI / 180;
const EPSILON = 1e-10;

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const std = (values) => {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};
const magnitude = (vector) => Math.hypot(...vector);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp = (value, lower, upper) => Math.min(upper, Math.max(lower, value));
const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;
const angleFromAxis = (field) => {
  const length = magnitude(field);
  return length < EPSILON ? 180 : Math.acos(clamp(field[1] / length, -1, 1)) / DEG;
};

function targetProbes() {
  const probes = [[0, 0, 0]];
  for (const x of [-0.3, 0, 0.3]) {
    for (const y of [-0.3, 0, 0.3]) {
      for (const z of [-0.3, 0, 0.3]) {
        if (x === 0 && y === 0 && z === 0) continue;
        probes.push([x, y, z]);
      }
    }
  }
  return probes;
}

function pairRadii(count, radiusSpread) {
  const pairCount = count / 2;
  const radii = [];
  for (let pair = 0; pair < pairCount; pair += 1) {
    const fraction = pairCount === 1 ? 0.5 : pair / (pairCount - 1);
    const radius = 1 - radiusSpread + 2 * radiusSpread * fraction;
    radii.push(radius, radius);
  }
  return radii;
}

function geometry(family, count, inclinationDeg, radiusSpread) {
  const inclination = inclinationDeg * DEG;
  const pairCount = count / 2;
  const normals = [];
  for (let pair = 0; pair < pairCount; pair += 1) {
    if (family === "cone") {
      const azimuth = pair / pairCount * Math.PI;
      normals.push(
        [Math.sin(inclination) * Math.cos(azimuth), Math.cos(inclination), Math.sin(inclination) * Math.sin(azimuth)],
        [-Math.sin(inclination) * Math.cos(azimuth), Math.cos(inclination), -Math.sin(inclination) * Math.sin(azimuth)],
      );
    } else {
      const level = pairCount === 1 ? inclination : inclination * (pair + 1) / pairCount;
      normals.push([0, Math.cos(level), Math.sin(level)], [0, Math.cos(level), -Math.sin(level)]);
    }
  }
  const radii = pairRadii(count, radiusSpread);
  const loops = normals.map((normal, index) => ({
    id: `${family}-${index}`,
    name: `${family} loop ${index + 1}`,
    center: [0, 0, 0],
    normal,
    radius: radii[index],
    current: 1,
    segments: 64,
    visible: true,
    role: "drive",
    schedule: { waveform: "dc", delay: 0, period: 1, duty: 1, phase: 0 },
  }));
  return { loops, normals, radii };
}

async function fieldInfluences(loops, probes) {
  return Promise.all(loops.map((loop) => engine.fields({ loops: [loop] }, probes, 0, { softening: 0.025 })));
}

function currentGains(policy, influences, normals, referenceCenterMagnitude) {
  const gains = [];
  for (let index = 0; index < influences.length; index += 1) {
    if (policy === "fixed_current") {
      gains.push(1);
      continue;
    }
    const centerField = influences[index][0];
    const ownAxisField = dot(centerField, normals[index]);
    if (policy === "equal_center_magnitude") {
      gains.push(referenceCenterMagnitude / Math.max(EPSILON, ownAxisField));
      continue;
    }
    const axialField = centerField[1];
    if (axialField <= referenceCenterMagnitude * 0.01) return null;
    gains.push(referenceCenterMagnitude / axialField);
  }
  return gains;
}

function activation(strategy, count, time) {
  if (strategy === "dc") return { factors: new Array(count).fill(1), scale: 1 / count };
  if (strategy === "triangle") {
    return {
      factors: Array.from({ length: count }, (_, index) => 1 - Math.abs(2 * mod(time + index / count, 1) - 1)),
      scale: 2 / count,
    };
  }
  let duty;
  let phases;
  if (strategy === "one_at_a_time") {
    duty = 1 / count;
    phases = Array.from({ length: count }, (_, index) => index / count);
  } else if (strategy === "uniform_overlap") {
    duty = Math.min(1, 2 / count);
    phases = Array.from({ length: count }, (_, index) => index / count);
  } else if (strategy === "balanced_pairs") {
    const pairCount = count / 2;
    duty = 1 / pairCount;
    phases = Array.from({ length: count }, (_, index) => Math.floor(index / 2) / pairCount);
  } else {
    duty = 0.5;
    phases = new Array(count).fill(0);
  }
  return {
    factors: phases.map((phase) => mod(time + phase, 1) < duty ? 1 : 0),
    scale: 1 / (count * duty),
  };
}

function evaluate(config, influences, gains) {
  const { family, count, inclinationDeg, radiusSpread, currentPolicy, strategy } = config;
  const probeMagnitudes = influences[0].map(() => []);
  const probeAxial = influences[0].map(() => []);
  const centerFields = [];
  const spatialMagnitudeCvs = [];
  const absoluteCurrent = [];
  const currentSquared = [];
  const peakLoopCurrent = [];

  for (const time of TIMES) {
    const { factors, scale } = activation(strategy, count, time);
    const weights = factors.map((factor, index) => factor * scale * gains[index]);
    absoluteCurrent.push(weights.reduce((sum, value) => sum + Math.abs(value), 0));
    currentSquared.push(weights.reduce((sum, value) => sum + value * value, 0));
    peakLoopCurrent.push(Math.max(...weights.map(Math.abs)));
    const magnitudesAtTime = [];

    for (let probeIndex = 0; probeIndex < probeMagnitudes.length; probeIndex += 1) {
      const field = [0, 0, 0];
      for (let loopIndex = 0; loopIndex < count; loopIndex += 1) {
        const source = influences[loopIndex][probeIndex];
        const weight = weights[loopIndex];
        field[0] += source[0] * weight;
        field[1] += source[1] * weight;
        field[2] += source[2] * weight;
      }
      const fieldMagnitude = magnitude(field);
      probeMagnitudes[probeIndex].push(fieldMagnitude);
      probeAxial[probeIndex].push(field[1]);
      magnitudesAtTime.push(fieldMagnitude);
      if (probeIndex === 0) centerFields.push(field);
    }
    spatialMagnitudeCvs.push(std(magnitudesAtTime) / Math.max(EPSILON, mean(magnitudesAtTime)));
  }

  const allAxial = probeAxial.flat();
  const allMagnitudes = probeMagnitudes.flat();
  const meanAxial = mean(allAxial);
  const minimumAxial = Math.min(...allAxial);
  const dropoutThreshold = meanAxial > EPSILON ? meanAxial * 0.5 : EPSILON;
  const reversalFraction = allAxial.filter((value) => value < 0).length / allAxial.length;
  const dropoutFraction = allAxial.filter((value) => value < dropoutThreshold).length / allAxial.length;
  const magnitudeRipples = probeMagnitudes.map((values) => (Math.max(...values) - Math.min(...values)) / Math.max(EPSILON, mean(values)));
  const centerMagnitudes = probeMagnitudes[0];
  const centerAngles = centerFields.map(angleFromAxis);
  const transverseAzimuths = centerFields
    .filter((field) => Math.hypot(field[0], field[2]) > EPSILON)
    .map((field) => Math.atan2(field[2], field[0]));
  const azimuthResultant = transverseAzimuths.length
    ? Math.hypot(mean(transverseAzimuths.map(Math.cos)), mean(transverseAzimuths.map(Math.sin)))
    : 1;
  const occupiedAzimuthBins = new Set(transverseAzimuths.map((angle) => Math.floor(mod(angle, Math.PI * 2) / (Math.PI * 2) * 12))).size;
  const centerMagnitudeMean = mean(centerMagnitudes);
  const centerMagnitudeRipple = magnitudeRipples[0];
  const worstVolumeMagnitudeRipple = Math.max(...magnitudeRipples);
  const maxCenterAngleDeg = Math.max(...centerAngles);
  const minimumCenterMagnitudeToMean = Math.min(...centerMagnitudes) / Math.max(EPSILON, centerMagnitudeMean);
  const dynamicActivation = strategy !== "dc"
    && !(count === 2 && ["uniform_overlap", "balanced_pairs"].includes(strategy));
  const staticMaintaining = dynamicActivation
    && reversalFraction === 0
    && dropoutFraction === 0
    && worstVolumeMagnitudeRipple <= 0.1
    && maxCenterAngleDeg <= 5;
  const rotatingCandidate = dynamicActivation
    && count >= 6
    && centerMagnitudeRipple <= 0.05
    && minimumCenterMagnitudeToMean >= 0.9
    && occupiedAzimuthBins >= 6
    && azimuthResultant <= 0.35
    && mean(centerAngles) >= Math.max(3, inclinationDeg * 0.5);

  return {
    ...config,
    metrics: {
      meanMagnitude: mean(allMagnitudes),
      meanAxialProjection: meanAxial,
      minimumAxialProjection: minimumAxial,
      minimumAxialToMean: meanAxial > EPSILON ? minimumAxial / meanAxial : null,
      centerMagnitudeRipple,
      worstVolumeMagnitudeRipple,
      minimumCenterMagnitudeToMean,
      meanCenterAngleDeg: mean(centerAngles),
      maxCenterAngleDeg,
      centerAngleStdDeg: std(centerAngles),
      meanSpatialMagnitudeCv: mean(spatialMagnitudeCvs),
      worstSpatialMagnitudeCv: Math.max(...spatialMagnitudeCvs),
      meanTransverseToAxial: mean(centerFields.map((field) => Math.hypot(field[0], field[2]) / Math.max(EPSILON, Math.abs(field[1])))),
      dropoutFraction,
      reversalFraction,
      azimuthCircularResultant: azimuthResultant,
      occupiedAzimuthBins,
      meanAbsoluteCurrent: mean(absoluteCurrent),
      peakAbsoluteCurrent: Math.max(...absoluteCurrent),
      meanCurrentSquared: mean(currentSquared),
      peakCurrentSquared: Math.max(...currentSquared),
      peakLoopCurrent: Math.max(...peakLoopCurrent),
      dynamicActivation,
      staticMaintaining,
      rotatingCandidate,
    },
  };
}

function staticRank(result) {
  const m = result.metrics;
  return m.worstVolumeMagnitudeRipple * 10 + m.maxCenterAngleDeg / 5 + m.dropoutFraction * 20 + m.reversalFraction * 100 + m.meanSpatialMagnitudeCv;
}

function rotatingRank(result) {
  const m = result.metrics;
  return m.centerMagnitudeRipple * 20 + m.azimuthCircularResultant + m.minimumCenterMagnitudeToMean * -0.1;
}

const probes = targetProbes();
const referenceLoop = geometry("cone", 2, 0, 0).loops[0];
const referenceInfluence = await fieldInfluences([referenceLoop], probes);
const referenceCenterMagnitude = magnitude(referenceInfluence[0][0]);
const startedAt = new Date().toISOString();
const started = performance.now();
const results = [];
const skipped = [];

for (const family of ["fan", "cone"]) {
  for (const count of [2, 4, 6, 8, 12]) {
    for (const inclinationDeg of [0, 5, 15, 30, 45, 60, 75, 90]) {
      for (const radiusSpread of [0, 0.1, 0.25, 0.5]) {
        const system = geometry(family, count, inclinationDeg, radiusSpread);
        const influences = await fieldInfluences(system.loops, probes);
        for (const currentPolicy of ["fixed_current", "equal_center_magnitude", "equal_center_axial"]) {
          const gains = currentGains(currentPolicy, influences, system.normals, referenceCenterMagnitude);
          if (!gains) {
            skipped.push({ family, count, inclinationDeg, radiusSpread, currentPolicy, reason: "axial compensation singular or above 100x" });
            continue;
          }
          for (const strategy of ["dc", "one_at_a_time", "uniform_overlap", "balanced_pairs", "triangle", "synchronized"]) {
            results.push(evaluate({ family, count, inclinationDeg, radiusSpread, currentPolicy, strategy }, influences, gains));
          }
        }
      }
    }
  }
}

const inclinedStaggered = results.filter((result) => result.inclinationDeg > 0 && !["dc", "synchronized"].includes(result.strategy));
const staticQualifiers = inclinedStaggered.filter((result) => result.metrics.staticMaintaining).sort((a, b) => staticRank(a) - staticRank(b));
const rotatingQualifiers = inclinedStaggered.filter((result) => result.metrics.rotatingCandidate).sort((a, b) => rotatingRank(a) - rotatingRank(b));
const evidenceSlices = {
  cone30OneHot: results.filter((result) => result.family === "cone" && result.count === 8 && result.inclinationDeg === 30 && result.radiusSpread === 0 && result.currentPolicy === "fixed_current" && result.strategy === "one_at_a_time"),
  cone30Pairs: results.filter((result) => result.family === "cone" && result.count === 8 && result.inclinationDeg === 30 && result.radiusSpread === 0 && result.currentPolicy === "fixed_current" && result.strategy === "balanced_pairs"),
  fan45Pairs: results.filter((result) => result.family === "fan" && result.count === 8 && result.inclinationDeg === 45 && result.radiusSpread === 0 && result.currentPolicy === "fixed_current" && result.strategy === "balanced_pairs"),
  nestedCone30Pairs: results.filter((result) => result.family === "cone" && result.count === 8 && result.inclinationDeg === 30 && result.radiusSpread === 0.5 && result.currentPolicy === "equal_center_magnitude" && result.strategy === "balanced_pairs"),
};

const artifact = {
  metadata: {
    question: "How do planar mutual inclination and concentric/nested geometry affect staggered field maintenance?",
    evidenceGrade: "candidate numerical sweep; normalized prescribed-current vacuum filament model",
    engine: engine.kind,
    startedAt,
    completedAt: new Date().toISOString(),
    elapsedMs: performance.now() - started,
    timeSteps: STEPS,
    probes: probes.length,
    resultCount: results.length,
    skippedPolicyCases: skipped.length,
  },
  definitions: {
    targetVolume: "center plus 26 points on a cube with coordinates -0.3, 0, +0.3; loop nominal radius 1",
    fan: "opposite inclination pairs sharing one line of nodes; pair inclination levels extend to inclinationDeg",
    cone: "diametric normal pairs at one polar inclination, distributed azimuthally",
    radiusSpread: "nested pair radii span 1-radiusSpread through 1+radiusSpread",
    currentNormalization: "activation schedules have unit mean nominal absolute current before geometry compensation gains",
  },
  summary: {
    staticQualifierCount: staticQualifiers.length,
    rotatingQualifierCount: rotatingQualifiers.length,
    topStatic: staticQualifiers.slice(0, 20),
    topRotating: rotatingQualifiers.slice(0, 20),
    evidenceSlices,
  },
  skipped,
  results,
};
await writeFile(resolve(here, "results.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify(artifact.metadata, null, 2));
console.log(JSON.stringify({ staticQualifierCount: staticQualifiers.length, rotatingQualifierCount: rotatingQualifiers.length }, null, 2));
