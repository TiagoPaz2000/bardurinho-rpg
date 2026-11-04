"""Reference extraction and review encoding for the ground-impact VFX."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(os.environ['TEMP']) / 'codex-vfx-media-tools'))
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'art/vfx/fireball-impact'
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def reference():
    destination = OUT / 'reference'
    destination.mkdir(parents=True, exist_ok=True)
    source = Path(r'C:\Users\User\Downloads\gemini_generated_video_dc809d69.mp4')
    metadata = subprocess.run([FFMPEG, '-hide_banner', '-i', str(source)], capture_output=True, text=True)
    print(metadata.stderr)
    subprocess.run([FFMPEG, '-y', '-hide_banner', '-loglevel', 'error', '-i', str(source),
                    '-vf', 'fps=3,scale=384:-1', '-frames:v', '36', str(destination / 'frame-%03d.png')], check=True)
    paths = sorted(destination.glob('frame-*.png'))
    frames = [Image.open(p).convert('RGB') for p in paths]
    width, height = frames[0].size
    sheet = Image.new('RGB', (width * 4, (height + 24) * ((len(frames) + 3) // 4)), '#17191B')
    draw = ImageDraw.Draw(sheet)
    for i, frame in enumerate(frames):
        x, y = (i % 4) * width, (i // 4) * (height + 24)
        sheet.paste(frame, (x, y + 24))
        draw.text((x + 12, y + 6), f'{i / 3:.2f} s', fill='#EAE5D9')
    sheet.save(destination / 'video-contact-sheet.png')
    print('REFERENCE_SHEET', destination / 'video-contact-sheet.png')


def encode():
    frames_dir = OUT / 'animation-frames'
    frames = sorted(frames_dir.glob('impact-*.png'))
    if len(frames) != 60:
        raise SystemExit(f'Expected 60 sampled frames, found {len(frames)}')
    subprocess.run([FFMPEG, '-y', '-hide_banner', '-loglevel', 'error', '-framerate', '12',
                    '-i', str(frames_dir / 'impact-%03d.png'), '-c:v', 'libx264', '-crf', '18',
                    '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
                    str(OUT / 'fireball-impact.mp4')], check=True)
    images = [Image.open(p).convert('RGB').resize((640, 360), Image.Resampling.LANCZOS) for p in frames]
    palette_sheet = Image.new('RGB', (800, 1080))
    for i, image in enumerate(images):
        palette_sheet.paste(image.resize((160, 90)), ((i % 5) * 160, (i // 5) * 90))
    palette = palette_sheet.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
    indexed = [image.quantize(palette=palette, dither=Image.Dither.NONE) for image in images]
    indexed[0].save(OUT / 'fireball-impact.gif', save_all=True, append_images=indexed[1:],
                    duration=[80, 80, 90] * 20, loop=0, disposal=2, optimize=False)
    with Image.open(OUT / 'fireball-impact.gif') as gif:
        duration = 0
        for i in range(gif.n_frames):
            gif.seek(i)
            duration += gif.info['duration']
        print('GIF_VALIDATED', gif.n_frames, duration, gif.size)
        assert 1 < gif.n_frames <= 60 and duration == 5000
    subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-i', str(OUT / 'fireball-impact.mp4'),
                    '-f', 'null', '-'], check=True)
    print('MP4_DECODE_VALIDATED', OUT / 'fireball-impact.mp4')


def stills():
    frames = [(9, 'QUEDA'), (22, 'IMPACTO'), (32, 'EXPANSAO'), (43, 'FOGO E FUMACA'),
              (64, 'CHAMAS'), (90, 'DISSIPACAO'), (114, 'ULTIMAS BRASAS'), (120, 'APAGADO')]
    sheet = Image.new('RGB', (1536, 488), '#151719')
    draw = ImageDraw.Draw(sheet)
    for i, (frame, title) in enumerate(frames):
        path = OUT / ('fireball-impact-preview.png' if frame == 43 else f'keyframe-{frame:03d}.png')
        image = Image.open(path).convert('RGB').resize((384, 216), Image.Resampling.LANCZOS)
        x, y = (i % 4) * 384, (i // 4) * 244
        sheet.paste(image, (x, y + 28))
        draw.text((x + 12, y + 8), f'{frame:03d} | {title}', fill='#E7D9BA')
    sheet.save(OUT / 'impact-contact-sheet.png')
    print('STILLS_SHEET', OUT / 'impact-contact-sheet.png')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['reference', 'encode', 'stills'])
    args = parser.parse_args()
    {'reference': reference, 'encode': encode, 'stills': stills}[args.mode]()
