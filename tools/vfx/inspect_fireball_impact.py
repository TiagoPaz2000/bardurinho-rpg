"""Native reopening, animation checks and review renders; never saves the blend."""
import json
import math
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'art/vfx/fireball-impact'
scene = bpy.context.scene
checks = {}


def check(name, ok, **details):
    checks[name] = {'status': 'PASS' if ok else 'FAIL', **details}


def value_at(socket, frame):
    scene.frame_set(frame)
    return socket.default_value


check('native_reopened', Path(bpy.data.filepath).name == 'fireball-impact.blend', blender=bpy.app.version_string)
check('duration_5_seconds', scene.frame_start == 1 and scene.frame_end == 120 and scene.render.fps == 24)
check('no_linked_libraries', not bpy.data.libraries)
images = [im for im in bpy.data.images if im.source == 'FILE']
check('all_reference_images_packed', bool(images) and all(im.packed_file for im in images))
nodes = bpy.data.materials['CHAO | raio animado + Noise 4D + erosao'].node_tree.nodes
radius = nodes['RAIO | expansao em unidades'].outputs[0]
erosion = nodes['EROSAO | buracos e ilhas finais'].outputs[0]
noise = nodes['MANCHAS | turbulencia 4D'].inputs['W']
radii = [value_at(radius, f) for f in (19, 23, 35, 43)]
check('radial_front_expands', radii[0] == 0 and all(a < b for a, b in zip(radii, radii[1:])), radii=radii)
check('texture_changes_during_expansion', abs(value_at(noise, 35) - value_at(noise, 23)) > 0.1)
check('ground_is_eroded_completely', value_at(erosion, 120) > 1)
patch = bpy.data.objects['Mancha de fogo | malha radial subdividida']
check('patch_is_not_only_a_scaling_disc', patch.animation_data is None and tuple(patch.scale) == (1, 1, 1))
flames = [obj for obj in scene.objects if obj.name.startswith('Chama ') and obj.data and hasattr(obj.data, 'shape_keys') and obj.data.shape_keys]
check('46_editable_shape_key_flames', len(flames) == 46 and all(len(obj.data.shape_keys.key_blocks) == 3 for obj in flames), count=len(flames))
scene.frame_set(43)
shape_values = [obj.data.shape_keys.key_blocks[1].value for obj in flames]
check('flames_do_not_sway_in_sync', max(shape_values) - min(shape_values) > 0.5)
root = bpy.data.objects['PROJETIL | queda e compressao no impacto']
scene.frame_set(9)
incoming = root.location.z
scene.frame_set(20)
impact = root.location.z
scene.frame_set(24)
check('projectile_falls_then_disappears', incoming > impact and max(abs(x) for x in root.scale) == 0)
scene.frame_set(120)
check('all_flames_end', all(max(abs(v) for v in obj.scale) == 0 for obj in flames))
spark_objects = [obj for obj in scene.objects if obj.name.startswith('Faisca ') and 'arco balistico' in obj.name]
check('all_64_sparks_end', len(spark_objects) == 64 and all(max(abs(v) for v in obj.scale) == 0 for obj in spark_objects))
smoke_mats = [mat for mat in bpy.data.materials if mat.name.startswith('FUMACA ') and 'opacidade animada' in mat.name]
check('all_25_smoke_clouds_fade', len(smoke_mats) == 25 and all(mat.node_tree.nodes['DISSIPACAO | opacidade'].inputs[0].default_value == 0 for mat in smoke_mats))
check('impact_light_ends', bpy.data.objects['Luz | clarão e fogo no piso'].data.energy == 0)
check('optical_glow', scene.compositing_node_group and any(n.bl_idname == 'CompositorNodeGlare' for n in scene.compositing_node_group.nodes))

# Scoped evaluated geometry check at the expanded pose. Deliberate sheet surfaces
# and zero world scale at birth/death are expected in this animation.
scene.frame_set(43)
depsgraph = bpy.context.evaluated_depsgraph_get()
triangles = 0
nonfinite = []
for obj in scene.objects:
    if obj.type != 'MESH':
        continue
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    mesh.calc_loop_triangles()
    triangles += len(mesh.loop_triangles)
    if any(not math.isfinite(value) for vertex in mesh.vertices for value in vertex.co):
        nonfinite.append(obj.name)
    evaluated.to_mesh_clear()
check('evaluated_geometry_finite', not nonfinite, bad_objects=nonfinite, evaluated_triangles=triangles)

# A substantive reversible edit: double spread radius without changing flame meshes.
before = [tuple(obj.scale) for obj in flames]
old_radius = radius.default_value
radius.default_value = old_radius * 1.1
bpy.context.view_layer.update()
check('ground_control_does_not_modify_flame_geometry', before == [tuple(obj.scale) for obj in flames])
radius.default_value = old_radius

report = {'source': bpy.data.filepath, 'profile': 'Editable native Blender VFX concept', 'checks': checks,
          'reference': 'User-supplied video, action condensed to 5 seconds',
          'game_runtime': 'NOT_CHECKED - no export or integration requested',
          'simulation_cache': 'Not required', 'third_party_plugins': 'Not required'}
(OUT / 'validation.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print('IMPACT_VALIDATION', json.dumps(report), flush=True)
if any(item['status'] == 'FAIL' for item in checks.values()):
    raise RuntimeError('Native impact validation failed; see validation.json')

scene.render.resolution_x, scene.render.resolution_y = 640, 360
scene.eevee.taa_render_samples = 8
frames = OUT / 'animation-frames'
frames.mkdir(exist_ok=True)
for index, frame in enumerate(range(1, 121, 2)):
    scene.frame_set(frame)
    for obj in scene.objects:
        if obj.type == 'MESH':
            obj.hide_render = max(abs(v) for v in obj.matrix_world.to_scale()) < 0.000001
    scene.render.filepath = str(frames / f'impact-{index:03d}.png')
    bpy.ops.render.render(write_still=True)
    print('REVIEW_FRAME', index, frame, flush=True)

# Actual overhead view of the spreading mask, with the overlaying smoke hidden.
scene.frame_set(55)
scene.camera = bpy.data.objects['Camera | TOPO - expansao radial']
scene.render.resolution_x, scene.render.resolution_y = 640, 640
for obj in scene.objects:
    if obj.name.startswith('Fumaca ') or obj.name.startswith('Chama '):
        obj.hide_render = True
scene.render.filepath = str(OUT / 'ground-spread-top.png')
bpy.ops.render.render(write_still=True)
print('IMPACT_INSPECTION_COMPLETE', flush=True)
