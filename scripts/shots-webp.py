# Converte só as capturas PNG de public/screenshots para WebP (não regenera logos/ícones como assets.py).
from pathlib import Path
from PIL import Image

shots = Path(__file__).resolve().parent.parent / 'public' / 'screenshots'
for png in sorted(shots.glob('*.png')):
    image = Image.open(png).convert('RGB')
    image.thumbnail((2000, 2000), Image.Resampling.LANCZOS)
    image.save(png.with_suffix('.webp'), 'WEBP', quality=80, method=6)
    png.unlink()
    print(f'{png.stem}.webp {image.size[0]}x{image.size[1]}')
