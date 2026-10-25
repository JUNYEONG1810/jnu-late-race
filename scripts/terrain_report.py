"""지형 높이 조사: data/raw/terrain/의 terrarium 타일로 캠퍼스 높이를 분석하고 그림을 만든다.

사용법 (저장소 루트에서):  python scripts/terrain_report.py
먼저 scripts/fetch_terrain.py를 실행해 둔다. Python 표준 라이브러리만 사용(PNG 읽기·쓰기도 직접).
결과: 표는 화면에 출력, 그림은 docs/terrain-height.png(높이) · docs/terrain-diff.png(표면 - 도로 기반 지면).
"""
import json
import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TILES = ROOT / "data" / "raw" / "terrain"
DOCS = ROOT / "docs"
EARTH_R = 6378137.0
MISSIONS = ["농생대 1호관", "중앙도서관", "제1학생마루", "생활관 9C동 예향학사", "공과대 2호관"]
PX_M = 3.0  # 그림 한 칸 = 3m


# ---------- PNG 읽기·쓰기 (8비트 RGB/RGBA) ----------

def read_png(path):
    data = path.read_bytes()
    pos, idat, w, h, ctype = 8, b"", 0, 0, 0
    while pos < len(data):
        n, kind = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + n]
        if kind == b"IHDR":
            w, h, depth, ctype = struct.unpack(">IIBB", body[:10])
            assert depth == 8 and ctype in (2, 6), "8비트 RGB/RGBA만 지원"
        elif kind == b"IDAT":
            idat += body
        pos += 12 + n
    bpp = 3 if ctype == 2 else 4
    raw = zlib.decompress(idat)
    stride = w * bpp
    rows, prev, i = [], bytearray(stride), 0
    for _ in range(h):
        f = raw[i]
        line = bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line)
        prev = line
    return w, h, bpp, rows


def write_png(path, w, h, pixels):
    """pixels: 길이 w*h의 (r, g, b) 리스트"""
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for r, g, b in pixels[y * w:(y + 1) * w]:
            raw += bytes((r, g, b))
    chunk = lambda k, d: struct.pack(">I", len(d)) + k + d + struct.pack(">I", zlib.crc32(k + d) & 0xffffffff)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


# ---------- 높이 격자 ----------

class Dem:
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
        x0 = max(0, min(self.w - 2, x0)); y0 = max(0, min(self.h - 2, y0))
        H = self.hgt
        top = H[y0][x0] * (1 - fx) + H[y0][x0 + 1] * fx
        bot = H[y0 + 1][x0] * (1 - fx) + H[y0 + 1][x0 + 1] * fx
        return top * (1 - fy) + bot * fy


def point_in_poly(x, z, poly):
    inside = False
    for (x1, z1), (x2, z2) in zip(poly, poly[1:] + poly[:1]):
        if (z1 > z) != (z2 > z) and x < x1 + (z - z1) * (x2 - x1) / (z2 - z1):
            inside = not inside
    return inside


def nearest_on_roads(roads, p):
    best = (1e18, p)
    for r in roads:
        pts = r["points"]
        for (x1, z1), (x2, z2) in zip(pts, pts[1:]):
            dx, dz = x2 - x1, z2 - z1
            L = dx * dx + dz * dz
            t = 0 if L == 0 else max(0, min(1, ((p[0] - x1) * dx + (p[1] - z1) * dz) / L))
            q = (x1 + t * dx, z1 + t * dz)
            d = math.hypot(p[0] - q[0], p[1] - q[1])
            if d < best[0]:
                best = (d, q)
    return best[1]


def ramp(t):
    """0~1 → 파랑-초록-노랑-주황-빨강"""
    stops = [(0, (40, 90, 200)), (0.25, (60, 170, 120)), (0.5, (230, 220, 90)), (0.75, (240, 150, 60)), (1, (200, 50, 40))]
    t = max(0, min(1, t))
    for (a, ca), (b, cb) in zip(stops, stops[1:]):
        if t <= b:
            k = (t - a) / (b - a)
            return tuple(int(ca[i] + (cb[i] - ca[i]) * k) for i in range(3))
    return stops[-1][1]


def main():
    campus = json.loads((ROOT / "data" / "campus.json").read_text(encoding="utf-8"))
    o = campus["meta"]["origin"]
    lat0, lon0 = o["lat"], o["lon"]
    kx = math.radians(1) * EARTH_R * math.cos(math.radians(lat0))
    kz = math.radians(1) * EARTH_R
    dem = Dem()
    H = lambda x, z: dem.at(lat0 - z / kz, lon0 + x / kx)  # 캠퍼스 좌표(m) → 높이(m)
    boundary = campus["boundary"]

    # 1) 캠퍼스 안 최저·최고 (5m 간격)
    xs = [p[0] for p in boundary]; zs = [p[1] for p in boundary]
    lo, hi = (1e9, None), (-1e9, None)
    for x in range(int(min(xs)), int(max(xs)) + 1, 5):
        for z in range(int(min(zs)), int(max(zs)) + 1, 5):
            if point_in_poly(x, z, boundary):
                h = H(x, z)
                if h < lo[0]: lo = (h, (x, z))
                if h > hi[0]: hi = (h, (x, z))
    print(f"캠퍼스 안 최저 {lo[0]:.1f}m @ {lo[1]}, 최고 {hi[0]:.1f}m @ {hi[1]}, 차이 {hi[0] - lo[0]:.1f}m")

    # 2) 정문·미션 장소 높이
    car_roads = [r for r in campus["roads"] if r["car"]]
    B = {b["name"]: b for b in campus["buildings"] if b["name"]}
    gx, gz = campus["spawn"]["gate"]
    print("\n| 장소 | 위치(x, z) | 높이(m) |")
    print(f"| 정문 | ({gx:.0f}, {gz:.0f}) | {H(gx, gz):.1f} |")
    marks = [("정문", (gx, gz))]
    for n in MISSIONS:
        q = nearest_on_roads(car_roads, B[n]["center"])
        print(f"| {n} (미션 지점) | ({q[0]:.0f}, {q[1]:.0f}) | {H(*q):.1f} |  건물 중심 {H(*B[n]['center']):.1f}")
        marks.append((n, q))

    # 3) 도로 위 점만으로 만든 지면과 비교 (표면 높이에 건물·나무가 섞였는지)
    samples = []
    for r in campus["roads"]:
        pts = r["points"]
        for (x1, z1), (x2, z2) in zip(pts, pts[1:]):
            L = math.hypot(x2 - x1, z2 - z1)
            for k in range(int(L // 10) + 1):
                t = k * 10 / L if L else 0
                x, z = x1 + (x2 - x1) * t, z1 + (z2 - z1) * t
                if point_in_poly(x, z, boundary):
                    samples.append((x, z, H(x, z)))
    cell = 40
    grid = {}
    for s in samples:
        grid.setdefault((int(s[0] // cell), int(s[1] // cell)), []).append(s)

    def ground(x, z):  # 가까운 도로 점들의 거리 가중 평균
        gx_, gz_ = int(x // cell), int(z // cell)
        for rad in (1, 2, 3, 5):
            near = [s for i in range(-rad, rad + 1) for j in range(-rad, rad + 1) for s in grid.get((gx_ + i, gz_ + j), [])]
            if len(near) >= 6:
                break
        ws = [(1 / (math.hypot(s[0] - x, s[1] - z) ** 2 + 25), s[2]) for s in near]
        return sum(w * h for w, h in ws) / sum(w for w, _ in ws) if ws else None

    diffs = []
    for x in range(int(min(xs)), int(max(xs)) + 1, 10):
        for z in range(int(min(zs)), int(max(zs)) + 1, 10):
            if point_in_poly(x, z, boundary):
                g = ground(x, z)
                if g is not None:
                    diffs.append((H(x, z) - g, (x, z)))
    vals = [d for d, _ in diffs]
    mean = sum(vals) / len(vals)
    mabs = sum(abs(v) for v in vals) / len(vals)
    big = sum(1 for v in vals if abs(v) > 3) / len(vals)
    mx = max(diffs); mn = min(diffs)
    in_b = [H(*b["center"]) - (ground(*b["center"]) or 0) for b in campus["buildings"] if b["inCampus"]]
    forest = [g for g in campus["greens"] if g["kind"] == "forest"]
    in_f = []
    for g in forest:
        cx = sum(p[0] for p in g["outline"]) / len(g["outline"]); cz = sum(p[1] for p in g["outline"]) / len(g["outline"])
        if point_in_poly(cx, cz, boundary) and ground(cx, cz) is not None:
            in_f.append(H(cx, cz) - ground(cx, cz))
    print(f"\n도로 점 {len(samples)}개로 만든 지면과 비교 (10m 간격 {len(vals)}점):")
    print(f"  평균 차이 {mean:+.2f}m, 평균 절대 차이 {mabs:.2f}m, |차이|>3m 비율 {big * 100:.1f}%")
    print(f"  최대 +{mx[0]:.1f}m @ {mx[1]}, 최소 {mn[0]:.1f}m @ {mn[1]}")
    print(f"  건물 중심 {len(in_b)}곳 평균 {sum(in_b) / len(in_b):+.2f}m, 숲 중심 {len(in_f)}곳 평균 {sum(in_f) / len(in_f):+.2f}m")

    # 4) 그림: 높이 지도 + 차이 지도 (건물 외곽선, 정문·미션 지점 표시)
    pad = 60
    X0, X1 = min(xs) - pad, max(xs) + pad
    Z0, Z1 = min(zs) - pad, max(zs) + pad
    W, Hh = int((X1 - X0) / PX_M), int((Z1 - Z0) / PX_M)
    hmin, hmax = lo[0] - 2, hi[0] + 2
    img_h, img_d = [], []
    for j in range(Hh):
        for i in range(W):
            x, z = X0 + (i + 0.5) * PX_M, Z0 + (j + 0.5) * PX_M
            h = H(x, z)
            c = ramp((h - hmin) / (hmax - hmin))
            inside = point_in_poly(x, z, boundary)
            if not inside:
                c = tuple(int(v * 0.55 + 255 * 0.45) for v in c)
            img_h.append(c)
            g = ground(x, z) if inside else None
            if g is None:
                img_d.append((235, 235, 235))
            else:
                d = max(-6, min(6, h - g)) / 6
                img_d.append((255, int(255 * (1 - d)), int(255 * (1 - d))) if d > 0 else (int(255 * (1 + d)), int(255 * (1 + d)), 255))

    def line(img, a, b, col):
        (x1, z1), (x2, z2) = a, b
        n = int(max(abs(x2 - x1), abs(z2 - z1)) / PX_M) + 1
        for k in range(n + 1):
            t = k / n
            i = int((x1 + (x2 - x1) * t - X0) / PX_M); j = int((z1 + (z2 - z1) * t - Z0) / PX_M)
            if 0 <= i < W and 0 <= j < Hh:
                img[j * W + i] = col

    for img in (img_h, img_d):
        for b in campus["buildings"]:
            ol = b["outline"]
            for a, c in zip(ol, ol[1:] + ol[:1]):
                line(img, a, c, (40, 40, 40))
        for a, c in zip(boundary, boundary[1:] + boundary[:1]):
            line(img, a, c, (255, 255, 255))
        for _, (x, z) in marks:  # 정문·미션 지점: 흰 테두리 검은 점
            ci, cj = int((x - X0) / PX_M), int((z - Z0) / PX_M)
            for di in range(-4, 5):
                for dj in range(-4, 5):
                    r2 = di * di + dj * dj
                    if r2 <= 16 and 0 <= ci + di < W and 0 <= cj + dj < Hh:
                        img[(cj + dj) * W + ci + di] = (0, 0, 0) if r2 <= 6 else (255, 255, 255)
    DOCS.mkdir(exist_ok=True)
    write_png(DOCS / "terrain-height.png", W, Hh, img_h)
    write_png(DOCS / "terrain-diff.png", W, Hh, img_d)
    print(f"\n그림 저장: docs/terrain-height.png, docs/terrain-diff.png ({W}×{Hh}px, 1px = {PX_M:.0f}m, 높이 범위 {hmin:.0f}~{hmax:.0f}m)")


if __name__ == "__main__":
    main()
