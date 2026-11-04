"""Reopen validation and real Blender diagnostic renders for the fireball.

Run Blender --background art/vfx/fireball/fireball-stylized.blend
--disable-autoexec --python-exit-code 1 --python tools/vfx/inspect_fireball.py.
This does not save changes to the source blend.
"""

import json
from pathlib import Path

import bpy
from mathutils import Vector


OUT = Path(__file__).resolve().parents[2] / "art/vfx/fireball"
scene = bpy.context.scene
meshes = [obj for obj in scene.objects if obj.type == "MESH"]
original_frame = scene.frame_current
root = bpy.data.objects["FIREBALL | mover e escalar o efeito inteiro"]
core = bpy.data.objects["Nucleo | volume luminoso irregular"]
checks = {}


def check(name, condition, **details):
    checks[name] = {"status": "PASS" if condition else "FAIL", **details}


def state_at(frame):
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    return {obj.name: [value for row in obj.matrix_world for value in row] for obj in scene.objects}


start, repeat = state_at(1), state_at(49)
loop_error = max(abs(a - b) for name in start for a, b in zip(start[name], repeat[name]))
check("loop_geometry_1_equals_49", loop_error < 0.00001, max_matrix_delta=loop_error)
quarter = state_at(13)
motion = max(abs(a - b) for name in start for a, b in zip(start[name], quarter[name]))
check("animation_changes_geometry", motion > 0.05, max_matrix_delta=motion)
check("timeline", scene.frame_start == 1 and scene.frame_end == 48 and scene.render.fps == 24)
check("native_reopen", Path(bpy.data.filepath).name == "fireball-stylized.blend", blender=bpy.app.version_string)
check("no_linked_libraries", len(bpy.data.libraries) == 0)
images = [im for im in bpy.data.images if im.source == "FILE"]
check("images_packed", bool(images) and all(im.packed_file for im in images), image_names=[im.name for im in images])
check("procedural_fire_material", any(n.bl_idname == "ShaderNodeTexNoise" for n in core.active_material.node_tree.nodes))
live_subdivision = [ob.name for ob in meshes if any(mod.type == "SUBSURF" for mod in ob.modifiers)]
check("editable_flame_sections", len(live_subdivision) == 6, object_names=live_subdivision)
check("glow_compositor", bool(scene.compositing_node_group) and len([n for n in scene.compositing_node_group.nodes if n.bl_idname == "CompositorNodeGlare"]) == 2)

scene.frame_set(13)
depsgraph = bpy.context.evaluated_depsgraph_get()
vertices, triangles, min_area, bad = 0, 0, float("inf"), []
positions = []
for obj in meshes:
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    mesh.calc_loop_triangles()
    vertices += len(mesh.vertices)
    triangles += len(mesh.loop_triangles)
    for tri in mesh.loop_triangles:
        a, b, c = [mesh.vertices[index].co for index in tri.vertices]
        area = (b - a).cross(c - a).length * 0.5
        min_area = min(min_area, area)
        if area < 1e-12:
            bad.append(obj.name)
    positions.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    evaluated.to_mesh_clear()
check("no_zero_area_triangles", not bad, affected_objects=sorted(set(bad)), local_area_threshold=1e-12)
dimensions = [max(v[i] for v in positions) - min(v[i] for v in positions) for i in range(3)]
check("genuine_three_dimensional_volume", dimensions[1] > 1.0, evaluated_bounds_xyz=dimensions)

# A reversible edit proves that the core can change without modifying the tail.
tail = bpy.data.objects["Fumaca 06 | massa"]
tail_before = tail.matrix_world.copy()
core_before = core.scale.copy()
core.scale *= 1.1
bpy.context.view_layer.update()
edit_error = max(abs(a - b) for a_row, b_row in zip(tail_before, tail.matrix_world) for a, b in zip(a_row, b_row))
check("core_edit_keeps_tail_unchanged", edit_error < 1e-7 and core.scale.x > core_before.x * 1.09)
core.scale = core_before
bpy.context.view_layer.update()

# Pattern coordinates follow the editable root, so moving the effect is safe.
smoke_mat = bpy.data.materials["SMOKE | charcoal cooling to embers near core"]
coords = next(n for n in smoke_mat.node_tree.nodes if n.bl_idname == "ShaderNodeTexCoord")
check("smoke_material_follows_root", coords.object is not None and coords.object.parent == root)

report = {
    "profile": "Editable native Blender VFX concept; not a game-runtime certification",
    "source": bpy.data.filepath,
    "checks": checks,
    "mesh_objects": len(meshes),
    "evaluated_vertices": vertices,
    "evaluated_triangles": triangles,
    "simulation_cache_required": False,
    "external_plugins_required": False,
    "game_runtime": "NOT_CHECKED - no export or integration requested",
    "hidden_reference_geometry": "UNKNOWN - single supplied reference view",
}
(OUT / "validation.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print("VALIDATION", json.dumps(report), flush=True)
if any(value["status"] == "FAIL" for value in checks.values()):
    raise RuntimeError("Fireball verification failed; see validation.json")

scene.render.resolution_x = 600
scene.render.resolution_y = 600
scene.eevee.taa_render_samples = 24
animation_dir = OUT / "animation-frames"
animation_dir.mkdir(exist_ok=True)
for frame in range(1, 49, 2):
    scene.frame_set(frame)
    scene.render.filepath = str(animation_dir / f"fireball-{frame:03d}.png")
    bpy.ops.render.render(write_still=True)
    print("ANIMATION_FRAME", frame, flush=True)

# Explicit assignments ensure the clay views inspect actual surfaces in Eevee.
scene.frame_set(13)
material = bpy.data.materials.new("DIAGNOSTIC | neutral clay")
material.use_nodes = True
shader = material.node_tree.nodes.get("Principled BSDF")
shader.inputs["Base Color"].default_value = (0.34, 0.34, 0.34, 1)
shader.inputs["Roughness"].default_value = 0.8
shader.inputs["Emission Color"].default_value = (0.06, 0.06, 0.06, 1)
shader.inputs["Emission Strength"].default_value = 1
for obj in meshes:
    obj.data.materials.clear()
    obj.data.materials.append(material)
scene.compositing_node_group = None
for obj in scene.objects:
    if obj.type == "LIGHT":
        obj.data.animation_data_clear()
        obj.data.color = (1, 1, 1)
        obj.data.energy = 900 if obj.data.type == "AREA" else 15
scene.render.resolution_x = 900
scene.render.resolution_y = 650
scene.camera.data.ortho_scale = 9.35
scene.render.filepath = str(OUT / "geometry-side.png")
bpy.ops.render.render(write_still=True)
scene.camera = bpy.data.objects["Camera | TOPO - conferir volume"]
scene.render.filepath = str(OUT / "geometry-top.png")
bpy.ops.render.render(write_still=True)
print("FIREBALL_INSPECTION_COMPLETE", flush=True)
