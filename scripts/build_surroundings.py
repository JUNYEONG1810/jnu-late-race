"""캠퍼스 바깥 풍경 → data/surroundings.json

사용법:  python scripts/fetch_surroundings.py  (먼저)  →  python scripts/build_surroundings.py
- data/far-terrain.json (늘 불러옴, 작음): AWS Terrain Tiles z11로 캠퍼스 둘레 ±15km를 300m 격자로 (무등산 능선 포함, 낮은 정밀도).
  높이는 data/terrain.json과 같은 기준(정문 앞 출발점 = 0)의 상대 높이, 10cm 단위 int16 → base64.
- data/surroundings.json (설정에서 "바깥 건물"을 켤 때만 불러옴): 지형 격자 둘레 1.3km 안 OSM 건물(campus.json에 이미 있는 것 빼고) 외곽선을 1m 단순화.
  높이 = building:levels × 4m + 1 (게임 규칙과 같음). 층수 태그가 없으면 house·detached 2층(태그로 정한 추정), 나머지 기본 4층(근거 없음).
Python 표준 라이브러리만 사용.
"""
import base64
import json
import math
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from terrain_report import read_png  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
TILES = RAW / "terrain_far"
OUT = ROOT / "data" / "surroundings.json"
FAR_OUT = ROOT / "data" / "far-terrain.json"
EARTH_R = 6378137.0
STEP = 300  # 메모리·삼각형을 줄이려고 150m → 300m (먼 산 능선은 그대로 보임)
HALF = 15000
MIN_AREA = 30


class FarDem:
    def __init__(self):
        meta = json.loads((TILES / "tiles.json").read_text(encoding="utf-8"))
        self.z = meta["zoom"]
        self.tx0, self.ty0 = meta["x"][0], meta["y"][0]
        nx, ny = meta["x"][1] - self.tx0 + 1, meta["y"][1] - self.ty0 + 1
        self.w, self.h = nx * 256, ny * 256
        self.hgt = [[0.0] * self.w for _ in range(self.h)]
        for i in range(nx):
            for j in range(ny):
                _, _, bpp, rows = read_png(TILES / f"{self.z}_{self.tx0 + i}_{self.ty0 + j}.png")
                for y, line in enumerate(rows):
                    out = self.hgt[j * 256 + y]
                    for x in range(256):
                        r, g, b = line[x * bpp], line[x * bpp + 1], line[x * bpp + 2]
                        out[i * 256 + x] = r * 256 + g + b / 256 - 32768

    def at(self, lat, lon):
        n = 256 * 2 ** self.z
        px = (lon + 180) / 360 * n - self.tx0 * 256 - 0.5
        py = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n - self.ty0 * 256 - 0.5
        x0, y0 = int(math.floor(px)), int(math.floor(py))
        fx, fy = px - x0, py - y0
        x0 = max(0, min(self.w - 2, x0))
        y0 = max(0, min(self.h - 2, y0))
        H = self.hgt
        top = H[y0][x0] * (1 - fx) + H[y0][x0 + 1] * fx
        bot = H[y0 + 1][x0] * (1 - fx) + H[y0 + 1][x0 + 1] * fx
        return top * (1 - fy) + bot * fy


def simplify(pts, tol=1.0):
    """Douglas–Peucker (닫힌 고리, 마지막 점 = 첫 점 아님)"""
    if len(pts) <= 4:
        return pts

    def dp(a, b, seg):
        if len(seg) < 3:
            return [seg[0]]
        (x1, z1), (x2, z2) = seg[0], seg[-1]
        L = math.hypot(x2 - x1, z2 - z1) or 1e-9
        best, bi = -1, 0
        for i in range(1, len(seg) - 1):
            d = abs((x2 - x1) * (z1 - seg[i][1]) - (x1 - seg[i][0]) * (z2 - z1)) / L
            if d > best:
                best, bi = d, i
        if best <= tol:
            return [seg[0]]
        return dp(a, b, seg[:bi + 1]) + dp(a, b, seg[bi:])
    half = len(pts) // 2
    out = dp(0, 0, pts[:half + 1]) + dp(0, 0, pts[half:] + [pts[0]])
    return out if len(out) >= 3 else pts


def area(o):
    return sum(o[i][0] * o[(i + 1) % len(o)][1] - o[(i + 1) % len(o)][0] * o[i][1] for i in range(len(o))) / 2


def main():
    campus = json.loads((ROOT / "data" / "campus.json").read_text(encoding="utf-8"))
    terr = json.loads((ROOT / "data" / "terrain.json").read_text(encoding="utf-8"))
    o = campus["meta"]["origin"]
    kx = math.radians(1) * EARTH_R * math.cos(math.radians(o["lat"]))
    kz = math.radians(1) * EARTH_R
    base = terr["baseElevation"]
    dem = FarDem()
    n = HALF * 2 // STEP + 1
    dm = []
    for j in range(n):
        z = -HALF + j * STEP
        for i in range(n):
            x = -HALF + i * STEP
            dm.append(max(-32000, min(32000, round((dem.at(o["lat"] - z / kz, o["lon"] + x / kx) - base) * 10))))
    peak = max(dm) / 10
    pi = dm.index(max(dm))
    print(f"먼 지형 {n}×{n} ({STEP}m), 가장 높은 곳 +{peak:.0f}m (해발 {peak + base:.0f}m) at x {-HALF + (pi % n) * STEP}, z {-HALF + (pi // n) * STEP}")

    have = {b["id"] for b in campus["buildings"]}
    raw = json.loads((RAW / "surroundings_osm.json").read_text(encoding="utf-8"))
    blds, skipped = [], 0
    for e in raw["elements"]:
        if e.get("type") != "way" or "geometry" not in e:
            continue
        if f"w{e['id']}" in have:
            continue
        pts = [((p["lon"] - o["lon"]) * kx, (o["lat"] - p["lat"]) * kz) for p in e["geometry"]]
        if len(pts) > 1 and pts[0] == pts[-1]:
            pts = pts[:-1]
        if len(pts) < 3 or abs(area(pts)) < MIN_AREA:
            skipped += 1
            continue
        pts = simplify(pts)
        t = e.get("tags", {})
        lv = None
        try:
            lv = float(str(t.get("building:levels", "")).split(";")[0])
        except ValueError:
            pass
        if lv:
            src = "levels"
        elif t.get("building") in ("house", "detached", "hut", "shed", "garage", "garages"):
            lv, src = 2 if t.get("building") in ("house", "detached") else 1, "type"
        else:
            lv, src = 4, "default"
        blds.append({"o": [[round(x, 1), round(z, 1)] for x, z in pts], "h": round(lv * 4 + 1, 1), "s": src[0]})
    from collections import Counter
    c = Counter(b["s"] for b in blds)
    print(f"둘레 건물 {len(blds)}개 (작은 것 {skipped}개 뺌): 층수 태그 {c['l']}, 종류로 정함 {c['t']}, 기본 4층 {c['d']}")
    far = {"source": "AWS Terrain Tiles(terrarium z11), 정문 앞 출발점 기준 상대 높이",
           "step": STEP, "x0": -HALF, "z0": -HALF, "n": n, "unit": 0.1,
           "data": base64.b64encode(struct.pack(f"<{len(dm)}h", *dm)).decode("ascii")}
    FAR_OUT.write_text(json.dumps(far, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"저장 → {FAR_OUT.relative_to(ROOT)} ({FAR_OUT.stat().st_size / 1024:.0f} KB)")
    out = {
        "source": "둘레 건물: OpenStreetMap 기여자(ODbL)",
        "buildings": blds,
        "근거": {"높이": "층수 태그 → 층수 × 4m + 1 / house·detached 2층·창고류 1층(태그로 정한 추정) / 나머지 기본 4층(근거 없음)",
                 "모양": "OSM 외곽선을 1m로 단순화한 덩어리, 창·재질 없음(임의 색)"},
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"저장 → {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
