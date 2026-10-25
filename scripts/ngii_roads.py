"""수치지도(2025 1:5,000)로 캠퍼스 차도의 실제 폭을 재서 data/road-widths.json에 저장 (게임이 불러와 OSM 폭 대신 씀).

사용법:  python scripts/ngii_roads.py
- 차도(OSM)마다 8m 간격으로 중심선에 수직인 선을 긋고, 양쪽 도로경계(N3L/N3A_A0010000)까지의 거리에서
  그 선 위의 보도(N3A_A0033320)와 주차장(OSM) 구간을 뺀 것을 차도 폭으로 본다.
  (정사영상은 보도와 아스팔트 색이 거의 같아 폭 재기에는 수치지도를 쓴다.)
- 도로 가장자리가 건물 외곽선에서 0.5m 안으로 들어가지 않게 줄인다. 잰 곳 5군데 이상·40% 이상인 도로만, 중앙값,
  4~16m (캠퍼스 안 service·residential 도로는 12m까지).
- OSM 폭과 1m 이상 다를 때만 기록. 정문 진입로는 참고 조사(정사영상) 결과: 편도 2차로 + 분리대.
"""
import json
import math
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ngii  # noqa: E402

OUT = ngii.ROOT / "data" / "road-widths.json"
STEP = 8.0
MAX_HALF = 20.0
CELL = 20
# 정문 진입로 (docs/참고-조사.md a): 차도 한쪽 7m × 2 + 가운데 분리대 1.5m, 4차로
ENTRY = {"w256927670": {"width": 15.5, "lanes": 4, "median": 1.5, "note": "정문 진입로 (정사영상: 편도 2차로 + 분리대)"}}


def dist_seg(px, pz, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    L = dx * dx + dz * dz
    t = 0 if L == 0 else max(0, min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / L))
    return math.hypot(px - a[0] - t * dx, pz - a[1] - t * dz)


def point_in(x, z, poly):
    inside = False
    for (x1, z1), (x2, z2) in zip(poly, poly[1:] + poly[:1]):
        if (z1 > z) != (z2 > z) and x < x1 + (z - z1) * (x2 - x1) / (z2 - z1):
            inside = not inside
    return inside


def grid_add(grid, a, b, item):
    for gx in range(int(min(a[0], b[0]) // CELL), int(max(a[0], b[0]) // CELL) + 1):
        for gz in range(int(min(a[1], b[1]) // CELL), int(max(a[1], b[1]) // CELL) + 1):
            grid.setdefault((gx, gz), []).append(item)


def main():
    campus = json.loads((ngii.ROOT / "data" / "campus.json").read_text(encoding="utf-8"))
    g = ngii.GameTM(campus)

    bound = {}
    for code in ("N3L_A0010000", "N3A_A0010000"):
        for _, _, parts in ngii.layer(code):
            for part in parts:
                pts = [g.to_game(E, N) for E, N in part]
                for a, b in zip(pts, pts[1:]):
                    grid_add(bound, a, b, (a, b))
    walks = {}
    for _, typ, parts in ngii.layer("N3A_A0033320"):
        if typ != 5 or not parts:
            continue
        ring = [g.to_game(E, N) for E, N in parts[0]]
        xs, zs = [p[0] for p in ring], [p[1] for p in ring]
        grid_add(walks, (min(xs), min(zs)), (max(xs), max(zs)), (ring, (min(xs), min(zs), max(xs), max(zs))))
    for o in campus.get("parking", []):
        xs, zs = [p[0] for p in o], [p[1] for p in o]
        grid_add(walks, (min(xs), min(zs)), (max(xs), max(zs)), (o, (min(xs), min(zs), max(xs), max(zs))))
    edges = {}
    for b in campus["buildings"]:
        o = b["outline"]
        for a, c in zip(o, o[1:] + o[:1]):
            grid_add(edges, (min(a[0], c[0]) - CELL, min(a[1], c[1]) - CELL), (max(a[0], c[0]) + CELL, max(a[1], c[1]) + CELL), (a, c))

    def ray(px, pz, dx, dz):
        best, seen = None, set()
        for k in range(0, int(MAX_HALF) + CELL, CELL // 2):
            for s in bound.get((int((px + dx * k) // CELL), int((pz + dz * k) // CELL)), []):
                if id(s) in seen:
                    continue
                seen.add(id(s))
                (x1, z1), (x2, z2) = s
                ex, ez = x2 - x1, z2 - z1
                den = dx * ez - dz * ex
                if abs(den) < 1e-9:
                    continue
                t = ((x1 - px) * ez - (z1 - pz) * ex) / den
                u = ((x1 - px) * dz - (z1 - pz) * dx) / den
                if 0.3 < t < MAX_HALF and 0 <= u <= 1 and (best is None or t < best):
                    best = t
        return best

    def in_walk(x, z):
        for ring, bb in walks.get((int(x // CELL), int(z // CELL)), []):
            if bb[0] <= x <= bb[2] and bb[1] <= z <= bb[3] and point_in(x, z, ring):
                return True
        return False

    def clearance(x, z):
        return min((dist_seg(x, z, a, c) for a, c in edges.get((int(x // CELL), int(z // CELL)), [])), default=99)

    out = dict(ENTRY)
    measured = 0
    for r in campus["roads"]:
        if not r["car"] or r["id"] in out:
            continue
        pts = r["points"]
        if sum(math.dist(a, b) for a, b in zip(pts, pts[1:])) < 60:
            continue
        samples, tries, acc = [], 0, 0.0
        for a, b in zip(pts, pts[1:]):
            L = math.dist(a, b)
            if L < 1e-6:
                continue
            ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
            t = (STEP - acc % STEP) % STEP
            while t < L:
                x, z = a[0] + ux * t, a[1] + uz * t
                tries += 1
                l, rr = ray(x, z, uz, -ux), ray(x, z, -uz, ux)
                if l and rr:
                    walk = sum(0.25 for k in range(int((l + rr) / 0.25)) if in_walk(x + uz * (l - k * 0.25), z - ux * (l - k * 0.25)))
                    w = l + rr - walk
                    samples.append(min(w, 2 * max(0, clearance(x, z) - 0.5)))
                t += STEP
            acc += L
        if len(samples) >= 5 and len(samples) >= 0.4 * tries:
            measured += 1
            cap = 12 if r["type"] in ("service", "residential", "living_street") else 16
            w = round(max(4, min(cap, statistics.median(samples))) * 2) / 2
            if abs(w - r["width"]) >= 1:
                out[r["id"]] = {"width": w, "lanes": 4 if w >= 12 else 2,
                                "note": f"수치지도 도로경계−보도·주차장, {len(samples)}곳 중앙값 (OSM {r['width']}m)"}
    OUT.write_text(json.dumps({"source": "국토지리정보원 수치지도(2025 1:5,000) 도로경계·보도로 잰 차도 폭, 정문 진입로는 정사영상",
                               "roads": out}, ensure_ascii=False, indent=1), encoding="utf-8")
    ws = [v["width"] for v in out.values()]
    print(f"잰 도로 {measured}개, 폭을 바꾼 도로 {len(out)}개 (정문 진입로 포함) → {OUT.relative_to(ngii.ROOT)}")
    print(f"  바꾼 폭: 최소 {min(ws)} / 중앙 {statistics.median(ws)} / 최대 {max(ws)} m")


if __name__ == "__main__":
    main()
