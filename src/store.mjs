import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applySceneOperation, createDefaultScene, normalizeScene } from "./scene.mjs";

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function statePaths(projectRoot) {
  const directory = join(projectRoot, ".field-gym");
  return {
    directory,
    scene: join(directory, "scene.json"),
    lock: join(directory, "scene.lock"),
  };
}

async function writeAtomic(path, value) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export async function readScene(projectRoot) {
  const paths = statePaths(projectRoot);
  await mkdir(paths.directory, { recursive: true });
  try {
    return normalizeScene(JSON.parse(await readFile(paths.scene, "utf8")));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const scene = createDefaultScene();
    await writeAtomic(paths.scene, scene);
    return scene;
  }
}

async function acquireLock(path, signal) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    signal?.throwIfAborted();
    try {
      return await open(path, "wx");
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      await wait(15 + Math.floor(Math.random() * 20));
    }
  }
  throw new Error("SCENE_LOCK_TIMEOUT");
}

export async function mutateScene(projectRoot, command, actor = "local", signal) {
  const paths = statePaths(projectRoot);
  await mkdir(paths.directory, { recursive: true });
  const lock = await acquireLock(paths.lock, signal);

  try {
    const current = await readScene(projectRoot);
    if (command.expectedRevision !== undefined && command.expectedRevision !== current.revision) {
      throw new Error(`REVISION_CONFLICT: expected ${command.expectedRevision}, current ${current.revision}`);
    }
    const { scene, changed } = applySceneOperation(current, command);
    scene.revision = current.revision + 1;
    scene.updatedAt = new Date().toISOString();
    scene.updatedBy = actor;
    await writeAtomic(paths.scene, scene);
    return { scene, changed };
  } finally {
    await lock.close();
    await unlink(paths.lock).catch(() => {});
  }
}
