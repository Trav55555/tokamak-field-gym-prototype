import {
  add,
  clamp,
  makeSolenoid,
  makeToroid,
  normalize,
  rotateVector,
  scale,
  sub,
} from "./sim.mjs";

const DEFAULT_SCHEDULE = Object.freeze({ waveform: "dc", delay: 0, period: 4, duty: 0.5, phase: 0 });

function finiteVector(value, fallback) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) return [...fallback];
  return value.map(Number);
}

function cleanSchedule(schedule = {}) {
  const waveform = ["dc", "pulse", "ramp", "sine", "triangle"].includes(schedule.waveform)
    ? schedule.waveform
    : "dc";
  return {
    waveform,
    delay: Number.isFinite(schedule.delay) ? Number(schedule.delay) : 0,
    period: clamp(Number(schedule.period ?? 4), 0.05, 1000),
    duty: clamp(Number(schedule.duty ?? 0.5), 0.01, 1),
    phase: Number.isFinite(schedule.phase) ? Number(schedule.phase) : 0,
  };
}

export function cleanLoop(input, id) {
  return {
    id,
    name: String(input.name ?? id),
    center: finiteVector(input.center, [0, 0, 0]),
    normal: normalize(finiteVector(input.normal, [0, 1, 0])),
    radius: clamp(Number(input.radius ?? 1), 0.05, 20),
    current: clamp(Number(input.current ?? 1), -100, 100),
    segments: clamp(Math.round(input.segments ?? 48), 16, 128),
    groupId: input.groupId ? String(input.groupId) : undefined,
    role: ["drive", "plasma", "probe"].includes(input.role) ? input.role : "drive",
    visible: input.visible !== false,
    schedule: cleanSchedule(input.schedule ?? DEFAULT_SCHEDULE),
  };
}

function cleanProbe(input, id) {
  return {
    id,
    name: String(input.name ?? id),
    position: finiteVector(input.position, [0, 0, 0]),
    targetDirection: normalize(finiteVector(input.targetDirection, [0, 1, 0])),
  };
}

export function baseScene() {
  return {
    schema: "field-gym.scene",
    schemaVersion: 1,
    revision: 0,
    updatedAt: new Date(0).toISOString(),
    updatedBy: "initial",
    time: { start: 0, end: 12, current: 0 },
    loops: [],
    groups: [],
    probes: [cleanProbe({ name: "Core", position: [0, 0, 0], targetDirection: [0, 1, 0] }, "probe-1")],
    selectedLoopId: null,
    display: { vectors: true, traces: true, labels: true },
    variants: {},
  };
}

function nextId(scene, prefix) {
  const used = new Set([
    ...scene.loops.map((loop) => loop.id),
    ...scene.groups.map((group) => group.id),
    ...scene.probes.map((probe) => probe.id),
  ]);
  let index = 1;
  while (used.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

function uniqueLoopId(scene, preferred) {
  if (preferred && !scene.loops.some((loop) => loop.id === preferred)) return preferred;
  return nextId(scene, "loop");
}

function addGeneratedLoops(scene, generated) {
  const ids = [];
  for (const generatedLoop of generated) {
    const id = uniqueLoopId(scene, generatedLoop.id);
    scene.loops.push(cleanLoop(generatedLoop, id));
    ids.push(id);
  }
  scene.selectedLoopId = ids[0] ?? scene.selectedLoopId;
  return ids;
}

function snapshot(scene) {
  return structuredClone({ loops: scene.loops, groups: scene.groups, probes: scene.probes });
}

function coincidentLoopKey(loop) {
  const stableNumber = (value) => Math.round(Number(value) * 1e12) / 1e12;
  return JSON.stringify({
    center: loop.center.map(stableNumber),
    normal: loop.normal.map(stableNumber),
    radius: stableNumber(loop.radius),
    segments: loop.segments,
    role: loop.role,
    visible: loop.visible,
    schedule: loop.schedule,
  });
}

function mergeCoincidentLoops(scene, saveAs) {
  const savedVariant = saveAs || `pre-merge-r${scene.revision}`;
  scene.variants[savedVariant] = snapshot(scene);
  const buckets = new Map();
  for (const loop of scene.loops) {
    const key = coincidentLoopKey(loop);
    const bucket = buckets.get(key) ?? [];
    bucket.push(loop);
    buckets.set(key, bucket);
  }

  const replacement = new Map();
  const mergedLoops = [];
  let removed = 0;
  let mergedSets = 0;
  for (const bucket of buckets.values()) {
    const retained = structuredClone(bucket[0]);
    if (bucket.length > 1) {
      retained.current = bucket.reduce((sum, loop) => sum + loop.current, 0);
      retained.name = `${retained.name.replace(/ ×\d+$/, "")} ×${bucket.length}`;
      mergedSets += 1;
      removed += bucket.length - 1;
    }
    for (const loop of bucket) replacement.set(loop.id, retained.id);
    mergedLoops.push(retained);
  }
  scene.loops = mergedLoops;

  const groupBuckets = new Map();
  for (const group of scene.groups) {
    const loopIds = [...new Set(group.loopIds.map((id) => replacement.get(id)).filter(Boolean))];
    if (!loopIds.length) continue;
    const key = JSON.stringify({ kind: group.kind, loopIds: [...loopIds].sort() });
    const bucket = groupBuckets.get(key) ?? [];
    bucket.push({ ...group, loopIds });
    groupBuckets.set(key, bucket);
  }
  scene.groups = [...groupBuckets.values()].map((groups) => {
    const retained = groups[0];
    if (groups.length > 1) retained.name = `${retained.name.replace(/ ×\d+ assemblies$/, "")} ×${groups.length} assemblies`;
    return retained;
  });
  if (scene.selectedLoopId) scene.selectedLoopId = replacement.get(scene.selectedLoopId) ?? scene.loops[0]?.id ?? null;
  return { removed, retained: scene.loops.length, mergedSets, savedVariant };
}

function presetScene(name) {
  const scene = baseScene();
  if (name === "single_loop") {
    scene.loops.push(cleanLoop({ name: "Single loop", radius: 1.8, current: 1 }, "loop-1"));
  } else if (name === "stacked_solenoids" || name === "staggered_solenoids") {
    const staggered = name === "staggered_solenoids";
    for (let stack = 0; stack < 3; stack += 1) {
      const groupId = `solenoid-${stack + 1}`;
      const schedule = staggered
        ? { waveform: "pulse", delay: stack * 1.2, period: 3.6, duty: 0.55 }
        : { waveform: "dc" };
      const loops = makeSolenoid({
        idPrefix: `${groupId}-w`,
        groupId,
        name: `Solenoid ${stack + 1}`,
        center: [0, (stack - 1) * 2.2, 0],
        axis: [0, 1, 0],
        radius: 1.45,
        length: 1.15,
        windings: 6,
        current: 1,
        schedule,
      });
      scene.loops.push(...loops.map((loop) => cleanLoop(loop, loop.id)));
      scene.groups.push({ id: groupId, name: `Solenoid ${stack + 1}`, kind: "solenoid", loopIds: loops.map((loop) => loop.id) });
    }
    scene.time.end = 10.8;
  } else if (name === "stacked_toroids") {
    for (let stack = 0; stack < 3; stack += 1) {
      const groupId = `toroid-${stack + 1}`;
      const loops = makeToroid({
        idPrefix: `${groupId}-c`,
        groupId,
        name: `Toroidal assembly ${stack + 1}`,
        center: [0, (stack - 1) * 2.1, 0],
        axis: [0, 1, 0],
        majorRadius: 2.1,
        minorRadius: 0.68,
        coils: 10,
        current: 1,
        schedule: { waveform: "pulse", delay: stack * 1.1, period: 3.3, duty: 0.58 },
      });
      scene.loops.push(...loops.map((loop) => cleanLoop(loop, loop.id)));
      scene.groups.push({ id: groupId, name: `Toroidal assembly ${stack + 1}`, kind: "toroid", loopIds: loops.map((loop) => loop.id) });
    }
    scene.time.end = 10;
  } else if (name === "tilted_toroids") {
    const axes = [[-0.24, 0.97, 0], [0, 1, 0], [0.24, 0.97, 0]];
    axes.forEach((axis, stack) => {
      const groupId = `tilted-${stack + 1}`;
      const loops = makeToroid({
        idPrefix: `${groupId}-c`, groupId, name: `Tilted toroid ${stack + 1}`,
        center: [0, (stack - 1) * 2.1, 0], axis, majorRadius: 2.1, minorRadius: 0.68,
        coils: 10, current: 1, schedule: { waveform: "pulse", delay: stack, period: 3, duty: 0.62 },
      });
      scene.loops.push(...loops.map((loop) => cleanLoop(loop, loop.id)));
      scene.groups.push({ id: groupId, name: `Tilted toroid ${stack + 1}`, kind: "toroid", loopIds: loops.map((loop) => loop.id) });
    });
    scene.time.end = 9;
  } else {
    return presetScene("staggered_solenoids");
  }
  scene.selectedLoopId = scene.loops[0]?.id ?? null;
  return scene;
}

export function createDefaultScene() {
  return presetScene("staggered_solenoids");
}

export function normalizeScene(input) {
  const scene = { ...baseScene(), ...structuredClone(input) };
  scene.loops = (input?.loops ?? []).map((loop, index) => cleanLoop(loop, String(loop.id ?? `loop-${index + 1}`)));
  scene.groups = Array.isArray(input?.groups) ? input.groups : [];
  scene.probes = (input?.probes?.length ? input.probes : baseScene().probes)
    .map((probe, index) => cleanProbe(probe, String(probe.id ?? `probe-${index + 1}`)));
  scene.variants = input?.variants && typeof input.variants === "object" ? input.variants : {};
  return scene;
}

export function applySceneOperation(inputScene, command) {
  let scene = normalizeScene(inputScene);
  const operation = command.op;
  let changed = {};

  if (operation === "reset" || operation === "preset") {
    const replacement = operation === "preset" ? presetScene(command.name) : createDefaultScene();
    replacement.revision = scene.revision;
    scene = replacement;
    changed = { replaced: true };
  } else if (operation === "add_loop") {
    const id = uniqueLoopId(scene, command.loop?.id);
    scene.loops.push(cleanLoop(command.loop ?? {}, id));
    scene.selectedLoopId = id;
    changed = { added: [id] };
  } else if (operation === "update_loop") {
    const loop = scene.loops.find((candidate) => candidate.id === command.loopId);
    if (!loop) throw new Error(`LOOP_NOT_FOUND: ${command.loopId}`);
    Object.assign(loop, cleanLoop({ ...loop, ...(command.patch ?? {}) }, loop.id));
    changed = { updated: [loop.id] };
  } else if (operation === "remove_loops") {
    const ids = new Set(command.loopIds ?? []);
    const before = scene.loops.length;
    scene.loops = scene.loops.filter((loop) => !ids.has(loop.id));
    scene.groups = scene.groups
      .map((group) => ({ ...group, loopIds: group.loopIds.filter((id) => !ids.has(id)) }))
      .filter((group) => group.loopIds.length);
    if (scene.selectedLoopId && ids.has(scene.selectedLoopId)) scene.selectedLoopId = scene.loops[0]?.id ?? null;
    changed = { removed: before - scene.loops.length };
  } else if (operation === "duplicate_loop") {
    const source = scene.loops.find((loop) => loop.id === command.loopId);
    if (!source) throw new Error(`LOOP_NOT_FOUND: ${command.loopId}`);
    const id = uniqueLoopId(scene, command.patch?.id);
    const duplicate = cleanLoop({ ...source, ...(command.patch ?? {}), name: command.patch?.name ?? `${source.name} copy` }, id);
    scene.loops.push(duplicate);
    scene.selectedLoopId = id;
    changed = { added: [id] };
  } else if (operation === "transform_loops") {
    const ids = new Set(command.loopIds ?? []);
    const translation = finiteVector(command.translation, [0, 0, 0]);
    const axis = normalize(finiteVector(command.rotation?.axis, [0, 1, 0]));
    const angle = Number(command.rotation?.angleDegrees ?? 0) * Math.PI / 180;
    const pivot = finiteVector(command.rotation?.pivot, [0, 0, 0]);
    const updated = [];
    for (const loop of scene.loops) {
      if (!ids.has(loop.id)) continue;
      if (Math.abs(angle) > 1e-9) {
        loop.center = add(pivot, rotateVector(sub(loop.center, pivot), axis, angle));
        loop.normal = normalize(rotateVector(loop.normal, axis, angle));
      }
      loop.center = add(loop.center, translation);
      updated.push(loop.id);
    }
    changed = { updated };
  } else if (operation === "create_solenoid") {
    const groupId = nextId(scene, "solenoid");
    const ids = addGeneratedLoops(scene, makeSolenoid({ ...(command.spec ?? {}), groupId, idPrefix: `${groupId}-w` }));
    scene.groups.push({ id: groupId, name: command.spec?.name ?? groupId, kind: "solenoid", loopIds: ids });
    changed = { added: ids, groupId };
  } else if (operation === "create_toroid") {
    const groupId = nextId(scene, "toroid");
    const ids = addGeneratedLoops(scene, makeToroid({ ...(command.spec ?? {}), groupId, idPrefix: `${groupId}-c` }));
    scene.groups.push({ id: groupId, name: command.spec?.name ?? groupId, kind: "toroid", loopIds: ids });
    changed = { added: ids, groupId };
  } else if (operation === "set_schedule") {
    const loopIds = new Set(command.loopIds ?? []);
    const groupIds = new Set(command.groupIds ?? []);
    const targets = scene.loops.filter((loop) => loopIds.has(loop.id) || (loop.groupId && groupIds.has(loop.groupId)));
    for (const [index, loop] of targets.entries()) {
      loop.schedule = cleanSchedule({ ...loop.schedule, ...(command.schedule ?? {}) });
      if (Number.isFinite(command.staggerDelay)) loop.schedule.delay += index * Number(command.staggerDelay);
    }
    changed = { updated: targets.map((loop) => loop.id) };
  } else if (operation === "select") {
    scene.selectedLoopId = command.loopId && scene.loops.some((loop) => loop.id === command.loopId) ? command.loopId : null;
    changed = { selected: scene.selectedLoopId };
  } else if (operation === "set_time") {
    scene.time = {
      start: Number(command.time?.start ?? scene.time.start),
      end: Math.max(Number(command.time?.start ?? scene.time.start) + 0.01, Number(command.time?.end ?? scene.time.end)),
      current: clamp(Number(command.time?.current ?? scene.time.current), Number(command.time?.start ?? scene.time.start), Number(command.time?.end ?? scene.time.end)),
    };
    changed = { time: scene.time };
  } else if (operation === "add_probe") {
    const id = nextId(scene, "probe");
    scene.probes.push(cleanProbe(command.probe ?? {}, id));
    changed = { addedProbe: id };
  } else if (operation === "update_probe") {
    const probe = scene.probes.find((candidate) => candidate.id === command.probeId);
    if (!probe) throw new Error(`PROBE_NOT_FOUND: ${command.probeId}`);
    Object.assign(probe, cleanProbe({ ...probe, ...(command.patch ?? {}) }, probe.id));
    changed = { updatedProbe: probe.id };
  } else if (operation === "merge_coincident") {
    changed = mergeCoincidentLoops(scene, command.saveAs);
  } else if (operation === "save_variant") {
    if (!command.name) throw new Error("VARIANT_NAME_REQUIRED");
    scene.variants[String(command.name)] = snapshot(scene);
    changed = { savedVariant: String(command.name) };
  } else if (operation === "restore_variant") {
    const saved = scene.variants[String(command.name)];
    if (!saved) throw new Error(`VARIANT_NOT_FOUND: ${command.name}`);
    Object.assign(scene, structuredClone(saved));
    changed = { restoredVariant: String(command.name) };
  } else {
    throw new Error(`UNKNOWN_OPERATION: ${operation}`);
  }

  return { scene, changed };
}
