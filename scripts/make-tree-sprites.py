#!/usr/bin/env python3
"""Build top-down tree crowns, roof and wall textures from 0 A.D. art (CC BY-SA 3.0, Wildfire Games).

Each crown is many copies of one of 0 A.D.'s leaf cards, rotated around the trunk the way branches
spread when seen from above. Usage:
  python3 scripts/make-tree-sprites.py /path/to/0ad/binaries/data/mods/public/art/textures/skins
"""
import sys, random
from pathlib import Path
from PIL import Image, ImageEnhance, ImageDraw, ImageFilter
src = sys.argv[1]
out = Path(__file__).resolve().parent.parent / 'src' / 'client' / 'tex'
def branch(path, crop):
    im = Image.open(path).convert('RGBA').crop(crop)
    return im
def crown(br, n_outer=18, n_inner=12, size=512, seed=1, shade=0.55, lengths=(0.42,0.3)):
    random.seed(seed)
    canvas = Image.new('RGBA', (size, size), (0,0,0,0))
    c = size/2
    for ring, (n, L) in enumerate([(n_outer, lengths[0]), (n_inner, lengths[1]), (8, lengths[1]*0.6)]):
        for k in range(n):
            th = 360*k/n + random.uniform(-15,15) + ring*17
            s = L*size*random.uniform(0.85,1.1)/br.height
            b = br.resize((max(1,int(br.width*s)), max(1,int(br.height*s))), Image.LANCZOS)
            # darker for lower (outer) rings so the top reads brighter
            b = ImageEnhance.Brightness(b).enhance([shade + 0.3, 1.1, 1.35][ring])
            t = Image.new('RGBA', (size, size), (0,0,0,0))
            t.paste(b, (int(c-b.width/2), int(c-b.height)), b)
            t = t.rotate(th, resample=Image.BICUBIC, center=(c,c))
            canvas = Image.alpha_composite(canvas, t)
    canvas = ImageEnhance.Color(canvas).enhance(1.15)
    return canvas
oak = branch(f'{src}/gaia/oak_tree_a.png', (0,0,185,256))
temp = branch(f'{src}/gaia/temperate_tree_01.png', (0,0,185,256))
pine = branch(f'{src}/gaia/blackpine.png', (75,0,512,512))
def save(im, name):
    im.resize((256, 256), Image.LANCZOS).save(out / f'{name}.webp', quality=82, method=6)

save(crown(oak, seed=1), 'tree-oak')
save(crown(temp, seed=2), 'tree-birch')
save(crown(pine, n_outer=20, n_inner=14, seed=3, shade=0.6), 'tree-pine')

# Strips that tile left to right, scaled down for the web.
Image.open(f'{src}/structural/gaul_tile_mossy.png').convert('RGB').resize((512, 128), Image.LANCZOS).save(out / 'roof.jpg', quality=82)
Image.open(f'{src}/structural/stone_wall_gray_diff.png').convert('RGB').resize((512, 128), Image.LANCZOS).save(out / 'wall.jpg', quality=82)
