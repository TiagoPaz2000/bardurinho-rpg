"""Encode the rendered Blender frames as a two-second review GIF.

Run with the system Python after inspect_fireball.py. Requires Pillow.
"""

from pathlib import Path

from PIL import Image, ImageDraw


OUT = Path(__file__).resolve().parents[2] / "art/vfx/fireball"
paths = [OUT / "animation-frames" / f"fireball-{frame:03d}.png" for frame in range(1, 49, 2)]
if not all(path.is_file() for path in paths):
    raise SystemExit("Render all 24 inspection frames before encoding the preview.")
frames = [Image.open(path).convert("RGB") for path in paths]

# One palette for the entire loop avoids palette flicker in the dark smoke.
atlas = Image.new("RGB", (600, 900))
for index, frame in enumerate(frames):
    atlas.paste(frame.resize((150, 150), Image.Resampling.LANCZOS), ((index % 4) * 150, (index // 4) * 150))
palette = atlas.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
indexed = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]
durations = [80, 80, 90] * 8  # GIF timings are in 10 ms units: exactly 2000 ms.
indexed[0].save(OUT / "fireball-loop.gif", save_all=True, append_images=indexed[1:], duration=durations, loop=0, disposal=2, optimize=False)

sheet = Image.new("RGB", (1200, 650), "#202122")
draw = ImageDraw.Draw(sheet)
for index, frame_number in enumerate((1, 13, 25, 37)):
    thumb = frames[(frame_number - 1) // 2].resize((600, 600), Image.Resampling.LANCZOS)
    # The crop removes only the empty upper/lower background around the effect.
    thumb = thumb.crop((0, 155, 600, 455))
    x, y = (index % 2) * 600, (index // 2) * 325
    sheet.paste(thumb, (x, y + 25))
    draw.text((x + 18, y + 8), f"FRAME {frame_number:02d} / 48", fill="#CBC6B8")
sheet.save(OUT / "animation-contact-sheet.png")

with Image.open(OUT / "fireball-loop.gif") as gif:
    duration = 0
    for index in range(gif.n_frames):
        gif.seek(index)
        duration += gif.info["duration"]
    assert gif.n_frames == 24 and duration == 2000
    print(f"GIF validated: {gif.n_frames} frames, {duration} ms, {gif.size}")
