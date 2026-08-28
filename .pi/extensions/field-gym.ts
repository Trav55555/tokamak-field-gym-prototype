import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fileURLToPath } from "node:url";
import { evaluateTimeline } from "../../src/sim.mjs";
import { loadEngine, samplesFromFields } from "../../src/engine.mjs";
import { mutateScene, readScene } from "../../src/store.mjs";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const Vec3 = Type.Array(Type.Number(), { minItems: 3, maxItems: 3, description: "[x,y,z] in normalized right-handed coordinates; +y is vertical" });
const Schedule = Type.Object({
  waveform: Type.Optional(StringEnum(["dc", "pulse", "ramp", "sine", "triangle"] as const)),
  delay: Type.Optional(Type.Number()),
  period: Type.Optional(Type.Number({ minimum: 0.05 })),
  duty: Type.Optional(Type.Number({ minimum: 0.01, maximum: 1 })),
  phase: Type.Optional(Type.Number()),
});

function sceneSummary(scene: any) {
  return {
    revision: scene.revision,
    updatedBy: scene.updatedBy,
    time: scene.time,
    selectedLoopId: scene.selectedLoopId,
    loops: scene.loops.map((loop: any) => ({
      id: loop.id, name: loop.name, groupId: loop.groupId, center: loop.center, normal: loop.normal,
      radius: loop.radius, current: loop.current, schedule: loop.schedule, visible: loop.visible,
    })),
    groups: scene.groups,
    probes: scene.probes,
    variants: Object.keys(scene.variants ?? {}),
    model: "Qualitative normalized vacuum field; no plasma, material, force, thermal, or structural model.",
  };
}

export default async function fieldGymExtension(pi: ExtensionAPI) {
  const engine = await loadEngine(projectRoot);

  pi.registerTool({
    name: "field_scene",
    label: "Field Scene",
    description: "Inspect or atomically mutate the shared Field Gym geometry. Supports loops, solenoids, crude toroidal coil assemblies, transforms, activation schedules, probes, presets, and variants. Mutations update the browser automatically. Use stable IDs from inspect results. All units are normalized.",
    promptSnippet: "Inspect and edit the shared 3D magnetic geometry and activation schedule",
    promptGuidelines: [
      "Use field_scene for Field Gym geometry instead of editing .field-gym/scene.json directly.",
      "Call field_scene with op=inspect before destructive or revision-sensitive geometry changes.",
      "Treat Field Gym results as qualitative vacuum-field experiments, not reactor or plasma engineering conclusions.",
    ],
    parameters: Type.Object({
      op: StringEnum(["inspect", "preset", "reset", "add_loop", "update_loop", "remove_loops", "duplicate_loop", "transform_loops", "create_solenoid", "create_toroid", "set_schedule", "select", "set_time", "add_probe", "update_probe", "merge_coincident", "save_variant", "restore_variant"] as const),
      expectedRevision: Type.Optional(Type.Integer({ minimum: 0, description: "Reject mutation if current scene revision differs" })),
      detail: Type.Optional(StringEnum(["summary", "full"] as const)),
      name: Type.Optional(Type.String({ description: "Preset or variant name" })),
      saveAs: Type.Optional(Type.String({ description: "Variant name used to back up a scene before merge_coincident" })),
      loopId: Type.Optional(Type.String()),
      loopIds: Type.Optional(Type.Array(Type.String(), { maxItems: 256 })),
      groupIds: Type.Optional(Type.Array(Type.String(), { maxItems: 128 })),
      loop: Type.Optional(Type.Object({
        id: Type.Optional(Type.String()), name: Type.Optional(Type.String()), center: Type.Optional(Vec3), normal: Type.Optional(Vec3),
        radius: Type.Optional(Type.Number({ minimum: 0.05, maximum: 20 })), current: Type.Optional(Type.Number({ minimum: -100, maximum: 100 })),
        role: Type.Optional(StringEnum(["drive", "plasma", "probe"] as const)), schedule: Type.Optional(Schedule),
      })),
      patch: Type.Optional(Type.Any({ description: "Partial loop or probe properties" })),
      spec: Type.Optional(Type.Any({ description: "Solenoid: center,axis,radius,length,windings,current,schedule,windingStagger. Toroid: center,axis,majorRadius,minorRadius,coils,current,schedule,coilStagger." })),
      schedule: Type.Optional(Schedule),
      staggerDelay: Type.Optional(Type.Number()),
      translation: Type.Optional(Vec3),
      rotation: Type.Optional(Type.Object({ axis: Vec3, angleDegrees: Type.Number(), pivot: Type.Optional(Vec3) })),
      time: Type.Optional(Type.Object({ start: Type.Optional(Type.Number()), end: Type.Optional(Type.Number()), current: Type.Optional(Type.Number()) })),
      probe: Type.Optional(Type.Object({ name: Type.Optional(Type.String()), position: Vec3, targetDirection: Type.Optional(Vec3) })),
      probeId: Type.Optional(Type.String()),
    }),
    async execute(_id, params, signal) {
      if (params.op === "inspect") {
        const scene = await readScene(projectRoot);
        const value = params.detail === "full" ? scene : sceneSummary(scene);
        return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], details: { scene: value, engine: engine.kind } };
      }
      const { detail: _detail, ...command } = params;
      const actor = `pi:${process.env.PI_SESSION_ID ?? "session"}`;
      const result = await mutateScene(projectRoot, command, actor, signal);
      const summary = { changed: result.changed, scene: sceneSummary(result.scene), engine: engine.kind };
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }], details: summary };
    },
  });

  pi.registerTool({
    name: "field_compute",
    label: "Field Compute",
    description: "Evaluate the current or saved Field Gym scene with the Magba Rust/WASM analytic circular-loop kernel. Sample points, trace field lines, evaluate field continuity over time, or compare saved variants. Outputs normalized qualitative fields and bounded results.",
    promptSnippet: "Sample, trace, or compare time-dependent fields in the shared Field Gym scene",
    promptGuidelines: [
      "Use field_compute action=timeline to test whether staggered activations maintain field magnitude and target-axis direction.",
      "Do not interpret field_compute schedules as circuit-achievable until resistance, mutual inductance, voltage, and induced-current constraints are modeled.",
    ],
    parameters: Type.Object({
      action: StringEnum(["sample", "trace", "timeline", "compare"] as const),
      time: Type.Optional(Type.Number()),
      points: Type.Optional(Type.Array(Vec3, { maxItems: 512 })),
      seeds: Type.Optional(Type.Array(Vec3, { maxItems: 16 })),
      probes: Type.Optional(Type.Array(Type.Object({ point: Vec3, targetDirection: Type.Optional(Vec3) }), { maxItems: 32 })),
      start: Type.Optional(Type.Number()), end: Type.Optional(Type.Number()),
      steps: Type.Optional(Type.Integer({ minimum: 2, maximum: 400 })),
      dropoutThreshold: Type.Optional(Type.Number({ minimum: 0 })),
      left: Type.Optional(Type.String({ description: "Saved variant name or current" })),
      right: Type.Optional(Type.String({ description: "Saved variant name or current" })),
      options: Type.Optional(Type.Object({
        softening: Type.Optional(Type.Number({ minimum: 0.000001 })),
        stepSize: Type.Optional(Type.Number({ minimum: 0.005, maximum: 0.5 })),
        maxSteps: Type.Optional(Type.Integer({ minimum: 8, maximum: 1200 })),
        bounds: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
        direction: Type.Optional(StringEnum(["forward", "backward", "both"] as const)),
      })),
    }),
    async execute(_id, params) {
      const scene = await readScene(projectRoot);
      const notice = { engine: engine.kind, units: "normalized", qualitative: true, excludes: ["circuit feasibility", "plasma response", "MHD equilibrium", "materials", "forces", "thermal limits"] };
      const evaluator = (source: any, points: number[][], time: number, options: any) => engine.fields(source, points, time, options);

      if (params.action === "sample") {
        const points = params.points?.length ? params.points : [[0, 0, 0]];
        const fields = engine.fields(scene, points, params.time ?? scene.time.current, params.options ?? {});
        const result = { notice, revision: scene.revision, time: params.time ?? scene.time.current, samples: samplesFromFields(points, fields) };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      }
      if (params.action === "trace") {
        const seeds = params.seeds?.length ? params.seeds : [[1, 0, 0]];
        const traces = seeds.map((seed: number[]) => {
          const trace = engine.trace(scene, seed, params.time ?? scene.time.current, params.options ?? {});
          const stride = Math.max(1, Math.ceil(trace.points.length / 220));
          return { seed, terminatedBy: trace.terminatedBy, points: trace.points.filter((_: unknown, index: number) => index % stride === 0) };
        });
        const result = { notice, revision: scene.revision, traces };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      }
      const timelineInput = { ...params, ...(params.options ?? {}) };
      if (params.action === "timeline") {
        const result = { notice, revision: scene.revision, ...evaluateTimeline(scene, timelineInput, evaluator) };
        return { content: [{ type: "text", text: JSON.stringify({ ...result, samples: result.samples.map(({ points: _points, ...sample }: any) => sample) }, null, 2) }], details: result };
      }
      const resolve = (name = "current") => name === "current" ? scene : ({ ...scene, ...structuredClone(scene.variants?.[name] ?? (() => { throw new Error(`VARIANT_NOT_FOUND: ${name}`); })()) });
      const left = evaluateTimeline(resolve(params.left), timelineInput, evaluator);
      const right = evaluateTimeline(resolve(params.right), timelineInput, evaluator);
      const result = {
        notice, revision: scene.revision,
        left: { name: params.left ?? "current", metrics: left.metrics },
        right: { name: params.right ?? "current", metrics: right.metrics },
        delta: {
          meanMagnitude: right.metrics.meanMagnitude - left.metrics.meanMagnitude,
          magnitudeRipple: right.metrics.magnitudeRipple - left.metrics.magnitudeRipple,
          dropoutFraction: right.metrics.dropoutFraction - left.metrics.dropoutFraction,
        },
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    },
  });

  pi.registerCommand("field-gym", {
    description: "Show Field Gym status and launch instructions",
    handler: async (_args, ctx) => {
      const scene = await readScene(projectRoot);
      ctx.ui.notify(`Field Gym r${scene.revision} · ${scene.loops.length} loops · ${engine.kind}. Run npm start and open http://127.0.0.1:4317`, "info");
    },
  });
}
