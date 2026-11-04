"""Build an editable, reference-led fireball in Blender 5.2.

Run from the repository root with Blender --background --factory-startup
--python tools/vfx/build_fireball.py. No add-ons, simulations or downloaded assets.
"""

import math
import random
from pathlib import Path

import bpy
from mathutils import Vector, noise


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "art/vfx/fireball"
REFERENCE = Path(r"C:\Users\User\AppData\Local\Temp\orca-paste-1793792410218-d8b02d12-8795-401d-8916-d7074f83bdcd.png")
TAU = math.tau
RNG = random.Random(1703)
FRAMES = 48


def rgba(hex_color):
    values = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in values) + (1,)


def collection(name):
    item = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(item)
    return item


def move_to(obj, target, parent=None):
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    target.objects.link(obj)
    obj.parent = parent
    return obj


def empty(name, target, parent=None):
    obj = bpy.data.objects.new(name, None)
    target.objects.link(obj)
    obj.parent = parent
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.28
    return obj


def new_material(name, color):
    material = bpy.data.materials.new(name)
    material.diffuse_color = rgba(color)
    material.use_nodes = True
    material.node_tree.nodes.clear()
    output = material.node_tree.nodes.new("ShaderNodeOutputMaterial")
    output.location = (720, 0)
    return material, material.node_tree.nodes, material.node_tree.links, output


def color_ramp(nodes, name, stops, location, interpolation="CONSTANT"):
    node = nodes.new("ShaderNodeValToRGB")
    node.label = name
    node.name = name
    node.location = location
    ramp = node.color_ramp
    ramp.interpolation = interpolation
    while len(ramp.elements) > 1:
        ramp.elements.remove(ramp.elements[-1])
    for index, (position, color) in enumerate(stops):
        element = ramp.elements[0] if index == 0 else ramp.elements.new(position)
        element.position = position
        element.color = rgba(color)
    return node


def emission_material(name, color, strength=1.0):
    mat, nodes, links, output = new_material(name, color)
    emission = nodes.new("ShaderNodeEmission")
    emission.location = (420, 0)
    emission.inputs["Color"].default_value = rgba(color)
    emission.inputs["Strength"].default_value = strength
    links.new(emission.outputs[0], output.inputs["Surface"])
    return mat


def patterned_fire(texture_space):
    mat, nodes, links, output = new_material("FIRE | broad orange islands / lemon core", "#FFDC45")
    coords = nodes.new("ShaderNodeTexCoord")
    coords.object = texture_space
    coords.location = (-860, 0)
    tex = nodes.new("ShaderNodeTexNoise")
    tex.name = "Large rounded islands"
    tex.label = "LARGE patches - scale 2.35"
    tex.location = (-620, 0)
    tex.noise_dimensions = "4D"
    tex.inputs["Scale"].default_value = 2.35
    tex.inputs["Detail"].default_value = 0.35
    tex.inputs["Roughness"].default_value = 0.48
    tex.inputs["Distortion"].default_value = 0.22
    tex.inputs["W"].default_value = 0.73
    links.new(coords.outputs["Object"], tex.inputs["Vector"])
    ramp = color_ramp(nodes, "Hard-edged fire palette", [
        (0, "#E74302"), (0.40, "#FF7504"),
        (0.49, "#FFF15C"), (0.68, "#FFF7AB"),
    ], (-340, 40))
    links.new(tex.outputs["Fac"], ramp.inputs["Fac"])
    emission = nodes.new("ShaderNodeEmission")
    emission.location = (420, 0)
    emission.inputs["Strength"].default_value = 2.1
    links.new(ramp.outputs["Color"], emission.inputs["Color"])
    links.new(emission.outputs[0], output.inputs["Surface"])
    for frame in range(1, FRAMES + 2):
        phase = TAU * (frame - 1) / FRAMES
        tex.inputs["W"].default_value = 0.73 + 0.21 * math.sin(phase)
        tex.inputs["W"].keyframe_insert("default_value", frame=frame)
        emission.inputs["Strength"].default_value = 2.1 + 0.13 * math.sin(phase * 3 + 0.3)
        emission.inputs["Strength"].keyframe_insert("default_value", frame=frame)
    return mat


def smoke_material(texture_space):
    mat, nodes, links, output = new_material("SMOKE | charcoal cooling to embers near core", "#30100A")
    coords = nodes.new("ShaderNodeTexCoord")
    coords.object = texture_space
    coords.location = (-1000, 200)
    split = nodes.new("ShaderNodeSeparateXYZ")
    split.location = (-800, 200)
    links.new(coords.outputs["Object"], split.inputs[0])
    remap = nodes.new("ShaderNodeMapRange")
    remap.location = (-620, 240)
    remap.inputs["From Min"].default_value = -3.8
    remap.inputs["From Max"].default_value = 0.75
    links.new(split.outputs["X"], remap.inputs["Value"])
    body = color_ramp(nodes, "Cooling smoke body", [
        (0, "#170B09"), (0.35, "#260B07"), (0.64, "#4D1005"),
        (0.83, "#7B2306"), (1, "#9F3205"),
    ], (-330, 300), "LINEAR")
    links.new(remap.outputs[0], body.inputs[0])
    hot = color_ramp(nodes, "Embers fade along tail", [
        (0, "#050000"), (0.40, "#120200"), (0.57, "#781000"),
        (0.78, "#F45500"), (0.96, "#FFAB0C"),
    ], (-340, -30), "LINEAR")
    links.new(remap.outputs[0], hot.inputs[0])
    tex = nodes.new("ShaderNodeTexNoise")
    tex.location = (-800, -280)
    tex.inputs["Scale"].default_value = 5.2
    tex.inputs["Detail"].default_value = 0.5
    links.new(coords.outputs["Object"], tex.inputs["Vector"])
    threshold = nodes.new("ShaderNodeMath")
    threshold.operation = "GREATER_THAN"
    threshold.inputs[1].default_value = 0.58
    threshold.location = (-540, -240)
    links.new(tex.outputs["Fac"], threshold.inputs[0])
    multiply = nodes.new("ShaderNodeMixRGB")
    multiply.blend_type = "MULTIPLY"
    multiply.inputs[0].default_value = 1
    multiply.location = (-40, -60)
    links.new(hot.outputs[0], multiply.inputs[1])
    links.new(threshold.outputs[0], multiply.inputs[2])
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.location = (240, 200)
    shader.inputs["Roughness"].default_value = 0.95
    shader.inputs["Specular IOR Level"].default_value = 0.08
    shader.inputs["Emission Strength"].default_value = 1.6
    links.new(body.outputs[0], shader.inputs["Base Color"])
    links.new(multiply.outputs[0], shader.inputs["Emission Color"])
    links.new(shader.outputs[0], output.inputs["Surface"])
    return mat


def blob(name, location, scale, material, target, parent, seed=0, detail=3, amplitude=0.12):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=detail, radius=1)
    obj = bpy.context.object
    obj.name = name
    for vertex in obj.data.vertices:
        p = vertex.co.copy()
        n = noise.noise_vector(p * 2.5 + Vector((seed * 2.6, 0.31, -1.7)))
        radius = 1 + amplitude * n.x + amplitude * 0.35 * math.sin(p.z * 7 + p.x * 5 + seed)
        vertex.co *= radius
    obj.location = location
    obj.scale = scale
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    move_to(obj, target, parent)
    return obj


def flame_tongue(name, points, radii, material, target, parent, seed=0):
    """Editable ring sweep. Narrow flat sections give flowing, pointed flames."""
    vertices, faces = [], []
    sides = 10
    for index, (point, radius) in enumerate(zip(points, radii)):
        p = Vector(point)
        if index == len(points) - 1:
            tangent = (p - Vector(points[index - 1])).normalized()
        else:
            tangent = (Vector(points[index + 1]) - p).normalized()
        side = tangent.cross(Vector((0, 1, 0))).normalized()
        depth = side.cross(tangent).normalized()
        for j in range(sides):
            theta = TAU * j / sides
            vertices.append(p + side * radius * math.cos(theta) + depth * radius * 0.38 * math.sin(theta))
    for i in range(len(points) - 1):
        for j in range(sides):
            a, b = i * sides + j, i * sides + (j + 1) % sides
            faces.append((a, a + sides, b + sides, b))
    faces.append(tuple(range(sides)))
    faces.append(tuple((len(points) - 1) * sides + j for j in reversed(range(sides))))
    mesh = bpy.data.meshes.new(name + " | editable sections")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    target.objects.link(obj)
    obj.parent = parent
    mesh.materials.append(material)
    sub = obj.modifiers.new("Smooth flame sections", "SUBSURF")
    sub.levels = 2
    sub.render_levels = 2
    for face in mesh.polygons:
        face.use_smooth = True
    obj["edit_hint"] = "Edit the sparse ring sections; subdivision remains live."
    for frame in range(1, FRAMES + 2):
        theta = TAU * (frame - 1) / FRAMES
        obj.rotation_euler.x = 0.04 * math.sin(theta * 2 + seed)
        obj.rotation_euler.y = 0.025 * math.sin(theta + seed)
        obj.keyframe_insert("rotation_euler", frame=frame)
    return obj


def crescent(name, start, end, radius, width, depth, material, target, parent):
    vertices, faces = [], []
    count = 34
    for i in range(count):
        u = i / (count - 1)
        angle = start + (end - start) * u
        taper = max(0.008, math.sin(math.pi * u) ** 0.72)
        waviness = 0.035 * math.sin(u * 23) + 0.018 * math.sin(u * 49)
        for inner in (0, 1):
            r = radius + waviness - inner * width * taper
            vertices.append((1.25 + r * math.cos(angle), depth + 0.12 * math.sin(u * 4), r * math.sin(angle) * 0.94))
    for i in range(count - 1):
        faces.append((2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2))
    mesh = bpy.data.meshes.new(name + " | curved strip")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    target.objects.link(obj)
    obj.parent = parent
    mesh.materials.append(material)
    solid = obj.modifiers.new("Thin shock shell", "SOLIDIFY")
    solid.thickness = 0.035
    solid.offset = 0
    return obj


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def configure_compositor(scene):
    tree = bpy.data.node_groups.new("FIREBALL | restrained optical glow", "CompositorNodeTree")
    scene.compositing_node_group = tree
    tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    render = tree.nodes.new("CompositorNodeRLayers")
    render.location = (-300, 0)
    glare = tree.nodes.new("CompositorNodeGlare")
    glare.name = "Soft halo - keep the orange shapes readable"
    glare.location = (0, 0)
    glare.inputs["Type"].default_value = "Fog Glow"
    glare.inputs["Quality"].default_value = "High"
    glare.inputs["Threshold"].default_value = 0.65
    glare.inputs["Strength"].default_value = 1.2
    glare.inputs["Size"].default_value = 0.25
    bloom = tree.nodes.new("CompositorNodeGlare")
    bloom.name = "Warm surrounding glow"
    bloom.location = (270, 0)
    bloom.inputs["Type"].default_value = "Bloom"
    bloom.inputs["Quality"].default_value = "High"
    bloom.inputs["Threshold"].default_value = 0.7
    bloom.inputs["Strength"].default_value = 0.16
    bloom.inputs["Size"].default_value = 0.30
    bloom.inputs["Tint"].default_value = (1, 0.36, 0.04, 1)
    output = tree.nodes.new("NodeGroupOutput")
    output.location = (540, 0)
    tree.links.new(render.outputs["Image"], glare.inputs["Image"])
    tree.links.new(glare.outputs["Image"], bloom.inputs["Image"])
    tree.links.new(bloom.outputs["Image"], output.inputs["Image"])


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "BOLA DE FOGO | reference study"
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 64
    scene.render.resolution_x = 1080
    scene.render.resolution_y = 1080
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.fps = 24
    scene.frame_start = 1
    scene.frame_end = FRAMES
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new("Charcoal backdrop")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = rgba("#303132")
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1

    controls = collection("00 | CONTROLES")
    cores = collection("01 | NUCLEO AMARELO")
    flames = collection("02 | CHAMAS E CONTORNOS")
    smokes = collection("03 | FUMACA E BRASAS")
    sparks = collection("04 | FAISCAS")
    studio = collection("05 | CAMERA E LUZES")
    references = collection("06 | REFERENCIA")
    rig = empty("FIREBALL | mover e escalar o efeito inteiro", controls)
    rig["direction"] = "+X; tail flows towards -X"
    rig["loop"] = "Frames 1-48, 24 fps. Frame 49 repeats frame 1."
    rig["source"] = "Stylized fireball matching the supplied image; native Blender concept asset."
    core_rig = empty("CORE | pulsacao", controls, rig)
    texture_space = empty("FIRE PATTERN | mover para ajustar manchas", controls, rig)
    texture_space.scale = (1.0, 1.0, 1.0)
    core_mat = patterned_fire(texture_space)
    yellow = emission_material("FIRE | lemon yellow", "#FFE752", 1.8)
    orange = emission_material("FIRE | tangerine", "#FF6C04", 1.2)
    red = emission_material("FIRE | deep vermilion", "#E92D02", 0.95)
    peach = emission_material("EDGE | pale warm shock rim", "#E4B895", 0.85)
    ivory = emission_material("EDGE | hot ivory inner rim", "#FFE0A8", 1.3)
    ember = emission_material("SPARK | incandescent orange", "#FF6F0B", 2.2)
    smoke = smoke_material(texture_space)

    core = blob("Nucleo | volume luminoso irregular", (1.20, 0, 0), (1.18, 0.91, 1.04), core_mat, cores, core_rig, seed=3.2, detail=5, amplitude=0.07)
    core["edit_hint"] = "Change the discrete ColorRamp and Noise scale in the FIRE material."
    for frame in range(1, FRAMES + 2):
        phase = TAU * (frame - 1) / FRAMES
        core_rig.scale = (1 + 0.022 * math.sin(phase * 2), 1 + 0.035 * math.sin(phase * 2 + 0.4), 1 + 0.035 * math.sin(phase * 2))
        core_rig.keyframe_insert("scale", frame=frame)

    flame_tongue("Chama superior | amarela", [(1.75, 0.05, 0.63), (1.2, 0.08, 0.94), (0.86, 0.1, 1.05), (0.62, 0.16, 0.96), (0.30, 0.1, 1.08), (0.08, 0.05, 1.00)], [0.16, 0.22, 0.20, 0.15, 0.13, 0.009], yellow, flames, rig, 1)
    flame_tongue("Chama superior | laranja", [(1.21, -0.28, 0.92), (0.79, -0.22, 1.12), (0.42, -0.16, 1.08), (0.38, -0.05, 1.30), (-0.12, 0.06, 1.24)], [0.12, 0.15, 0.18, 0.12, 0.007], orange, flames, rig, 2)
    flame_tongue("Chama inferior | lingua longa", [(1.55, 0.12, -0.74), (0.9, 0.06, -0.98), (0.50, -0.02, -0.88), (0.2, -0.12, -1.05), (-0.2, -0.05, -0.83), (-0.73, 0.02, -0.72)], [0.17, 0.24, 0.24, 0.16, 0.14, 0.008], yellow, flames, rig, 3)
    flame_tongue("Chama inferior | borda vermelha", [(1.38, -0.3, -0.93), (0.75, -0.34, -1.05), (0.42, -0.4, -1.11), (0.03, -0.43, -0.85), (-0.4, -0.2, -0.97)], [0.07, 0.11, 0.12, 0.12, 0.007], red, flames, rig, 5)
    flame_tongue("Fluxo lateral | chama de ligacao", [(0.73, -0.36, 0.12), (0.16, -0.46, 0.28), (-0.34, -0.42, 0.13), (-0.78, -0.36, 0.27), (-1.25, -0.12, 0.17)], [0.23, 0.31, 0.27, 0.18, 0.008], orange, flames, rig, 7)
    flame_tongue("Fluxo lateral | filete amarelo", [(0.64, -0.55, -0.37), (0.07, -0.58, -0.28), (-0.3, -0.56, -0.42), (-0.74, -0.32, -0.3)], [0.16, 0.21, 0.13, 0.007], yellow, flames, rig, 8)
    crescent("Borda externa | arco palido", -1.63, 1.02, 1.43, 0.14, 0.03, peach, flames, rig)
    crescent("Borda interna | crescente quente", -1.16, 0.70, 1.30, 0.075, -0.24, ivory, flames, rig)
    crescent("Fragmento inferior | choque", -1.91, -0.68, 1.48, 0.075, 0.16, peach, flames, rig)

    # Sparse, lobed puff groups retain separately editable 3D surfaces.
    for i in range(11):
        puff = empty(f"Fumaca {i + 1:02d} | fluxo ciclico", smokes, rig)
        phase_offset = (i / 11 + 0.027) % 1
        base_y = RNG.uniform(-0.16, 0.22)
        base_z = RNG.uniform(-0.18, 0.19)
        base_seed = i * 3.7
        blob(f"Fumaca {i + 1:02d} | massa", (0, 0, 0), (1, 0.91, 0.88), smoke, smokes, puff, base_seed, 3, 0.16)
        for j in range(5):
            angle = TAU * j / 5 + i * 0.76
            offset = (0.63 * math.cos(angle), RNG.uniform(-0.37, 0.10), 0.59 * math.sin(angle))
            size = RNG.uniform(0.33, 0.47)
            blob(f"Fumaca {i + 1:02d} | lobulo {j + 1}", offset, (size, size * 0.86, size), smoke, smokes, puff, base_seed + j, 2, 0.16)
        for frame in range(1, FRAMES + 2):
            theta = (frame - 1) / FRAMES
            age = (theta + phase_offset) % 1
            envelope = min(1.0, age / 0.075) * min(1.0, (1 - age) / 0.09)
            radius = (0.59 - 0.40 * age) * max(0.001, envelope)
            puff.location = (0.37 - 5.33 * age, base_y - 0.30, base_z + 0.09 * math.sin(age * 12 + i))
            puff.scale = (radius * (1.03 + 0.06 * math.sin(age * 8 + i)), radius, radius)
            puff.rotation_euler = (age * 0.65 + i, age * 0.36, 0.14 * math.sin(age * 7 + i))
            puff.keyframe_insert("location", frame=frame)
            puff.keyframe_insert("scale", frame=frame)
            puff.keyframe_insert("rotation_euler", frame=frame)

    for i in range(14):
        spark = blob(f"Faisca {i + 1:02d}", (0, 0, 0), (1, 1, 1), ember if i % 3 else red, sparks, rig, seed=i, detail=1, amplitude=0.10)
        phase_offset = RNG.random()
        lateral = RNG.choice((-1, 1))
        speed = RNG.uniform(3.1, 5.5)
        spread = RNG.uniform(0.6, 1.2)
        depth = RNG.uniform(-0.6, 0.4)
        size = RNG.uniform(0.025, 0.055)
        for frame in range(1, FRAMES + 2):
            age = ((frame - 1) / FRAMES + phase_offset) % 1
            fade = math.sin(math.pi * age) ** 0.65
            spark.location = (0.8 - speed * age, depth, lateral * (0.25 + spread * age) + 0.1 * math.sin(age * 8 + i))
            spark.scale = (size * 1.8 * fade + 0.0001, size * 0.5 * fade + 0.0001, size * 0.55 * fade + 0.0001)
            spark.rotation_euler.y = lateral * 0.3
            spark.keyframe_insert("location", frame=frame)
            spark.keyframe_insert("scale", frame=frame)

    bpy.ops.object.camera_add(location=(-0.95, -16, 3.1))
    cam = move_to(bpy.context.object, studio)
    cam.name = "Camera | REFERENCIA - vista principal"
    aim(cam, (-0.95, 0, 0.04))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 9.35
    cam.data.lens = 50
    scene.camera = cam
    bpy.ops.object.camera_add(location=(-0.95, 0, 16))
    top = move_to(bpy.context.object, studio)
    top.name = "Camera | TOPO - conferir volume"
    aim(top, (-0.95, 0, 0))
    top.data.type = "ORTHO"
    top.data.ortho_scale = 9.35

    bpy.ops.object.light_add(type="AREA", location=(-0.4, -4, 5))
    key = move_to(bpy.context.object, studio)
    key.name = "Luz | preenchimento suave"
    key.data.energy = 180
    key.data.shape = "DISK"
    key.data.size = 7
    key.data.color = (1, 0.7, 0.47)
    aim(key, (0, 0, 0))
    bpy.ops.object.light_add(type="POINT", location=(0.45, -1.9, 0.35))
    point = move_to(bpy.context.object, studio, rig)
    point.name = "Luz | fogo refletido na fumaca"
    point.data.color = (1, 0.16, 0.015)
    point.data.shadow_soft_size = 1.4
    for frame in range(1, FRAMES + 2):
        point.data.energy = 38 + 9 * math.sin(TAU * (frame - 1) / FRAMES * 3)
        point.data.keyframe_insert("energy", frame=frame)

    if REFERENCE.exists():
        image = bpy.data.images.load(str(REFERENCE), check_existing=True)
        image.name = "REFERENCE | supplied stylized fireball"
        image.pack()
        reference = empty("Referencia original | imagem empacotada", references)
        reference.empty_display_type = "IMAGE"
        reference.data = image
        reference.empty_display_size = 6
        reference.location = (0, 4, 0)
        reference.rotation_euler.x = math.pi / 2
        reference.hide_render = True
        reference.hide_viewport = True
    configure_compositor(scene)
    instructions = bpy.data.texts.new("LEIA-ME | bola de fogo")
    instructions.write("""BOLA DE FOGO ESTILIZADA - estudo da referencia fornecida

Abrir a camera principal com Numpad 0 e renderizar com F12.
Espaco: tocar o loop de 2 segundos (frames 1-48, 24 fps).
O frame 49 duplica o frame 1 para fechar o ciclo.

00 CONTROLES: FIREBALL move/escala o efeito; CORE pulsa o nucleo.
01 NUCLEO: malha 3D irregular. No material FIRE, ColorRamp controla
   as cores e Noise Scale controla o tamanho das manchas.
02 CHAMAS: malhas com secoes esparsas e Subdivision nao aplicado.
   Os arcos claros sao cascas finas com Solidify editavel.
03 FUMACA: onze grupos de massas e lobulos 3D; fluxo por keyframes.
   O material esfria pela coordenada X local do controle FIRE PATTERN.
04 FAISCAS: quatorze fragmentos animados.
05 CAMERA E LUZES: camera principal e camera de topo, luzes animadas.
06 REFERENCIA: imagem original empacotada, oculta na renderizacao.

O Compositor tem Fog Glow moderado. Emissao, halo e luz pontual
sao configurados separadamente. A cena usa Eevee e materiais nativos.
Nenhum plugin, imagem externa ou cache de simulacao e necessario.

Uso: conceito 3D editavel no Blender. Nao ha exportacao ou integracao
com o jogo; shaders procedurais e compositor precisam de adaptacao
para motores de tempo real. Escala artistica: nucleo ~2.4 unidades.
Fonte reproduzivel: tools/vfx/build_fireball.py.
""")
    scene.timeline_markers.new("LOOP | inicio", frame=1)
    scene.timeline_markers.new("PREVIA | pose principal", frame=13)
    scene.timeline_markers.new("LOOP | ultimo quadro", frame=48)
    scene.frame_set(13)
    bpy.ops.object.select_all(action="DESELECT")
    core.select_set(True)
    bpy.context.view_layer.objects.active = core
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                space = area.spaces.active
                space.region_3d.view_perspective = "CAMERA"
                space.overlay.show_overlays = False
                space.shading.type = "MATERIAL"
                space.shading.use_scene_world = True
                space.shading.use_scene_lights = True
    scene.render.filepath = str(OUT / "fireball-preview.png")
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "fireball-stylized.blend"), compress=True)
    bpy.ops.render.render(write_still=True)
    print("FIREBALL_BUILD_COMPLETE", str(OUT), flush=True)


if __name__ == "__main__":
    build()
