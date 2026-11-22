"""
Extract crisp architectural 3D vector geometry from data/campus-map.png and data/walkable.json
into src/data/campus-geometry.json (1000x875 campus space) with polygon point arrays and
realistic architectural building heights for true 3D isometric rendering.
"""
import json
from collections import Counter
from pathlib import Path
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
MAP_PNG = ROOT / "data" / "campus-map.png"
CAMPUS_JSON = ROOT / "data" / "campus.json"
WALKABLE_JSON = ROOT / "data" / "walkable.json"
OUT_JSON = ROOT / "src" / "data" / "campus-geometry.json"


def contour_to_pts(cnt, scale, eps=1.2):
    approx = cv2.approxPolyDP(cnt, eps, True)
    pts = approx.reshape(-1, 2)
    if len(pts) < 3:
        return None
    flat = []
    for x, y in pts:
        flat.append(round(float(x) / scale, 1))
        flat.append(round(float(y) / scale, 1))
    return flat


def pts_to_svg_path(flat):
    parts = [f"M{flat[0]},{flat[1]}"]
    for i in range(2, len(flat), 2):
        parts.append(f"L{flat[i]},{flat[i+1]}")
    parts.append("Z")
    return "".join(parts)


def main():
    im = cv2.imread(str(MAP_PNG))
    H, W = im.shape[:2]
    scale = W / 1000.0
    gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    b, g, r = im[:, :, 0], im[:, :, 1], im[:, :, 2]

    campus = json.loads(CAMPUS_JSON.read_text(encoding="utf-8"))
    walk = json.loads(WALKABLE_JSON.read_text(encoding="utf-8"))

    # Zone masks from campus-map.png colors
    z1 = (r > 235) & (g > 235) & (b < 170)  # Yellow: EPAC, S, M, Admin
    z2 = (r > 235) & (g > 150) & (g < 210) & (b > 150) & (b < 210)  # Pink: Pool, Q, Gym, T, B
    z3 = (r > 225) & (g > 180) & (g < 230) & (b > 120) & (b < 190)  # Peach: Cafeteria, Greek, A, P, Lib, E
    z4 = (b > 215) & (g > 195) & (r < 205)  # Blue: H, C

    # Keep only campus area (mask out DP crest top-left, title block bottom-right, outer border)
    mask_keep = np.ones((H, W), dtype=np.uint8)
    mask_keep[: int(224 * scale), : int(376 * scale)] = 0
    mask_keep[int(715 * scale) :, int(615 * scale) :] = 0
    mask_keep[: int(16 * scale), :] = 0
    mask_keep[int(860 * scale) :, :] = 0
    mask_keep[:, : int(16 * scale)] = 0
    mask_keep[:, int(984 * scale) :] = 0

    dark = ((gray < 160) & (mask_keep > 0)).astype(np.uint8)
    num_d, lbl_d, st_d, _ = cv2.connectedComponentsWithStats(dark, connectivity=8)
    walls = np.zeros_like(dark)
    for i in range(1, num_d):
        cw = st_d[i, cv2.CC_STAT_WIDTH]
        ch = st_d[i, cv2.CC_STAT_HEIGHT]
        ca = st_d[i, cv2.CC_STAT_AREA]
        if max(cw, ch) >= 22 or ca >= 120:
            walls[lbl_d == i] = 255

    walls_sealed = cv2.dilate(walls, np.ones((2, 2), np.uint8), iterations=1)
    inv = 255 - walls_sealed

    ff = inv.copy()
    ff_mask = np.zeros((H + 2, W + 2), np.uint8)
    cv2.floodFill(ff, ff_mask, (0, 0), 128)
    interior = (ff == 255).astype(np.uint8) * 255

    num_r, lbl_r, st_r, cent_r = cv2.connectedComponentsWithStats(interior, connectivity=4)

    # 1. Extract all 106 classroom polygons
    rooms_out = []
    used_room_labels = set()
    for rm in campus["rooms"]:
        px, py = int(round(rm["x"] * scale)), int(round(rm["y"] * scale))
        found = 0
        for rad in range(0, 7):
            for dy in range(-rad, rad + 1):
                for dx in range(-rad, rad + 1):
                    ny, nx = py + dy, px + dx
                    if 0 <= ny < H and 0 <= nx < W and lbl_r[ny, nx] > 0:
                        a = st_r[lbl_r[ny, nx], cv2.CC_STAT_AREA] / (scale * scale)
                        if 50 < a < 8000:
                            found = int(lbl_r[ny, nx])
                            break
                if found:
                    break
            if found:
                break
        if found:
            used_room_labels.add(found)
            comp_mask = (lbl_r == found).astype(np.uint8) * 255
            comp_mask = cv2.dilate(comp_mask, np.ones((2, 2), np.uint8), iterations=1)
            cnts, _ = cv2.findContours(comp_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if cnts:
                cnt = max(cnts, key=cv2.contourArea)
                pts = contour_to_pts(cnt, scale, eps=1.0)
                if pts:
                    rooms_out.append({
                        "id": rm["id"],
                        "label": rm["label"],
                        "building": rm["building"],
                        "pts": pts,
                        "d": pts_to_svg_path(pts),
                        "cx": round(float(cent_r[found][0]) / scale, 1),
                        "cy": round(float(cent_r[found][1]) / scale, 1),
                    })

    # 2. Extract outer footprints with 3D heights
    bldg_mask = cv2.morphologyEx(interior, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    bldg_mask = cv2.dilate(bldg_mask, np.ones((2, 2), np.uint8), iterations=1)
    outer_cnts, _ = cv2.findContours(bldg_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    def classify_outer(cx, cy, area, mask_poly):
        z_counts = [
            int(np.count_nonzero(z1 & (mask_poly > 0))),
            int(np.count_nonzero(z2 & (mask_poly > 0))),
            int(np.count_nonzero(z3 & (mask_poly > 0))),
            int(np.count_nonzero(z4 & (mask_poly > 0))),
        ]
        max_z = max(z_counts)
        zone = (z_counts.index(max_z) + 1) if max_z > (area * scale * scale * 0.15) else 0

        if 540 < cx < 930 and 80 < cy < 250 and area > 20000:
            return "stadium", 0, 0
        if 660 < cx < 830 and 30 < cy < 95:
            return "bleachers", 0, 7
        if 660 < cx < 840 and 245 < cy < 295:
            return "bleachers", 0, 7
        if 100 < cx < 305 and 220 < cy < 410 and area > 10000:
            return "baseball", 0, 0
        if 80 < cx < 260 and 415 < cy < 640 and area > 500:
            return "tennis", 0, 0
        if 470 < cx < 575 and 90 < cy < 250 and area > 1000:
            return "volleyball", 0, 0
        if 315 < cx < 470 and 225 < cy < 345 and area > 4000:
            return "pool_complex", 2, 4
        if 300 < cx < 475 and 350 < cy < 480 and area > 4000:
            return "gym", 2, 16
        if 340 < cx < 455 and 505 < cy < 675 and area > 3000:
            return "epac", 1, 18
        if 705 < cx < 795 and 430 < cy < 485:
            return "greek", 3, 5
        if 345 < cx < 445 and 675 < cy < 845:
            return "busloop", 0, 0
        if 55 < cx < 315 and 530 < cy < 845 and area > 5000:
            return "parking_outline", 0, 0
        if 445 < cx < 615 and 680 < cy < 835:
            return "parking_outline", 0, 0
        if 805 < cx < 930 and 645 < cy < 720:
            return "parking_outline", 0, 0
        if 525 < cx < 565 and 265 < cy < 295:
            return "structure", 0, 5
        if 605 < cx < 655 and 255 < cy < 285:
            return "restroom_block", 0, 5
        if 620 < cx < 658 and 600 < cy < 670 and area < 1200:
            return "flagpole_court", 0, 0
        if zone > 0 and area > 160:
            # Tall signature buildings (Library, Cafeteria, Admin, DPEA) vs standard 1-story wings
            h_val = 9
            if 620 < cx < 700 and 485 < cy < 560:  # Library
                h_val = 12
            elif 715 < cx < 845 and 375 < cy < 425:  # Cafeteria
                h_val = 12
            elif 565 < cx < 610 and 570 < cy < 660:  # Admin
                h_val = 11
            elif 815 < cx < 915 and 395 < cy < 590:  # DPEA / E wing
                h_val = 12
            return "building", zone, h_val
        if area > 400:
            return "structure", zone, 6
        return "ignore", 0, 0

    features = []
    for idx, cnt in enumerate(outer_cnts):
        area = cv2.contourArea(cnt) / (scale * scale)
        if area < 90:
            continue
        M = cv2.moments(cnt)
        if M["m00"] == 0:
            continue
        cx = M["m10"] / M["m00"] / scale
        cy = M["m01"] / M["m00"] / scale
        poly_mask = np.zeros((H, W), dtype=np.uint8)
        cv2.drawContours(poly_mask, [cnt], -1, 255, -1)
        kind, zone, h_val = classify_outer(cx, cy, area, poly_mask)
        if kind in ("ignore", "parking_outline", "busloop", "flagpole_court"):
            continue
        eps = 1.6 if kind in ("stadium", "baseball", "greek") else 1.2
        pts = contour_to_pts(cnt, scale, eps=eps)
        if not pts:
            continue
        # Tag matching room IDs inside this building polygon for 3D highlight elevation
        bldg_rooms = []
        for rm in rooms_out:
            rx, ry = int(round(rm["cx"] * scale)), int(round(rm["cy"] * scale))
            if 0 <= ry < H and 0 <= rx < W and poly_mask[ry, rx] > 0:
                bldg_rooms.append(rm["id"])
        # Also record building height on each room so 3D highlight sits accurately on its roof
        for rm in rooms_out:
            if rm["id"] in bldg_rooms:
                rm["h"] = h_val

        features.append({
            "id": f"f{idx}",
            "kind": kind,
            "zone": zone,
            "h": h_val,
            "pts": pts,
            "d": pts_to_svg_path(pts),
            "cx": round(cx, 1),
            "cy": round(cy, 1),
            "area": round(area, 0),
            "roomIds": bldg_rooms,
        })

    # Ensure every room has a height fallback
    for rm in rooms_out:
        if "h" not in rm:
            rm["h"] = 9

    # 3. Extract sub-features (stadium field, pool water, courts, Greek tiers, interior walls)
    sub_features = []
    for i in range(1, num_r):
        if i in used_room_labels:
            continue
        area = st_r[i, cv2.CC_STAT_AREA] / (scale * scale)
        if area < 90 or area > 45000:
            continue
        cx = float(cent_r[i][0]) / scale
        cy = float(cent_r[i][1]) / scale
        comp_mask = (lbl_r == i).astype(np.uint8) * 255
        comp_mask = cv2.dilate(comp_mask, np.ones((2, 2), np.uint8), iterations=1)
        cnts, _ = cv2.findContours(comp_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts:
            continue
        cnt = max(cnts, key=cv2.contourArea)

        kind = None
        if 335 < cx < 450 and 245 < cy < 312 and 3500 < area < 10000:
            kind = "pool_water"
        elif 565 < cx < 915 and 100 < cy < 235 and area > 15000:
            kind = "stadium_field"
        elif 95 < cx < 250 and 425 < cy < 630 and 900 < area < 3500:
            kind = "tennis_court"
        elif 490 < cx < 540 and 105 < cy < 230 and 250 < area < 1200:
            kind = "volleyball_court"
        elif 715 < cx < 795 and 435 < cy < 480 and 100 < area < 2500:
            kind = "greek_tier"
        else:
            px, py = int(cent_r[i][0]), int(cent_r[i][1])
            in_z = bool(z1[py, px] or z2[py, px] or z3[py, px] or z4[py, px])
            if in_z and 120 < area < 12000:
                kind = "interior_space"

        if kind:
            eps = 1.6 if kind in ("stadium_field", "greek_tier") else 1.1
            pts = contour_to_pts(cnt, scale, eps=eps)
            if pts:
                sub_features.append({
                    "kind": kind,
                    "pts": pts,
                    "d": pts_to_svg_path(pts),
                    "cx": round(cx, 1),
                    "cy": round(cy, 1),
                })

    # 4. Extract smooth paved courtyard / core walkway polygons from walkable.json
    rows, cols, step = walk["rows"], walk["cols"], walk["mapUnitsPerCell"]
    core_img = np.zeros((rows * 2, cols * 2), dtype=np.uint8)
    for r_i in range(rows):
        row_w = walk["walkable"][r_i]
        row_c = walk["core"][r_i]
        for c_i in range(cols):
            if row_w[c_i] == "1" and row_c[c_i] == "1":
                core_img[r_i * 2 : r_i * 2 + 2, c_i * 2 : c_i * 2 + 2] = 255
    core_smooth = cv2.GaussianBlur(core_img, (9, 9), 0)
    _, core_bin = cv2.threshold(core_smooth, 127, 255, cv2.THRESH_BINARY)
    core_cnts, _ = cv2.findContours(core_bin, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    courtyard_polys = []
    courtyard_paths = []
    for cnt in core_cnts:
        if cv2.contourArea(cnt) < 20:
            continue
        approx = cv2.approxPolyDP(cnt, 1.4, True).reshape(-1, 2)
        if len(approx) < 3:
            continue
        flat = []
        for x, y in approx:
            flat.append(round(float(x) * step / 2, 1))
            flat.append(round(float(y) * step / 2, 1))
        courtyard_polys.append(flat)
        courtyard_paths.append(pts_to_svg_path(flat))

    out = {
        "width": 1000,
        "height": 875,
        "courtyardPath": " ".join(courtyard_paths),
        "courtyardPolys": courtyard_polys,
        "features": features,
        "subFeatures": sub_features,
        "rooms": rooms_out,
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")

    print("Extracted 3D geometry written to", OUT_JSON)
    print("Rooms:", len(rooms_out), "Features:", Counter(f["kind"] for f in features))
    print("Sub features:", Counter(f["kind"] for f in sub_features))
    print("Output size (bytes):", OUT_JSON.stat().st_size)


if __name__ == "__main__":
    main()
