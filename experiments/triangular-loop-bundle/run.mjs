import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEngine } from "../../src/engine.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../..");
const engine = await loadEngine(projectRoot);
const DEG = Math.PI / 180;
const STEPS = 144;
const TIMES = Array.from({ length: STEPS }, (_, index) => (index + 0.5) / STEPS);
const EPSILON = 1e-10;
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const std = (values) => { const average = mean(values); return Math.sqrt(mean(values.map((value) => (value - average) ** 2))); };
const magnitude = (vector) => Math.hypot(...vector);
const clamp = (value, lower, upper) => Math.min(upper, Math.max(lower, value));
const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;
const centerAngle = (field) => magnitude(field) < EPSILON ? 180 : Math.acos(clamp(field[1] / magnitude(field), -1, 1)) / DEG;

function probes() {
  const points = [[0, 0, 0]];
  for (const x of [-0.3, 0, 0.3]) for (const y of [-0.3, 0, 0.3]) for (const z of [-0.3, 0, 0.3]) {
    if (x || y || z) points.push([x, y, z]);
  }
  return points;
}

function loop(id, radius, center, normal) {
  return {
    id, name: id, radius, center, normal, current: 1, segments: 64, visible: true, role: "drive",
    schedule: { waveform: "dc", delay: 0, period: 1, duty: 1, phase: 0 },
  };
}

function bundle(bundleRadius, orientationDeg, inclinationDeg) {
  const orientation = orientationDeg * DEG;
  const inclination = inclinationDeg * DEG;
  const loops = [loop("main", 1, [0, 0, 0], [0, 1, 0])];
  for (let index = 0; index < 3; index += 1) {
    const angle = orientation + index * Math.PI * 2 / 3;
    const radius = 1 + bundleRadius * Math.cos(angle);
    const y = bundleRadius * Math.sin(angle);
    const normal = [Math.sin(inclination) * Math.cos(angle), Math.cos(inclination), Math.sin(inclination) * Math.sin(angle)];
    loops.push(loop(`satellite-${index + 1}`, radius, [0, y, 0], normal));
  }
  return loops;
}

async function influences(loops, points) {
  return Promise.all(loops.map((source) => engine.fields({ loops: [source] }, points, 0, { softening: 0.025 })));
}

function gainsFor(policy, fieldInfluences) {
  const reference = fieldInfluences[0][0][1];
  if (policy === "fixed_current") return [1, 1, 1, 1];
  const gains = [1];
  for (let index = 1; index < 4; index += 1) {
    const axial = fieldInfluences[index][0][1];
    if (axial <= reference * 0.01) return null;
    gains.push(reference / axial);
  }
  return gains;
}

function weightsFor(strategy, biasFraction, time, gains) {
  const weights = [0, 0, 0, 0];
  if (strategy === "all_four_one_at_a_time") {
    const active = Math.floor(mod(time, 1) * 4);
    weights[active] = gains[active];
    return weights;
  }

  weights[0] = biasFraction;
  const satelliteBudget = 1 - biasFraction;
  if (strategy === "satellites_dc") {
    for (let index = 1; index < 4; index += 1) weights[index] = satelliteBudget / 3 * gains[index];
  } else if (strategy === "satellite_one_at_a_time") {
    const active = 1 + Math.floor(mod(time, 1) * 3);
    weights[active] = satelliteBudget * gains[active];
  } else if (strategy === "satellite_triangle") {
    for (let index = 1; index < 4; index += 1) {
      const phase = (index - 1) / 3;
      const factor = 1 - Math.abs(2 * mod(time + phase, 1) - 1);
      weights[index] = 2 * satelliteBudget / 3 * factor * gains[index];
    }
  } else if (strategy === "satellite_cosine") {
    for (let index = 1; index < 4; index += 1) {
      const phase = (index - 1) / 3;
      const factor = 0.5 * (1 + Math.cos(Math.PI * 2 * (time + phase)));
      weights[index] = 2 * satelliteBudget / 3 * factor * gains[index];
    }
  } else {
    const on = mod(time, 1) < 1 / 3;
    for (let index = 1; index < 4; index += 1) weights[index] = on ? satelliteBudget * gains[index] : 0;
  }
  return weights;
}

function evaluate(config, fieldInfluences, gains) {
  const pointCount = fieldInfluences[0].length;
  const magnitudeSeries = Array.from({ length: pointCount }, () => []);
  const axialSeries = Array.from({ length: pointCount }, () => []);
  const centerFields = [];
  const spatialCvs = [];
  const absoluteCurrent = [];
  const currentSquared = [];

  for (const time of TIMES) {
    const weights = weightsFor(config.strategy, config.biasFraction, time, gains);
    absoluteCurrent.push(weights.reduce((sum, value) => sum + Math.abs(value), 0));
    currentSquared.push(weights.reduce((sum, value) => sum + value * value, 0));
    const magnitudesAtTime = [];
    for (let point = 0; point < pointCount; point += 1) {
      const field = [0, 0, 0];
      for (let source = 0; source < 4; source += 1) {
        field[0] += fieldInfluences[source][point][0] * weights[source];
        field[1] += fieldInfluences[source][point][1] * weights[source];
        field[2] += fieldInfluences[source][point][2] * weights[source];
      }
      const fieldMagnitude = magnitude(field);
      magnitudeSeries[point].push(fieldMagnitude);
      axialSeries[point].push(field[1]);
      magnitudesAtTime.push(fieldMagnitude);
      if (point === 0) centerFields.push(field);
    }
    spatialCvs.push(std(magnitudesAtTime) / Math.max(EPSILON, mean(magnitudesAtTime)));
  }

  const allAxial = axialSeries.flat();
  const meanAxial = mean(allAxial);
  const allMagnitudes = magnitudeSeries.flat();
  const magnitudeRipples = magnitudeSeries.map((values) => (Math.max(...values) - Math.min(...values)) / Math.max(EPSILON, mean(values)));
  const centerMagnitudes = magnitudeSeries[0];
  const centerAngles = centerFields.map(centerAngle);
  const transverseAzimuths = centerFields
    .filter((field) => Math.hypot(field[0], field[2]) > EPSILON)
    .map((field) => Math.atan2(field[2], field[0]));
  const bins = new Set(transverseAzimuths.map((angle) => Math.floor(mod(angle, Math.PI * 2) / (Math.PI * 2) * 12))).size;
  const azimuthResultant = transverseAzimuths.length
    ? Math.hypot(mean(transverseAzimuths.map(Math.cos)), mean(transverseAzimuths.map(Math.sin)))
    : 1;
  const dropoutFraction = allAxial.filter((value) => value < Math.max(EPSILON, meanAxial * 0.5)).length / allAxial.length;
  const reversalFraction = allAxial.filter((value) => value < 0).length / allAxial.length;
  const dynamicActivation = config.strategy !== "satellites_dc" && config.biasFraction < 1;
  const worstVolumeMagnitudeRipple = Math.max(...magnitudeRipples);
  const centerMagnitudeRipple = magnitudeRipples[0];
  const maxCenterAngleDeg = Math.max(...centerAngles);
  const staticMaintaining = dynamicActivation && dropoutFraction === 0 && reversalFraction === 0
    && worstVolumeMagnitudeRipple <= 0.1 && maxCenterAngleDeg <= 5;
  const rotatingComponentCandidate = dynamicActivation && centerMagnitudeRipple <= 0.05
    && bins >= 3 && maxCenterAngleDeg >= 3 && azimuthResultant <= 0.5;

  return {
    ...config,
    gains,
    metrics: {
      meanMagnitude: mean(allMagnitudes),
      meanAxialProjection: meanAxial,
      minimumAxialToMean: meanAxial > EPSILON ? Math.min(...allAxial) / meanAxial : null,
      centerMagnitudeRipple,
      worstVolumeMagnitudeRipple,
      meanCenterAngleDeg: mean(centerAngles),
      maxCenterAngleDeg,
      centerAngleStdDeg: std(centerAngles),
      meanSpatialMagnitudeCv: mean(spatialCvs),
      dropoutFraction,
      reversalFraction,
      occupiedAzimuthBins: bins,
      azimuthCircularResultant: azimuthResultant,
      meanAbsoluteCurrent: mean(absoluteCurrent),
      peakAbsoluteCurrent: Math.max(...absoluteCurrent),
      meanCurrentSquared: mean(currentSquared),
      peakCurrentSquared: Math.max(...currentSquared),
      dynamicActivation,
      staticMaintaining,
      rotatingComponentCandidate,
    },
  };
}

const points = probes();
const results = [];
const skipped = [];
const startedAt = new Date().toISOString();
const started = performance.now();
for (const bundleRadius of [0, 0.05, 0.1, 0.2, 0.3, 0.5]) {
  for (const triangleOrientationDeg of [0, 30]) {
    for (const satelliteInclinationDeg of [0, 5, 15, 30, 45]) {
      const loops = bundle(bundleRadius, triangleOrientationDeg, satelliteInclinationDeg);
      const fieldInfluences = await influences(loops, points);
      for (const currentPolicy of ["fixed_current", "equal_center_axial"]) {
        const gains = gainsFor(currentPolicy, fieldInfluences);
        if (!gains) {
          skipped.push({ bundleRadius, triangleOrientationDeg, satelliteInclinationDeg, currentPolicy });
          continue;
        }
        for (const biasFraction of [0, 0.25, 0.5, 0.75]) {
          for (const strategy of ["satellite_one_at_a_time", "satellite_triangle", "satellite_cosine", "satellites_dc", "satellites_synchronized"]) {
            results.push(evaluate({ bundleRadius, triangleOrientationDeg, satelliteInclinationDeg, currentPolicy, biasFraction, strategy }, fieldInfluences, gains));
          }
        }
        results.push(evaluate({ bundleRadius, triangleOrientationDeg, satelliteInclinationDeg, currentPolicy, biasFraction: 0, strategy: "all_four_one_at_a_time" }, fieldInfluences, gains));
      }
    }
  }
}

const dynamic = results.filter((result) => result.metrics.dynamicActivation && result.strategy !== "satellites_synchronized");
const staticQualifiers = dynamic.filter((result) => result.metrics.staticMaintaining)
  .sort((a, b) => a.metrics.worstVolumeMagnitudeRipple - b.metrics.worstVolumeMagnitudeRipple || a.metrics.meanCurrentSquared - b.metrics.meanCurrentSquared);
const rotatingCandidates = dynamic.filter((result) => result.metrics.rotatingComponentCandidate)
  .sort((a, b) => a.metrics.centerMagnitudeRipple - b.metrics.centerMagnitudeRipple);
const find = (query) => results.find((result) => Object.entries(query).every(([key, value]) => result[key] === value));
const evidenceSlices = {
  thinParallelNoBias: find({ bundleRadius: 0.1, triangleOrientationDeg: 0, satelliteInclinationDeg: 0, currentPolicy: "equal_center_axial", biasFraction: 0, strategy: "satellite_one_at_a_time" }),
  thickParallelNoBias: find({ bundleRadius: 0.5, triangleOrientationDeg: 0, satelliteInclinationDeg: 0, currentPolicy: "equal_center_axial", biasFraction: 0, strategy: "satellite_one_at_a_time" }),
  mediumInclinedHalfBias: find({ bundleRadius: 0.2, triangleOrientationDeg: 0, satelliteInclinationDeg: 15, currentPolicy: "equal_center_axial", biasFraction: 0.5, strategy: "satellite_one_at_a_time" }),
  mediumInclinedTriangle: find({ bundleRadius: 0.2, triangleOrientationDeg: 0, satelliteInclinationDeg: 15, currentPolicy: "equal_center_axial", biasFraction: 0.25, strategy: "satellite_triangle" }),
  mediumInclinedCosine: find({ bundleRadius: 0.2, triangleOrientationDeg: 0, satelliteInclinationDeg: 15, currentPolicy: "equal_center_axial", biasFraction: 0.25, strategy: "satellite_cosine" }),
  allFourHandoff: find({ bundleRadius: 0.2, triangleOrientationDeg: 0, satelliteInclinationDeg: 15, currentPolicy: "equal_center_axial", biasFraction: 0, strategy: "all_four_one_at_a_time" }),
};

const artifact = {
  metadata: {
    question: "How does a main loop with three triangularly arrayed satellite loops behave under staggered activation?",
    evidenceGrade: "candidate numerical sweep; normalized prescribed-current vacuum filament model",
    engine: engine.kind,
    startedAt,
    completedAt: new Date().toISOString(),
    elapsedMs: performance.now() - started,
    timeSteps: STEPS,
    probes: points.length,
    resultCount: results.length,
    skippedPolicyCases: skipped.length,
  },
  geometryDefinition: "main R=1 at y=0; satellites use (delta R, delta y)=rho(cos psi, sin psi), psi=orientation+i*120deg",
  summary: {
    dynamicCaseCount: dynamic.length,
    staticQualifierCount: staticQualifiers.length,
    rotatingComponentCandidateCount: rotatingCandidates.length,
    topStatic: staticQualifiers.slice(0, 20),
    topRotatingComponent: rotatingCandidates.slice(0, 20),
    evidenceSlices,
  },
  skipped,
  results,
};
await writeFile(resolve(here, "results.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify(artifact.metadata, null, 2));
console.log(JSON.stringify({ dynamicCaseCount: dynamic.length, staticQualifierCount: staticQualifiers.length, rotatingComponentCandidateCount: rotatingCandidates.length }, null, 2));
