from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
out = root / 'public' / 'brand'
pwa = root / 'public' / 'icons'
out.mkdir(parents=True, exist_ok=True)
pwa.mkdir(parents=True, exist_ok=True)

# Logos da marca (otimizados em WebP)
for source, name, size in [('logo (2).png','logo-horizontal',800),('logo (6).png','logo',600),('logo (1).png','symbol',512),('logo (3).png','logo-light',600)]:
    image = Image.open(root / source).convert('RGBA')
    bounds = image.getchannel('A').point(lambda p: 255 if p > 80 else 0).getbbox()
    image = image.crop(bounds)
    image.thumbnail((size,size), Image.Resampling.LANCZOS)
    image.save(out / f'{name}.webp', 'WEBP', quality=90)

# Símbolo base para os ícones
symbol_src = Image.open(root / 'logo (1).png').convert('RGBA')
bounds = symbol_src.getchannel('A').point(lambda p: 255 if p > 80 else 0).getbbox()
symbol_src = symbol_src.crop(bounds)

# Ícones PWA completos (regulares e maskable)
sizes = [16, 32, 48, 72, 96, 144, 180, 192, 384, 512]
bg = (6, 27, 61, 255) # #061B3D - Brand background

for px in sizes:
    # Regular (proporção ~84% com fundo azul-marinho PISTEC)
    reg = Image.new('RGBA', (px, px), bg)
    s = symbol_src.copy()
    inner = max(1, int(px * 0.84))
    s.thumbnail((inner, inner), Image.Resampling.LANCZOS)
    reg.alpha_composite(s, ((px - s.width) // 2, (px - s.height) // 2))
    reg.save(pwa / f'icon-{px}x{px}.png', optimize=True)

    # Maskable (área segura do W3C: símbolo contido no círculo de raio 40% do centro; ~70% do tamanho)
    mask = Image.new('RGBA', (px, px), bg)
    sm = symbol_src.copy()
    inner_m = max(1, int(px * 0.70))
    sm.thumbnail((inner_m, inner_m), Image.Resampling.LANCZOS)
    mask.alpha_composite(sm, ((px - sm.width) // 2, (px - sm.height) // 2))
    mask.save(pwa / f'icon-maskable-{px}x{px}.png', optimize=True)

# Favicon e atalhos na pasta brand/
for px, filename in [(32, 'favicon.png'), (180, 'apple-touch-icon.png'), (192, 'icon-192.png'), (512, 'icon-512.png')]:
    img = Image.open(pwa / f'icon-{px}x{px}.png')
    img.save(out / filename, optimize=True)

# Capturas de tela WebP
shots = root / 'public' / 'screenshots'
for png in shots.glob('*.png'):
    image = Image.open(png).convert('RGB')
    image.thumbnail((2000, 2000), Image.Resampling.LANCZOS)
    image.save(png.with_suffix('.webp'), 'WEBP', quality=82)
    png.unlink()

print(f'PWA icons gerados: {len(sizes) * 2} arquivos em public/icons/.')
