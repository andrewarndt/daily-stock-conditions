"""Generate the three vending-machine renderings used in the vending page hero.

Writes vending/assets/machine-drink.svg, machine-snack.svg and
machine-vapor.svg. They are drawn procedurally (no photos): a slight
three-quarter view with a visible side panel, shaded products, coil
spirals, LED lighting and glass reflections, modelled on current
manufacturer product shots (Crane BevMax MEDIA2 drink and Merchant
Ambient MEDIA2 snack machines, VMFS tall vape kiosks).

Run from the repo root:  python vending/scripts/generate-machines.py
"""
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "assets"
W, H = 420, 680

# ---------------------------------------------------------------- shared defs

DEFS = """
  <filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9"/></filter>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2"/></filter>
  <filter id="glow-wide" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="10"/></filter>
  <filter id="grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="2" seed="7" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .06 0"/>
  </filter>
  <!-- cylinder shading laid over any bottle/can shape (object bounding box) -->
  <linearGradient id="cyl" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#000" stop-opacity=".55"/>
    <stop offset=".18" stop-color="#000" stop-opacity=".08"/>
    <stop offset=".32" stop-color="#fff" stop-opacity=".5"/>
    <stop offset=".42" stop-color="#fff" stop-opacity=".05"/>
    <stop offset=".78" stop-color="#000" stop-opacity=".1"/>
    <stop offset="1" stop-color="#000" stop-opacity=".6"/>
  </linearGradient>
  <!-- puffy pillow shading for bags and wrappers -->
  <radialGradient id="puff" cx=".38" cy=".38" r=".75">
    <stop offset="0" stop-color="#fff" stop-opacity=".42"/>
    <stop offset=".45" stop-color="#fff" stop-opacity=".05"/>
    <stop offset="1" stop-color="#000" stop-opacity=".45"/>
  </radialGradient>
  <linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#f4f6f8"/><stop offset=".45" stop-color="#9aa3ad"/>
    <stop offset=".55" stop-color="#6b747e"/><stop offset="1" stop-color="#d7dce1"/>
  </linearGradient>
  <linearGradient id="chrome-h" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#6b747e"/><stop offset=".35" stop-color="#eef1f4"/>
    <stop offset=".6" stop-color="#9aa3ad"/><stop offset="1" stop-color="#4c545d"/>
  </linearGradient>
  <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity=".16"/>
    <stop offset=".22" stop-color="#fff" stop-opacity=".03"/>
    <stop offset=".3" stop-color="#fff" stop-opacity=".13"/>
    <stop offset=".36" stop-color="#fff" stop-opacity="0"/>
    <stop offset=".7" stop-color="#fff" stop-opacity="0"/>
    <stop offset="1" stop-color="#fff" stop-opacity=".07"/>
  </linearGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#f3d9a2"/><stop offset="1" stop-color="#b08040"/>
  </linearGradient>
  <linearGradient id="recess" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#020407"/><stop offset="1" stop-color="#1c2229"/>
  </linearGradient>
  <linearGradient id="flap" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2a3139"/><stop offset=".5" stop-color="#3b444e"/><stop offset="1" stop-color="#1a1f25"/>
  </linearGradient>
"""


def svg_doc(title, defs, body):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-label="{title}">\n'
        f"<title>{title}</title>\n<defs>{DEFS}{defs}</defs>\n{body}\n</svg>\n"
    )


def cabinet(front_grad, side_grad, x0=70, x1=380, y0=24, y1=630, side=40):
    """Floor shadow, side panel (3/4 view), front face, plinth and grain."""
    return f"""
<ellipse cx="{(x0 + x1) / 2 - 12}" cy="{y1 + 24}" rx="{(x1 - x0) / 2 + 30}" ry="16" fill="#000" opacity=".55" filter="url(#soft)"/>
<polygon points="{x0 - side},{y0 + 22} {x0},{y0} {x0},{y1 + 6} {x0 - side},{y1 - 4}" fill="url(#{side_grad})"/>
<polygon points="{x0 - side},{y1 - 4} {x0},{y1 + 6} {x0},{y1 + 22} {x0 - side},{y1 + 10}" fill="#07090c"/>
<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0 + 6}" rx="7" fill="url(#{front_grad})"/>
<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0 + 6}" rx="7" filter="url(#grain)"/>
<rect x="{x0 + .5}" y="{y0 + .5}" width="{x1 - x0 - 1}" height="{y1 - y0 + 5}" rx="7" fill="none" stroke="#fff" stroke-opacity=".12"/>
<rect x="{x0}" y="{y1 + 6}" width="{x1 - x0}" height="16" fill="#0a0d11"/>
<rect x="{x0 + 14}" y="{y1 + 10}" width="{x1 - x0 - 28}" height="2" fill="#fff" opacity=".06"/>"""


# ---------------------------------------------------------------- products

def bottle(x, y, s, liquid, label, cap, liquid_opacity=0.92, back=False):
    """20oz-style bottle, bottom-centre at (x, y), scale s (base 20x62)."""
    shade = '<path d="M7,5h6v4c0,3 6,5 6,11v38c0,2.5-1.5,4-4,4h-10c-2.5,0-4-1.5-4-4v-38c0-6 6-8 6-11z" fill="#000" opacity=".5"/>' if back else ""
    return f"""<g transform="translate({x - 10 * s:.1f},{y - 62 * s:.1f}) scale({s})">
<path d="M7,5h6v4c0,3 6,5 6,11v38c0,2.5-1.5,4-4,4h-10c-2.5,0-4-1.5-4-4v-38c0-6 6-8 6-11z" fill="{liquid}" opacity="{liquid_opacity}"/>
<rect x="1" y="27" width="18" height="17" fill="{label}"/>
<rect x="1" y="33" width="18" height="4" fill="#fff" opacity=".55"/>
<path d="M7,5h6v4c0,3 6,5 6,11v38c0,2.5-1.5,4-4,4h-10c-2.5,0-4-1.5-4-4v-38c0-6 6-8 6-11z" fill="url(#cyl)"/>
<rect x="6" y="0" width="8" height="5.5" rx="1.2" fill="{cap}"/><rect x="6" y="0" width="8" height="5.5" rx="1.2" fill="url(#cyl)"/>
<path d="M8.5,10c-1.5,1.5-3,3-3.5,6" stroke="#fff" stroke-opacity=".55" stroke-width="1" fill="none"/>
{shade}</g>"""


def can(x, y, s, body, band, back=False):
    """12oz can, bottom-centre at (x, y), scale s (base 18x32)."""
    shade = '<rect x="0" y="2" width="18" height="28" rx="2" fill="#000" opacity=".5"/>' if back else ""
    return f"""<g transform="translate({x - 9 * s:.1f},{y - 32 * s:.1f}) scale({s})">
<rect x="0" y="2" width="18" height="28" rx="2" fill="{body}"/>
<rect x="0" y="12" width="18" height="7" fill="{band}"/>
<rect x="0" y="2" width="18" height="28" rx="2" fill="url(#cyl)"/>
<rect x="1" y="0" width="16" height="3.4" rx="1.6" fill="url(#chrome)"/>
<rect x="1" y="29" width="16" height="3" rx="1.4" fill="url(#chrome)"/>
{shade}</g>"""


def chip_bag(x, y, w, h, color, accent):
    """Crimped chip bag hanging in a coil, bottom-centre at (x, y)."""
    x0, y0 = x - w / 2, y - h
    zig_top = " ".join(f"L{x0 + i * w / 8:.1f},{y0 + (2.5 if i % 2 else 0):.1f}" for i in range(9))
    zig_bot = " ".join(f"L{x0 + w - i * w / 8:.1f},{y - (2.5 if i % 2 else 0):.1f}" for i in range(9))
    path = f"M{x0:.1f},{y0:.1f} {zig_top} L{x0 + w - 1:.1f},{y0 + h * .5:.1f} {zig_bot} L{x0 + 1:.1f},{y0 + h * .5:.1f}Z"
    return f"""<path d="{path}" fill="{color}"/>
<ellipse cx="{x:.1f}" cy="{y0 + h * .55:.1f}" rx="{w * .32:.1f}" ry="{h * .2:.1f}" fill="{accent}"/>
<rect x="{x0 + w * .15:.1f}" y="{y0 + h * .2:.1f}" width="{w * .7:.1f}" height="{h * .1:.1f}" rx="1.5" fill="#fff" opacity=".85"/>
<path d="{path}" fill="url(#puff)"/>
<path d="M{x0 + 2:.1f},{y0 + 5:.1f}H{x0 + w - 2:.1f}M{x0 + 2:.1f},{y - 5:.1f}H{x0 + w - 2:.1f}" stroke="#000" stroke-opacity=".25" stroke-width="1"/>"""


def bar(x, y, w, h, color, accent):
    """Upright candy bar wrapper with crimped ends, bottom-centre at (x, y)."""
    x0, y0 = x - w / 2, y - h
    return f"""<rect x="{x0:.1f}" y="{y0:.1f}" width="{w:.1f}" height="{h:.1f}" rx="1.5" fill="{color}"/>
<rect x="{x0 + w * .12:.1f}" y="{y0 + h * .3:.1f}" width="{w * .76:.1f}" height="{h * .32:.1f}" rx="1" fill="{accent}"/>
<rect x="{x0:.1f}" y="{y0:.1f}" width="{w:.1f}" height="3" fill="#000" opacity=".25"/>
<rect x="{x0:.1f}" y="{y - 3:.1f}" width="{w:.1f}" height="3" fill="#000" opacity=".25"/>
<rect x="{x0:.1f}" y="{y0:.1f}" width="{w:.1f}" height="{h:.1f}" rx="1.5" fill="url(#puff)" opacity=".75"/>"""


def pack(x, y, w, h, color, accent):
    """Square pastry/cookie pack, bottom-centre at (x, y)."""
    x0, y0 = x - w / 2, y - h
    return f"""<rect x="{x0:.1f}" y="{y0:.1f}" width="{w:.1f}" height="{h:.1f}" rx="2.5" fill="{color}"/>
<circle cx="{x:.1f}" cy="{y0 + h * .58:.1f}" r="{min(w, h) * .26:.1f}" fill="{accent}"/>
<rect x="{x0 + 3:.1f}" y="{y0 + 4:.1f}" width="{w - 6:.1f}" height="{h * .14:.1f}" rx="1" fill="#fff" opacity=".8"/>
<rect x="{x0:.1f}" y="{y0:.1f}" width="{w:.1f}" height="{h:.1f}" rx="2.5" fill="url(#puff)"/>"""


def coil_back(x, y, rx):
    return f'<path d="M{x - rx:.1f},{y:.1f}a{rx:.1f},5 0 0 1 {2 * rx:.1f},0" fill="none" stroke="#5d6670" stroke-width="1.6" opacity=".9"/>'


def coil_front(x, y, rx):
    return (f'<path d="M{x - rx:.1f},{y:.1f}a{rx:.1f},5 0 0 0 {2 * rx:.1f},0" fill="none" stroke="url(#chrome-h)" stroke-width="2"/>'
            f'<path d="M{x - rx:.1f},{y + 6:.1f}a{rx:.1f},5 0 0 0 {2 * rx:.1f},0" fill="none" stroke="#8a939c" stroke-width="1.2" opacity=".55"/>')


# ---------------------------------------------------------------- panels

def keypad(x, y, cols, rows, labels, w=14, h=10, gap=4):
    out = []
    for r in range(rows):
        for c in range(cols):
            i = r * cols + c
            bx, by = x + c * (w + gap), y + r * (h + gap)
            out.append(f'<rect x="{bx}" y="{by}" width="{w}" height="{h}" rx="2" fill="url(#chrome)"/>'
                       f'<rect x="{bx + .5}" y="{by + .5}" width="{w - 1}" height="{h - 1}" rx="2" fill="none" stroke="#000" stroke-opacity=".35"/>'
                       f'<text x="{bx + w / 2}" y="{by + h / 2 + 2.6}" text-anchor="middle" font-family="Arial, sans-serif" font-size="7" font-weight="700" fill="#1d232a">{labels[i]}</text>')
    return "".join(out)


def card_reader(x, y, w=44, h=46):
    return f"""<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="5" fill="#0f1317" stroke="#3a434d"/>
<rect x="{x + 4}" y="{y + 4}" width="{w - 8}" height="{h * .45:.1f}" rx="3" fill="#161c22"/>
<g fill="none" stroke="#e9edf1" stroke-width="1.6" stroke-linecap="round" opacity=".9">
<path d="M{x + w / 2 - 6},{y + 9} a5,5 0 0 1 0,{h * .45 - 10:.1f}"/><path d="M{x + w / 2 - 1},{y + 7} a8,8 0 0 1 0,{h * .45 - 6:.1f}"/><path d="M{x + w / 2 + 4},{y + 5} a11,11 0 0 1 0,{h * .45 - 2:.1f}"/></g>
<rect x="{x + 6}" y="{y + h - 12}" width="{w - 12}" height="3" rx="1.5" fill="#000"/>
<circle cx="{x + w - 7}" cy="{y + h - 18}" r="1.8" fill="#46e37a"/><circle cx="{x + w - 7}" cy="{y + h - 18}" r="3" fill="#46e37a" opacity=".5" filter="url(#glow)"/>"""


def bill_validator(x, y, w=44):
    return f"""<rect x="{x}" y="{y}" width="{w}" height="22" rx="3" fill="#0f1317" stroke="#3a434d"/>
<rect x="{x + 5}" y="{y + 9}" width="{w - 10}" height="3.2" rx="1.6" fill="#000"/>
<rect x="{x + 5}" y="{y + 8.5}" width="{w - 10}" height="1" fill="#46e37a" opacity=".85"/>
<rect x="{x + 5}" y="{y + 8}" width="{w - 10}" height="3" fill="#46e37a" opacity=".5" filter="url(#glow)"/>"""


def coin_slot(x, y):
    return f"""<rect x="{x}" y="{y}" width="14" height="24" rx="3" fill="url(#chrome)"/>
<rect x="{x + 5.5}" y="{y + 5}" width="3" height="14" rx="1.5" fill="#0a0c0f"/>"""


def coin_return(x, y, w=40):
    return f"""<rect x="{x}" y="{y}" width="{w}" height="26" rx="4" fill="url(#chrome)"/>
<rect x="{x + 4}" y="{y + 4}" width="{w - 8}" height="18" rx="3" fill="url(#recess)"/>"""


def t_handle(x, y):
    return f"""<rect x="{x}" y="{y}" width="16" height="40" rx="4" fill="url(#chrome-h)"/>
<circle cx="{x + 8}" cy="{y + 10}" r="3.2" fill="#2a3036"/><rect x="{x + 7}" y="{y + 8}" width="2" height="4" fill="#9aa3ad"/>"""


def lcd(x, y, w, h, text, color="#7cf29a", bg="#071009"):
    return f"""<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="#0b0e11" stroke="#3a434d"/>
<rect x="{x + 3}" y="{y + 3}" width="{w - 6}" height="{h - 6}" rx="2" fill="{bg}"/>
<text x="{x + w / 2}" y="{y + h / 2 + 3}" text-anchor="middle" font-family="Consolas, 'Courier New', monospace" font-size="7.5" fill="{color}">{text}</text>
<text x="{x + w / 2}" y="{y + h / 2 + 3}" text-anchor="middle" font-family="Consolas, 'Courier New', monospace" font-size="7.5" fill="{color}" filter="url(#glow)" opacity=".7">{text}</text>"""


def glass_door(x, y, w, h, interior_grad):
    """Frame, lit interior back wall and LED strips; products go on top, glass after."""
    return f"""<rect x="{x - 5}" y="{y - 5}" width="{w + 10}" height="{h + 10}" rx="6" fill="#0b0d10" stroke="#2c333b"/>
<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="url(#{interior_grad})"/>
<rect x="{x + 3}" y="{y + 2}" width="{w - 6}" height="3" rx="1.5" fill="#fffaf0"/>
<rect x="{x + 3}" y="{y}" width="{w - 6}" height="16" fill="#fffaf0" opacity=".35" filter="url(#glow-wide)"/>
<rect x="{x + 2}" y="{y + 6}" width="2.5" height="{h - 12}" rx="1.2" fill="#f4fbff" opacity=".9"/>
<rect x="{x + w - 4.5}" y="{y + 6}" width="2.5" height="{h - 12}" rx="1.2" fill="#f4fbff" opacity=".9"/>
<rect x="{x + 1}" y="{y + 6}" width="8" height="{h - 12}" fill="#e8f6ff" opacity=".35" filter="url(#glow)"/>
<rect x="{x + w - 9}" y="{y + 6}" width="8" height="{h - 12}" fill="#e8f6ff" opacity=".35" filter="url(#glow)"/>"""


def glass_over(x, y, w, h):
    return f"""<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="url(#glass)"/>
<path d="M{x + w * .55},{y} L{x + w * .72},{y} L{x + w * .2},{y + h} L{x + w * .05},{y + h} Z" fill="#fff" opacity=".045"/>
<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="none" stroke="#fff" stroke-opacity=".18"/>"""


def delivery_bin(x, y, w, h, label="PUSH"):
    return f"""<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="5" fill="#0b0d10" stroke="#2c333b"/>
<rect x="{x + 6}" y="{y + 6}" width="{w - 12}" height="{h - 12}" rx="3" fill="url(#flap)"/>
<rect x="{x + 6}" y="{y + 6}" width="{w - 12}" height="3" fill="#fff" opacity=".12"/>
<text x="{x + w / 2}" y="{y + h / 2 + 3.5}" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" font-weight="700" letter-spacing="3" fill="#c9d1d9" opacity=".75">{label}</text>"""


# ---------------------------------------------------------------- shared v2 parts
# Modelled on current manufacturer product shots: Crane BevMax MEDIA2 (drink),
# Crane Merchant Ambient MEDIA2 (snack) and VMFS tall vape kiosks.

STEEL_DEFS = """
  <linearGradient id="steel" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#9da4ab"/><stop offset=".08" stop-color="#e6e9ec"/><stop offset=".3" stop-color="#c3c8cd"/>
    <stop offset=".55" stop-color="#eef0f2"/><stop offset=".8" stop-color="#b4bac0"/><stop offset="1" stop-color="#8d949b"/>
  </linearGradient>
  <linearGradient id="steel-v" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#eef0f2"/><stop offset=".5" stop-color="#c3c8cd"/><stop offset="1" stop-color="#9da4ab"/>
  </linearGradient>
  <filter id="brushed" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.004 0.9" numOctaves="2" seed="3" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .14 0"/>
  </filter>
  <linearGradient id="gloss-black" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#1b1f24"/><stop offset=".4" stop-color="#07090b"/><stop offset="1" stop-color="#121519"/>
  </linearGradient>
  <linearGradient id="screen-ui" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#1e8fe0"/><stop offset="1" stop-color="#0b4f9c"/>
  </linearGradient>
"""


def steel_cabinet(x0=70, x1=380, y0=24, y1=632, side=34, feet=True):
    """Stainless cabinet with a darker side panel, floor shadow and feet."""
    feet_svg = ""
    if feet:
        feet_svg = (f'<rect x="{x0 + 10}" y="{y1}" width="22" height="12" rx="2" fill="#0b0d10"/>'
                    f'<rect x="{x1 - 32}" y="{y1}" width="22" height="12" rx="2" fill="#0b0d10"/>')
    return f"""
<ellipse cx="{(x0 + x1) / 2 - 10}" cy="{y1 + 14}" rx="{(x1 - x0) / 2 + 26}" ry="12" fill="#000" opacity=".55" filter="url(#soft)"/>
{feet_svg}
<polygon points="{x0 - side},{y0 + 20} {x0},{y0} {x0},{y1} {x0 - side},{y1 - 10}" fill="#5d646b"/>
<polygon points="{x0 - side},{y0 + 20} {x0},{y0} {x0},{y1} {x0 - side},{y1 - 10}" fill="url(#d-sideshade)"/>
<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" rx="4" fill="url(#steel)"/>
<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" rx="4" filter="url(#brushed)"/>
<rect x="{x0 + .5}" y="{y0 + .5}" width="{x1 - x0 - 1}" height="{y1 - y0 - 1}" rx="4" fill="none" stroke="#fff" stroke-opacity=".5"/>"""


SIDESHADE = """
  <linearGradient id="d-sideshade" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity=".15"/>
  </linearGradient>
"""


def touchscreen(x, y, w, h, title, sub, accent="#ffd166"):
    """Small media touchscreen with a simple product UI."""
    return f"""<rect x="{x - 2}" y="{y - 2}" width="{w + 4}" height="{h + 4}" rx="3" fill="#000"/>
<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="2" fill="url(#screen-ui)"/>
<rect x="{x}" y="{y}" width="{w}" height="{h * .2:.1f}" fill="#fff" opacity=".12"/>
<text x="{x + w / 2}" y="{y + h * .14:.1f}" text-anchor="middle" font-family="Arial, sans-serif" font-size="4.6" font-weight="700" fill="#fff">{title}</text>
<circle cx="{x + w / 2}" cy="{y + h * .52:.1f}" r="{w * .24:.1f}" fill="{accent}" opacity=".95"/>
<circle cx="{x + w / 2}" cy="{y + h * .52:.1f}" r="{w * .24:.1f}" fill="url(#puff)"/>
<rect x="{x + 4}" y="{y + h * .82:.1f}" width="{w - 8}" height="{h * .1:.1f}" rx="2" fill="#fff" opacity=".9"/>
<text x="{x + w / 2}" y="{y + h * .895:.1f}" text-anchor="middle" font-family="Arial, sans-serif" font-size="3.8" font-weight="700" fill="#0b4f9c">{sub}</text>
<path d="M{x},{y} L{x + w * .6:.1f},{y} L{x},{y + h * .7:.1f} Z" fill="#fff" opacity=".08"/>"""


# ---------------------------------------------------------------- drink machine (BevMax MEDIA2 style)

def drink():
    defs = STEEL_DEFS + SIDESHADE + """
  <linearGradient id="d-white" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#edf2f6"/><stop offset="1" stop-color="#d9e1e8"/></linearGradient>
"""
    body = [steel_cabinet()]
    # black glass door; products fill the upper two thirds, the rest is opaque black
    dx, dy, dw, dh = 80, 34, 222, 588
    body.append(f'<rect x="{dx}" y="{dy}" width="{dw}" height="{dh}" rx="3" fill="url(#gloss-black)"/>')
    gx, gy, gw, gh = dx + 10, dy + 12, dw - 20, 400
    body.append(f'<rect x="{gx}" y="{gy}" width="{gw}" height="{gh}" fill="url(#d-white)"/>'
                f'<rect x="{gx}" y="{gy}" width="{gw}" height="14" fill="#fff" opacity=".9" filter="url(#glow)"/>')
    shelves = [
        [("#2b0f08", "#d0101e", "#d0101e", .96)] * 4 + [("#2b0f08", "#1d4fb8", "#1d4fb8", .96)] * 2 + [("#2b0f08", "#c9ced4", "#c9ced4", .96)] * 2,
        [("#ff5a1f", "#ff5a1f", "#f2f2f2", .9)] * 2 + [("#d9f2c4", "#1f8a3b", "#1f8a3b", .7)] * 2 + [("#e6f2fb", "#2a6fbf", "#2a6fbf", .5)] * 4,
        [("#2f97ff", "#f2f4f6", "#1d6fd1", .9)] * 2 + [("#ffd23f", "#f2f4f6", "#f08c00", .9)] * 2 + [("#e6f2fb", "#2a6fbf", "#2a6fbf", .5)] * 2 + [("#9be15d", "#f2f4f6", "#3a9d23", .9)] * 2,
        [("#ff7a1a", "#fff", "#e35d0a", .92)] * 2 + [("#e8433b", "#f2f4f6", "#b72a23", .9)] * 2 + [("#9a521c", "#f2e2bf", "#2e7d32", .92)] * 2 + [("#c43dd6", "#f2f4f6", "#8e24aa", .9)] * 2,
        "cans",
    ]
    can_colors = [("#16191c", "#7ed957"), ("#16191c", "#7ed957"), ("#2556c9", "#d9dee3"), ("#2556c9", "#d9dee3"),
                  ("#d32f2f", "#f5f5f5"), ("#d32f2f", "#f5f5f5"), ("#f2b705", "#16191c"), ("#c0c6cc", "#d32f2f")]
    pitch = 78
    half = (gw - 8) / 2
    slot = half / 4
    for i, row in enumerate(shelves):
        base = gy + 4 + (i + 1) * pitch
        for j in range(8):
            side = 0 if j < 4 else 1
            cx = gx + side * (half + 8) + slot * ((j % 4) + .5)
            if row == "cans":
                b, band = can_colors[j]
                body.append(can(cx + 2, base - 3, 1.2, b, band, back=True))
                body.append(can(cx, base, 1.35, b, band))
            else:
                liquid, label, cap, op = row[j]
                body.append(bottle(cx + 3, base - 3, .9, liquid, label, cap, op, back=True))
                body.append(bottle(cx, base, 1.0, liquid, label, cap, op))
        body.append(f'<rect x="{gx}" y="{base}" width="{gw}" height="5" fill="url(#chrome)"/>'
                    f'<rect x="{gx}" y="{base + 5}" width="{gw}" height="2" fill="#000" opacity=".18"/>')
    # white centre elevator column
    body.append(f'<rect x="{gx + half}" y="{gy}" width="8" height="{gh}" fill="#fbfcfd"/>'
                f'<rect x="{gx + half + 7}" y="{gy}" width="1" height="{gh}" fill="#000" opacity=".12"/>')
    body.append(glass_over(gx, gy, gw, gh))
    # opaque lower door with a soft reflection and logo
    body.append(f'<path d="M{dx + 20},{dy + 430} L{dx + 120},{dy + 430} L{dx + 60},{dy + 580} L{dx + 20},{dy + 580} Z" fill="#fff" opacity=".04"/>'
                f'<text x="{dx + dw / 2}" y="{dy + 520}" text-anchor="middle" font-family="Georgia, serif" font-size="26" letter-spacing="6" fill="url(#gold)" opacity=".85">4A</text>')
    # control column: black strip with screen, card reader, bill validator, vend cup
    px = 312
    body.append(f'<rect x="{px}" y="46" width="52" height="470" rx="10" fill="#0c0e11" stroke="#2c333b"/>'
                f'<rect x="{px + 2}" y="48" width="2" height="466" rx="1" fill="#4f9dff" opacity=".9"/>'
                f'<rect x="{px + 48}" y="48" width="2" height="466" rx="1" fill="#4f9dff" opacity=".9"/>'
                f'<rect x="{px}" y="46" width="52" height="470" rx="10" fill="none" stroke="#4f9dff" stroke-width="3" opacity=".35" filter="url(#glow)"/>')
    body.append(touchscreen(px + 9, 140, 34, 58, "COLD DRINKS", "TOUCH TO START"))
    body.append(card_reader(px + 10, 214, w=32, h=34))
    body.append(bill_validator(px + 10, 256, w=32))
    body.append(f'<rect x="{px + 8}" y="296" width="36" height="58" rx="6" fill="url(#steel-v)"/>'
                f'<rect x="{px + 12}" y="302" width="28" height="46" rx="4" fill="url(#recess)"/>'
                f'<rect x="{px + 12}" y="302" width="28" height="4" fill="#fff" opacity=".08"/>')
    body.append(f'<rect x="{px + 14}" y="372" width="24" height="16" rx="3" fill="url(#steel-v)"/><rect x="{px + 17}" y="375" width="18" height="10" rx="2" fill="url(#recess)"/>')
    body.append(t_handle(px + 18, 540))
    return svg_doc("Glass-front cold drink vending machine", defs, "\n".join(body))


# ---------------------------------------------------------------- snack machine (Merchant Ambient MEDIA2 style)

def snack():
    defs = STEEL_DEFS + SIDESHADE + """
  <linearGradient id="s-interior" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d2126"/><stop offset="1" stop-color="#090a0c"/></linearGradient>
  <linearGradient id="s-flap" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f6f8"/><stop offset=".5" stop-color="#d3d8dd"/><stop offset="1" stop-color="#aab1b8"/></linearGradient>
"""
    body = [steel_cabinet()]
    dx, dy, dw, dh = 80, 34, 222, 560
    body.append(f'<rect x="{dx}" y="{dy}" width="{dw}" height="{dh}" rx="3" fill="url(#gloss-black)"/>')
    gx, gy, gw, gh = dx + 8, dy + 8, dw - 16, 414
    body.append(f'<rect x="{gx}" y="{gy}" width="{gw}" height="{gh}" fill="url(#s-interior)"/>'
                f'<rect x="{gx + 2}" y="{gy + 1}" width="{gw - 4}" height="3" fill="#fffaf0"/>'
                f'<rect x="{gx}" y="{gy}" width="{gw}" height="18" fill="#fffaf0" opacity=".3" filter="url(#glow-wide)"/>')
    chips = [("#e8262c", "#ffd23f"), ("#f2c230", "#1f7ae0"), ("#2a9d4b", "#f2f2f2"), ("#f07b1a", "#7a2a10"),
             ("#1f7ae0", "#f2f2f2"), ("#7b3fb3", "#ffd23f"), ("#18191b", "#d4a94f"), ("#ffd23f", "#e8262c")]
    candy = [("#4e2a1e", "#c62828"), ("#c62828", "#fff"), ("#f9a825", "#4e2a1e"), ("#6d4c41", "#ffd54f"), ("#1565c0", "#fff"),
             ("#2e7d32", "#ffd54f"), ("#212121", "#ffca28"), ("#ad1457", "#fff"), ("#ef6c00", "#fff"), ("#283593", "#ffca28")]
    rows = [("bag", 6, 0), ("bag", 6, 2), ("bag", 6, 4), ("bar", 10, 0), ("bar", 10, 5), ("pack", 7, 1), ("small", 8, 3)]
    pitch = 58
    letters = "ABCDEFG"
    for i, (kind, n, off) in enumerate(rows):
        lip = gy + 2 + (i + 1) * pitch
        slot = (gw - 6) / n
        for j in range(n):
            cx = gx + 3 + slot * (j + .5)
            rx = slot / 2 - 1.5
            body.append(coil_back(cx, lip - 5, rx))
            if kind == "bag":
                c1, c2 = chips[(j + off) % len(chips)]
                body.append(chip_bag(cx, lip - 2, slot - 2.5, 50, c1, c2))
            elif kind == "bar":
                c1, c2 = candy[(j + off) % len(candy)]
                body.append(bar(cx, lip - 2, slot - 3, 40, c1, c2))
            elif kind == "pack":
                c1, c2 = chips[(j + off) % len(chips)]
                body.append(pack(cx, lip - 2, slot - 4, 40, c1, c2))
            else:
                c1, c2 = candy[(j + off) % len(candy)]
                body.append(pack(cx, lip - 2, slot - 5, 28, c1, c2))
            body.append(coil_front(cx, lip - 5, rx))
        body.append(f'<rect x="{gx}" y="{lip}" width="{gw}" height="6" fill="#0b0c0e"/>'
                    f'<rect x="{gx}" y="{lip}" width="{gw}" height="1" fill="#fff" opacity=".22"/>')
        for j in range(n):
            cx = gx + 3 + slot * (j + .5)
            body.append(f'<rect x="{cx - 5.5:.1f}" y="{lip + 1.6}" width="11" height="3.4" rx=".8" fill="#f5f5f2"/>'
                        f'<text x="{cx:.1f}" y="{lip + 4.4}" text-anchor="middle" font-family="Arial, sans-serif" font-size="3" font-weight="700" fill="#222">{letters[i]}{j + 1}</text>')
    body.append(glass_over(gx, gy, gw, gh))
    # wide light delivery flap in the black lower panel
    fx, fy = dx + 16, gy + gh + 26
    body.append(f'<rect x="{fx}" y="{fy}" width="{dw - 32}" height="74" rx="6" fill="#050608"/>'
                f'<rect x="{fx + 5}" y="{fy + 5}" width="{dw - 42}" height="64" rx="4" fill="url(#s-flap)"/>'
                f'<rect x="{fx + 5}" y="{fy + 5}" width="{dw - 42}" height="64" rx="4" filter="url(#brushed)"/>'
                f'<rect x="{fx + 30}" y="{fy + 14}" width="{dw - 92}" height="3" rx="1.5" fill="#7d858d"/>'
                f'<text x="{dx + dw / 2}" y="{fy + 50}" text-anchor="middle" font-family="Arial, sans-serif" font-size="8" font-weight="700" letter-spacing="3" fill="#6b737b">PUSH</text>')
    # control column with blue LED edges
    px = 312
    body.append(f'<rect x="{px}" y="46" width="52" height="420" rx="10" fill="#0c0e11" stroke="#2c333b"/>'
                f'<rect x="{px + 2}" y="48" width="2" height="416" rx="1" fill="#4f9dff" opacity=".95"/>'
                f'<rect x="{px + 48}" y="48" width="2" height="416" rx="1" fill="#4f9dff" opacity=".95"/>'
                f'<rect x="{px}" y="46" width="52" height="420" rx="10" fill="none" stroke="#4f9dff" stroke-width="3" opacity=".35" filter="url(#glow)"/>')
    body.append(touchscreen(px + 9, 150, 34, 58, "SNACK TIME", "TOUCH TO START", accent="#ff9f1c"))
    body.append(card_reader(px + 10, 222, w=32, h=34))
    body.append(bill_validator(px + 10, 264, w=32))
    body.append(f'<rect x="{px + 14}" y="300" width="24" height="16" rx="3" fill="url(#steel-v)"/><rect x="{px + 17}" y="303" width="18" height="10" rx="2" fill="url(#recess)"/>')
    body.append(f'<rect x="{px + 12}" y="490" width="28" height="36" rx="5" fill="url(#steel-v)"/><rect x="{px + 16}" y="496" width="20" height="24" rx="3" fill="url(#recess)"/>')
    body.append(t_handle(px + 18, 548))
    return svg_doc("Glass-front snack vending machine with spiral coils", defs, "\n".join(body))


# ---------------------------------------------------------------- vapor kiosk (VMFS tall vape machine style)

def vapor():
    defs = """
  <linearGradient id="v-body" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#22262b"/><stop offset=".5" stop-color="#121417"/><stop offset="1" stop-color="#0a0b0d"/></linearGradient>
  <linearGradient id="v-side" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#060708"/><stop offset="1" stop-color="#17191c"/></linearGradient>
  <linearGradient id="v-led" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#36d6e7"/><stop offset=".35" stop-color="#7b5cff"/><stop offset=".7" stop-color="#ff4fa3"/><stop offset="1" stop-color="#ffb347"/>
  </linearGradient>
  <linearGradient id="v-screen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a1458"/><stop offset=".55" stop-color="#4b1f7a"/><stop offset="1" stop-color="#0f3a6b"/></linearGradient>
  <linearGradient id="v-ad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff4fa3"/><stop offset=".5" stop-color="#7b5cff"/><stop offset="1" stop-color="#36d6e7"/></linearGradient>
  <linearGradient id="v-pen" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".35"/><stop offset=".35" stop-color="#fff" stop-opacity=".45"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".4"/></linearGradient>
"""
    x0, x1, y0, y1 = 124, 312, 40, 600
    body = [f'<ellipse cx="{(x0 + x1) / 2 - 8}" cy="{y1 + 34}" rx="140" ry="12" fill="#000" opacity=".6" filter="url(#soft)"/>']
    # wheeled base
    body.append(f'<rect x="{x0 - 26}" y="{y1 + 6}" width="{x1 - x0 + 52}" height="16" rx="4" fill="#0b0c0e"/>'
                f'<rect x="{x0 - 26}" y="{y1 + 6}" width="{x1 - x0 + 52}" height="2" fill="#fff" opacity=".1"/>'
                + "".join(f'<circle cx="{cx}" cy="{y1 + 26}" r="6" fill="#0b0c0e" stroke="#2c333b"/>' for cx in (x0 - 14, x0 + 40, x1 - 40, x1 + 14)))
    # side and front
    body.append(f'<polygon points="{x0 - 26},{y0 + 18} {x0},{y0} {x0},{y1 + 6} {x0 - 26},{y1 - 2}" fill="url(#v-side)"/>'
                f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0 + 6}" rx="14" fill="url(#v-body)"/>'
                f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0 + 6}" rx="14" filter="url(#grain)"/>')
    # colour-shifting LED edge
    body.append(f'<rect x="{x0 + 2}" y="{y0 + 2}" width="{x1 - x0 - 4}" height="{y1 - y0 + 2}" rx="13" fill="none" stroke="url(#v-led)" stroke-width="3"/>'
                f'<rect x="{x0 + 2}" y="{y0 + 2}" width="{x1 - x0 - 4}" height="{y1 - y0 + 2}" rx="13" fill="none" stroke="url(#v-led)" stroke-width="8" opacity=".55" filter="url(#glow)"/>')
    # camera + 21+ badge
    body.append(f'<circle cx="{(x0 + x1) / 2}" cy="{y0 + 12}" r="3.5" fill="#05070a" stroke="#3a434d"/><circle cx="{(x0 + x1) / 2 - .8}" cy="{y0 + 11.2}" r="1.1" fill="#3b6ea5"/>')
    # 32" portrait touchscreen with fanned devices
    sx, sy, sw, sh = x0 + 16, y0 + 24, x1 - x0 - 32, 262
    body.append(f'<rect x="{sx - 3}" y="{sy - 3}" width="{sw + 6}" height="{sh + 6}" rx="6" fill="#000"/>'
                f'<rect x="{sx}" y="{sy}" width="{sw}" height="{sh}" rx="4" fill="url(#v-screen)"/>'
                f'<circle cx="{sx + sw * .7:.1f}" cy="{sy + sh * .42:.1f}" r="70" fill="#ff4fa3" opacity=".25" filter="url(#glow-wide)"/>')
    pens = [("#36d6e7", -38), ("#ffffff", -22), ("#ff4fa3", -6), ("#7b5cff", 10), ("#ffb347", 26), ("#6fd39b", 42)]
    pcx, pcy = sx + sw * .55, sy + sh * .74
    for color, ang in pens:
        body.append(f'<g transform="rotate({ang} {pcx:.1f} {pcy:.1f})"><rect x="{pcx - 6:.1f}" y="{pcy - 118:.1f}" width="12" height="104" rx="6" fill="{color}"/>'
                    f'<rect x="{pcx - 6:.1f}" y="{pcy - 118:.1f}" width="12" height="104" rx="6" fill="url(#v-pen)"/>'
                    f'<rect x="{pcx - 3.5:.1f}" y="{pcy - 128:.1f}" width="7" height="12" rx="3" fill="#15171a"/></g>')
    body.append(f'<text x="{sx + 12}" y="{sy + 24}" font-family="Arial, sans-serif" font-size="8" letter-spacing="2" fill="#f3d9a2">4A VAPOR</text>'
                f'<text x="{sx + 12}" y="{sy + 44}" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#fff">Scan ID</text>'
                f'<text x="{sx + 12}" y="{sy + 58}" font-family="Arial, sans-serif" font-size="8" fill="#d8ccff">to start · 21+</text>'
                f'<rect x="{sx + 12}" y="{sy + sh - 32}" width="{sw - 24}" height="20" rx="10" fill="#fff" opacity=".92"/>'
                f'<text x="{sx + sw / 2}" y="{sy + sh - 19}" text-anchor="middle" font-family="Arial, sans-serif" font-size="7.5" font-weight="700" letter-spacing="1" fill="#2a1458">TOUCH TO BEGIN</text>'
                f'<path d="M{sx},{sy} L{sx + sw * .55:.1f},{sy} L{sx},{sy + sh * .55:.1f} Z" fill="#fff" opacity=".06"/>')
    # hardware row: pickup door, ID scanner, card reader / bill slot
    hy = sy + sh + 14
    body.append(f'<rect x="{sx}" y="{hy}" width="60" height="58" rx="5" fill="#050608" stroke="#2c333b"/>'
                f'<rect x="{sx + 5}" y="{hy + 5}" width="50" height="48" rx="3" fill="url(#flap)"/>'
                f'<text x="{sx + 30}" y="{hy + 33}" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" font-weight="700" letter-spacing="1.5" fill="#c9d1d9" opacity=".8">PUSH</text>')
    body.append(f'<rect x="{sx + 66}" y="{hy}" width="44" height="58" rx="5" fill="#0d1115" stroke="#3a434d"/>'
                f'<rect x="{sx + 71}" y="{hy + 8}" width="34" height="22" rx="3" fill="#05070a"/>'
                f'<rect x="{sx + 74}" y="{hy + 18}" width="28" height="1.6" fill="#ff4d4d"/>'
                f'<rect x="{sx + 74}" y="{hy + 15}" width="28" height="7" fill="#ff4d4d" opacity=".5" filter="url(#glow)"/>'
                f'<text x="{sx + 88}" y="{hy + 45}" text-anchor="middle" font-family="Arial, sans-serif" font-size="6.5" font-weight="700" letter-spacing="1.5" fill="#cfd5db">SCAN ID</text>')
    body.append(card_reader(sx + 116, hy, w=sw - 116, h=36))
    body.append(bill_validator(sx + 116, hy + 40, w=sw - 116))
    # lower ad panel
    ay = hy + 72
    body.append(f'<rect x="{sx - 3}" y="{ay - 3}" width="{sw + 6}" height="{y1 - ay - 12}" rx="6" fill="#000"/>'
                f'<rect x="{sx}" y="{ay}" width="{sw}" height="{y1 - ay - 18}" rx="4" fill="url(#v-ad)"/>'
                f'<rect x="{sx}" y="{ay}" width="{sw}" height="{y1 - ay - 18}" rx="4" fill="url(#puff)" opacity=".6"/>'
                f'<g transform="rotate(-18 {sx + sw * .66:.1f} {ay + 60})"><rect x="{sx + sw * .66 - 8:.1f}" y="{ay + 14}" width="16" height="96" rx="8" fill="#e8262c"/>'
                f'<rect x="{sx + sw * .66 - 8:.1f}" y="{ay + 14}" width="16" height="96" rx="8" fill="url(#v-pen)"/></g>'
                f'<text x="{sx + 12}" y="{ay + 30}" font-family="Arial, sans-serif" font-size="13" font-weight="900" fill="#fff">21+</text>'
                f'<text x="{sx + 12}" y="{ay + 44}" font-family="Arial, sans-serif" font-size="7" letter-spacing="1.5" fill="#fff">ID REQUIRED</text>')
    return svg_doc("Touchscreen vapor vending kiosk with ID scanner", defs, "\n".join(body))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, fn in [("drink", drink), ("snack", snack), ("vapor", vapor)]:
        path = OUT / f"machine-{name}.svg"
        path.write_text(fn(), encoding="utf-8")
        print(f"wrote {path} ({path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
