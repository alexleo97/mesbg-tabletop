#!/usr/bin/env python3
"""Copy terrain textures from 0 A.D. into src/client/tex, scaled for the web.

0 A.D.'s art is by Wildfire Games under CC BY-SA 3.0; see src/client/tex/README.md.
Usage: python3 scripts/import-0ad-textures.py /path/to/0ad/binaries/data/mods/public/art/textures/terrain/types
Needs Pillow. Get the source with a sparse clone of https://github.com/0ad/0ad.
"""
import sys
from pathlib import Path
from PIL import Image

# our material name -> 0 A.D. texture
TEXTURES = {
    'grass': 'temperate/grass_05.png',
    'plains': 'temperate/grass_03.png',
    'forest': 'temperate/forestfloor_003.png',
    'mud': 'temperate/mud_01.png',
    'rock': 'baltic_nordic/rock_moss_01.png',
    'cliff': 'alpine_arctic/cliff_01.png',
    'stone': 'temperate/paving_001.png',
    'ruin': 'alpine_arctic/paving_stones_01.png',
    'snow': 'alpine_arctic/snow_01.png',
    'sand': 'aegean_anatolia/sand_01.png',
    'farmland': 'temperate/farmland_01.png',
    'dirt': 'temperate/rocks_dirt_01.png',
}

src = Path(sys.argv[1])
out = Path(__file__).resolve().parent.parent / 'src' / 'client' / 'tex'
out.mkdir(parents=True, exist_ok=True)
for name, rel in TEXTURES.items():
    im = Image.open(src / rel).convert('RGB').resize((512, 512), Image.LANCZOS)
    im.save(out / f'{name}.jpg', quality=82, optimize=True, progressive=True)
    print(f'{name}.jpg <- {rel} ({(out / f"{name}.jpg").stat().st_size // 1024} KB)')
