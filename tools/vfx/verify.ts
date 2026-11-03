/** Validate actual exported geometry and Babylon loading without a GPU. */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { NullEngine, Scene, LoadAssetContainerAsync, FreeCamera, Vector3 } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { abilities, items } from '@bardurinho/content';
import { animateVfx } from '../../apps/web/src/rendering/vfx.js';

const manifest = JSON.parse(readFileSync('assets/models/vfx/manifest.json', 'utf8')) as Record<string, { path: string }>;
for (const definition of [...abilities, ...items]) {
  if ('presentation' in definition && definition.presentation?.vfxId) {
    assert(manifest[definition.presentation.vfxId], `Missing ${definition.id}`);
  }
}
const engine = new NullEngine();
const scene = new Scene(engine);
scene.useRightHandedSystem = true;
new FreeCamera('test', new Vector3(0, 0, -10), scene);
let meshes = 0;
for (const [id, entry] of Object.entries(manifest)) {
  const bytes = readFileSync(`assets/${entry.path}`);
  const container = await LoadAssetContainerAsync(new Uint8Array(bytes), scene, { pluginExtension: '.glb' });
  assert(container.meshes.some(m => m.getTotalVertices() > 0), `${id}: empty GLB`);
  const instance = container.instantiateModelsToScene(n => `test:${n}`, false);
  meshes += container.meshes.length;
  instance.dispose();
  container.dispose();
}
assert.equal(scene.meshes.length, 0, 'All spawned meshes must be disposed');
const observers = scene.onBeforeRenderObservable.observers.length;
let lastProgress = -1;
engine.getDeltaTime = () => 16;
const completed = animateVfx(scene, .48, t => { lastProgress = t; });
for (let i = 0; i < 40; i++) scene.render();
await completed;
assert.equal(lastProgress, 1, 'Animation must reach its final frame');
// Babylon defers observable removal until the end of the current task.
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(scene.onBeforeRenderObservable.observers.length, observers, 'No frame observer leak');
const animation = animateVfx(scene, 10, () => {});
scene.dispose();
await animation;
engine.dispose();
console.log(`PASS: ${Object.keys(manifest).length} GLBs loaded in Babylon (${meshes} meshes); catalog coverage; disposal; animation cancellation.`);
