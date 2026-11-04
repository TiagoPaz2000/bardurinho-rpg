"""Export the runtime projectile of the Mage's Bola de fogo from the editable concept.

Blender --background art/vfx/fireball/fireball-stylized.blend --disable-autoexec
--python tools/vfx/export_fireball_glb.py

Takes the core, flame tongues, crescent rims and sparks (frame 1, modifiers applied),
skips smoke (the game tints every VFX mesh with one unlit colour), turns the effect so its
head points to glTF +Z (the projectile's front, like build.py), centres the core on the
origin, scales it to ~0.75 m, decimates it to the effect triangle budget and writes
assets/models/vfx/projectile.fireball.glb plus its manifest entry. Never saves the .blend.
"""
import json
from pathlib import Path

import bpy
from mathutils import Matrix

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets/models/vfx'
ID = 'projectile.fireball'
COLOR = '#ff5a12'
LENGTH = 0.75
TRIANGLE_BUDGET = 1400  # tools/perf/assets.ts: efeitos ~1 500 triângulos
KEEP = ('Nucleo', 'Chama', 'Fluxo', 'Borda', 'Fragmento', 'Faisca')

scene = bpy.context.scene
scene.frame_set(1)
depsgraph = bpy.context.evaluated_depsgraph_get()
sources = [o for o in scene.objects if o.type == 'MESH' and o.name.startswith(KEEP) and not o.hide_render]
assert sources, 'fireball meshes not found'

mesh = bpy.data.meshes.new(ID)
verts, faces = [], []
for obj in sources:
    evaluated = obj.evaluated_get(depsgraph)
    data = evaluated.to_mesh()
    base = len(verts)
    verts += [obj.matrix_world @ v.co for v in data.vertices]
    faces += [[base + i for i in p.vertices] for p in data.polygons]
    evaluated.to_mesh_clear()
mesh.from_pydata(verts, [], faces)
mesh.update()

core = bpy.data.objects['Nucleo | volume luminoso irregular'].matrix_world.translation.copy()
xs = [v.x for v in verts]
scale = LENGTH / (max(xs) - min(xs))
# Head along Blender +X -> -Y (glTF +Z after the exporter's Y-up conversion).
mesh.transform(Matrix.Rotation(-1.5707963267948966, 4, 'Z') @ Matrix.Scale(scale, 4) @ Matrix.Translation(-core))

for obj in list(scene.objects):
    obj.select_set(False)
out_obj = bpy.data.objects.new(ID, mesh)
scene.collection.objects.link(out_obj)
material = bpy.data.materials.new(ID)
mesh.materials.append(material)
out_obj.select_set(True)
bpy.context.view_layer.objects.active = out_obj
# Collapse decimation down to the runtime triangle budget (silhouette only; one unlit colour).
mesh.calc_loop_triangles()
decimate = out_obj.modifiers.new('budget', 'DECIMATE')
decimate.ratio = min(1.0, TRIANGLE_BUDGET / len(mesh.loop_triangles))
bpy.ops.object.modifier_apply(modifier=decimate.name)
mesh.calc_loop_triangles()
triangles = len(mesh.loop_triangles)
assert 0 < triangles <= TRIANGLE_BUDGET + 50, triangles
bpy.ops.export_scene.gltf(filepath=str(OUT / f'{ID}.glb'), use_selection=True, export_format='GLB',
                          export_animations=False, export_extras=False)

manifest_path = OUT / 'manifest.json'
manifest = json.loads(manifest_path.read_text())
manifest[ID] = {'path': f'models/vfx/{ID}.glb', 'shape': 'fireball', 'color': COLOR}
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
print('FIREBALL_GLB', triangles, 'triangles', f'scale={scale:.4f}', flush=True)
