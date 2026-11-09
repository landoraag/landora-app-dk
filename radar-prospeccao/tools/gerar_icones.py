"""Gera os ícones do Radar: o "L" da Landora com um pequeno radar no canto superior direito.

Uso (na pasta radar-prospeccao):  python3 tools/gerar_icones.py
Base: ../landora-app/public/icon-512.png (ícone do app Landora). Saída: public/.
"""
import math, os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BASE = os.path.join(ROOT, "..", "landora-app", "public", "icon-512.png")
OUT = os.path.join(ROOT, "public")
S = 4  # desenha 4x maior e reduz: bordas suaves

def radar_layer(size=512, cx=332, cy=186, r=74, grosso=1.0):
    W = size * S
    lay = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    X, Y, R = cx * S, cy * S, r * S
    # varredura: setor com brilho que some para trás
    sweep = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    ds = ImageDraw.Draw(sweep)
    end = -50  # graus (0 = direita, sentido horário no PIL)
    for i in range(70):
        a0 = end - 70 + i
        alpha = int(6 + 120 * (i / 69) ** 1.6)
        ds.pieslice([X - R, Y - R, X + R, Y + R], a0, a0 + 1.6, fill=(90, 160, 255, alpha))
    lay = Image.alpha_composite(lay, sweep)
    d = ImageDraw.Draw(lay)
    # anéis
    for k, (rr, w, a) in enumerate([(1.0, 7, 235), (0.64, 6, 200), (0.30, 5, 170)]):
        q = R * rr
        d.ellipse([X - q, Y - q, X + q, Y + q], outline=(77, 141, 255, a), width=max(1, int(w * S * grosso / 2)))
    # ponteiro da varredura
    ang = math.radians(end)
    d.line([X, Y, X + R * math.cos(ang), Y + R * math.sin(ang)], fill=(150, 190, 255, 255), width=max(1, int(6 * S * grosso / 2)))
    # centro
    c = 7 * S * grosso
    d.ellipse([X - c, Y - c, X + c, Y + c], fill=(150, 190, 255, 255))
    # "blip": um lead encontrado, com brilho
    bx, by = X + R * 0.52 * math.cos(math.radians(-78)), Y + R * 0.52 * math.sin(math.radians(-78))
    glow = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    g = 22 * S
    ImageDraw.Draw(glow).ellipse([bx - g, by - g, bx + g, by + g], fill=(34, 197, 94, 120))
    glow = glow.filter(ImageFilter.GaussianBlur(9 * S))
    lay = Image.alpha_composite(lay, glow)
    b = 9 * S * grosso
    ImageDraw.Draw(lay).ellipse([bx - b, by - b, bx + b, by + b], fill=(74, 222, 128, 255))
    return lay.resize((size, size), Image.LANCZOS)

def main():
    base = Image.open(BASE).convert("RGBA")
    icon = Image.alpha_composite(base, radar_layer())
    icon.save(os.path.join(OUT, "icon-512.png"))
    icon.resize((192, 192), Image.LANCZOS).save(os.path.join(OUT, "icon-192.png"))
    icon.convert("RGB").resize((180, 180), Image.LANCZOS).save(os.path.join(OUT, "apple-touch-icon.png"))
    # favicon: radar maior e com traço grosso para continuar legível em 16-64 px
    fav = Image.alpha_composite(base, radar_layer(cx=322, cy=196, r=100, grosso=2.2))
    fav.resize((64, 64), Image.LANCZOS).save(os.path.join(OUT, "favicon-64.png"))
    fav.save(os.path.join(OUT, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    # maskable: o celular recorta em círculo/gota; encolhe o desenho para caber na área segura (80%)
    bg = Image.new("RGBA", (512, 512), base.getpixel((5, 5)))
    small = icon.resize((420, 420), Image.LANCZOS)
    bg.alpha_composite(small, (46, 46))
    bg.save(os.path.join(OUT, "icon-maskable-512.png"))
    print("ícones gerados em", OUT)

if __name__ == "__main__":
    main()
