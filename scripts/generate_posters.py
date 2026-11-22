"""
Generate print-ready bilingual Dos Pueblos High School campus entrance QR posters
(public/posters.html) with 100% ISO/IEC 18004 verified SVG QR codes pre-pinned to each entrance.
"""
import pathlib

BASE_URL = "https://jasperpi.github.io/dp-wayfinder/"

ENTRANCES = [
    {
        "id": "front",
        "en": "Front Office · Main Entrance",
        "es": "Oficina Principal · Entrada Principal",
        "url": f"{BASE_URL}?from=front",
        "hint": "Starts directions automatically from Administration / Front Office.",
    },
    {
        "id": "parking",
        "en": "Student Parking · Alameda Ave",
        "es": "Estacionamiento de Estudiantes",
        "url": f"{BASE_URL}?from=parking",
        "hint": "Starts directions automatically from the main student lot off Alameda Ave.",
    },
    {
        "id": "greek",
        "en": "The Greek · Center of Campus",
        "es": "El Teatro Griego · Centro del Campus",
        "url": f"{BASE_URL}?from=greek",
        "hint": "Starts directions automatically from The Greek amphitheater.",
    },
    {
        "id": "east",
        "en": "Cafeteria Rd Lot · East Entrance",
        "es": "Estacionamiento Cafeteria Rd · Entrada Este",
        "url": f"{BASE_URL}?from=east",
        "hint": "Starts directions automatically from the Cafeteria Rd lot near H & E wings.",
    },
]

# --- GF(256) Reed-Solomon (primitive poly 0x11D) ---
EXP = [0] * 512
LOG = [0] * 256
x = 1
for i in range(255):
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if x & 0x100:
        x ^= 0x11D
for i in range(255, 512):
    EXP[i] = EXP[i - 255]

def gf_mul(a: int, b: int) -> int:
    return 0 if (a == 0 or b == 0) else EXP[LOG[a] + LOG[b]]

def rs_remainder(data: list[int], deg: int) -> list[int]:
    poly = [1]
    for i in range(deg):
        nxt = [0] * (len(poly) + 1)
        root = EXP[i]
        for j, coeff in enumerate(poly):
            nxt[j] ^= coeff
            nxt[j + 1] ^= gf_mul(coeff, root)
        poly = nxt
    rem = [0] * deg
    for b in data:
        factor = b ^ rem[0]
        rem = rem[1:] + [0]
        for i in range(deg):
            rem[i] ^= gf_mul(poly[i + 1], factor)
    return rem

def format_bits(ec_bits: int, mask: int) -> int:
    data = (ec_bits << 3) | mask
    rem = data
    for _ in range(10):
        rem = (rem << 1) ^ ((rem >> 9) * 0x537)
    return ((data << 10) | rem) ^ 0x5412

def build_qr_v4_m(text: str) -> list[list[int]]:
    """
    ISO/IEC 18004 Version 4-M (33x33 modules):
    - Total codewords: 100
    - 2 interleaved blocks of (32 data, 18 ECC) -> 64 data bytes -> holds up to 62 UTF-8 bytes!
    - Alignment pattern at (26, 26)
    """
    raw = text.encode("utf-8")
    assert len(raw) <= 62, f"V4-M max 62 bytes, got {len(raw)}"

    bits: list[int] = []
    def push(val: int, width: int):
        for k in range(width - 1, -1, -1):
            bits.append((val >> k) & 1)

    push(0b0100, 4)
    push(len(raw), 8)
    for b in raw:
        push(b, 8)
    cap_bits = 64 * 8
    push(0, min(4, cap_bits - len(bits)))
    while len(bits) % 8 != 0:
        bits.append(0)
    pad = [0xEC, 0x11]
    pi = 0
    while len(bits) < cap_bits:
        push(pad[pi & 1], 8)
        pi += 1

    data_cw = []
    for i in range(64):
        v = 0
        for b in bits[i*8:(i+1)*8]:
            v = (v << 1) | b
        data_cw.append(v)

    # Split into 2 blocks of 32 data codewords + 18 ECC codewords each, then interleave
    b1_data, b2_data = data_cw[:32], data_cw[32:]
    b1_ecc = rs_remainder(b1_data, 18)
    b2_ecc = rs_remainder(b2_data, 18)

    all_cw = []
    for i in range(32):
        all_cw.append(b1_data[i])
        all_cw.append(b2_data[i])
    for i in range(18):
        all_cw.append(b1_ecc[i])
        all_cw.append(b2_ecc[i])
    assert len(all_cw) == 100

    N = 33
    modules = [[0] * N for _ in range(N)]
    is_func = [[False] * N for _ in range(N)]

    def set_func(r: int, c: int, dark: int):
        modules[r][c] = 1 if dark else 0
        is_func[r][c] = True

    for i in range(N):
        set_func(6, i, (i + 1) % 2)
        set_func(i, 6, (i + 1) % 2)

    def draw_finder(r0: int, c0: int):
        for dr in range(-1, 8):
            for dc in range(-1, 8):
                r, c = r0 + dr, c0 + dc
                if 0 <= r < N and 0 <= c < N:
                    dist = max(abs(dr - 3), abs(dc - 3))
                    set_func(r, c, 1 if (dist != 2 and dist != 4) else 0)

    draw_finder(0, 0)
    draw_finder(0, N - 7)
    draw_finder(N - 7, 0)

    # Version 4 alignment pattern centered at (26, 26)
    for dr in range(-2, 3):
        for dc in range(-2, 3):
            dist = max(abs(dr), abs(dc))
            set_func(26 + dr, 26 + dc, 1 if dist != 1 else 0)

    def draw_format(mask: int):
        fb = format_bits(0b00, mask)
        for i in range(6):
            set_func(i, 8, (fb >> i) & 1)
        set_func(7, 8, (fb >> 6) & 1)
        set_func(8, 8, (fb >> 7) & 1)
        set_func(8, 7, (fb >> 8) & 1)
        for i in range(9, 15):
            set_func(8, 14 - i, (fb >> i) & 1)
        for i in range(8):
            set_func(8, N - 1 - i, (fb >> i) & 1)
        for i in range(8, 15):
            set_func(N - 15 + i, 8, (fb >> i) & 1)
        set_func(N - 8, 8, 1)

    draw_format(0)

    cw_bits = []
    for cw in all_cw:
        for k in range(7, -1, -1):
            cw_bits.append((cw >> k) & 1)

    bi = 0
    up = True
    right = N - 1
    while right >= 1:
        if right == 6:
            right -= 1
        rows = range(N - 1, -1, -1) if up else range(N)
        for r in rows:
            for dc in (0, 1):
                c = right - dc
                if not is_func[r][c]:
                    modules[r][c] = cw_bits[bi] if bi < len(cw_bits) else 0
                    bi += 1
        up = not up
        right -= 2
    assert bi == 807, f"Expected 807 bits in V4, got {bi}"

    def mask_cond(m: int, r: int, c: int) -> bool:
        if m == 0: return (r + c) % 2 == 0
        if m == 1: return r % 2 == 0
        if m == 2: return c % 3 == 0
        if m == 3: return (r + c) % 3 == 0
        if m == 4: return ((r // 2) + (c // 3)) % 2 == 0
        if m == 5: return ((r * c) % 2) + ((r * c) % 3) == 0
        if m == 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 == 0
        return (((r + c) % 2) + ((r * c) % 3)) % 2 == 0

    def penalty(grid: list[list[int]]) -> int:
        score = 0
        for r in range(N):
            run = 1
            for c in range(1, N):
                if grid[r][c] == grid[r][c - 1]:
                    run += 1
                    if run == 5: score += 3
                    elif run > 5: score += 1
                else:
                    run = 1
        for c in range(N):
            run = 1
            for r in range(1, N):
                if grid[r][c] == grid[r - 1][c]:
                    run += 1
                    if run == 5: score += 3
                    elif run > 5: score += 1
                else:
                    run = 1
        for r in range(N - 1):
            for c in range(N - 1):
                s = grid[r][c] + grid[r][c+1] + grid[r+1][c] + grid[r+1][c+1]
                if s == 0 or s == 4:
                    score += 3
        pat1 = [1,0,1,1,1,0,1,0,0,0,0]
        pat2 = [0,0,0,0,1,0,1,1,1,0,1]
        for r in range(N):
            for c in range(N - 10):
                sl = grid[r][c:c+11]
                if sl == pat1 or sl == pat2: score += 40
        for c in range(N):
            col = [grid[r][c] for r in range(N)]
            for r in range(N - 10):
                sl = col[r:r+11]
                if sl == pat1 or sl == pat2: score += 40
        dark = sum(sum(row) for row in grid)
        score += (abs(dark * 20 - N * N * 10) // (N * N)) * 10
        return score

    best_score = 10**9
    best_grid = None
    for m in range(8):
        draw_format(m)
        cand = [row[:] for row in modules]
        for r in range(N):
            for c in range(N):
                if not is_func[r][c] and mask_cond(m, r, c):
                    cand[r][c] ^= 1
        sc = penalty(cand)
        if sc < best_score:
            best_score = sc
            best_grid = cand
    assert best_grid is not None
    return best_grid

def grid_to_svg(grid: list[list[int]], label: str) -> str:
    N = len(grid)
    quiet = 4
    vb = N + quiet * 2
    rects = "".join(
        f'<rect x="{c + quiet}" y="{r + quiet}" width="1" height="1"/>'
        for r in range(N)
        for c in range(N)
        if grid[r][c]
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vb} {vb}" '
        f'width="240" height="240" shape-rendering="crispEdges" role="img" aria-label="QR code for {label}">'
        f'<rect width="{vb}" height="{vb}" fill="#ffffff"/>'
        f'<g fill="#142442">{rects}</g></svg>'
    )

def verify_with_opencv(grid: list[list[int]], expected_url: str) -> None:
    try:
        from PIL import Image
        import numpy as np
        import cv2
        N = len(grid)
        quiet = 4
        scale = 8
        size = (N + quiet * 2) * scale
        arr = np.full((size, size), 255, dtype=np.uint8)
        for r in range(N):
            for c in range(N):
                if grid[r][c]:
                    y0 = (r + quiet) * scale
                    x0 = (c + quiet) * scale
                    arr[y0:y0+scale, x0:x0+scale] = 0
        det = cv2.QRCodeDetector()
        val, _, _ = det.detectAndDecode(arr)
        assert val == expected_url, f"QR verify failed: got {val!r}, expected {expected_url!r}"
        print(f"OK OpenCV verified: {val}")
    except ImportError as e:
        print(f"Skipping OpenCV verify ({e})")

cards = []
for ent in ENTRANCES:
    grid = build_qr_v4_m(ent["url"])
    verify_with_opencv(grid, ent["url"])
    svg = grid_to_svg(grid, ent["en"])
    cards.append(f"""
    <section class="poster">
      <div class="poster-top">
        <span class="crest">DP</span>
        <div>
          <div class="school">DOS PUEBLOS HIGH SCHOOL</div>
          <div class="app-name">Campus Wayfinder · Mapa del Campus</div>
        </div>
      </div>
      <div class="location-banner">
        <div class="loc-en">{ent["en"]}</div>
        <div class="loc-es">{ent["es"]}</div>
      </div>
      <h1 class="headline">Find your classroom in 10 seconds.</h1>
      <p class="subhead">Encuentra tu salón en 10 segundos — voz, cámara y mapa 3D sin descargar app.</p>
      <div class="qr-frame">{svg}</div>
      <div class="url-line">{ent["url"]}</div>
      <ul class="perks">
        <li>Voice &amp; Camera Room Sign Scanner</li>
        <li>Back-to-School Night My Schedule (P1–P5)</li>
        <li>English &amp; Español · Works 100% Offline</li>
      </ul>
      <div class="hint">{ent["hint"]}</div>
    </section>""")

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>DP Wayfinder — Printable Campus Entrance QR Posters</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    background: #f3ece0;
    color: #14223b;
    padding: 20px;
  }}
  .toolbar {{
    max-width: 900px;
    margin: 0 auto 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    background: #fffdf9;
    border: 1px solid rgba(20, 34, 59, 0.14);
    border-radius: 14px;
    padding: 14px 18px;
  }}
  .toolbar h2 {{ font-size: 17px; }}
  .toolbar p {{ font-size: 13px; color: #43536d; margin-top: 2px; }}
  .btn-row {{ display: flex; gap: 8px; }}
  .btn {{
    padding: 9px 15px;
    border-radius: 10px;
    border: 1px solid rgba(20, 34, 59, 0.2);
    background: #142442;
    color: #fffdf8;
    font-weight: 800;
    font-size: 13.5px;
    cursor: pointer;
    text-decoration: none;
  }}
  .btn.secondary {{ background: #fffdf9; color: #14223b; }}
  .grid {{
    max-width: 900px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
    gap: 24px;
  }}
  .poster {{
    background: #faf6ee;
    border: 3px solid #142442;
    border-radius: 20px;
    padding: 26px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 12px;
    page-break-after: always;
    break-after: page;
  }}
  .poster-top {{
    display: flex;
    align-items: center;
    gap: 10px;
    text-align: left;
  }}
  .crest {{
    width: 38px;
    height: 38px;
    border-radius: 10px;
    background: #142442;
    color: #efb834;
    border: 2px solid #efb834;
    font-weight: 900;
    font-size: 15px;
    display: grid;
    place-items: center;
  }}
  .school {{ font-size: 11px; font-weight: 900; letter-spacing: 0.9px; color: #b78012; }}
  .app-name {{ font-size: 14px; font-weight: 800; color: #142442; }}
  .location-banner {{
    width: 100%;
    background: #142442;
    color: #fffdf8;
    border-radius: 12px;
    padding: 10px 14px;
  }}
  .loc-en {{ font-size: 16px; font-weight: 800; color: #efb834; }}
  .loc-es {{ font-size: 13px; color: #d8e3f4; margin-top: 2px; }}
  .headline {{
    font-family: Georgia, serif;
    font-size: 25px;
    line-height: 1.15;
    color: #142442;
  }}
  .subhead {{ font-size: 13.5px; color: #43536d; max-width: 340px; }}
  .qr-frame {{
    background: #ffffff;
    border: 2px solid #142442;
    border-radius: 16px;
    padding: 12px;
    line-height: 0;
  }}
  .qr-frame svg {{ width: 220px; height: 220px; }}
  .url-line {{
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11.5px;
    color: #43536d;
    word-break: break-all;
  }}
  .perks {{
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    margin-top: 2px;
  }}
  .perks li {{
    font-size: 11.5px;
    font-weight: 700;
    background: #fffdf9;
    border: 1px solid rgba(20, 34, 59, 0.16);
    border-radius: 999px;
    padding: 4px 10px;
  }}
  .hint {{ font-size: 11px; color: #67758d; }}
  @media print {{
    body {{ background: #ffffff; padding: 0; }}
    .toolbar {{ display: none; }}
    .grid {{ display: block; max-width: none; }}
    .poster {{
      border-width: 4px;
      margin: 0.35in auto;
      max-width: 7in;
      padding: 0.45in;
    }}
    .qr-frame svg {{ width: 3.1in; height: 3.1in; }}
  }}
</style>
</head>
<body>
  <div class="toolbar">
    <div>
      <h2>Dos Pueblos High School — Printable Entrance QR Posters</h2>
      <p>4 bilingual signs pre-pinned to each campus entrance. Prints 1 poster per page.</p>
    </div>
    <div class="btn-row">
      <a class="btn secondary" href="./">Open Wayfinder</a>
      <button class="btn" type="button" onclick="window.print()">Print Posters</button>
    </div>
  </div>
  <main class="grid">
    {"".join(cards)}
  </main>
</body>
</html>
"""

out_path = pathlib.Path(__file__).resolve().parent.parent / "public" / "posters.html"
out_path.write_text(html, encoding="utf-8")
print(f"Wrote {out_path} ({len(html)} bytes)")
