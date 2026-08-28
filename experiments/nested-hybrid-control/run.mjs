import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEngine } from "../../src/engine.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../..");
const engine = await loadEngine(projectRoot);
const DEG = Math.PI / 180;
const STEPS = 96;
const TARGET_AXIAL = 0.4;
const EPSILON = 1e-12;
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const magnitude = (vector) => Math.hypot(...vector);
const clamp = (value, lower, upper) => Math.min(upper, Math.max(lower, value));
const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;

function probes() {
  const points = [[0, 0, 0]];
  for (const x of [-0.3, 0, 0.3]) for (const y of [-0.3, 0, 0.3]) for (const z of [-0.3, 0, 0.3]) {
    if (x || y || z) points.push([x, y, z]);
  }
  return points;
}

function makeLoop(id, radius, center, normal) {
  return {
    id, name: id, radius, center, normal, current: 1, segments: 64, visible: true, role: "drive",
    schedule: { waveform: "dc", delay: 0, period: 1, duty: 1, phase: 0 },
  };
}

function makeNestedSystem(radiusSpacing, orientationDeg, inclinationDeg) {
  const orientation = orientationDeg * DEG;
  const inclination = inclinationDeg * DEG;
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

async function influenceMatrix(loops, points) {
  const byCoil = await Promise.all(loops.map((source) => engine.fields({ loops: [source] }, points, 0, { softening: 0.025 })));
  const rows = [];
  for (let point = 0; point < points.length; point += 1) {
    for (let component = 0; component < 3; component += 1) {
      rows.push(byCoil.map((fields) => fields[point][component]));
    }
  }
  return { rows, byCoil };
}

function gramMatrix(rows) {
  const normalization = rows.length * TARGET_AXIAL * TARGET_AXIAL;
  const coilCount = rows[0].length;
  return Array.from({ length: coilCount }, (_, i) => Array.from({ length: coilCount }, (_, j) =>
    rows.reduce((sum, row) => sum + row[i] * row[j], 0) / normalization));
}

function targetVector(target, pointCount) {
  return Array.from({ length: pointCount }, () => target).flat();
}

function linearTerm(rows, targetRows) {
  const normalization = rows.length * TARGET_AXIAL * TARGET_AXIAL;
  return Array.from({ length: rows[0].length }, (_, coil) => rows.reduce((sum, row, index) => sum + row[coil] * targetRows[index], 0) / normalization);
}

function matrixVector(matrix, vector) {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
}

function solveAllocation({ gram, linear, resistance, previous, capacities, lambdaEnergy, lambdaSlew, maxDelta, initial = false, iterations = 80 }) {
  const hessian = gram.map((row, i) => row.map((value, j) => value + (i === j ? lambdaEnergy * resistance[i] + lambdaSlew : 0)));
  const objectiveLinear = linear.map((value, index) => value + lambdaSlew * previous[index]);
  const upper = capacities.map((capacity, index) => Math.min(capacity, initial ? capacity : previous[index] + maxDelta));
  const lower = capacities.map((capacity, index) => Math.min(upper[index], Math.max(0, initial ? 0 : previous[index] - maxDelta)));
  let currents = previous.map((value, index) => clamp(value, lower[index], upper[index]));
  const lipschitz = Math.max(...hessian.map((row) => row.reduce((sum, value) => sum + Math.abs(value), 0)), EPSILON);
  const step = 0.9 / lipschitz;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const product = matrixVector(hessian, currents);
    currents = currents.map((value, index) => clamp(value - step * (product[index] - objectiveLinear[index]), lower[index], upper[index]));
  }
  return currents;
}

function targetFor(scenario, time) {
  if (scenario === "amplitude_tracking") return [0, TARGET_AXIAL * (0.75 + 0.25 * Math.sin(Math.PI * 4 * time)), 0];
  if (scenario === "rotating_correction") {
    const transverse = TARGET_AXIAL * 0.12;
    return [transverse * Math.cos(Math.PI * 4 * time), TARGET_AXIAL, transverse * Math.sin(Math.PI * 4 * time)];
  }
  return [0, TARGET_AXIAL, 0];
}

function capacitiesFor(scenario, time, coilCount) {
  const capacities = new Array(coilCount).fill(1);
  if (scenario === "main_derating") {
    if (time >= 0.25 && time < 0.6) capacities[0] = 1 - 0.8 * (time - 0.25) / 0.35;
    else if (time >= 0.6) capacities[0] = 0.2;
  }
  if (scenario === "satellite_failure" && time >= 0.5) capacities[1] = 0;
  return capacities;
}

function fieldRows(rows, currents) {
  return rows.map((row) => row.reduce((sum, value, index) => sum + value * currents[index], 0));
}

function scenarioMetrics({ scenario, rows, resistance, controller, fixedCurrents, mainCenterField }) {
  let previous = new Array(resistance.length).fill(0);
  const rmsErrors = [];
  const worstPointErrors = [];
  const centerAngleErrors = [];
  const losses = [];
  const baselineLosses = [];
  const currentSums = new Array(resistance.length).fill(0);
  let dropoutSamples = 0;
  let reversalSamples = 0;
  let saturationSamples = 0;
  let slewLimitedSamples = 0;
  let recoveryStep = null;
  const eventStep = scenario === "main_derating" ? Math.ceil(0.25 * STEPS) : scenario === "satellite_failure" ? Math.ceil(0.5 * STEPS) : null;

  for (let step = 0; step < STEPS; step += 1) {
    const time = (step + 0.5) / STEPS;
    const target = targetFor(scenario, time);
    const targetRows = targetVector(target, rows.length / 3);
    const capacities = capacitiesFor(scenario, time, resistance.length);
    let currents;
    if (controller.kind === "adaptive" || controller.kind === "oracle") {
      currents = solveAllocation({
        gram: controller.gram,
        linear: linearTerm(rows, targetRows),
        resistance,
        previous,
        capacities,
        lambdaEnergy: controller.kind === "oracle" ? 0 : controller.lambdaEnergy,
        lambdaSlew: controller.kind === "oracle" ? 0 : controller.lambdaSlew,
        maxDelta: controller.kind === "oracle" ? Infinity : controller.maxDelta,
        initial: step === 0 || controller.kind === "oracle",
        iterations: controller.kind === "oracle" ? 160 : 80,
      });
    } else if (controller.kind === "fixed") {
      currents = fixedCurrents.map((value, index) => Math.min(value, capacities[index]));
    } else {
      const desired = target[1] / mainCenterField;
      currents = [Math.min(Math.max(0, desired), capacities[0]), ...new Array(resistance.length - 1).fill(0)];
    }

    const actualRows = fieldRows(rows, currents);
    const targetMagnitude = Math.max(EPSILON, magnitude(target));
    let sumSquaredError = 0;
    let worstPointError = 0;
    for (let point = 0; point < actualRows.length / 3; point += 1) {
      const offset = point * 3;
      const error = Math.hypot(
        actualRows[offset] - targetRows[offset],
        actualRows[offset + 1] - targetRows[offset + 1],
        actualRows[offset + 2] - targetRows[offset + 2],
      ) / targetMagnitude;
      sumSquaredError += error * error;
      worstPointError = Math.max(worstPointError, error);
      if (actualRows[offset + 1] < target[1] * 0.5) dropoutSamples += 1;
      if (actualRows[offset + 1] < 0) reversalSamples += 1;
    }
    const rmsError = Math.sqrt(sumSquaredError / (actualRows.length / 3));
    rmsErrors.push(rmsError);
    worstPointErrors.push(worstPointError);
    const actualCenter = actualRows.slice(0, 3);
    const angle = magnitude(actualCenter) < EPSILON ? 180 : Math.acos(clamp(
      (actualCenter[0] * target[0] + actualCenter[1] * target[1] + actualCenter[2] * target[2])
      / (magnitude(actualCenter) * targetMagnitude), -1, 1,
    )) / DEG;
    centerAngleErrors.push(angle);
    losses.push(currents.reduce((sum, value, index) => sum + resistance[index] * value * value, 0));
    currents.forEach((value, index) => { currentSums[index] += value; });
    const baselineCurrent = target[1] / mainCenterField;
    baselineLosses.push(resistance[0] * baselineCurrent * baselineCurrent);
    saturationSamples += currents.filter((value, index) => value >= capacities[index] - 1e-5 && capacities[index] > 0).length;
    if (step > 0) slewLimitedSamples += currents.filter((value, index) => Math.abs(value - previous[index]) >= (controller.maxDelta ?? Infinity) - 1e-5).length;
    if (eventStep !== null && step >= eventStep && recoveryStep === null && rmsError <= 0.1) recoveryStep = step - eventStep;
    previous = currents;
  }

  const pointTimeCount = STEPS * rows.length / 3;
  return {
    meanRmsError: mean(rmsErrors),
    worstRmsError: Math.max(...rmsErrors),
    meanWorstPointError: mean(worstPointErrors),
    worstPointError: Math.max(...worstPointErrors),
    meanCenterAngleErrorDeg: mean(centerAngleErrors),
    worstCenterAngleErrorDeg: Math.max(...centerAngleErrors),
    dropoutFraction: dropoutSamples / pointTimeCount,
    reversalFraction: reversalSamples / pointTimeCount,
    meanLoss: mean(losses),
    peakLoss: Math.max(...losses),
    runtimeRelativeToMain: mean(baselineLosses) / Math.max(EPSILON, mean(losses)),
    runtimeRelativeFixedCopper: mean(baselineLosses) / Math.max(EPSILON, resistance.length * mean(losses)),
    meanCurrents: currentSums.map((sum) => sum / STEPS),
    saturationFraction: saturationSamples / (STEPS * resistance.length),
    slewLimitedFraction: slewLimitedSamples / ((STEPS - 1) * resistance.length),
    recoveryStepsToTenPercent: eventStep === null ? null : recoveryStep,
  };
}

function aggregate(config, scenarios, baselineScenarios) {
  const values = Object.values(scenarios);
  const worstScenarioRmsError = Math.max(...values.map((metrics) => metrics.worstRmsError));
  const worstPointError = Math.max(...values.map((metrics) => metrics.worstPointError));
  const dropoutFraction = Math.max(...values.map((metrics) => metrics.dropoutFraction));
  const reversalFraction = Math.max(...values.map((metrics) => metrics.reversalFraction));
  const meanLoss = mean(values.map((metrics) => metrics.meanLoss));
  const baselineLoss = mean(Object.values(baselineScenarios).map((metrics) => metrics.meanLoss));
  const qualified = worstScenarioRmsError <= 0.1 && dropoutFraction <= 0.01 && reversalFraction === 0
    && scenarios.steady.meanRmsError < baselineScenarios.steady.meanRmsError;
  return {
    ...config,
    scenarios,
    aggregate: {
      meanScenarioRmsError: mean(values.map((metrics) => metrics.meanRmsError)),
      worstScenarioRmsError,
      worstPointError,
      dropoutFraction,
      reversalFraction,
      meanLoss,
      runtimeRelativeToMain: baselineLoss / Math.max(EPSILON, meanLoss),
      runtimeRelativeFixedCopper: baselineLoss / Math.max(EPSILON, (config.satelliteCount + 1) * meanLoss),
      qualified,
    },
  };
}

function paretoFront(candidates) {
  return candidates.filter((candidate) => !candidates.some((other) =>
    other !== candidate
    && other.aggregate.worstScenarioRmsError <= candidate.aggregate.worstScenarioRmsError
    && other.aggregate.meanLoss <= candidate.aggregate.meanLoss
    && (other.aggregate.worstScenarioRmsError < candidate.aggregate.worstScenarioRmsError
      || other.aggregate.meanLoss < candidate.aggregate.meanLoss)));
}

const points = probes();
const scenarioNames = ["steady", "amplitude_tracking", "main_derating", "satellite_failure", "rotating_correction"];
const startedAt = new Date().toISOString();
const started = performance.now();
const results = [];
const baselines = [];

for (const radiusSpacing of [0.04, 0.06, 0.08, 0.1, 0.12]) {
  for (const inclinationDeg of [15, 30, 45]) {
    for (const orientationDeg of [0, 30]) {
      const loops = makeNestedSystem(radiusSpacing, orientationDeg, inclinationDeg);
      const { rows, byCoil } = await influenceMatrix(loops, points);
      const gram = gramMatrix(rows);
      const resistance = loops.map((source) => source.radius);
      const mainCenterField = byCoil[0][0][1];
      const steadyTarget = targetVector([0, TARGET_AXIAL, 0], points.length);
      const fixedCurrents = solveAllocation({
        gram, linear: linearTerm(rows, steadyTarget), resistance, previous: new Array(loops.length).fill(0), capacities: new Array(loops.length).fill(1),
        lambdaEnergy: 0, lambdaSlew: 0, maxDelta: Infinity, initial: true, iterations: 200,
      });
      const mainController = { kind: "main", maxDelta: Infinity };
      const fixedController = { kind: "fixed", maxDelta: Infinity };
      const oracleController = { kind: "oracle", gram, maxDelta: Infinity };
      const baselineScenarios = {};
      const fixedScenarios = {};
      const oracleScenarios = {};
      for (const scenario of scenarioNames) {
        baselineScenarios[scenario] = scenarioMetrics({ scenario, rows, resistance, controller: mainController, fixedCurrents, mainCenterField });
        fixedScenarios[scenario] = scenarioMetrics({ scenario, rows, resistance, controller: fixedController, fixedCurrents, mainCenterField });
        oracleScenarios[scenario] = scenarioMetrics({ scenario, rows, resistance, controller: oracleController, fixedCurrents, mainCenterField });
      }
      baselines.push({ satelliteCount: 6, radiusSpacing, inclinationDeg, orientationDeg, clearanceFor20mmWire: radiusSpacing >= 0.048, fixedCurrents, mainOnly: baselineScenarios, fixed: fixedScenarios, oracle: oracleScenarios });

      for (const lambdaEnergy of [0, 0.001, 0.01, 0.1]) {
        for (const lambdaSlew of [0.001, 0.01, 0.1]) {
          for (const maxDelta of [0.02, 0.05, 0.1]) {
            const controller = { kind: "adaptive", gram, lambdaEnergy, lambdaSlew, maxDelta };
            const scenarios = {};
            for (const scenario of scenarioNames) scenarios[scenario] = scenarioMetrics({ scenario, rows, resistance, controller, fixedCurrents, mainCenterField });
            results.push(aggregate({ satelliteCount: 6, radiusSpacing, inclinationDeg, orientationDeg, clearanceFor20mmWire: radiusSpacing >= 0.048, lambdaEnergy, lambdaSlew, maxDelta }, scenarios, baselineScenarios));
          }
        }
      }
    }
  }
}

const fieldQualified = results.filter((result) => result.aggregate.qualified);
const promoted = fieldQualified.filter((result) => result.clearanceFor20mmWire);
const pareto = paretoFront(promoted).sort((a, b) => a.aggregate.meanLoss - b.aggregate.meanLoss);
const topStability = [...promoted].sort((a, b) => a.aggregate.worstScenarioRmsError - b.aggregate.worstScenarioRmsError).slice(0, 20);
const topRuntime = [...promoted].sort((a, b) => b.aggregate.runtimeRelativeToMain - a.aggregate.runtimeRelativeToMain).slice(0, 20);
const topRuntimeFixedCopper = [...promoted].sort((a, b) => b.aggregate.runtimeRelativeFixedCopper - a.aggregate.runtimeRelativeFixedCopper).slice(0, 20);
const topCompromise = [...promoted].sort((a, b) =>
  (a.aggregate.worstScenarioRmsError + 0.02 * a.aggregate.meanLoss)
  - (b.aggregate.worstScenarioRmsError + 0.02 * b.aggregate.meanLoss)).slice(0, 20);
const artifact = {
  metadata: {
    question: "Can distinct-radius concentric inclined loops preserve adaptive field stability while clearing 20 mm conductors?",
    evidenceGrade: "smoke-to-candidate control sweep; instantaneous vacuum field and loss proxies only",
    engine: engine.kind,
    startedAt,
    completedAt: new Date().toISOString(),
    elapsedMs: performance.now() - started,
    timeStepsPerScenario: STEPS,
    scenarios: scenarioNames,
    geometryCount: baselines.length,
    controllerResultCount: results.length,
  },
  definitions: {
    target: "uniform vector field over 27 central-cube probes; nominal axial magnitude 0.4",
    loss: "sum(radius_i * current_i^2)",
    runtimeRelativeToMain: "main-only loss divided by adaptive loss when every coil retains the main coil's conductor gauge; this adds copper with coil count",
    runtimeRelativeFixedCopper: "main-only loss divided by coil-count-scaled adaptive loss when total conductor cross-section is held fixed",
    controller: "projected-gradient bounded feedback allocation over the main loop and all satellites",
  },
  summary: {
    fieldQualifiedCount: fieldQualified.length,
    promotedCount: promoted.length,
    paretoCount: pareto.length,
    pareto,
    topStability,
    topRuntime,
    topRuntimeFixedCopper,
    topCompromise,
  },
  baselines,
  results,
};
await writeFile(resolve(here, "results.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify(artifact.metadata, null, 2));
console.log(JSON.stringify({ fieldQualifiedCount: fieldQualified.length, promotedCount: promoted.length, paretoCount: pareto.length }, null, 2));
