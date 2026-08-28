import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { currentAt, fieldAtPoint, samplePoints, traceFieldLine } from "./sim.mjs";

function activeLoops(scene, time) {
  return (scene.loops ?? [])
    .filter((loop) => loop.visible !== false && Math.abs(currentAt(loop, time)) > 1e-14)
    .map((loop) => [
      ...loop.center,
      ...loop.normal,
      loop.radius,
      currentAt(loop, time),
    ]);
}

function triples(values) {
  const output = [];
  for (let index = 0; index < values.length; index += 3) output.push([values[index], values[index + 1], values[index + 2]]);
  return output;
}

class RustWasmEngine {
  constructor(instance) {
    this.exports = instance.exports;
    this.kind = "magba-rust-wasm";
  }

  allocate(values) {
    const pointer = this.exports.alloc_f64(values.length);
    new Float64Array(this.exports.memory.buffer, pointer, values.length).set(values);
    return { pointer, length: values.length };
  }

  free(allocation) {
    this.exports.dealloc_f64(allocation.pointer, allocation.length);
  }

  fields(scene, points, time = 0, options = {}) {
    const loops = activeLoops(scene, time).flat();
    if (!loops.length) return points.map(() => [0, 0, 0]);
    const loopMemory = this.allocate(loops);
    const pointMemory = this.allocate(points.flat());
    const outputMemory = this.allocate(new Array(points.length * 3).fill(0));
    try {
      const status = this.exports.field_batch(
        loopMemory.pointer,
        loops.length / 8,
        pointMemory.pointer,
        points.length,
        outputMemory.pointer,
        Number(options.softening ?? 0.025),
      );
      if (status !== 0) throw new Error(`WASM_FIELD_ERROR: ${status}`);
      return triples(Array.from(new Float64Array(this.exports.memory.buffer, outputMemory.pointer, outputMemory.length)));
    } finally {
      this.free(outputMemory);
      this.free(pointMemory);
      this.free(loopMemory);
    }
  }

  traceOneDirection(scene, seed, time, direction, options) {
    const loops = activeLoops(scene, time).flat();
    if (!loops.length) return { points: [seed], terminatedBy: "weak_field" };
    const maxSteps = Math.min(1200, Math.max(8, Math.round(options.maxSteps ?? 240)));
    const loopMemory = this.allocate(loops);
    const seedMemory = this.allocate(seed);
    const outputMemory = this.allocate(new Array((maxSteps + 1) * 3).fill(0));
    try {
      const count = this.exports.trace_line(
        loopMemory.pointer,
        loops.length / 8,
        seedMemory.pointer,
        direction,
        Number(options.stepSize ?? 0.08),
        maxSteps,
        Number(options.bounds ?? 12),
        Number(options.softening ?? 0.025),
        outputMemory.pointer,
        maxSteps + 1,
      );
      const values = Array.from(new Float64Array(this.exports.memory.buffer, outputMemory.pointer, count * 3));
      return { points: triples(values), terminatedBy: count >= maxSteps + 1 ? "max_steps" : "bounds_or_weak_field" };
    } finally {
      this.free(outputMemory);
      this.free(seedMemory);
      this.free(loopMemory);
    }
  }

  trace(scene, seed, time = 0, options = {}) {
    const direction = options.direction ?? "both";
    if (direction === "forward") return this.traceOneDirection(scene, seed, time, 1, options);
    if (direction === "backward") return this.traceOneDirection(scene, seed, time, -1, options);
    const backward = this.traceOneDirection(scene, seed, time, -1, options);
    const forward = this.traceOneDirection(scene, seed, time, 1, options);
    return {
      points: [...backward.points.reverse().slice(0, -1), ...forward.points],
      terminatedBy: `${backward.terminatedBy}/${forward.terminatedBy}`,
    };
  }
}

class JavaScriptEngine {
  constructor() { this.kind = "javascript-reference"; }
  fields(scene, points, time = 0, options = {}) {
    return points.map((point) => fieldAtPoint(scene, point, time, options));
  }
  trace(scene, seed, time = 0, options = {}) {
    return traceFieldLine(scene, seed, time, options);
  }
}

export async function loadEngine(projectRoot) {
  try {
    const bytes = await readFile(join(projectRoot, "public", "field_gym_engine.wasm"));
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new RustWasmEngine(instance);
  } catch (error) {
    console.warn(`WASM engine unavailable; using JavaScript reference: ${error.message}`);
    return new JavaScriptEngine();
  }
}

export function samplesFromFields(points, fields) {
  return points.map((point, index) => {
    const field = fields[index];
    return { point, field, magnitude: Math.hypot(...field) };
  });
}
