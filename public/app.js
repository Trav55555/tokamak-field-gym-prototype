const $ = (selector) => document.querySelector(selector);
const elements = {
  connection: $("#connection"), canvas: $("#field-canvas"), canvasWrap: $("#canvas-wrap"),
  timelineCanvas: $("#timeline-canvas"), loopSelect: $("#loop-select"), sceneMeta: $("#scene-meta"),
  groupList: $("#group-list"), time: $("#time"), timeValue: $("#time-value"),
  timeStart: $("#time-start"), timeEnd: $("#time-end"), play: $("#play"),
};

const editorIds = ["loop-name", "center-x", "center-y", "center-z", "radius", "current", "tilt", "azimuth", "waveform", "delay", "period", "duty", "phase"];
const editor = Object.fromEntries(editorIds.map((id) => [id, $(`#${id}`)]));
const state = {
  scene: null,
  localTime: 0,
  traces: [],
  vectors: [],
  timeline: null,
  playing: false,
  lastFrame: performance.now(),
  lastSpatialRefresh: 0,
  spatialPending: false,
  camera: { yaw: -0.7, pitch: 0.42, distance: 9.5, target: [0, 0, 0] },
  drag: null,
};

const add = (a, b) => a.map((value, index) => value + b[index]);
const sub = (a, b) => a.map((value, index) => value - b[index]);
const scale = (vector, amount) => vector.map((value) => value * amount);
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (vector) => Math.hypot(...vector);
const normalize = (vector, fallback = [0, 1, 0]) => {
  const size = length(vector);
  return size > 1e-10 ? scale(vector, 1 / size) : [...fallback];
};
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

function setConnection(mode, text) {
  elements.connection.className = `connection ${mode}`;
  elements.connection.lastElementChild.textContent = text;
}

async function loadScene({ preserveTime = true } = {}) {
  try {
    const scene = await api("/api/scene");
    const firstLoad = !state.scene;
    if (state.scene?.revision === scene.revision) return;
    state.scene = scene;
    if (firstLoad || !preserveTime) state.localTime = scene.time.current;
    updateInterface();
    setConnection("online", `Scene r${scene.revision}`);
    await Promise.all([refreshSpatial(), refreshTimeline()]);
  } catch (error) {
    setConnection("error", error.message);
  }
}

async function operate(command, { recompute = true } = {}) {
  if (!state.scene) return;
  $("main").setAttribute("aria-busy", "true");
  setConnection("", "Updating scene");
  try {
    const result = await api("/api/scene", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...command, expectedRevision: state.scene.revision }),
    });
    state.scene = result.scene;
    state.localTime = clamp(state.localTime, state.scene.time.start, state.scene.time.end);
    updateInterface();
    setConnection("online", `Scene r${state.scene.revision}`);
    if (recompute) await Promise.all([refreshSpatial(), refreshTimeline()]);
    return result;
  } catch (error) {
    if (error.message.includes("REVISION_CONFLICT")) await loadScene();
    setConnection("error", error.message);
    throw error;
  } finally {
    $("main").setAttribute("aria-busy", "false");
  }
}

function currentMultiplier(schedule = {}, time = 0) {
  const delay = Number(schedule.delay ?? 0);
  if (time < delay) return 0;
  if (schedule.waveform === "dc" || !schedule.waveform) return 1;
  const period = Math.max(0.001, Number(schedule.period ?? 4));
  if (schedule.waveform === "ramp") return clamp((time - delay) / period, 0, 1);
  const cycle = (((time - delay) / period + Number(schedule.phase ?? 0)) % 1 + 1) % 1;
  if (schedule.waveform === "pulse") return cycle < Number(schedule.duty ?? 0.5) ? 1 : 0;
  if (schedule.waveform === "sine") return Math.sin(Math.PI * 2 * cycle);
  if (schedule.waveform === "triangle") return 1 - Math.abs(2 * cycle - 1);
  return 1;
}

function selectedLoop() {
  return state.scene?.loops.find((loop) => loop.id === state.scene.selectedLoopId) ?? null;
}

function normalToAngles(normal) {
  const unit = normalize(normal);
  return {
    tilt: Math.acos(clamp(unit[1], -1, 1)) * 180 / Math.PI,
    azimuth: Math.atan2(unit[2], unit[0]) * 180 / Math.PI,
  };
}

function anglesToNormal(tiltDegrees, azimuthDegrees) {
  const tilt = tiltDegrees * Math.PI / 180;
  const azimuth = azimuthDegrees * Math.PI / 180;
  return [Math.sin(tilt) * Math.cos(azimuth), Math.cos(tilt), Math.sin(tilt) * Math.sin(azimuth)];
}

function updateInterface() {
  const scene = state.scene;
  if (!scene) return;
  elements.sceneMeta.textContent = `${scene.loops.length} filaments · ${scene.groups.length} assemblies · revision ${scene.revision}`;
  elements.time.min = scene.time.start;
  elements.time.max = scene.time.end;
  elements.time.value = state.localTime;
  elements.timeStart.textContent = scene.time.start.toFixed(1);
  elements.timeEnd.textContent = scene.time.end.toFixed(1);
  elements.timeValue.textContent = state.localTime.toFixed(2);

  const currentSelection = scene.selectedLoopId;
  elements.loopSelect.replaceChildren(...scene.loops.map((loop) => {
    const option = document.createElement("option");
    option.value = loop.id;
    option.textContent = `${loop.name} · ${loop.current >= 0 ? "+" : "−"}${Math.abs(loop.current).toFixed(2)}`;
    option.selected = loop.id === currentSelection;
    return option;
  }));
  elements.loopSelect.disabled = scene.loops.length === 0;
  $("#delete-loop").disabled = !selectedLoop();
  $("#duplicate-loop").disabled = !selectedLoop();
  const selected = selectedLoop();
  $("#geometry-summary").textContent = scene.loops.length
    ? `${scene.loops.length} current filaments in ${scene.groups.length} assemblies. Selected ${selected?.name ?? "none"}. Simulation time ${state.localTime.toFixed(2)}.`
    : "The scene is empty. Use Add loop, Add solenoid, Add toroid, or Load geometry.";
  fillEditor(selected);
  renderGroups();
  drawScene();
}

function fillEditor(loop) {
  $("#loop-editor").hidden = !loop;
  if (!loop || editor["loop-name"].contains(document.activeElement)) return;
  const angles = normalToAngles(loop.normal);
  editor["loop-name"].value = loop.name;
  editor["center-x"].value = loop.center[0].toFixed(3);
  editor["center-y"].value = loop.center[1].toFixed(3);
  editor["center-z"].value = loop.center[2].toFixed(3);
  editor.radius.value = loop.radius.toFixed(3);
  editor.current.value = loop.current.toFixed(3);
  editor.tilt.value = angles.tilt.toFixed(2);
  editor.azimuth.value = angles.azimuth.toFixed(2);
  editor.waveform.value = loop.schedule.waveform;
  editor.delay.value = loop.schedule.delay;
  editor.period.value = loop.schedule.period;
  editor.duty.value = loop.schedule.duty;
  editor.phase.value = loop.schedule.phase;
}

function renderGroups() {
  elements.groupList.replaceChildren(...state.scene.groups.map((group) => {
    const row = document.createElement("div");
    row.className = "group-item";
    const copy = document.createElement("div");
    copy.innerHTML = `<strong>${escapeHtml(group.name)}</strong><span>${group.kind} · ${group.loopIds.length} filaments</span>`;
    const button = document.createElement("button");
    button.textContent = "Select";
    button.addEventListener("click", () => operate({ op: "select", loopId: group.loopIds[0] }, { recompute: false }));
    row.append(copy, button);
    return row;
  }));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
}

function editorPatch() {
  return {
    name: editor["loop-name"].value,
    center: [Number(editor["center-x"].value), Number(editor["center-y"].value), Number(editor["center-z"].value)],
    radius: Number(editor.radius.value),
    current: Number(editor.current.value),
    normal: anglesToNormal(Number(editor.tilt.value), Number(editor.azimuth.value)),
    schedule: {
      waveform: editor.waveform.value,
      delay: Number(editor.delay.value), period: Number(editor.period.value),
      duty: Number(editor.duty.value), phase: Number(editor.phase.value),
    },
  };
}

let editTimer;
function queueEditorUpdate() {
  clearTimeout(editTimer);
  editTimer = setTimeout(() => {
    const loop = selectedLoop();
    if (loop) operate({ op: "update_loop", loopId: loop.id, patch: editorPatch() });
  }, 140);
}

function cameraBasis() {
  const { yaw, pitch, distance, target } = state.camera;
  const camera = add(target, [distance * Math.cos(pitch) * Math.sin(yaw), distance * Math.sin(pitch), distance * Math.cos(pitch) * Math.cos(yaw)]);
  const forward = normalize(sub(target, camera), [0, 0, -1]);
  const right = normalize(cross(forward, [0, 1, 0]), [1, 0, 0]);
  const up = normalize(cross(right, forward), [0, 1, 0]);
  return { camera, forward, right, up };
}

function resizeCanvas(canvas) {
  const rectangle = canvas.getBoundingClientRect();
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rectangle.width * ratio));
  const height = Math.max(1, Math.round(rectangle.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, ratio };
}

function projector(canvas) {
  const { width, height } = resizeCanvas(canvas);
  const basis = cameraBasis();
  const focal = Math.min(width, height) * 0.9;
  return {
    ...basis, width, height,
    point(world) {
      const relative = sub(world, basis.camera);
      const depth = dot(relative, basis.forward);
      if (depth < 0.05) return null;
      return [width / 2 + dot(relative, basis.right) * focal / depth, height / 2 - dot(relative, basis.up) * focal / depth, depth];
    },
  };
}

function loopPoints(loop, count = 64) {
  const normal = normalize(loop.normal);
  const helper = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize(cross(helper, normal), [1, 0, 0]);
  const v = normalize(cross(normal, u), [0, 0, 1]);
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = index / count * Math.PI * 2;
    return add(loop.center, add(scale(u, Math.cos(angle) * loop.radius), scale(v, Math.sin(angle) * loop.radius)));
  });
}

function path(ctx, projection, points, color, width, alpha = 1) {
  ctx.beginPath();
  let started = false;
  for (const point of points) {
    const screen = projection.point(point);
    if (!screen) { started = false; continue; }
    if (!started) { ctx.moveTo(screen[0], screen[1]); started = true; }
    else ctx.lineTo(screen[0], screen[1]);
  }
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawScene() {
  const canvas = elements.canvas;
  const ctx = canvas.getContext("2d");
  const projection = projector(canvas);
  ctx.clearRect(0, 0, projection.width, projection.height);

  for (let index = -5; index <= 5; index += 1) {
    path(ctx, projection, [[-5, 0, index], [5, 0, index]], "#aab6b2", 1);
    path(ctx, projection, [[index, 0, -5], [index, 0, 5]], "#aab6b2", 1);
  }
  path(ctx, projection, [[-5, 0, 0], [5, 0, 0]], "#e33a20", 2);
  path(ctx, projection, [[0, -5, 0], [0, 5, 0]], "#152127", 2);
  path(ctx, projection, [[0, 0, -5], [0, 0, 5]], "#164bd6", 2);

  if ($("#show-traces").checked) {
    for (const trace of state.traces) path(ctx, projection, trace.points, "#00a89d", 1.6, 0.76);
  }
  if ($("#show-vectors").checked && state.vectors.length) {
    const maximum = Math.max(...state.vectors.map((sample) => sample.magnitude), 1e-9);
    for (const sample of state.vectors) {
      const direction = normalize(sample.field, [0, 0, 0]);
      const size = 0.12 + 0.42 * Math.sqrt(sample.magnitude / maximum);
      path(ctx, projection, [sample.point, add(sample.point, scale(direction, size))], "#164bd6", 1.4, 0.72);
    }
  }

  if (!(state.scene?.loops?.length)) {
    ctx.fillStyle = "#5c686c";
    ctx.font = `700 ${Math.round(16 * (window.devicePixelRatio || 1))}px Noto Sans`;
    ctx.textAlign = "center";
    ctx.fillText("Empty scene — add a loop or load a geometry", projection.width / 2, projection.height / 2);
    ctx.textAlign = "start";
  }

  const loops = [...(state.scene?.loops ?? [])].sort((a, b) => {
    const pa = projection.point(a.center); const pb = projection.point(b.center);
    return (pb?.[2] ?? 0) - (pa?.[2] ?? 0);
  });
  const groupsById = new Map((state.scene?.groups ?? []).map((group) => [group.id, group]));
  for (const loop of loops) {
    const multiplier = currentMultiplier(loop.schedule, state.localTime);
    const effective = loop.current * multiplier;
    const selected = loop.id === state.scene.selectedLoopId;
    const color = Math.abs(effective) < 1e-4 ? "#899395" : effective >= 0 ? "#164bd6" : "#e33a20";
    path(ctx, projection, loopPoints(loop), selected ? "#fffefa" : color, selected ? 7 : 3.2, Math.abs(effective) < 1e-4 ? 0.38 : 0.92);
    if (selected) path(ctx, projection, loopPoints(loop), color, 3, 1);
    const group = loop.groupId ? groupsById.get(loop.groupId) : null;
    const shouldLabel = !group || group.loopIds[0] === loop.id;
    if ($("#show-labels").checked && shouldLabel) {
      const screen = projection.point(loop.center);
      if (screen) {
        ctx.fillStyle = "#152127";
        ctx.font = `700 ${Math.round(11 * (window.devicePixelRatio || 1))}px Noto Sans`;
        ctx.fillText(group?.name ?? loop.name, screen[0] + 7, screen[1] - 7);
      }
    }
  }
}

async function refreshSpatial() {
  if (!state.scene || state.spatialPending) return;
  state.spatialPending = true;
  const status = $("#canvas-status");
  status.hidden = false;
  status.className = "canvas-status";
  status.textContent = "Computing field";
  try {
    const span = Math.min(5, Math.max(2.5, ...state.scene.loops.map((loop) => length(loop.center) + loop.radius)));
    const vectorPoints = [];
    for (let x = -3; x <= 3; x += 1) for (let z = -3; z <= 3; z += 1) vectorPoints.push([x * span / 3, 0, z * span / 3]);
    const seeds = [0.45, 0.85, 1.25, 1.8].flatMap((radius) => [[radius, 0, 0], [-radius, 0, 0], [0, 0, radius], [0, 0, -radius]]);
    const requests = [];
    requests.push(api("/api/compute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "sample", time: state.localTime, points: vectorPoints }) }));
    requests.push(api("/api/compute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "trace", time: state.localTime, seeds, options: { stepSize: 0.11, maxSteps: 150, bounds: span * 1.8 } }) }));
    const [vectors, traces] = await Promise.all(requests);
    state.vectors = vectors.samples;
    state.traces = traces.traces;
    drawScene();
  } catch (error) {
    setConnection("error", error.message);
    status.className = "canvas-status error";
    status.textContent = `Field error: ${error.message}`;
  } finally {
    state.spatialPending = false;
    if (!status.classList.contains("error")) status.hidden = true;
  }
}

async function refreshTimeline() {
  if (!state.scene) return;
  const button = $("#refresh-measurements");
  const status = $("#measurement-status");
  button.disabled = true;
  button.textContent = "Computing";
  status.classList.remove("error");
  status.textContent = "Computing full-scene probe timeline";
  try {
    const result = await api("/api/compute", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "timeline", start: state.scene.time.start, end: state.scene.time.end, steps: 120 }),
    });
    state.timeline = result;
    renderTimeline();
    status.textContent = "Full-scene timeline · average across active probes";
  } catch (error) {
    setConnection("error", error.message);
    status.classList.add("error");
    status.textContent = `Timeline error: ${error.message}. Recompute to retry.`;
  } finally { button.disabled = false; button.textContent = "Recompute"; }
}

function formatField(value) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 0.01)) return value.toExponential(2);
  return value.toFixed(3);
}

function renderTimeline() {
  const canvas = elements.timelineCanvas;
  const ctx = canvas.getContext("2d");
  const { width, height } = resizeCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  if (!state.timeline?.samples?.length) return;
  const samples = state.timeline.samples;
  const padding = 12 * (window.devicePixelRatio || 1);
  const magnitudes = samples.map((sample) => sample.magnitude);
  const projections = samples.map((sample) => sample.projection);
  const maximum = Math.max(...magnitudes.map(Math.abs), ...projections.map(Math.abs), 1e-9);
  const x = (index) => padding + index / (samples.length - 1) * (width - padding * 2);
  const y = (value) => height / 2 - value / maximum * (height / 2 - padding);
  ctx.strokeStyle = "#b9c2c0"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(padding, height / 2); ctx.lineTo(width - padding, height / 2); ctx.stroke();
  const plot = (values, color, lineWidth) => {
    ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.beginPath();
    values.forEach((value, index) => index ? ctx.lineTo(x(index), y(value)) : ctx.moveTo(x(index), y(value)));
    ctx.stroke();
  };
  plot(magnitudes, "#164bd6", 3);
  plot(projections, "#e33a20", 2);
  const start = samples[0].time;
  const end = samples[samples.length - 1].time;
  const markerX = padding + clamp((state.localTime - start) / Math.max(1e-9, end - start), 0, 1) * (width - padding * 2);
  ctx.strokeStyle = "#152127"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(markerX, padding); ctx.lineTo(markerX, height - padding); ctx.stroke(); ctx.setLineDash([]);
  const metrics = state.timeline.metrics;
  $("#mean-field").textContent = formatField(metrics.meanMagnitude);
  $("#min-field").textContent = formatField(metrics.minMagnitude);
  $("#ripple").textContent = `${(metrics.magnitudeRipple * 100).toFixed(1)}%`;
  $("#dropout").textContent = `${(metrics.dropoutFraction * 100).toFixed(1)}%`;
  $("#direction").textContent = metrics.projectionReversed ? "Reverses" : "Maintained";
  $("#direction").style.color = metrics.projectionReversed ? "#e33a20" : "#06766f";
}

function togglePlay() {
  state.playing = !state.playing;
  elements.play.classList.toggle("playing", state.playing);
  elements.play.querySelector("span").textContent = state.playing ? "Pause" : "Play";
  elements.play.querySelector("svg").innerHTML = state.playing ? '<path d="M5 3h3.5v14H5zm6.5 0H15v14h-3.5z"/>' : '<path d="M6 3.5 16 10 6 16.5Z"/>';
  state.lastFrame = performance.now();
}

function animationFrame(now) {
  if (state.playing && state.scene) {
    const delta = Math.min(0.1, (now - state.lastFrame) / 1000);
    state.localTime += delta;
    if (state.localTime > state.scene.time.end) state.localTime = state.scene.time.start;
    elements.time.value = state.localTime;
    elements.timeValue.textContent = state.localTime.toFixed(2);
    drawScene();
    renderTimeline();
    if (now - state.lastSpatialRefresh > 180) {
      state.lastSpatialRefresh = now;
      refreshSpatial();
    }
  }
  state.lastFrame = now;
  requestAnimationFrame(animationFrame);
}

editorIds.forEach((id) => editor[id].addEventListener("change", queueEditorUpdate));
elements.loopSelect.addEventListener("change", () => operate({ op: "select", loopId: elements.loopSelect.value }, { recompute: false }));
$("#load-preset").addEventListener("click", () => operate({ op: "preset", name: $("#preset").value }));
$("#add-loop").addEventListener("click", () => operate({ op: "add_loop", loop: { name: "New loop", center: [0, 0, 0], normal: [0, 1, 0], radius: 1, current: 1 } }));
$("#add-solenoid").addEventListener("click", () => operate({ op: "create_solenoid", spec: { name: "Added solenoid", center: [0, 0, 0], axis: [0, 1, 0], radius: 1.3, length: 1.5, windings: 7, current: 1 } }));
$("#add-toroid").addEventListener("click", () => operate({ op: "create_toroid", spec: { name: "Added toroid", center: [0, 0, 0], axis: [0, 1, 0], majorRadius: 2, minorRadius: 0.65, coils: 10, current: 1 } }));
$("#delete-loop").addEventListener("click", () => selectedLoop() && operate({ op: "remove_loops", loopIds: [selectedLoop().id] }));
$("#duplicate-loop").addEventListener("click", () => selectedLoop() && operate({ op: "duplicate_loop", loopId: selectedLoop().id, patch: { center: add(selectedLoop().center, [0, 0.35, 0]) } }));
$("#apply-group").addEventListener("click", () => {
  const loop = selectedLoop();
  if (loop?.groupId) operate({ op: "set_schedule", groupIds: [loop.groupId], schedule: editorPatch().schedule });
});
$("#refresh-measurements").addEventListener("click", refreshTimeline);
elements.play.addEventListener("click", togglePlay);
elements.time.addEventListener("input", () => {
  state.localTime = Number(elements.time.value);
  elements.timeValue.textContent = state.localTime.toFixed(2);
  drawScene();
  renderTimeline();
});
elements.time.addEventListener("change", refreshSpatial);
["show-vectors", "show-traces", "show-labels"].forEach((id) => $(`#${id}`).addEventListener("change", drawScene));

elements.canvas.addEventListener("pointerdown", (event) => {
  elements.canvas.setPointerCapture(event.pointerId);
  state.drag = { x: event.clientX, y: event.clientY, yaw: state.camera.yaw, pitch: state.camera.pitch, movingLoop: event.shiftKey && selectedLoop(), originalCenter: selectedLoop()?.center.slice() };
});
elements.canvas.addEventListener("pointermove", (event) => {
  if (!state.drag) return;
  const dx = event.clientX - state.drag.x;
  const dy = event.clientY - state.drag.y;
  if (state.drag.movingLoop) {
    const basis = cameraBasis();
    state.drag.movingLoop.center = add(state.drag.originalCenter, add(scale(basis.right, dx * state.camera.distance / 650), scale(basis.up, -dy * state.camera.distance / 650)));
  } else {
    state.camera.yaw = state.drag.yaw - dx * 0.008;
    state.camera.pitch = clamp(state.drag.pitch + dy * 0.008, -1.45, 1.45);
  }
  drawScene();
});
elements.canvas.addEventListener("pointerup", async () => {
  if (state.drag?.movingLoop) {
    const loop = state.drag.movingLoop;
    await operate({ op: "update_loop", loopId: loop.id, patch: { center: loop.center } });
  }
  state.drag = null;
});
elements.canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  state.camera.distance = clamp(state.camera.distance * Math.exp(event.deltaY * 0.001), 2, 35);
  drawScene();
}, { passive: false });
elements.canvas.addEventListener("keydown", (event) => {
  const handled = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-"].includes(event.key);
  if (!handled) return;
  event.preventDefault();
  if (event.key === "ArrowLeft") state.camera.yaw += 0.1;
  if (event.key === "ArrowRight") state.camera.yaw -= 0.1;
  if (event.key === "ArrowUp") state.camera.pitch = clamp(state.camera.pitch - 0.1, -1.45, 1.45);
  if (event.key === "ArrowDown") state.camera.pitch = clamp(state.camera.pitch + 0.1, -1.45, 1.45);
  if (event.key === "+" || event.key === "=") state.camera.distance = clamp(state.camera.distance * 0.9, 2, 35);
  if (event.key === "-") state.camera.distance = clamp(state.camera.distance * 1.1, 2, 35);
  drawScene();
});

new ResizeObserver(() => { drawScene(); renderTimeline(); }).observe(document.body);
setInterval(() => loadScene(), 1200);
requestAnimationFrame(animationFrame);
loadScene({ preserveTime: false });
