import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  completeEllipticKE,
  evaluateTimeline,
  fieldAtPoint,
  fieldFromLoopSegmented,
} from "../src/sim.mjs";
import { createDefaultScene, applySceneOperation } from "../src/scene.mjs";
import { loadEngine } from "../src/engine.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

function relativeError(actual, expected) {
  return Math.abs(actual - expected) / Math.max(1e-12, Math.abs(expected));
}

test("complete elliptic integrals match known values", () => {
  const { K, E } = completeEllipticKE(0.5);
  assert.ok(Math.abs(K - 1.8540746773013719) < 1e-13);
  assert.ok(Math.abs(E - 1.3506438810476755) < 1e-13);
});

test("analytic loop center follows the closed form and polarity", () => {
  const scene = { loops: [{ center: [0, 0, 0], normal: [0, 1, 0], radius: 2, current: 3, schedule: { waveform: "dc" } }] };
  const positive = fieldAtPoint(scene, [0, 0, 0], 0, { softening: 1e-8 });
  assert.ok(relativeError(positive[1], 0.75) < 1e-12);
  scene.loops[0].current = -3;
  const negative = fieldAtPoint(scene, [0, 0, 0], 0, { softening: 1e-8 });
  assert.ok(relativeError(negative[1], -0.75) < 1e-12);
});

test("analytic field agrees with high-resolution segmented reference away from wire", () => {
  const loop = { center: [0.2, -0.1, 0.3], normal: [0.2, 0.97, -0.1], radius: 1.4, current: 2.2, schedule: { waveform: "dc" } };
  const point = [0.7, 1.1, -0.5];
  const analytic = fieldAtPoint({ loops: [loop] }, point, 0, { softening: 1e-6 });
  const segmented = fieldFromLoopSegmented(loop, point, 0, { softening: 1e-6, segments: 256 });
  analytic.forEach((value, index) => assert.ok(relativeError(value, segmented[index]) < 3e-4, `${value} vs ${segmented[index]}`));
});

test("scene creates staggered assemblies and revision-neutral operations", () => {
  const scene = createDefaultScene();
  assert.equal(scene.groups.length, 3);
  assert.equal(scene.loops.length, 18);
  assert.deepEqual(scene.groups.map((group) => scene.loops.find((loop) => loop.groupId === group.id).schedule.delay), [0, 1.2, 2.4]);
  const { scene: changed } = applySceneOperation(scene, { op: "set_schedule", groupIds: [scene.groups[0].id], schedule: { waveform: "pulse", period: 2, duty: 0.4 } });
  assert.ok(changed.loops.filter((loop) => loop.groupId === scene.groups[0].id).every((loop) => loop.schedule.period === 2));
});

test("coincident-loop merge preserves field and keeps a restorable variant", () => {
  const scene = createDefaultScene();
  const original = scene.loops[0];
  scene.loops.push({ ...structuredClone(original), id: "coincident-copy", name: "Coincident copy" });
  const point = [0.3, 0.2, -0.4];
  const before = fieldAtPoint(scene, point, 0.5);
  const { scene: merged, changed } = applySceneOperation(scene, { op: "merge_coincident", saveAs: "before-merge" });
  const after = fieldAtPoint(merged, point, 0.5);

  assert.equal(changed.removed, 1);
  assert.equal(merged.loops.length, scene.loops.length - 1);
  assert.equal(merged.variants["before-merge"].loops.length, scene.loops.length);
  before.forEach((value, index) => assert.ok(relativeError(after[index], value) < 1e-12));
});

test("timeline exposes ripple, dropout, and direction", () => {
  const scene = createDefaultScene();
  const result = evaluateTimeline(scene, { start: 0, end: 5, steps: 25 });
  assert.ok(result.metrics.meanMagnitude > 0);
  assert.ok(result.metrics.magnitudeRipple >= 0);
  assert.ok(result.metrics.dropoutFraction >= 0 && result.metrics.dropoutFraction <= 1);
  assert.equal(typeof result.metrics.projectionReversed, "boolean");
});

test("Rust WASM engine agrees with JavaScript reference", async () => {
  const engine = await loadEngine(projectRoot);
  assert.equal(engine.kind, "magba-rust-wasm");
  const scene = { loops: [{ center: [0.1, 0.2, -0.3], normal: [0.1, 0.95, 0.2], radius: 1.2, current: 2, visible: true, schedule: { waveform: "dc", delay: 0 } }] };
  const points = [[0, 0, 0], [0.8, 0.4, -0.7], [2.2, -1, 0.3]];
  const wasm = engine.fields(scene, points, 0, { softening: 1e-6 });
  const reference = points.map((point) => fieldAtPoint(scene, point, 0, { softening: 1e-6 }));
  wasm.flat().forEach((value, index) => assert.ok(relativeError(value, reference.flat()[index]) < 2e-8, `${value} vs ${reference.flat()[index]}`));
});
