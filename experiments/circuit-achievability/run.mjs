import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEngine } from "../../src/engine.mjs";
import { discretizeLoop } from "../../src/sim.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../..");
const engine = await loadEngine(projectRoot);
const MU0 = 4 * Math.PI * 1e-7;
const COPPER_RESISTIVITY = 1.68e-8;
const COPPER_DENSITY = 8960;
const COPPER_HEAT_CAPACITY = 385;
const COPPER_ALPHA = 0.00393;
const AMBIENT = 20;
const MAX_TEMPERATURE = 80;
const COOLING_TIME_CONSTANT = 120;
const ENERGY_BUDGET = 50e6;
const CURRENT_UNIT = 100_000;
const DEG = Math.PI / 180;
const EPSILON = 1e-15;
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const clamp = (value, lower, upper) => Math.min(upper, Math.max(lower, value));

function makeLoop(id, radius, center, normal) {
  return {
    id, name: id, radius, center, normal, current: 1, segments: 96, visible: true, role: "drive",
    schedule: { waveform: "dc", delay: 0, period: 1, duty: 1, phase: 0 },
  };
}

function makeBundle(bundleRadius, inclinationDeg, orientationDeg = 0, satelliteCount = 6) {
  const inclination = inclinationDeg * DEG;
  const orientation = orientationDeg * DEG;
  const loops = [makeLoop("main", 1, [0, 0, 0], [0, 1, 0])];
  for (let index = 0; index < satelliteCount; index += 1) {
    const angle = orientation + index * Math.PI * 2 / satelliteCount;
    loops.push(makeLoop(
      `satellite-${index + 1}`,
      1 + bundleRadius * Math.cos(angle),
      [0, bundleRadius * Math.sin(angle), 0],
      [Math.sin(inclination) * Math.cos(angle), Math.cos(inclination), Math.sin(inclination) * Math.sin(angle)],
    ));
  }
  return loops;
}

function makeNestedSystem(radiusSpacing, inclinationDeg, orientationDeg = 0) {
  const inclination = inclinationDeg * DEG;
  const orientation = orientationDeg * DEG;
  const radialLevels = [-3, -2, -1, 1, 2, 3];
  const loops = [makeLoop("main", 1, [0, 0, 0], [0, 1, 0])];
  for (let index = 0; index < radialLevels.length; index += 1) {
    const angle = orientation + index * Math.PI * 2 / radialLevels.length;
    loops.push(makeLoop(
      `correction-${index + 1}`,
      1 + radiusSpacing * radialLevels[index],
      [0, 0, 0],
      [Math.sin(inclination) * Math.cos(angle), Math.cos(inclination), Math.sin(inclination) * Math.sin(angle)],
    ));
  }
  return loops;
}

function subtract(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function addScaled(a, b, scale) { return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale]; }
function segmentDistance(p1, q1, p2, q2) {
  const d1 = subtract(q1, p1);
  const d2 = subtract(q2, p2);
  const r = subtract(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s;
  let t;
  if (a <= EPSILON && e <= EPSILON) return Math.hypot(...r);
  if (a <= EPSILON) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = dot(d1, r);
    if (e <= EPSILON) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = dot(d1, d2);
      const denominator = a * e - b * b;
      s = denominator !== 0 ? clamp((b * f - c * e) / denominator, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  const closest = subtract(addScaled(p1, d1, s), addScaled(p2, d2, t));
  return Math.hypot(...closest);
}

function minimumClearance(loops) {
  const points = loops.map((loop) => discretizeLoop(loop, 192));
  let minimum = Infinity;
  let limitingPair = null;
  for (let first = 0; first < loops.length; first += 1) {
    for (let second = first + 1; second < loops.length; second += 1) {
      const a = points[first];
      const b = points[second];
      for (let i = 0; i < a.length; i += 1) {
        for (let j = 0; j < b.length; j += 1) {
          const distance = segmentDistance(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length]);
          if (distance < minimum) {
            minimum = distance;
            limitingPair = [loops[first].id, loops[second].id];
          }
        }
      }
    }
  }
  return { minimum, limitingPair };
}

function lineElements(loop, segments = 96) {
  const points = discretizeLoop(loop, segments);
  return points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return { midpoint: [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2, (point[2] + next[2]) / 2], dl: subtract(next, point) };
  });
}

function inductanceMatrix(loops, wireRadius) {
  const elements = loops.map((loop) => lineElements(loop));
  const matrix = loops.map(() => new Array(loops.length).fill(0));
  for (let i = 0; i < loops.length; i += 1) {
    matrix[i][i] = MU0 * loops[i].radius * (Math.log(8 * loops[i].radius / wireRadius) - 2);
    for (let j = i + 1; j < loops.length; j += 1) {
      let integral = 0;
      for (const first of elements[i]) for (const second of elements[j]) {
        const displacement = subtract(first.midpoint, second.midpoint);
        integral += dot(first.dl, second.dl) / Math.sqrt(dot(displacement, displacement) + wireRadius * wireRadius);
      }
      const mutual = MU0 / (4 * Math.PI) * integral;
      matrix[i][j] = mutual;
      matrix[j][i] = mutual;
    }
  }
  const original = matrix.map((row) => [...row]);
  const maxDiagonal = Math.max(...matrix.map((row, index) => row[index]));
  let regularization = 0;
  while (!isPositiveDefinite(matrix) && regularization < maxDiagonal) {
    const increment = regularization === 0 ? maxDiagonal * 1e-8 : regularization * 10 - regularization;
    regularization += increment;
    for (let index = 0; index < matrix.length; index += 1) matrix[index][index] = original[index][index] + regularization;
  }
  const couplingRatio = Math.max(...matrix.map((row, i) => row.reduce((sum, value, j) => sum + (i === j ? 0 : Math.abs(value)), 0) / row[i]));
  return { matrix, regularization, couplingRatio, selfInductances: original.map((row, index) => row[index]) };
}

function isPositiveDefinite(matrix) {
  const lower = matrix.map(() => new Array(matrix.length).fill(0));
  for (let i = 0; i < matrix.length; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = matrix[i][j];
      for (let k = 0; k < j; k += 1) sum -= lower[i][k] * lower[j][k];
      if (i === j) {
        if (sum <= 0 || !Number.isFinite(sum)) return false;
        lower[i][j] = Math.sqrt(sum);
      } else lower[i][j] = sum / lower[j][j];
    }
  }
  return true;
}

function solve(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[best][pivot])) best = row;
    [augmented[pivot], augmented[best]] = [augmented[best], augmented[pivot]];
    const divisor = augmented[pivot][pivot];
    if (Math.abs(divisor) < EPSILON) throw new Error("SINGULAR_CIRCUIT_MATRIX");
    for (let column = pivot; column <= size; column += 1) augmented[pivot][column] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let column = pivot; column <= size; column += 1) augmented[row][column] -= factor * augmented[pivot][column];
    }
  }
  return augmented.map((row) => row[size]);
}

function matrixVector(matrix, vector) { return matrix.map((row) => dot(row, vector)); }
function diagonalMatrix(values) { return values.map((value, i) => values.map((_, j) => i === j ? value : 0)); }
function addMatrices(a, b) { return a.map((row, i) => row.map((value, j) => value + b[i][j])); }
function scaleMatrix(matrix, scale) { return matrix.map((row) => row.map((value) => value * scale)); }

function referenceCurrents(time, period, count) {
  const currents = [0.20 * CURRENT_UNIT];
  const derivatives = [0];
  const omega = Math.PI * 2 / period;
  for (let index = 0; index < count - 1; index += 1) {
    const phase = index * Math.PI * 2 / (count - 1);
    currents.push(0.18 * (1 + 0.25 * Math.cos(omega * time + phase)) * CURRENT_UNIT);
    derivatives.push(-0.18 * 0.25 * omega * Math.sin(omega * time + phase) * CURRENT_UNIT);
  }
  return { currents, derivatives };
}

async function fieldGram(loops) {
  const points = [[0, 0, 0]];
  for (const x of [-0.3, 0, 0.3]) for (const y of [-0.3, 0, 0.3]) for (const z of [-0.3, 0, 0.3]) if (x || y || z) points.push([x, y, z]);
  const fields = await Promise.all(loops.map((loop) => engine.fields({ loops: [loop] }, points, 0, { softening: 0.025 })));
  const rows = [];
  for (let point = 0; point < points.length; point += 1) for (let component = 0; component < 3; component += 1) rows.push(fields.map((source) => source[point][component]));
  return loops.map((_, i) => loops.map((__, j) => rows.reduce((sum, row) => sum + row[i] * row[j], 0) / rows.length));
}

function thermalRuntime(power, heatCapacity) {
  if (power <= 0) return Infinity;
  const steadyRise = power * COOLING_TIME_CONSTANT / heatCapacity;
  const allowedRise = MAX_TEMPERATURE - AMBIENT;
  if (steadyRise <= allowedRise) return Infinity;
  return -COOLING_TIME_CONSTANT * Math.log(1 - allowedRise / steadyRise);
}

function simulate({ loops, inductance, fieldInfluenceGram, wireRadius, period, voltageLimit, controlMode, clearance }) {
  const count = loops.length;
  const area = Math.PI * wireRadius * wireRadius;
  const lengths = loops.map((loop) => 2 * Math.PI * loop.radius);
  const resistance20 = lengths.map((length) => COPPER_RESISTIVITY * length / area);
  const masses = lengths.map((length) => COPPER_DENSITY * area * length);
  const heatCapacities = masses.map((mass) => mass * COPPER_HEAT_CAPACITY);
  const stepsPerPeriod = 240;
  const periods = 6;
  const dt = period / stepsPerPeriod;
  const totalSteps = stepsPerPeriod * periods;
  const initial = referenceCurrents(0, period, count);
  let currents = [...initial.currents];
  const temperatures = new Array(count).fill(AMBIENT);
  const currentErrors = [];
  const fieldErrors = [];
  const copperLosses = [];
  const supplyPowers = [];
  const coilPowerSums = new Array(count).fill(0);
  let voltageSaturationCount = 0;
  let maxVoltage = 0;
  let maxCurrentDensity = 0;
  const trackingTimeConstant = period / 12;

  for (let step = 0; step < totalSteps; step += 1) {
    const time = step * dt;
    const reference = referenceCurrents(time, period, count);
    const resistances = resistance20.map((value, index) => value * (1 + COPPER_ALPHA * (temperatures[index] - 20)));
    const desiredRate = reference.derivatives.map((value, index) => value + (reference.currents[index] - currents[index]) / trackingTimeConstant);
    const inductiveVoltage = controlMode === "coupling_aware"
      ? matrixVector(inductance.matrix, desiredRate)
      : desiredRate.map((value, index) => inductance.matrix[index][index] * value);
    const commanded = inductiveVoltage.map((value, index) => value + resistances[index] * reference.currents[index]);
    const voltages = commanded.map((value) => {
      if (Math.abs(value) > voltageLimit) voltageSaturationCount += 1;
      const limited = clamp(value, -voltageLimit, voltageLimit);
      maxVoltage = Math.max(maxVoltage, Math.abs(limited));
      return limited;
    });
    const implicitMatrix = addMatrices(scaleMatrix(inductance.matrix, 1 / dt), diagonalMatrix(resistances));
    const right = matrixVector(scaleMatrix(inductance.matrix, 1 / dt), currents).map((value, index) => value + voltages[index]);
    currents = solve(implicitMatrix, right);

    const deltaNormalized = currents.map((value, index) => (value - reference.currents[index]) / CURRENT_UNIT);
    const referenceNormalized = reference.currents.map((value) => value / CURRENT_UNIT);
    currentErrors.push(Math.sqrt(dot(deltaNormalized, deltaNormalized) / Math.max(EPSILON, dot(referenceNormalized, referenceNormalized))));
    const fieldErrorSquared = dot(deltaNormalized, matrixVector(fieldInfluenceGram, deltaNormalized));
    const fieldReferenceSquared = dot(referenceNormalized, matrixVector(fieldInfluenceGram, referenceNormalized));
    fieldErrors.push(Math.sqrt(Math.max(0, fieldErrorSquared) / Math.max(EPSILON, fieldReferenceSquared)));
    let totalCopperLoss = 0;
    let positiveSupplyPower = 0;
    for (let index = 0; index < count; index += 1) {
      const loss = resistances[index] * currents[index] * currents[index];
      totalCopperLoss += loss;
      coilPowerSums[index] += loss;
      positiveSupplyPower += Math.max(0, voltages[index] * currents[index]);
      const cooling = heatCapacities[index] / COOLING_TIME_CONSTANT * (temperatures[index] - AMBIENT);
      temperatures[index] += (loss - cooling) / heatCapacities[index] * dt;
      maxCurrentDensity = Math.max(maxCurrentDensity, Math.abs(currents[index]) / area);
    }
    copperLosses.push(totalCopperLoss);
    supplyPowers.push(positiveSupplyPower);
  }

  const averageCoilPowers = coilPowerSums.map((sum) => sum / totalSteps);
  const thermalRuntimes = averageCoilPowers.map((power, index) => thermalRuntime(power, heatCapacities[index]));
  const energyRuntime = ENERGY_BUDGET / Math.max(EPSILON, mean(supplyPowers));
  const thermalLimitRuntime = Math.min(...thermalRuntimes);
  const estimatedRuntime = Math.min(energyRuntime, thermalLimitRuntime);
  const clearanceValid = clearance.minimum >= wireRadius * 2.4;
  const regularizationRatio = inductance.regularization / Math.max(...inductance.selfInductances);
  const metrics = {
    clearance: clearance.minimum,
    limitingPair: clearance.limitingPair,
    clearanceValid,
    currentTrackingRms: Math.sqrt(mean(currentErrors.map((value) => value * value))),
    worstCurrentTracking: Math.max(...currentErrors),
    fieldTrackingRms: Math.sqrt(mean(fieldErrors.map((value) => value * value))),
    worstFieldTracking: Math.max(...fieldErrors),
    voltageSaturationFraction: voltageSaturationCount / (totalSteps * count),
    maxVoltage,
    maxCurrentDensity,
    meanCopperLoss: mean(copperLosses),
    meanPositiveSupplyPower: mean(supplyPowers),
    energyRuntime,
    thermalLimitRuntime,
    estimatedRuntime,
    maximumSimulatedTemperature: Math.max(...temperatures),
    couplingRatio: inductance.couplingRatio,
    inductanceRegularization: inductance.regularization,
    regularizationRatio,
  };
  metrics.candidate = clearanceValid
    && metrics.currentTrackingRms <= 0.05
    && metrics.fieldTrackingRms <= 0.05
    && metrics.voltageSaturationFraction <= 0.01
    && metrics.maxCurrentDensity <= 100e6
    && metrics.estimatedRuntime >= 30
    && regularizationRatio <= 1e-6;
  return metrics;
}

const geometries = [
  { name: "field_optimal_inclined", kind: "bundle", bundleRadius: 0.05, inclinationDeg: 30, orientationDeg: 0 },
  { name: "clearer_inclined", kind: "bundle", bundleRadius: 0.30, inclinationDeg: 30, orientationDeg: 0 },
  { name: "parallel_pipe_control", kind: "bundle", bundleRadius: 0.05, inclinationDeg: 0, orientationDeg: 0 },
  { name: "nested_inclined_candidate", kind: "nested", radiusSpacing: 0.06, inclinationDeg: 45, orientationDeg: 0 },
];
const startedAt = new Date().toISOString();
const started = performance.now();
const results = [];
const geometryReports = [];
for (const geometry of geometries) {
  const loops = geometry.kind === "nested"
    ? makeNestedSystem(geometry.radiusSpacing, geometry.inclinationDeg, geometry.orientationDeg)
    : makeBundle(geometry.bundleRadius, geometry.inclinationDeg, geometry.orientationDeg);
  const clearance = minimumClearance(loops);
  const fieldInfluenceGram = await fieldGram(loops);
  geometryReports.push({ ...geometry, clearance });
  for (const wireRadius of [0.001, 0.002, 0.005, 0.01, 0.015, 0.017, 0.02]) {
    const inductance = inductanceMatrix(loops, wireRadius);
    for (const period of [0.02, 0.1, 0.5, 2]) {
      for (const voltageLimit of [10, 50, 200, 1000]) {
        for (const controlMode of ["coupling_aware", "naive_independent"]) {
          results.push({
            geometry: geometry.name,
            bundleRadius: geometry.bundleRadius,
            inclinationDeg: geometry.inclinationDeg,
            wireRadius,
            period,
            voltageLimit,
            controlMode,
            metrics: simulate({ loops, inductance, fieldInfluenceGram, wireRadius, period, voltageLimit, controlMode, clearance }),
          });
        }
      }
    }
  }
}

const candidates = results.filter((result) => result.metrics.candidate);
const valid = results.filter((result) => result.metrics.clearanceValid);
const topRuntime = [...candidates].sort((a, b) => b.metrics.estimatedRuntime - a.metrics.estimatedRuntime).slice(0, 20);
const topTracking = [...valid].sort((a, b) => a.metrics.fieldTrackingRms - b.metrics.fieldTrackingRms).slice(0, 20);
const artifact = {
  metadata: {
    question: "Are the adaptive satellite currents achievable with coupled L/R circuits, finite voltage, heat, clearance, and energy limits?",
    evidenceGrade: "smoke circuit-achievability sweep; lumped copper and inductance proxies",
    engine: engine.kind,
    startedAt,
    completedAt: new Date().toISOString(),
    elapsedMs: performance.now() - started,
    geometryCount: geometries.length,
    resultCount: results.length,
  },
  assumptions: {
    mainRadiusMeters: 1,
    currentUnitAmps: CURRENT_UNIT,
    energyBudgetJoules: ENERGY_BUDGET,
    ambientCelsius: AMBIENT,
    maximumCelsius: MAX_TEMPERATURE,
    coolingTimeConstantSeconds: COOLING_TIME_CONSTANT,
  },
  summary: {
    candidateCount: candidates.length,
    clearanceValidCount: valid.length,
    geometryReports,
    topRuntime,
    topTracking,
  },
  results,
};
await writeFile(resolve(here, "results.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify(artifact.metadata, null, 2));
console.log(JSON.stringify({ candidateCount: candidates.length, clearanceValidCount: valid.length, geometryReports }, null, 2));
