"""Blender --background --python tools/vfx/build.py (no external dependencies)."""
import bpy
import math
import json
import random
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets/models/vfx'
SOURCE = ROOT / 'art/vfx'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
random.seed(27)

# Distinct silhouettes, shared palette; dimensions in meters, +Z up in Blender.
specs = {
    'projectile.fire': ('bolt', '#ff721c'),
    'projectile.frost': ('crystal', '#79eaff'),
    'projectile.arcane': ('bolt', '#b784ff'),
    'projectile.nature': ('bolt', '#9cfa65'),
    'trail.arrow': ('arrow', '#ffe4a1'),
    'impact.physical': ('slash', '#fff1b9'),
    'impact.wave': ('rings', '#ffd295'),
    'charge.dust': ('dust', '#c3a886'),
    'barrier.arcane': ('shield', '#b491ff'),
    'stealth.transition': ('dust', '#8063be'),
    'surface.thorns': ('thorns', '#86bd41'),
    'status.roots': ('roots', '#b6d75c'),
    'heal.nature': ('heal', '#91ffad'),
    'item.health': ('heal', '#ff729a'),
    'item.focus': ('heal', '#65bdff'),
    'item.oil': ('splash', '#a58c54'),
    'damage.physical': ('burst', '#ff6653'),
    'damage.fire': ('burst', '#ff901e'),
    'damage.cold': ('crystal', '#a3f5ff'),
    'damage.arcane': ('burst', '#c38aff'),
    'damage.nature': ('burst', '#aeeb61'),
    'explosion.fire': ('burst', '#ffac35'),
}

def material(name, color):
    rgb = tuple(int(color[i:i+2], 16) / 255 for i in (1, 3, 5))
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*rgb, 1)
    mat.use_nodes = True
    bs = mat.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*rgb, 1)
    bs.inputs['Emission Color'].default_value = (*rgb, 1)
    bs.inputs['Emission Strength'].default_value = 1.6
    bs.inputs['Roughness'].default_value = .55
    return mat

parts = []
def add(obj):
    parts.append(obj)
    return obj

def line(points, radius=.025):
    data = bpy.data.curves.new('editable sweep', 'CURVE')
    data.dimensions = '3D'
    data.bevel_depth = radius
    data.bevel_resolution = 1
    spline = data.splines.new('POLY')
    spline.points.add(len(points)-1)
    for p, co in zip(spline.points, points):
        p.co = (*co, 1)
    obj = bpy.data.objects.new('sweep', data)
    bpy.context.collection.objects.link(obj)
    return add(obj)

def ring(radius, z=0, start=0, end=math.tau):
    return line([(radius*math.cos(t), radius*math.sin(t), z)
                 for t in [start+(end-start)*i/40 for i in range(41)]])

def gem(pos, scale):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1, location=pos)
    obj = add(bpy.context.object)
    obj.scale = scale
    return obj

manifest = {}
for index, (name, (shape, color)) in enumerate(specs.items()):
    parts = []
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    if shape in ('bolt', 'crystal', 'arrow'):
        gem((0, 0, 0), (.13, .48, .13) if shape == 'arrow' else (.24, .5, .24))
        for i in range(3):
            x = (i-1)*.13
            line([(x, -.1, 0), (x, .4, .08), (x*.5, 1.1, 0)], .018)
        if shape == 'crystal':
            for i in range(6):
                a = i*math.tau/6
                gem((.4*math.cos(a), .2, .4*math.sin(a)), (.07, .28, .07))
    elif shape == 'slash':
        for i in range(3):
            ring(.65+i*.14, i*.08, -.9, 1.8)
    elif shape in ('rings', 'shield', 'heal'):
        for i in range(3):
            obj = ring(.55+i*.16, i*.16)
            if shape == 'shield':
                obj.rotation_euler[i] = math.pi/2
        if shape == 'heal':
            for i in range(6):
                a = i*math.tau/6
                x, y, z = .5*math.cos(a), .5*math.sin(a), .4+(i%3)*.25
                line([(x-.09,y,z), (x+.09,y,z)])
                line([(x,y,z-.09), (x,y,z+.09)])
    elif shape in ('roots', 'thorns'):
        for i in range(8):
            a = i*math.tau/8
            if shape == 'roots':
                line([((.65-.15*t)*math.cos(a+t), (.65-.15*t)*math.sin(a+t), t*.65)
                      for t in [j/10 for j in range(16)]], .045)
            else:
                bpy.ops.mesh.primitive_cone_add(vertices=5, radius1=.16, radius2=0, depth=.5+(i%3)*.18,
                    location=(.65*math.cos(a), .65*math.sin(a), .25))
                add(bpy.context.object)
    else:
        for i in range(16):
            a = i*math.tau/16
            r = .35+random.random()*.5
            z = random.uniform(-.3, .5)
            if shape in ('dust', 'splash'):
                gem((r*math.cos(a), r*math.sin(a), abs(z)*.4), (.13,.13,.09))
            else:
                line([(r*.35*math.cos(a), r*.35*math.sin(a), z*.35),
                      (r*math.cos(a), r*math.sin(a), z)], .035)
        if shape == 'burst':
            ring(.55)
    mat = material(name, color)
    for obj in parts:
        for old in list(obj.users_collection):
            old.objects.unlink(obj)
        col.objects.link(obj)
        obj.data.materials.append(mat)
        obj.name = name + '.' + obj.name
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    # Convert delivery duplicates; preserve editable curves in the native source.
    bpy.ops.object.duplicate()
    bpy.ops.object.convert(target='MESH')
    bpy.ops.object.join()
    bpy.ops.export_scene.gltf(filepath=str(OUT / (name+'.glb')), use_selection=True,
        export_format='GLB', export_extras=True)
    bpy.ops.object.delete(use_global=False)
    manifest[name] = {'path': 'models/vfx/'+name+'.glb', 'shape': shape, 'color': color}
    # Contact-sheet layout affects only source, after origin-centered export.
    for obj in parts:
        obj.location.x += (index % 6)*3
        obj.location.y += (index // 6)*3

bpy.context.scene.world.color = (.025, .025, .025)
bpy.ops.object.camera_add(location=(7.5, -10, 21))
cam = bpy.context.object
cam.rotation_euler = (Vector((7.5, 4.5, 0))-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 20
bpy.context.scene.camera = cam
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 16
scene.render.resolution_x = 1400
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = str(SOURCE/'preview.png')
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'combat-vfx.blend'))
bpy.ops.render.render(write_still=True)
# Keep entries exported by other scripts (e.g. export_fireball_glb.py -> projectile.fireball).
previous = json.loads((OUT/'manifest.json').read_text()) if (OUT/'manifest.json').exists() else {}
manifest.update({k: v for k, v in previous.items() if k not in manifest})
(OUT/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
