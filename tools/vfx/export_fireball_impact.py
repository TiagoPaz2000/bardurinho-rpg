"""Export the in-game version of the Bola de fogo impact from the editable concept.

Blender --background art/vfx/fireball-impact/fireball-impact.blend --disable-autoexec
--python tools/vfx/export_fireball_impact.py

Two runtime pieces, both starting at the impact (frame 20 -> t = 0, 100 frames at 24 fps):

1. assets/models/vfx/explosion.fireball.glb - the burst star, the orange envelope, the shock
   ring and the 46 flames, with their keyframed scales and the flames' shape keys (glTF morph
   targets). Subdivision is dropped (shape keys survive only on unmodified meshes) and each
   flame gets vertex colours from its stylised ramp (gold base, tangerine tips). A flat
   'Chao | decal' plane carries the UVs of the ground flipbook.
2. assets/models/vfx/explosion.fireball.ground.png - the procedural ground (radius, 4D noise,
   erosion) cannot travel as glTF, so the top camera renders it to an 8x8 flipbook
   (64 frames of 256 px, transparent background, no compositor glow).

Smoke, sparks and the impact light stay in the game's particle system. Never saves the .blend.
`-- --glb-only` re-exports the GLB without re-rendering the flipbook (~5 min).
"""
import json
from pathlib import Path
import sys
import tempfile

import bpy
import numpy as np
from mathutils import noise, Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets/models/vfx'
ID = 'explosion.fireball'
COLOR = '#ff890b'
IMPACT, END = 20, 120
GRID, TILE = 8, 256
EXTENT = 10.0  # ortho_scale of the top camera: the decal covers [-5, 5] m on both axes
DECAL = 'Chao | decal'
FLAME_RAMP = [(0, '#E43C02'), (0.27, '#FF7203'), (0.43, '#FFC21B'), (0.53, '#FFE35C'), (0.65, '#FFEA7A')]

scene = bpy.context.scene
root = bpy.data.objects['EFEITO | mover e escalar conjunto']
ground = bpy.data.objects['Mancha de fogo | malha radial subdividida']
burst = [bpy.data.objects[n] for n in ('Estouro | estrela 3D de pontas irregulares', 'Estouro | pontas secundarias laranja', 'Onda de impacto | anel expansivo')]
flames = sorted((o for o in bpy.data.collections['04 | CHAMAS COM SHAPE KEYS'].objects if o.type == 'MESH'), key=lambda o: o.name)
assert len(flames) == 46, len(flames)


def frames():
    """Blender frame of each flipbook tile (impact .. end, evenly spaced)."""
    count = GRID * GRID
    return [IMPACT + (END - IMPACT) * i / (count - 1) for i in range(count)]


def render_ground():
    top = bpy.data.objects['Camera | TOPO - expansao radial']
    assert abs(top.data.ortho_scale - EXTENT) < 1e-6 and top.location.xy.length < 1e-6
    for obj in scene.objects:
        obj.hide_render = obj is not ground and obj.type != 'CAMERA'
    scene.camera = top
    scene.render.film_transparent = True
    scene.render.use_compositing = False
    scene.render.resolution_x = scene.render.resolution_y = TILE
    scene.render.resolution_percentage = 100
    scene.eevee.taa_render_samples = 16
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    atlas = np.zeros((GRID * TILE, GRID * TILE, 4), dtype=np.float32)
    tmp = Path(tempfile.mkdtemp())
    for i, frame in enumerate(frames()):
        scene.frame_set(int(frame), subframe=frame - int(frame))
        scene.render.filepath = str(tmp / f'ground-{i:02d}.png')
        bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(scene.render.filepath)
        tile = np.array(image.pixels[:], dtype=np.float32).reshape(TILE, TILE, 4)  # bottom row first
        bpy.data.images.remove(image)
        col, row = i % GRID, i // GRID  # row 0 = top of the PNG
        y0 = (GRID - 1 - row) * TILE
        atlas[y0:y0 + TILE, col * TILE:(col + 1) * TILE] = tile
    out = bpy.data.images.new('ground-atlas', GRID * TILE, GRID * TILE, alpha=True)
    out.pixels = atlas.ravel()
    out.filepath_raw = str(OUT / f'{ID}.ground.png')
    out.file_format = 'PNG'
    out.save()
    for obj in scene.objects:
        obj.hide_render = False


def ramp(value):
    color = FLAME_RAMP[0][1]
    for position, hex_color in FLAME_RAMP:
        if value >= position:
            color = hex_color
    return [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)] + [1.0]


def prepare_flame(obj, index):
    for modifier in list(obj.modifiers):
        obj.modifiers.remove(modifier)
    mesh = obj.data
    zs = [v.co.z for v in mesh.vertices]
    low, high = min(zs), max(zs)
    attribute = mesh.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    for vertex in mesh.vertices:
        z = (vertex.co.z - low) / (high - low)
        n = noise.noise(vertex.co * 3.0 + Vector((index * 8.0, 0, 0)))  # [-1, 1]
        attribute.data[vertex.index].color = ramp(0.66 - 0.32 * z + 0.18 * n)
    mesh.color_attributes.active_color = attribute


def apply_modifiers(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    for modifier in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=modifier.name)


def decal_plane():
    half = EXTENT / 2
    mesh = bpy.data.meshes.new(DECAL)
    mesh.from_pydata([(-half, -half, 0.05), (half, -half, 0.05), (half, half, 0.05), (-half, half, 0.05)], [], [(0, 1, 2, 3)])
    uv = mesh.uv_layers.new(name='UVMap')
    for loop in mesh.loops:
        co = mesh.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = ((co.x + half) / EXTENT, (co.y + half) / EXTENT)
    obj = bpy.data.objects.new(DECAL, mesh)
    scene.collection.objects.link(obj)
    obj.parent = root
    return obj


def export_glb():
    keep = {root, *burst, *flames}
    for obj in list(scene.objects):
        if obj not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)
    for obj in burst:
        apply_modifiers(obj)
    for i, obj in enumerate(flames):
        prepare_flame(obj, i)
    decal = decal_plane()
    scene.frame_start, scene.frame_end = IMPACT, END
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [root, decal, *burst, *flames]:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(OUT / f'{ID}.glb'), use_selection=True, export_format='GLB',
        export_animations=True, export_animation_mode='SCENE', export_frame_range=True,
        export_force_sampling=True, export_anim_slide_to_zero=True, export_morph=True, export_morph_animation=True,
        export_vertex_color='ACTIVE', export_materials='PLACEHOLDER', export_extras=False,
        export_apply=False, export_yup=True)
    triangles = 0
    for obj in [*burst, *flames]:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
    return triangles


if '--glb-only' not in sys.argv:
    render_ground()
triangles = export_glb()
manifest_path = OUT / 'manifest.json'
manifest = json.loads(manifest_path.read_text())
manifest[ID] = {'path': f'models/vfx/{ID}.glb', 'shape': 'impact', 'color': COLOR,
                'ground': f'models/vfx/{ID}.ground.png', 'fps': scene.render.fps,
                'frames': END - IMPACT, 'flipbook': {'grid': GRID, 'tile': TILE, 'extent': EXTENT}}
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
print('FIREBALL_IMPACT', triangles, 'triangles', flush=True)
