from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
out = root / 'public' / 'brand'
out.mkdir(parents=True, exist_ok=True)
for source, name, size in [('logo (2).png','logo-horizontal',800),('logo (6).png','logo',600),('logo (1).png','symbol',512),('logo (3).png','logo-light',600)]:
    image = Image.open(root / source).convert('RGBA')
    bounds = image.getchannel('A').point(lambda p: 255 if p > 80 else 0).getbbox()
    image = image.crop(bounds)
    image.thumbnail((size,size), Image.Resampling.LANCZOS)
    image.save(out / f'{name}.webp', 'WEBP', quality=90)
    if name == 'symbol':
        for px, filename in [(32,'favicon'),(180,'apple-touch-icon'),(192,'icon-192'),(512,'icon-512')]:
            icon = Image.new('RGBA',(px,px),(7,21,46,255))
            symbol=image.copy()
            symbol.thumbnail((int(px*.82),int(px*.82)), Image.Resampling.LANCZOS)
            icon.alpha_composite(symbol,((px-symbol.width)//2,(px-symbol.height)//2))
            icon.save(out / f'{filename}.png', optimize=True)
shots = root / 'public' / 'screenshots'
for png in shots.glob('*.png'):  # capturas reais do Playwright -> WebP leve para a landing
    image = Image.open(png).convert('RGB')
    image.thumbnail((2000, 2000), Image.Resampling.LANCZOS)
    image.save(png.with_suffix('.webp'), 'WEBP', quality=82)
    png.unlink()
print('Assets otimizados; originais preservados.')
