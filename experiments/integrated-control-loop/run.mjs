import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEngine } from "../../src/engine.mjs";
import { discretizeLoop } from "../../src/sim.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../..");
const engine = await loadEngine(projectRoot);
const MU0 = 4 * Math.PI * 1e-7;
const CURRENT_UNIT = 100_000;
const TARGET_AXIAL = 0.4;
const WIRE_RADIUS = 0.02;
const COPPER_RESISTIVITY = 1.68e-8;
const COPPER_DENSITY = 8960;
const COPPER_HEAT_CAPACITY = 385;
const COPPER_ALPHA = 0.00393;
const AMBIENT = 20;
const DERATE_TEMPERATURE = 60;
const MAX_TEMPERATURE = 80;
const COOLING_TIME_CONSTANT = 120;
const ENERGY_BUDGET = 50e6;
const DEG = Math.PI / 180;
const EPSILON = 1e-14;
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const clamp = (value, lower, upper) => Math.min(upper, Math.max(lower, value));
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const magnitude = (vector) => Math.hypot(...vector);

function makeLoop(id, radius, normal) {
  return {
    id, name: id, center: [0, 0, 0], radius, normal, current: 1, segments: 96, visible: true, role: "drive",
    schedule: { waveform: "dc", delay: 0, period: 1, duty: 1, phase: 0 },
  };
}

function makeSystem() {
  const inclination = 45 * DEG;
  const radii = [0.82, 0.88, 0.94, 1.06, 1.12, 1.18];
  const loops = [makeLoop("main", 1, [0, 1, 0])];
  for (let index = 0; index < radii.length; index += 1) {
    const angle = index * Math.PI * 2 / radii.length;
    loops.push(makeLoop(`correction-${index + 1}`, radii[index], [
      Math.sin(inclination) * Math.cos(angle),
      Math.cos(inclination),
      Math.sin(inclination) * Math.sin(angle),
    ]));
  }
  return loops;
}

function probes() {
  const points = [[0, 0, 0]];
  for (const x of [-0.3, 0, 0.3]) for (const y of [-0.3, 0, 0.3]) for (const z of [-0.3, 0, 0.3]) if (x || y || z) points.push([x, y, z]);
  return points;
}

async function fieldModel(loops, points) {
  const byCoil = await Promise.all(loops.map((loop) => engine.fields({ loops: [loop] }, points, 0, { softening: 0.025 })));
  const rows = [];
  for (let point = 0; point < points.length; point += 1) for (let component = 0; component < 3; component += 1) rows.push(byCoil.map((source) => source[point][component]));
  const normalization = rows.length * TARGET_AXIAL * TARGET_AXIAL;
  const gram = loops.map((_, i) => loops.map((__, j) => rows.reduce((sum, row) => sum + row[i] * row[j], 0) / normalization));
  return { rows, gram };
}

function targetRows(target, pointCount) { return Array.from({ length: pointCount }, () => target).flat(); }
function linearTerm(rows, target) {
  const normalization = rows.length * TARGET_AXIAL * TARGET_AXIAL;
  return Array.from({ length: rows[0].length }, (_, coil) => rows.reduce((sum, row, index) => sum + row[coil] * target[index], 0) / normalization);
}
function matrixVector(matrix, vector) { return matrix.map((row) => dot(row, vector)); }
function diagonalMatrix(values) { return values.map((value, i) => values.map((_, j) => i === j ? value : 0)); }
function addMatrices(a, b) { return a.map((row, i) => row.map((value, j) => value + b[i][j])); }
function scaleMatrix(matrix, scale) { return matrix.map((row) => row.map((value) => value * scale)); }

function allocate({ gram, rows, desiredRows, measuredRows, previous, capacities, resistanceWeights, lambdaEnergy, dt, initial = false }) {
  const feedbackGain = 0.5;
  const correctedTarget = desiredRows.map((value, index) => value + feedbackGain * (value - measuredRows[index]));
  const linear = linearTerm(rows, correctedTarget);
  const lambdaSlew = 0.01;
  const hessian = gram.map((row, i) => row.map((value, j) => value + (i === j ? lambdaEnergy * resistanceWeights[i] + lambdaSlew : 0)));
  const objectiveLinear = linear.map((value, index) => value + lambdaSlew * previous[index]);
  const maxDelta = 10 * dt;
  const upper = capacities.map((capacity, index) => Math.min(capacity, initial ? capacity : previous[index] + maxDelta));
  const lower = capacities.map((_, index) => Math.min(upper[index], Math.max(0, initial ? 0 : previous[index] - maxDelta)));
  let currents = previous.map((value, index) => clamp(value, lower[index], upper[index]));
  const lipschitz = Math.max(...hessian.map((row) => row.reduce((sum, value) => sum + Math.abs(value), 0)), EPSILON);
  const step = 0.9 / lipschitz;
  for (let iteration = 0; iteration < 30; iteration += 1) {
    const product = matrixVector(hessian, currents);
    currents = currents.map((value, index) => clamp(value - step * (product[index] - objectiveLinear[index]), lower[index], upper[index]));
  }
  return currents;
}

function lineElements(loop, segments = 96) {
  const points = discretizeLoop(loop, segments);
  return points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return {
      midpoint: [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2, (point[2] + next[2]) / 2],
      dl: [next[0] - point[0], next[1] - point[1], next[2] - point[2]],
    };
  });
}

function inductanceMatrix(loops) {
  const elements = loops.map((loop) => lineElements(loop));
  const matrix = loops.map(() => new Array(loops.length).fill(0));
  for (let i = 0; i < loops.length; i += 1) {
    matrix[i][i] = MU0 * loops[i].radius * (Math.log(8 * loops[i].radius / WIRE_RADIUS) - 2);
    for (let j = i + 1; j < loops.length; j += 1) {
      let integral = 0;
      for (const first of elements[i]) for (const second of elements[j]) {
        const displacement = first.midpoint.map((value, index) => value - second.midpoint[index]);
        integral += dot(first.dl, second.dl) / Math.sqrt(dot(displacement, displacement) + WIRE_RADIUS * WIRE_RADIUS);
      }
      matrix[i][j] = MU0 / (4 * Math.PI) * integral;
      matrix[j][i] = matrix[i][j];
    }
  }
  return matrix;
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

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}
function gaussian(random) {
  const first = Math.max(EPSILON, random());
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * random());
}

function targetFor(scenario, time) {
  if (scenario === "amplitude_tracking") return [0, TARGET_AXIAL * (0.75 + 0.25 * Math.sin(Math.PI * 4 * time)), 0];
  if (scenario === "rotating_correction") {
    const transverse = TARGET_AXIAL * 0.12;
    return [transverse * Math.cos(Math.PI * 4 * time), TARGET_AXIAL, transverse * Math.sin(Math.PI * 4 * time)];
  }
  return [0, TARGET_AXIAL, 0];
}

function baseCapacities(scenario, time, temperatures) {
  const capacities = temperatures.map((temperature) => temperature <= DERATE_TEMPERATURE ? 1 : clamp((MAX_TEMPERATURE - temperature) / (MAX_TEMPERATURE - DERATE_TEMPERATURE), 0, 1));
  if (scenario === "main_derating") {
    if (time >= 0.5 && time < 1.2) capacities[0] *= 1 - 0.8 * (time - 0.5) / 0.7;
    else if (time >= 1.2) capacities[0] *= 0.2;
  }
  if (scenario === "correction_failure" && time >= 1) capacities[1] = 0;
  return capacities;
}

function actualField(rows, currentsAmps) {
  const normalized = currentsAmps.map((value) => value / CURRENT_UNIT);
  return rows.map((row) => dot(row, normalized));
}

function scenarioDuration(scenario) { return scenario === "steady" ? 1 : 2; }

function simulate({ scenario, config, loops, rows, gram, inductance, resistance20, resistanceWeights, heatCapacities, seed, endurance = false }) {
  const dt = config.dt;
  const duration = endurance ? 300 : scenarioDuration(scenario);
  const totalSteps = Math.ceil(duration / dt);
  const random = randomGenerator(seed);
  const initialTarget = targetRows(targetFor(scenario, 0), rows.length / 3);
  let reference = allocate({
    gram, rows, desiredRows: initialTarget, measuredRows: initialTarget,
    previous: new Array(loops.length).fill(0), capacities: new Array(loops.length).fill(1), resistanceWeights,
    lambdaEnergy: config.lambdaEnergy, dt, initial: true,
  });
  let currents = reference.map((value) => value * CURRENT_UNIT);
  const temperatures = new Array(loops.length).fill(AMBIENT);
  const measurementQueue = [actualField(rows, currents)];
  const delaySteps = Math.round(config.sensorDelay / dt);
  const rmsErrors = [];
  const worstPointErrors = [];
  const centerAngles = [];
  let dropoutCount = 0;
  let reversalCount = 0;
  let saturationCount = 0;
  let peakCurrentDensity = 0;
  let energyUsed = 0;
  let highErrorDuration = 0;
  let stopReason = "duration";
  let usefulRuntime = duration;

  for (let step = 0; step < totalSteps; step += 1) {
    const time = step * dt;
    const target = targetFor(scenario, time);
    const desiredRows = targetRows(target, rows.length / 3);
    const exactMeasurement = actualField(rows, currents);
    measurementQueue.push(exactMeasurement);
    if (measurementQueue.length > delaySteps + 2) measurementQueue.shift();
    const delayed = measurementQueue[Math.max(0, measurementQueue.length - 1 - delaySteps)];
    const measured = delayed.map((value) => value + gaussian(random) * config.sensorNoise * TARGET_AXIAL);
    const capacities = baseCapacities(scenario, time, temperatures);
    reference = allocate({ gram, rows, desiredRows, measuredRows: measured, previous: reference, capacities, resistanceWeights, lambdaEnergy: config.lambdaEnergy, dt });

    const failed = scenario === "correction_failure" && time >= 1 ? 1 : -1;
    const resistances = resistance20.map((value, index) => value * (1 + COPPER_ALPHA * (temperatures[index] - 20)) + (index === failed ? 0.05 : 0));
    const desiredRate = reference.map((value, index) => (value * CURRENT_UNIT - currents[index]) / config.currentTimeConstant);
    const voltagesUnclipped = matrixVector(inductance, desiredRate).map((value, index) => value + resistances[index] * currents[index]);
    const voltages = voltagesUnclipped.map((value, index) => {
      if (index === failed) return 0;
      if (Math.abs(value) > config.voltageLimit) saturationCount += 1;
      return clamp(value, -config.voltageLimit, config.voltageLimit);
    });
    const implicit = addMatrices(scaleMatrix(inductance, 1 / dt), diagonalMatrix(resistances));
    const right = matrixVector(scaleMatrix(inductance, 1 / dt), currents).map((value, index) => value + voltages[index]);
    currents = solve(implicit, right);

    let positiveSupplyPower = 0;
    for (let index = 0; index < loops.length; index += 1) {
      const copperResistance = resistance20[index] * (1 + COPPER_ALPHA * (temperatures[index] - 20));
      const loss = copperResistance * currents[index] * currents[index];
      const cooling = heatCapacities[index] / COOLING_TIME_CONSTANT * (temperatures[index] - AMBIENT);
      temperatures[index] += (loss - cooling) / heatCapacities[index] * dt;
      positiveSupplyPower += Math.max(0, voltages[index] * currents[index]);
      peakCurrentDensity = Math.max(peakCurrentDensity, Math.abs(currents[index]) / (Math.PI * WIRE_RADIUS * WIRE_RADIUS));
    }
    energyUsed += positiveSupplyPower * dt;

    const achieved = actualField(rows, currents);
    const targetMagnitude = Math.max(EPSILON, magnitude(target));
    let sumSquared = 0;
    let worstPoint = 0;
    for (let point = 0; point < achieved.length / 3; point += 1) {
      const offset = point * 3;
      const error = Math.hypot(
        achieved[offset] - desiredRows[offset],
        achieved[offset + 1] - desiredRows[offset + 1],
        achieved[offset + 2] - desiredRows[offset + 2],
      ) / targetMagnitude;
      sumSquared += error * error;
      worstPoint = Math.max(worstPoint, error);
      if (achieved[offset + 1] < target[1] * 0.5) dropoutCount += 1;
      if (achieved[offset + 1] < 0) reversalCount += 1;
    }
    const rmsError = Math.sqrt(sumSquared / (achieved.length / 3));
    rmsErrors.push(rmsError);
    worstPointErrors.push(worstPoint);
    const center = achieved.slice(0, 3);
    centerAngles.push(magnitude(center) < EPSILON ? 180 : Math.acos(clamp(dot(center, target) / (magnitude(center) * targetMagnitude), -1, 1)) / DEG);

    if (endurance) {
      highErrorDuration = rmsError > 0.1 ? highErrorDuration + dt : 0;
      if (highErrorDuration >= 0.5) { stopReason = "field_error"; usefulRuntime = time; break; }
      if (energyUsed >= ENERGY_BUDGET) { stopReason = "energy"; usefulRuntime = time; break; }
      if (Math.max(...temperatures) >= MAX_TEMPERATURE) { stopReason = "temperature"; usefulRuntime = time; break; }
    }
  }

  const pointTimeCount = rmsErrors.length * rows.length / 3;
  return {
    meanRmsError: mean(rmsErrors),
    worstRmsError: Math.max(...rmsErrors),
    worstPointError: Math.max(...worstPointErrors),
    worstCenterAngleDeg: Math.max(...centerAngles),
    dropoutFraction: dropoutCount / pointTimeCount,
    reversalFraction: reversalCount / pointTimeCount,
    voltageSaturationFraction: saturationCount / (rmsErrors.length * loops.length),
    peakCurrentDensity,
    maximumTemperature: Math.max(...temperatures),
    energyUsed,
    usefulRuntime,
    stopReason,
    finalCurrents: currents.map((value) => value / CURRENT_UNIT),
    finalTemperatures: temperatures,
  };
}

const loops = makeSystem();
const points = probes();
const { rows, gram } = await fieldModel(loops, points);
const inductance = inductanceMatrix(loops);
const area = Math.PI * WIRE_RADIUS * WIRE_RADIUS;
const lengths = loops.map((loop) => 2 * Math.PI * loop.radius);
const resistance20 = lengths.map((length) => COPPER_RESISTIVITY * length / area);
const resistanceWeights = resistance20.map((value) => value / Math.min(...resistance20));
const heatCapacities = lengths.map((length) => COPPER_DENSITY * area * length * COPPER_HEAT_CAPACITY);
const scenarios = ["steady", "amplitude_tracking", "main_derating", "correction_failure", "rotating_correction"];
const startedAt = new Date().toISOString();
const started = performance.now();
const results = [];
let configIndex = 0;
for (const dt of [0.005, 0.02]) for (const voltageLimit of [10, 50]) for (const sensorDelay of [0, 0.02]) for (const sensorNoise of [0, 0.01]) for (const lambdaEnergy of [0.001, 0.01]) for (const currentTimeConstant of [0.01, 0.05]) {
  const config = { dt, voltageLimit, sensorDelay, sensorNoise, lambdaEnergy, currentTimeConstant };
  const scenarioResults = {};
  for (let scenarioIndex = 0; scenarioIndex < scenarios.length; scenarioIndex += 1) {
    const scenario = scenarios[scenarioIndex];
    scenarioResults[scenario] = simulate({ scenario, config, loops, rows, gram, inductance, resistance20, resistanceWeights, heatCapacities, seed: 1000 + configIndex * 10 + scenarioIndex });
  }
  const values = Object.values(scenarioResults);
  const aggregate = {
    meanRmsError: mean(values.map((value) => value.meanRmsError)),
    worstRmsError: Math.max(...values.map((value) => value.worstRmsError)),
    worstPointError: Math.max(...values.map((value) => value.worstPointError)),
    dropoutFraction: Math.max(...values.map((value) => value.dropoutFraction)),
    reversalFraction: Math.max(...values.map((value) => value.reversalFraction)),
    voltageSaturationFraction: Math.max(...values.map((value) => value.voltageSaturationFraction)),
    peakCurrentDensity: Math.max(...values.map((value) => value.peakCurrentDensity)),
    maximumTemperature: Math.max(...values.map((value) => value.maximumTemperature)),
  };
  aggregate.dynamicQualified = aggregate.worstRmsError <= 0.1
    && aggregate.dropoutFraction <= 0.01
    && aggregate.reversalFraction === 0
    && aggregate.voltageSaturationFraction <= 0.01
    && aggregate.peakCurrentDensity <= 100e6;
  results.push({ ...config, scenarios: scenarioResults, aggregate });
  configIndex += 1;
}

const dynamicallyQualified = results.filter((result) => result.aggregate.dynamicQualified)
  .sort((a, b) => a.aggregate.worstRmsError - b.aggregate.worstRmsError);
const endurance = [];
for (let index = 0; index < Math.min(5, dynamicallyQualified.length); index += 1) {
  const config = dynamicallyQualified[index];
  endurance.push({
    config: { dt: config.dt, voltageLimit: config.voltageLimit, sensorDelay: config.sensorDelay, sensorNoise: config.sensorNoise, lambdaEnergy: config.lambdaEnergy, currentTimeConstant: config.currentTimeConstant },
    result: simulate({ scenario: "steady", config, loops, rows, gram, inductance, resistance20, resistanceWeights, heatCapacities, seed: 9000 + index, endurance: true }),
  });
}
const fullyQualified = endurance.filter((entry) => entry.result.usefulRuntime >= 30);
const artifact = {
  metadata: {
    question: "Does the nested inclined system remain stable when the adaptive allocator is closed through a coupled, noisy, delayed, voltage- and thermal-limited circuit plant?",
    evidenceGrade: "candidate integrated-loop simulation; lumped circuit and thermal model",
    engine: engine.kind,
    startedAt,
    completedAt: new Date().toISOString(),
    elapsedMs: performance.now() - started,
    configurationCount: results.length,
    scenarioCount: scenarios.length,
  },
  assumptions: {
    geometryRadii: loops.map((loop) => loop.radius),
    inclinationDegrees: 45,
    wireRadiusMeters: WIRE_RADIUS,
    currentUnitAmps: CURRENT_UNIT,
    energyBudgetJoules: ENERGY_BUDGET,
    thermalDeratingStartsCelsius: DERATE_TEMPERATURE,
    maximumCelsius: MAX_TEMPERATURE,
    fieldProbeCount: points.length,
  },
  summary: {
    dynamicallyQualifiedCount: dynamicallyQualified.length,
    fullyQualifiedCount: fullyQualified.length,
    topDynamic: dynamicallyQualified.slice(0, 20),
    endurance,
  },
  results,
};
await writeFile(resolve(here, "results.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify(artifact.metadata, null, 2));
console.log(JSON.stringify({ dynamicallyQualifiedCount: dynamicallyQualified.length, fullyQualifiedCount: fullyQualified.length, endurance: endurance.map((entry) => ({ config: entry.config, usefulRuntime: entry.result.usefulRuntime, stopReason: entry.result.stopReason })) }, null, 2));
