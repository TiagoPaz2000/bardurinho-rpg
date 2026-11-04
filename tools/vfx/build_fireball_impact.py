"""Editable 5-second fireball impact, spread and burnout in Blender 5.2.

Blender --background --factory-startup --python-exit-code 1
--python tools/vfx/build_fireball_impact.py
"""
import json
import math
from pathlib import Path
import random
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_fireball as base

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'art/vfx/fireball-impact'
SOURCE = ROOT / 'art/vfx/fireball/fireball-stylized.blend'
RNG = random.Random(704)
TAU = math.tau
END = 120
IMPACT = 20


def key_socket(socket, values):
    for frame, value in values:
        socket.default_value = value
        socket.keyframe_insert('default_value', frame=frame)


def key_scale(obj, values):
    for frame, scale in values:
        obj.scale = (scale,) * 3 if isinstance(scale, (int, float)) else scale
        obj.keyframe_insert('scale', frame=frame)


def math_node(nodes, links, operation, a, b=None, label=''):
    node = nodes.new('ShaderNodeMath')
    node.operation = operation
    node.label = label
    for i, value in enumerate((a, b)):
        if value is None:
            continue
        if isinstance(value, (float, int)):
            node.inputs[i].default_value = value
        else:
            links.new(value, node.inputs[i])
    return node.outputs[0]


def setup_material(name, color):
    return base.new_material(name, color)


def layer_material(rig):
    mat, nodes, links, output = setup_material('CHAO | raio animado + Noise 4D + erosao', '#FF8F12')
    mat.surface_render_method = 'DITHERED'
    coords = nodes.new('ShaderNodeTexCoord')
    coords.object = rig
    coords.location = (-1100, 300)
    radius = nodes.new('ShaderNodeValue')
    radius.name = 'RAIO | expansao em unidades'
    radius.label = 'ANIMADO: raio da frente de fogo'
    radius.location = (-1100, 540)
    key_socket(radius.outputs[0], [(1, 0), (19, 0), (20, 0.18), (23, 0.85), (28, 2.1), (35, 3.4), (43, 3.85), (120, 3.85)])
    erosion = nodes.new('ShaderNodeValue')
    erosion.name = 'EROSAO | buracos e ilhas finais'
    erosion.label = 'ANIMADO: queima ate desaparecer'
    erosion.location = (-1100, -400)
    key_socket(erosion.outputs[0], [(1, 0.34), (30, 0.34), (50, 0.38), (68, 0.43), (85, 0.50), (99, 0.58), (110, 0.68), (118, 1.1), (120, 1.1)])
    tex = nodes.new('ShaderNodeTexNoise')
    tex.name = 'MANCHAS | turbulencia 4D'
    tex.location = (-850, 40)
    tex.noise_dimensions = '4D'
    tex.inputs['Scale'].default_value = 1.05
    tex.inputs['Detail'].default_value = 0.35
    tex.inputs['Roughness'].default_value = 0.52
    tex.inputs['Distortion'].default_value = 0.45
    links.new(coords.outputs['Object'], tex.inputs['Vector'])
    key_socket(tex.inputs['W'], [(1, 0), (20, 0.1), (40, 0.7), (70, 1.65), (100, 2.6), (120, 3.2)])
    distance = nodes.new('ShaderNodeVectorMath')
    distance.operation = 'LENGTH'
    distance.location = (-850, 400)
    links.new(coords.outputs['Object'], distance.inputs[0])
    edge_noise = math_node(nodes, links, 'MULTIPLY', tex.outputs['Fac'], 0.78, 'Borda irregular')
    broken_distance = math_node(nodes, links, 'ADD', distance.outputs['Value'], edge_noise)
    reach = math_node(nodes, links, 'LESS_THAN', broken_distance, radius.outputs[0])
    islands = math_node(nodes, links, 'GREATER_THAN', tex.outputs['Fac'], erosion.outputs[0], 'Buracos reais transparentes')
    opacity = math_node(nodes, links, 'MULTIPLY', reach, islands)
    ramp = base.color_ramp(nodes, 'Amarelo / laranja / vermelho', [
        (0.0, '#A81C03'), (0.38, '#F34802'), (0.445, '#FF8D06'),
        (0.50, '#FFD03C'), (0.57, '#FFAC14'), (0.66, '#E83E03'),
        (0.76, '#9C1B02')], (-450, 0), 'CONSTANT')
    links.new(tex.outputs['Fac'], ramp.inputs[0])
    emit = nodes.new('ShaderNodeEmission')
    emit.location = (100, 160)
    links.new(ramp.outputs[0], emit.inputs['Color'])
    key_socket(emit.inputs['Strength'], [(1, 1.125), (20, 1.65), (35, 1.3875), (75, 1.2), (105, 0.6375), (120, 0.0)])
    transparent = nodes.new('ShaderNodeBsdfTransparent')
    transparent.location = (100, -80)
    mix = nodes.new('ShaderNodeMixShader')
    mix.location = (440, 80)
    links.new(opacity, mix.inputs[0])
    links.new(transparent.outputs[0], mix.inputs[1])
    links.new(emit.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], output.inputs['Surface'])
    # Lay out arithmetic nodes as a readable mask section.
    arithmetic = [n for n in nodes if n.bl_idname == 'ShaderNodeMath']
    for i, node in enumerate(arithmetic):
        node.location = (-620 + (i % 3) * 190, -350 - (i // 3) * 180)
    return mat


def flame_material():
    mat, nodes, links, output = setup_material('CHAMA | ouro na base e pontas tangerina', '#FFC43B')
    coord = nodes.new('ShaderNodeTexCoord')
    coord.location = (-900, 260)
    split = nodes.new('ShaderNodeSeparateXYZ')
    split.location = (-680, 320)
    links.new(coord.outputs['Generated'], split.inputs[0])
    noise = nodes.new('ShaderNodeTexNoise')
    noise.location = (-650, 30)
    noise.noise_dimensions = '4D'
    noise.inputs['Scale'].default_value = 3.0
    noise.inputs['Detail'].default_value = 0.4
    links.new(coord.outputs['Generated'], noise.inputs['Vector'])
    time = nodes.new('ShaderNodeValue')
    time.name = 'TURBULENCIA | tempo'
    time.location = (-1100, -50)
    key_socket(time.outputs[0], [(1, 0), (120, 5.0)])
    obj = nodes.new('ShaderNodeObjectInfo')
    obj.location = (-1100, -260)
    random = math_node(nodes, links, 'MULTIPLY', obj.outputs['Random'], 8)
    links.new(math_node(nodes, links, 'ADD', random, time.outputs[0]), noise.inputs['W'])
    z = math_node(nodes, links, 'MULTIPLY', split.outputs['Z'], -0.32)
    value = math_node(nodes, links, 'ADD', math_node(nodes, links, 'ADD', z, noise.outputs['Fac']), 0.16)
    ramp = base.color_ramp(nodes, 'Fogo estilizado em blocos', [
        (0, '#E43C02'), (0.27, '#FF7203'), (0.43, '#FFC21B'),
        (0.53, '#FFE35C'), (0.65, '#FFEA7A')], (-250, 140), 'CONSTANT')
    links.new(value, ramp.inputs[0])
    emit = nodes.new('ShaderNodeEmission')
    emit.location = (400, 100)
    links.new(ramp.outputs[0], emit.inputs['Color'])
    emit.inputs['Strength'].default_value = 1.4
    links.new(emit.outputs[0], output.inputs['Surface'])
    return mat


def smoke_material(name):
    mat, nodes, links, output = setup_material(name, '#25262A')
    mat.surface_render_method = 'DITHERED'
    coord = nodes.new('ShaderNodeTexCoord')
    coord.location = (-650, 30)
    tex = nodes.new('ShaderNodeTexNoise')
    tex.location = (-420, 50)
    tex.inputs['Scale'].default_value = 3.1
    tex.inputs['Detail'].default_value = 0.7
    links.new(coord.outputs['Generated'], tex.inputs['Vector'])
    ramp = base.color_ramp(nodes, 'Carvao quente', [(0.25, '#111214'), (0.70, '#303236')], (-180, 50), 'LINEAR')
    links.new(tex.outputs['Fac'], ramp.inputs[0])
    shader = nodes.new('ShaderNodeBsdfPrincipled')
    shader.location = (90, 150)
    shader.inputs['Roughness'].default_value = 1
    shader.inputs['Specular IOR Level'].default_value = 0.12
    links.new(ramp.outputs[0], shader.inputs['Base Color'])
    trans = nodes.new('ShaderNodeBsdfTransparent')
    trans.location = (100, -130)
    mix = nodes.new('ShaderNodeMixShader')
    mix.location = (470, 60)
    mix.name = 'DISSIPACAO | opacidade'
    links.new(trans.outputs[0], mix.inputs[1])
    links.new(shader.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], output.inputs['Surface'])
    return mat, mix.inputs[0]


def make_mesh(name, vertices, faces, material, target, parent):
    mesh = bpy.data.meshes.new(name + ' | malha editavel')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    target.objects.link(obj)
    obj.parent = parent
    mesh.materials.append(material)
    return obj


def ground_patch(material, target, parent):
    segments, rings = 160, 28
    vertices = [(0, 0, 0.035)]
    for j in range(1, rings + 1):
        t = j / rings
        for i in range(segments):
            angle = TAU * i / segments
            radius = 4.25 * t * (1 + 0.045 * math.sin(angle * 7 + 0.5) + 0.028 * math.sin(angle * 13))
            vertices.append((radius * math.cos(angle), radius * math.sin(angle), 0.036 + 0.008 * math.sin(angle * 6) * t))
    faces = [(0, 1 + i, 1 + (i + 1) % segments) for i in range(segments)]
    for j in range(rings - 1):
        start = 1 + j * segments
        for i in range(segments):
            a, b = start + i, start + (i + 1) % segments
            faces.append((a, a + segments, b + segments, b))
    obj = make_mesh('Mancha de fogo | malha radial subdividida', vertices, faces, material, target, parent)
    obj['controle'] = 'Material: RAIO controla expansao; EROSAO abre buracos; W movimenta o desenho.'
    return obj


def flame_mesh(name, material, target, parent, seed):
    points = [(0, 0, 0), (-0.07, 0, 0.16), (0.08, 0.02, 0.42), (0.20, 0.025, 0.68), (0.05, 0.015, 0.92), (-0.13, 0, 1.13), (-0.02, 0.01, 1.38)]
    radii = [0.13, 0.34, 0.29, 0.24, 0.15, 0.075, 0.004]
    sides = 10
    vertices, faces = [], []
    for p, radius in zip(points, radii):
        for j in range(sides):
            angle = TAU * j / sides
            vertices.append((p[0] + radius * math.cos(angle), p[1] + radius * 0.43 * math.sin(angle), p[2]))
    for i in range(len(points) - 1):
        for j in range(sides):
            a, b = i * sides + j, i * sides + (j + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    faces.append(tuple(reversed(range(sides))))
    faces.append(tuple((len(points) - 1) * sides + j for j in range(sides)))
    obj = make_mesh(name, vertices, faces, material, target, parent)
    for face in obj.data.polygons:
        face.use_smooth = True
    subdivision = obj.modifiers.new('Contorno suave | secoes preservadas', 'SUBSURF')
    subdivision.levels = 1
    subdivision.render_levels = 2
    obj.shape_key_add(name='Base')
    left = obj.shape_key_add(name='Curva esquerda')
    right = obj.shape_key_add(name='Curva direita')
    for i, vertex in enumerate(obj.data.vertices):
        t = vertex.co.z / 1.38
        left.data[i].co.x += 0.37 * t ** 1.7
        left.data[i].co.y += 0.12 * t ** 2
        right.data[i].co.x -= 0.43 * t ** 1.7
        right.data[i].co.z *= 1 - 0.12 * t
    for frame in range(1, END + 1, 3):
        theta = frame * 0.36 + seed * 1.7
        left.value = 0.5 + 0.5 * math.sin(theta)
        right.value = 0.5 + 0.5 * math.cos(theta * 0.85)
        left.keyframe_insert('value', frame=frame)
        right.keyframe_insert('value', frame=frame)
    return obj


def flash_mesh(name, material, target, parent, count=22):
    vertices = [(0, 0, 0.08)]
    for i in range(count * 2):
        angle = TAU * i / (count * 2)
        radius = RNG.uniform(1.1, 2.1) if i % 2 == 0 else RNG.uniform(0.27, 0.48)
        z = RNG.uniform(0.15, 0.75) if i % 2 == 0 else 0.10
        if i % 6 == 0:
            radius *= 0.5
            z += 1.0
        vertices.append((radius * math.cos(angle), radius * math.sin(angle), z))
    faces = [(0, 1 + i, 1 + (i + 1) % (count * 2)) for i in range(count * 2)]
    obj = make_mesh(name, vertices, faces, material, target, parent)
    solid = obj.modifiers.new('Espessura da explosao', 'SOLIDIFY')
    solid.thickness = 0.018
    return obj


def shock_ring(material, target, parent):
    vertices, faces = [], []
    segments = 192
    for i in range(segments):
        angle = TAU * i / segments
        ripple = 0.028 * math.sin(angle * 15)
        for radius in (1.0, 0.984):
            r = radius + ripple
            vertices.append((r * math.cos(angle), r * math.sin(angle), 0.055))
    for i in range(segments):
        a, b = i * 2, ((i + 1) % segments) * 2
        faces.append((a, b, b + 1, a + 1))
    return make_mesh('Onda de impacto | anel expansivo', vertices, faces, material, target, parent)


def append_projectile(target, effect_root):
    with bpy.data.libraries.load(str(SOURCE), link=False) as (source, destination):
        destination.collections = [name for name in source.collections if name[:2] in ('00', '01', '02', '03', '04')]
    for col in destination.collections:
        target.children.link(col)
    root = bpy.data.objects['FIREBALL | mover e escalar o efeito inteiro']
    root.parent = effect_root
    root.name = 'PROJETIL | queda e compressao no impacto'
    root['origem'] = 'Asset aprovado: art/vfx/fireball/fireball-stylized.blend'
    for frame in range(1, END + 1):
        t = min(1.0, max(0.0, (frame - 1) / 19))
        center = Vector((-2.8 * (1 - t), 0.15 * (1 - t), 0.43 + 3.25 * (1 - t ** 1.32)))
        direction = Vector((2.8, -0.15, -3.25 * 1.32 * max(0.15, t) ** 0.32)).normalized()
        rotation = Vector((1, 0, 0)).rotation_difference(direction)
        scale = 0.47 if frame <= 20 else (0.47 * max(0.0, 1 - (frame - 20) / 3))
        root.rotation_mode = 'QUATERNION'
        root.rotation_quaternion = rotation
        root.scale = (scale,) * 3
        root.location = center - rotation @ (Vector((1.2, 0, 0)) * scale)
        root.keyframe_insert('location', frame=frame)
        root.keyframe_insert('rotation_quaternion', frame=frame)
        root.keyframe_insert('scale', frame=frame)
    return root


def smoke_puff(index, birth, duration, origin, velocity, target, parent, size=0.45):
    puff = base.empty(f'Fumaca {index:02d} | nascimento {birth}', target, parent)
    mat, opacity = smoke_material(f'FUMACA {index:02d} | opacidade animada')
    base.blob(f'Fumaca {index:02d} | massa arredondada', (0, 0, 0), (1, 0.92, 1), mat, target, puff, index * 2.3, 3, 0.10)
    for j in range(5):
        angle = TAU * j / 5 + index
        radius = RNG.uniform(0.35, 0.53)
        base.blob(f'Fumaca {index:02d} | lobulo {j + 1}', (0.57 * math.cos(angle), 0.47 * math.sin(angle), RNG.uniform(-0.3, 0.4)), (radius,) * 3, mat, target, puff, index + j, 2, 0.1)
    for frame in range(1, END + 1):
        age = max(0.0, min(1.0, (frame - birth) / duration))
        active = birth < frame < birth + duration
        grow = min(1, age / 0.11) if active else 0
        fade = min(1, (1 - age) / 0.29) if active else 0
        radius = size * (0.55 + age * 1.05) * grow
        puff.scale = (radius,) * 3
        puff.location = Vector(origin) + Vector(velocity) * age
        puff.rotation_euler.z = index * 0.7 + age * 0.7
        puff.keyframe_insert('scale', frame=frame)
        puff.keyframe_insert('location', frame=frame)
        puff.keyframe_insert('rotation_euler', frame=frame)
        opacity.default_value = 0.97 * fade * grow * (0.6 if index > 20 else 1)
        opacity.keyframe_insert('default_value', frame=frame)
    return puff


def configure_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = 'BOLA DE FOGO | queda - impacto - expansao - dissipacao'
    scene.render.engine = 'BLENDER_EEVEE'
    scene.eevee.taa_render_samples = 48
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.fps = 24
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.frame_start, scene.frame_end = 1, END
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new('Mundo | estudio escuro')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = base.rgba('#171B1F')
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.7
    return scene


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    scene = configure_scene()
    controls = base.collection('00 | CONTROLES DO IMPACTO')
    incoming = base.collection('01 | BOLA EM QUEDA')
    burst = base.collection('02 | CLARAO E ONDA DE CHOQUE')
    ground = base.collection('03 | FOGO SE ESPALHANDO')
    flames = base.collection('04 | CHAMAS COM SHAPE KEYS')
    smoke = base.collection('05 | FUMACA SUBINDO')
    sparks = base.collection('06 | FAISCAS E BRASAS')
    studio = base.collection('07 | CHAO CAMERA E LUZ')
    references = base.collection('08 | REFERENCIA EMPACOTADA')
    effect_root = base.empty('EFEITO | mover e escalar conjunto', controls)
    effect_root['duracao'] = '5 segundos / 120 quadros / 24 fps'
    effect_root['impacto'] = 20
    effect_root['raio_maximo'] = 3.85
    effect_root['edicao'] = 'Cada camada tem keyframes; raio e erosao no material CHAO.'
    projectile = append_projectile(incoming, effect_root)
    patch_mat = layer_material(effect_root)
    patch = ground_patch(patch_mat, ground, effect_root)
    fire_mat = flame_material()
    hot = base.emission_material('IMPACTO | branco amarelo', '#FFF0B1', 4.0)
    orange = base.emission_material('IMPACTO | envelope laranja', '#FF890B', 2.2)
    gold = base.emission_material('ONDA | amarelo quente', '#FFCE55', 2.3)
    ember = base.emission_material('FAISCAS | ouro e laranja', '#FFAD25', 3.0)
    flash = flash_mesh('Estouro | estrela 3D de pontas irregulares', hot, burst, effect_root)
    key_scale(flash, [(1, 0), (19, 0), (20, 0.23), (22, (1.0, 1.0, 1.55)), (25, (1.6, 1.6, 0.70)), (29, (1.9, 1.9, 0.11)), (32, 0), (120, 0)])
    envelope = flash_mesh('Estouro | pontas secundarias laranja', orange, burst, effect_root, 17)
    envelope.rotation_euler.z = 0.2
    key_scale(envelope, [(1, 0), (20, 0), (22, (1.1, 1.1, 1.1)), (27, (1.85, 1.85, 0.35)), (33, 0), (120, 0)])
    ring = shock_ring(gold, burst, effect_root)
    key_scale(ring, [(1, (0, 0, 1)), (19, (0, 0, 1)), (20, (0.2, 0.2, 1)), (25, (1.8, 1.8, 1)), (32, (3.8, 3.8, 1)), (38, (4.4, 4.4, 1)), (41, (4.6, 4.6, 1)), (120, (4.6, 4.6, 1))])
    ring_emit = next(n for n in gold.node_tree.nodes if n.bl_idname == 'ShaderNodeEmission')
    # A transparent shader fades the ring instead of leaving a black ring.
    ring_nodes, ring_links = gold.node_tree.nodes, gold.node_tree.links
    ring_output = next(n for n in ring_nodes if n.bl_idname == 'ShaderNodeOutputMaterial')
    ring_trans = ring_nodes.new('ShaderNodeBsdfTransparent')
    ring_mix = ring_nodes.new('ShaderNodeMixShader')
    ring_mix.location = (580, 0)
    ring_links.new(ring_trans.outputs[0], ring_mix.inputs[1])
    ring_links.new(ring_emit.outputs[0], ring_mix.inputs[2])
    ring_links.new(ring_mix.outputs[0], ring_output.inputs['Surface'])
    key_socket(ring_mix.inputs[0], [(1, 0), (19, 0), (20, 1), (28, 0.9), (36, 0.35), (41, 0), (120, 0)])
    gold.surface_render_method = 'DITHERED'

    # Irregular arrangement: tall inner curls and smaller flames at the front.
    flame_records = []
    for i in range(46):
        angle = i * 2.399963 + RNG.uniform(-0.25, 0.25)
        r = (math.sqrt((i + 0.6) / 46) * 3.45) if i >= 9 else RNG.uniform(0.12, 1.15)
        x, y = r * math.cos(angle), r * math.sin(angle)
        birth = 21 + int(r * 3.5) + RNG.randint(0, 5)
        death = RNG.randint(93, 116) if r > 2 else RNG.randint(85, 105)
        height = RNG.uniform(0.35, 0.90) * (1.4 if r < 1.6 else 1)
        height *= 1.0 if r < 1.6 else (0.65 if r < 2.5 else 0.45)
        width = RNG.uniform(0.48, 0.95)
        obj = flame_mesh(f'Chama {i + 1:02d} | nascimento {birth:03d}', fire_mat, flames, effect_root, i)
        obj.location = (x, y, 0.045)
        obj.rotation_euler.z = RNG.uniform(-1.2, 1.2)
        for frame in range(1, END + 1):
            if frame <= birth or frame >= death:
                envelope_scale = 0
            else:
                growth = min(1, (frame - birth) / 4)
                decay = min(1, (death - frame) / 18)
                initial = 1 + 0.75 * math.exp(-max(0, frame - birth - 4) / 9)
                envelope_scale = growth * decay * initial
            flicker = 1 + 0.18 * math.sin(frame * 0.7 + i * 2) + 0.08 * math.sin(frame * 1.3 + i)
            obj.scale = (width * envelope_scale, width * envelope_scale, height * envelope_scale * flicker)
            obj.keyframe_insert('scale', frame=frame)
        flame_records.append({'name': obj.name, 'birth': birth, 'death': death, 'radius': r})

    for i in range(20):
        angle = RNG.uniform(0, TAU)
        radius = RNG.uniform(0.18, 1.25)
        origin = (radius * math.cos(angle), radius * math.sin(angle) + 0.45, RNG.uniform(0.2, 0.85))
        velocity = (0.9 * math.cos(angle) + 0.4, 0.7 * math.sin(angle) + 0.7, RNG.uniform(2.1, 3.6))
        smoke_puff(i + 1, 24 + i // 2, RNG.randint(48, 70), origin, velocity, smoke, effect_root, RNG.uniform(0.30, 0.52))
    for i in range(5):
        t = i / 5
        smoke_puff(21 + i, 8 + i * 2, 44 + i * 2, (-2.5 + t * 2.1, 0.3, 3.1 - t * 2.3), (-0.3, 0.8, 0.8), smoke, effect_root, (0.24 + t * 0.1) * 0.65)

    for i in range(64):
        angle = RNG.uniform(0, TAU)
        birth = RNG.randint(20, 28) if i < 44 else RNG.randint(43, 78)
        duration = RNG.randint(18, 37)
        distance = RNG.uniform(1.0, 4.5) if i < 44 else RNG.uniform(0.3, 1.8)
        zpeak = RNG.uniform(0.5, 2.8)
        origin_radius = 0.2 if i < 44 else RNG.uniform(0.4, 2.7)
        obj = base.blob(f'Faisca {i + 1:02d} | arco balistico', (0, 0, 0), (1, 1, 1), ember, sparks, effect_root, i, 1, 0.05)
        size = RNG.uniform(0.018, 0.039)
        for frame in range(1, END + 1):
            age = (frame - birth) / duration
            active = 0 < age < 1
            t = max(0, min(1, age))
            radius = origin_radius + distance * t
            obj.location = (math.cos(angle) * radius, math.sin(angle) * radius, 0.09 + 4 * zpeak * t * (1 - t))
            tangent = Vector((math.cos(angle) * distance, math.sin(angle) * distance, 4 * zpeak * (1 - 2 * t))).normalized()
            obj.rotation_euler = tangent.to_track_quat('Z', 'Y').to_euler()
            scale = (math.sin(math.pi * t) ** 0.45) if active else 0
            obj.scale = (size * scale, size * scale, size * scale * 3.8)
            obj.keyframe_insert('location', frame=frame)
            obj.keyframe_insert('rotation_euler', frame=frame)
            obj.keyframe_insert('scale', frame=frame)

    # A subdued, textured studio ground makes contact and projected light legible.
    floor_mat, nodes, links, output = setup_material('PISO | carvao fosco', '#25292C')
    floor_shader = nodes.new('ShaderNodeBsdfPrincipled')
    floor_shader.inputs['Base Color'].default_value = base.rgba('#25292C')
    floor_shader.inputs['Roughness'].default_value = 0.88
    floor_shader.inputs['Specular IOR Level'].default_value = 0.18
    links.new(floor_shader.outputs[0], output.inputs['Surface'])
    bpy.ops.mesh.primitive_plane_add(size=200)
    floor = base.move_to(bpy.context.object, studio)
    floor.name = 'Piso | receptor de sombra e luz'
    floor.data.materials.append(floor_mat)
    bpy.ops.object.camera_add(location=(7.5, -15, 10.4))
    camera = base.move_to(bpy.context.object, studio)
    camera.name = 'Camera | IMPACTO - vista principal'
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 12.15
    base.aim(camera, (0, 0, 1.15))
    scene.camera = camera
    bpy.ops.object.camera_add(location=(0, 0, 16))
    top = base.move_to(bpy.context.object, studio)
    top.name = 'Camera | TOPO - expansao radial'
    top.data.type = 'ORTHO'
    top.data.ortho_scale = 10
    base.aim(top, (0, 0, 0))
    bpy.ops.object.light_add(type='AREA', location=(-3, -4, 8))
    key = base.move_to(bpy.context.object, studio)
    key.name = 'Luz | volumes da fumaca'
    key.data.energy = 700
    key.data.size = 9
    base.aim(key, (0, 0, 1))
    bpy.ops.object.light_add(type='AREA', location=(3, 4, 6))
    fill = base.move_to(bpy.context.object, studio)
    fill.name = 'Luz | recorte frio suave'
    fill.data.energy = 460
    fill.data.size = 7
    fill.data.color = (0.66, 0.77, 1)
    base.aim(fill, (0, 0, 1))
    bpy.ops.object.light_add(type='POINT', location=(0, 0, 0.8))
    fire_light = base.move_to(bpy.context.object, studio, effect_root)
    fire_light.name = 'Luz | clarão e fogo no piso'
    fire_light.data.color = (1, 0.22, 0.025)
    fire_light.data.shadow_soft_size = 1.8
    for frame, energy in [(1, 0), (18, 0), (20, 350), (22, 1100), (28, 650), (43, 420), (70, 330), (92, 140), (110, 20), (118, 0), (120, 0)]:
        fire_light.data.energy = energy
        fire_light.data.keyframe_insert('energy', frame=frame)
    base.configure_compositor(scene)
    scene.compositing_node_group.name = 'IMPACTO | Fog Glow preservando os contornos'

    sheet = OUT / 'reference/video-contact-sheet.png'
    if sheet.exists():
        image = bpy.data.images.load(str(sheet))
        image.name = 'REFERENCIA | quadros do video fornecido'
        image.pack()
        ref = base.empty('Video de referencia | folha de quadros empacotada', references)
        ref.empty_display_type = 'IMAGE'
        ref.data = image
        ref.hide_render = True
        ref.hide_viewport = True
    readme = bpy.data.texts.new('LEIA-ME | impacto da bola de fogo')
    readme.write('''BOLA DE FOGO - IMPACTO E EXPANSAO
Cena nativa Blender, 120 quadros a 24 fps (5 segundos).
Referencia: gemini_generated_video_dc809d69.mp4, fornecido pelo usuario.
Adaptacao temporal: a acao foi condensada; nao e uma copia quadro a quadro.

1-19: queda da bola reutilizando o modelo aprovado.
20-32: impacto, estrela 3D e clarão; onda se expande ate 41.
23-43: frente de fogo avanca pelo piso com borda irregular.
25-80: linguas de fogo com Shape Keys e fumaca ascendente.
68-118: erosao da mancha, ilhas de fogo, brasas e dissipacao.
119-120: efeito completamente apagado.

Espaco: reproduzir. Numpad 0: camera. F12: renderizar.
As colecoes 00-08 separam as camadas. EFEITO move/escala o conjunto.
O piso e a camera ficam na colecao 07 e podem ser substituidos.
Material CHAO: RAIO anima a expansao, EROSAO abre os buracos e
Noise 4D / W altera o desenho; a malha nao e apenas ampliada.
Cada chama conserva Shape Keys Curva esquerda/direita e Subdivision.
O efeito termina por keyframes, sem cache de simulacao ou drivers.
O compositor separa halo, emissao e luz projetada no piso.

Geometria para conceito/render nativo. Nao exportada nem integrada
ao jogo. O shader procedural transparente precisa de adaptacao
se for levado a outro motor. Todos os recursos necessarios estao
no blend; a folha do video foi empacotada como referencia.
Fonte: tools/vfx/build_fireball_impact.py
''')
    for frame, label in [(1, 'QUEDA'), (20, 'IMPACTO'), (35, 'EXPANSAO'), (55, 'FOGO NO CHAO'), (82, 'ILHAS E DISSIPACAO'), (119, 'APAGADO')]:
        scene.timeline_markers.new(label, frame=frame)
    scene.frame_set(43)
    scene['impact_art_revision'] = 1
    bpy.ops.object.select_all(action='DESELECT')
    effect_root.select_set(True)
    bpy.context.view_layer.objects.active = effect_root
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                space = area.spaces.active
                space.region_3d.view_perspective = 'CAMERA'
                space.overlay.show_overlays = False
                space.shading.type = 'MATERIAL'
                space.shading.use_scene_world = True
                space.shading.use_scene_lights = True
    scene.render.filepath = str(OUT / 'fireball-impact-preview.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'fireball-impact.blend'), compress=True)
    (OUT / 'timing.json').write_text(json.dumps({'fps': 24, 'frames': 120, 'impact_frame': IMPACT, 'flames': flame_records}, indent=2) + '\n')
    render_previews(scene)


def render_previews(scene):
    scene.frame_set(43)
    scene.render.filepath = str(OUT / 'fireball-impact-preview.png')
    bpy.ops.render.render(write_still=True)
    # A small set of real renders lets us check the story before the full movie.
    scene.render.resolution_x, scene.render.resolution_y = 768, 432
    scene.eevee.taa_render_samples = 12
    for frame in (9, 22, 32, 64, 90, 114, 120):
        scene.frame_set(frame)
        scene.render.filepath = str(OUT / f'keyframe-{frame:03d}.png')
        bpy.ops.render.render(write_still=True)
    print('IMPACT_BUILD_COMPLETE', str(OUT), flush=True)


def refine_saved_scene():
    """Apply the first art-review changes to the saved scene, retaining animation."""
    scene = bpy.context.scene
    if scene.get('impact_art_revision', 0) >= 1:
        raise RuntimeError('Art-review changes have already been applied')
    ground = bpy.data.materials['CHAO | raio animado + Noise 4D + erosao']
    nodes = ground.node_tree.nodes
    noise = nodes['MANCHAS | turbulencia 4D']
    noise.inputs['Scale'].default_value = 1.05
    noise.inputs['Detail'].default_value = 0.35
    noise.inputs['Distortion'].default_value = 0.45
    for element in nodes['Amarelo / laranja / vermelho'].color_ramp.elements:
        if abs(element.position - 0.5) < 0.001:
            element.color = base.rgba('#FFD03C')
    ground_emission = next(n for n in nodes if n.bl_idname == 'ShaderNodeEmission')
    flame_mat = bpy.data.materials['CHAMA | ouro na base e pontas tangerina']
    palette = flame_mat.node_tree.nodes['Fogo estilizado em blocos'].color_ramp
    palette.elements[-2].color = base.rgba('#FFE35C')
    palette.elements[-1].color = base.rgba('#FFEA7A')
    next(n for n in flame_mat.node_tree.nodes if n.bl_idname == 'ShaderNodeEmission').inputs['Strength'].default_value = 1.4
    flames = [o for o in scene.objects if o.name.startswith('Chama ') and o.type == 'MESH' and o.data.shape_keys]
    puff_names = [f'Fumaca {index:02d} | nascimento {8 + (index - 21) * 2}' for index in range(21, 26)]
    puff_mats = [bpy.data.materials[f'FUMACA {index:02d} | opacidade animada'] for index in range(21, 26)]
    original_strength = {}
    for frame in range(1, END + 1):
        scene.frame_set(frame)
        original_strength[frame] = ground_emission.inputs['Strength'].default_value
    for frame in range(1, END + 1):
        scene.frame_set(frame)
        ground_emission.inputs['Strength'].default_value = original_strength[frame] * 0.75
        ground_emission.inputs['Strength'].keyframe_insert('default_value', frame=frame)
        for obj in flames:
            radius = math.hypot(obj.location.x, obj.location.y)
            obj.scale.z *= 1.0 if radius < 1.6 else (0.65 if radius < 2.5 else 0.45)
            obj.keyframe_insert('scale', frame=frame)
        for name, mat in zip(puff_names, puff_mats):
            puff = bpy.data.objects[name]
            puff.scale *= 0.65
            puff.keyframe_insert('scale', frame=frame)
            socket = mat.node_tree.nodes['DISSIPACAO | opacidade'].inputs[0]
            socket.default_value *= 0.6
            socket.keyframe_insert('default_value', frame=frame)
    ring = bpy.data.objects['Onda de impacto | anel expansivo']
    for i, vertex in enumerate(ring.data.vertices):
        if i % 2:
            angle = TAU * (i // 2) / 192
            radius = 0.984 + 0.028 * math.sin(angle * 15)
            vertex.co.x = radius * math.cos(angle)
            vertex.co.y = radius * math.sin(angle)
    scene['impact_art_revision'] = 1
    scene.frame_set(43)
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.eevee.taa_render_samples = 48
    scene.render.filepath = str(OUT / 'fireball-impact-preview.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'fireball-impact.blend'), compress=True)
    render_previews(scene)


if __name__ == '__main__':
    refine_saved_scene() if '--refine' in sys.argv else build()
