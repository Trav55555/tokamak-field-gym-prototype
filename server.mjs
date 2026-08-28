import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateTimeline } from "./src/sim.mjs";
import { loadEngine, samplesFromFields } from "./src/engine.mjs";
import { mutateScene, readScene } from "./src/store.mjs";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = join(projectRoot, "public");
const port = Number(process.env.PORT ?? 4317);
const engine = await loadEngine(projectRoot);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(value)}\n`);
}

async function bodyJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("REQUEST_TOO_LARGE");
  }
  return body ? JSON.parse(body) : {};
}

function sceneForVariant(scene, name) {
  if (!name || name === "current") return scene;
  const saved = scene.variants?.[name];
  if (!saved) throw new Error(`VARIANT_NOT_FOUND: ${name}`);
  return { ...scene, ...structuredClone(saved) };
}

async function compute(scene, input) {
  const action = input.action ?? "sample";
  const time = Number(input.time ?? scene.time?.current ?? 0);
  const model = {
    qualitative: true,
    units: "normalized",
    method: "analytic circular current filaments",
    engine: engine.kind,
    excludes: ["plasma response", "MHD equilibrium", "materials", "thermal and structural limits"],
  };

  if (action === "sample") {
    const points = Array.isArray(input.points) ? input.points.slice(0, 512) : [[0, 0, 0]];
    const fields = engine.fields(scene, points, time, input.options);
    return { model, revision: scene.revision, time, samples: samplesFromFields(points, fields) };
  }
  if (action === "trace") {
    const seeds = Array.isArray(input.seeds) ? input.seeds.slice(0, 16) : [[1, 0, 0]];
    return {
      model,
      revision: scene.revision,
      time,
      traces: seeds.map((seed) => ({ seed, ...engine.trace(scene, seed, time, input.options ?? {}) })),
    };
  }
  if (action === "timeline") {
    const result = evaluateTimeline(scene, input, (sourceScene, points, sampleTime, options) => engine.fields(sourceScene, points, sampleTime, options));
    return { model, revision: scene.revision, ...result };
  }
  if (action === "compare") {
    const left = sceneForVariant(scene, input.left ?? "current");
    const right = sceneForVariant(scene, input.right ?? "current");
    const evaluator = (sourceScene, points, sampleTime, options) => engine.fields(sourceScene, points, sampleTime, options);
    const leftResult = evaluateTimeline(left, input, evaluator);
    const rightResult = evaluateTimeline(right, input, evaluator);
    return {
      model,
      revision: scene.revision,
      left: { name: input.left ?? "current", metrics: leftResult.metrics },
      right: { name: input.right ?? "current", metrics: rightResult.metrics },
      delta: {
        meanMagnitude: rightResult.metrics.meanMagnitude - leftResult.metrics.meanMagnitude,
        magnitudeRipple: rightResult.metrics.magnitudeRipple - leftResult.metrics.magnitudeRipple,
        dropoutFraction: rightResult.metrics.dropoutFraction - leftResult.metrics.dropoutFraction,
      },
    };
  }
  throw new Error(`UNKNOWN_COMPUTE_ACTION: ${action}`);
}

async function serveStatic(request, response) {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const safePath = normalize(relative).replace(/^(\.\.(\/|\\|$))+/, "");
  const path = join(publicRoot, safePath);
  if (!path.startsWith(publicRoot)) return false;
  try {
    const info = await stat(path);
    if (!info.isFile()) return false;
    response.writeHead(200, {
      "content-type": MIME[extname(path)] ?? "application/octet-stream",
      "cache-control": "no-cache",
    });
    createReadStream(path).pipe(response);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === "GET" && url.pathname === "/api/scene") {
      return sendJson(response, 200, await readScene(projectRoot));
    }
    if (request.method === "POST" && url.pathname === "/api/scene") {
      const command = await bodyJson(request);
      const result = await mutateScene(projectRoot, command, "browser", AbortSignal.timeout(5000));
      return sendJson(response, 200, result);
    }
    if (request.method === "POST" && url.pathname === "/api/compute") {
      const input = await bodyJson(request);
      return sendJson(response, 200, await compute(await readScene(projectRoot), input));
    }
    if (request.method === "GET" && await serveStatic(request, response)) return;
    sendJson(response, 404, { error: "NOT_FOUND" });
  } catch (error) {
    const conflict = String(error.message).startsWith("REVISION_CONFLICT");
    sendJson(response, conflict ? 409 : 400, { error: error.message });
  }
});

await readScene(projectRoot);
server.listen(port, "127.0.0.1", () => {
  console.log(`Field Gym running at http://127.0.0.1:${port}`);
});
