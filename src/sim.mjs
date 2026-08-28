const TAU = Math.PI * 2;
const EPSILON = 1e-9;

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (v, amount) => [v[0] * amount, v[1] * amount, v[2] * amount];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const magnitude = (v) => Math.sqrt(dot(v, v));
export const normalize = (v, fallback = [0, 1, 0]) => {
  const length = magnitude(v);
  return length > EPSILON ? scale(v, 1 / length) : [...fallback];
};
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function modulo(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

export function currentMultiplier(schedule = {}, time = 0) {
  const waveform = schedule.waveform ?? "dc";
  const delay = Number(schedule.delay ?? 0);
  const period = Math.max(0.001, Number(schedule.period ?? 4));
  const phase = Number(schedule.phase ?? 0);
  const duty = clamp(Number(schedule.duty ?? 0.5), 0.01, 1);
  const local = time - delay;

  if (local < 0) return 0;
  if (waveform === "dc") return 1;
  if (waveform === "ramp") return clamp(local / period, 0, 1);

  const cycle = modulo(local / period + phase, 1);
  if (waveform === "pulse") return cycle < duty ? 1 : 0;
  if (waveform === "sine") return Math.sin(TAU * cycle);
  if (waveform === "triangle") return 1 - Math.abs(2 * cycle - 1);
  return 1;
}

export function currentAt(loop, time = 0) {
  return Number(loop.current ?? 0) * currentMultiplier(loop.schedule, time);
}

export function basisFromNormal(inputNormal) {
  const normal = normalize(inputNormal);
  const helper = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize(cross(helper, normal), [1, 0, 0]);
  const v = normalize(cross(normal, u), [0, 0, 1]);
  return { normal, u, v };
}

export function discretizeLoop(loop, segmentsOverride) {
  const count = clamp(Math.round(segmentsOverride ?? loop.segments ?? 64), 16, 256);
  const center = loop.center ?? [0, 0, 0];
  const radius = Math.max(0.001, Number(loop.radius ?? 1));
  const { u, v } = basisFromNormal(loop.normal ?? [0, 1, 0]);
  const points = [];

  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * TAU;
    points.push(add(center, add(scale(u, Math.cos(angle) * radius), scale(v, Math.sin(angle) * radius))));
  }

  return points;
}

export function completeEllipticKE(parameter) {
  const m = clamp(parameter, 0, 1 - 1e-14);
  if (m < 1e-14) return { K: Math.PI / 2, E: Math.PI / 2 };

  let arithmetic = 1;
  let geometric = Math.sqrt(1 - m);
  let correction = m / 2;
  let factor = 1;

  for (let iteration = 0; iteration < 24; iteration += 1) {
    const difference = (arithmetic - geometric) / 2;
    if (Math.abs(difference) < 2e-16 * arithmetic) break;
    correction += factor * difference * difference;
    factor *= 2;
    const nextArithmetic = (arithmetic + geometric) / 2;
    geometric = Math.sqrt(arithmetic * geometric);
    arithmetic = nextArithmetic;
  }

  const K = Math.PI / (2 * arithmetic);
  return { K, E: K * (1 - correction) };
}

export function fieldFromLoopAnalytic(loop, point, time = 0, options = {}) {
  const current = currentAt(loop, time);
  if (Math.abs(current) < EPSILON || loop.visible === false) return [0, 0, 0];

  const center = loop.center ?? [0, 0, 0];
  const radius = Math.max(0.001, Number(loop.radius ?? 1));
  const { normal, u, v } = basisFromNormal(loop.normal ?? [0, 1, 0]);
  const displacement = sub(point, center);
  const x = dot(displacement, u);
  const y = dot(displacement, v);
  const axial = dot(displacement, normal);
  const radialDistance = Math.hypot(x, y);
  const softening = Math.max(1e-6, Number(options.softening ?? 0.025));
  const axialSquared = axial * axial + softening * softening;

  if (radialDistance < 1e-9 * radius) {
    const denominator = Math.pow(radius * radius + axialSquared, 1.5);
    return scale(normal, current * radius * radius / (2 * denominator));
  }

  const sumSquared = (radius + radialDistance) ** 2 + axialSquared;
  const differenceSquared = (radius - radialDistance) ** 2 + axialSquared;
  const root = Math.sqrt(sumSquared);
  const parameter = (4 * radius * radialDistance) / sumSquared;
  const { K, E } = completeEllipticKE(parameter);
  const coefficient = current / (2 * Math.PI * root);
  const radialField = coefficient * axial / radialDistance
    * (-K + ((radius * radius + radialDistance * radialDistance + axialSquared) / differenceSquared) * E);
  const axialField = coefficient
    * (K + ((radius * radius - radialDistance * radialDistance - axialSquared) / differenceSquared) * E);
  const radialDirection = normalize(add(scale(u, x), scale(v, y)));
  return add(scale(radialDirection, radialField), scale(normal, axialField));
}

export function fieldFromLoopSegmented(loop, point, time = 0, options = {}) {
  const current = currentAt(loop, time);
  if (Math.abs(current) < EPSILON || loop.visible === false) return [0, 0, 0];
  const softening = Math.max(0.001, Number(options.softening ?? 0.025));
  const softeningSquared = softening * softening;
  const points = discretizeLoop(loop, options.segments ?? 128);
  let field = [0, 0, 0];

  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const midpoint = scale(add(start, end), 0.5);
    const dl = sub(end, start);
    const displacement = sub(point, midpoint);
    const denominator = Math.pow(dot(displacement, displacement) + softeningSquared, 1.5);
    field = add(field, scale(cross(dl, displacement), current / (4 * Math.PI * denominator)));
  }
  return field;
}

export function fieldAtPoint(scene, point, time = 0, options = {}) {
  const evaluator = options.method === "segments" ? fieldFromLoopSegmented : fieldFromLoopAnalytic;
  let field = [0, 0, 0];
  for (const loop of scene.loops ?? []) field = add(field, evaluator(loop, point, time, options));
  return field;
}

export function samplePoints(scene, points, time = 0, options = {}) {
  return points.map((point) => {
    const field = fieldAtPoint(scene, point, time, options);
    return { point, field, magnitude: magnitude(field) };
  });
}

function rk4Direction(scene, point, time, direction, stepSize, options) {
  const derivative = (position) => scale(normalize(fieldAtPoint(scene, position, time, options), [0, 0, 0]), direction);
  const k1 = derivative(point);
  const k2 = derivative(add(point, scale(k1, stepSize / 2)));
  const k3 = derivative(add(point, scale(k2, stepSize / 2)));
  const k4 = derivative(add(point, scale(k3, stepSize)));
  return add(point, scale(add(add(k1, scale(add(k2, k3), 2)), k4), stepSize / 6));
}

function traceDirection(scene, seed, time, direction, options) {
  const stepSize = clamp(Number(options.stepSize ?? 0.08), 0.005, 0.5);
  const maxSteps = clamp(Math.round(options.maxSteps ?? 240), 8, 1200);
  const bounds = clamp(Number(options.bounds ?? 12), 1, 100);
  const minField = Math.max(0, Number(options.minField ?? 1e-5));
  const points = [[...seed]];
  let point = [...seed];
  let terminatedBy = "max_steps";

  for (let index = 0; index < maxSteps; index += 1) {
    const field = fieldAtPoint(scene, point, time, options);
    if (magnitude(field) < minField) {
      terminatedBy = "weak_field";
      break;
    }
    point = rk4Direction(scene, point, time, direction, stepSize, options);
    if (!point.every(Number.isFinite)) {
      terminatedBy = "invalid";
      break;
    }
    if (Math.max(...point.map(Math.abs)) > bounds) {
      terminatedBy = "bounds";
      break;
    }
    points.push(point);
  }

  return { points, terminatedBy };
}

export function traceFieldLine(scene, seed, time = 0, options = {}) {
  const direction = options.direction ?? "both";
  if (direction === "forward") return traceDirection(scene, seed, time, 1, options);
  if (direction === "backward") return traceDirection(scene, seed, time, -1, options);

  const backward = traceDirection(scene, seed, time, -1, options);
  const forward = traceDirection(scene, seed, time, 1, options);
  return {
    points: [...backward.points.reverse().slice(0, -1), ...forward.points],
    terminatedBy: `${backward.terminatedBy}/${forward.terminatedBy}`,
  };
}

export function evaluateTimeline(scene, input = {}, batchEvaluator) {
  const start = Number(input.start ?? scene.time?.start ?? 0);
  const end = Math.max(start + 0.001, Number(input.end ?? scene.time?.end ?? 10));
  const steps = clamp(Math.round(input.steps ?? 80), 2, 400);
  const probes = input.probes?.length
    ? input.probes
    : (scene.probes ?? []).map((probe) => ({ point: probe.position, targetDirection: probe.targetDirection }));
  const effectiveProbes = probes.length ? probes.slice(0, 32) : [{ point: [0, 0, 0], targetDirection: [0, 1, 0] }];
  const samples = [];

  for (let index = 0; index < steps; index += 1) {
    const time = start + (index / (steps - 1)) * (end - start);
    let totalMagnitude = 0;
    let totalProjection = 0;
    const fields = batchEvaluator
      ? batchEvaluator(scene, effectiveProbes.map((probe) => probe.point), time, input)
      : effectiveProbes.map((probe) => fieldAtPoint(scene, probe.point, time, input));
    const points = effectiveProbes.map((probe, probeIndex) => {
      const field = fields[probeIndex];
      const fieldMagnitude = magnitude(field);
      const target = normalize(probe.targetDirection ?? input.targetDirection ?? [0, 1, 0]);
      const projection = dot(field, target);
      totalMagnitude += fieldMagnitude;
      totalProjection += projection;
      return { point: probe.point, field, magnitude: fieldMagnitude, projection };
    });
    samples.push({
      time,
      magnitude: totalMagnitude / effectiveProbes.length,
      projection: totalProjection / effectiveProbes.length,
      points,
    });
  }

  const magnitudes = samples.map((sample) => sample.magnitude);
  const projections = samples.map((sample) => sample.projection);
  const meanMagnitude = magnitudes.reduce((sum, value) => sum + value, 0) / magnitudes.length;
  const meanProjection = projections.reduce((sum, value) => sum + value, 0) / projections.length;
  const minMagnitude = Math.min(...magnitudes);
  const maxMagnitude = Math.max(...magnitudes);
  const minProjection = Math.min(...projections);
  const maxProjection = Math.max(...projections);
  const threshold = Number(input.dropoutThreshold ?? meanMagnitude * 0.5);

  return {
    samples,
    metrics: {
      minMagnitude,
      maxMagnitude,
      meanMagnitude,
      magnitudeRipple: meanMagnitude > EPSILON ? (maxMagnitude - minMagnitude) / meanMagnitude : 0,
      minProjection,
      maxProjection,
      meanProjection,
      projectionReversed: minProjection < 0,
      dropoutThreshold: threshold,
      dropoutFraction: magnitudes.filter((value) => value < threshold).length / magnitudes.length,
    },
  };
}

export function rotateVector(vector, axisInput, angleRadians) {
  const axis = normalize(axisInput);
  const cosine = Math.cos(angleRadians);
  const sine = Math.sin(angleRadians);
  return add(
    add(scale(vector, cosine), scale(cross(axis, vector), sine)),
    scale(axis, dot(axis, vector) * (1 - cosine)),
  );
}

export function makeSolenoid(spec = {}) {
  const count = clamp(Math.round(spec.windings ?? 8), 1, 64);
  const center = spec.center ?? [0, 0, 0];
  const axis = normalize(spec.axis ?? [0, 1, 0]);
  const length = Math.max(0, Number(spec.length ?? 2));
  const loops = [];

  for (let index = 0; index < count; index += 1) {
    const offset = count === 1 ? 0 : (index / (count - 1) - 0.5) * length;
    loops.push({
      id: `${spec.idPrefix ?? "sol"}-${index + 1}`,
      name: `${spec.name ?? "Solenoid"} · winding ${index + 1}`,
      center: add(center, scale(axis, offset)),
      normal: axis,
      radius: Math.max(0.05, Number(spec.radius ?? 1.2)),
      current: Number(spec.current ?? 1),
      segments: spec.segments ?? 48,
      groupId: spec.groupId,
      role: "drive",
      schedule: {
        waveform: spec.schedule?.waveform ?? "dc",
        delay: Number(spec.schedule?.delay ?? 0) + index * Number(spec.windingStagger ?? 0),
        period: Number(spec.schedule?.period ?? 4),
        duty: Number(spec.schedule?.duty ?? 0.5),
        phase: Number(spec.schedule?.phase ?? 0),
      },
    });
  }
  return loops;
}

export function makeToroid(spec = {}) {
  const count = clamp(Math.round(spec.coils ?? 12), 3, 48);
  const center = spec.center ?? [0, 0, 0];
  const axis = normalize(spec.axis ?? [0, 1, 0]);
  const { u, v } = basisFromNormal(axis);
  const majorRadius = Math.max(0.1, Number(spec.majorRadius ?? 2.2));
  const minorRadius = Math.max(0.05, Number(spec.minorRadius ?? 0.7));
  const loops = [];

  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * TAU;
    const radial = normalize(add(scale(u, Math.cos(angle)), scale(v, Math.sin(angle))));
    const tangent = normalize(cross(radial, axis));
    loops.push({
      id: `${spec.idPrefix ?? "tor"}-${index + 1}`,
      name: `${spec.name ?? "Toroidal assembly"} · coil ${index + 1}`,
      center: add(center, scale(radial, majorRadius)),
      normal: tangent,
      radius: minorRadius,
      current: Number(spec.current ?? 1),
      segments: spec.segments ?? 40,
      groupId: spec.groupId,
      role: "drive",
      schedule: {
        waveform: spec.schedule?.waveform ?? "dc",
        delay: Number(spec.schedule?.delay ?? 0) + index * Number(spec.coilStagger ?? 0),
        period: Number(spec.schedule?.period ?? 4),
        duty: Number(spec.schedule?.duty ?? 0.5),
        phase: Number(spec.schedule?.phase ?? 0),
      },
    });
  }
  return loops;
}
