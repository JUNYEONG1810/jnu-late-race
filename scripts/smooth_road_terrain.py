"""차도 위 단차 정리: 수치지도 지형(data/terrain.json)에서 차도 범위만 길이 방향으로 부드럽게, 폭 방향은 평평하게 고친다.
옹벽·석축 단차는 차도 밖에만 남는다.

사용법:  python scripts/smooth_road_terrain.py
- 처음 실행 때 지금의 data/terrain.json을 data/raw/terrain_ngii.json(커밋 안 함)으로 복사해 두고, 그 뒤로는 늘 그 사본에서 시작한다.
- 차도(campus.json roads 중 car) 가운데선에서 (반폭 + MARGIN) 안의 격자점만 움직인다.
  1) 도로마다 가운데선을 2.5m 간격으로 잘라, 폭 방향 여러 점의 땅 높이 중앙값 = 도로 높이
  2) 길이 방향으로 이동 평균(WINDOW m) → 경사 MAX_SLOPE 이하로 앞뒤 두 번 깎기
  3) 격자점 높이 = 가장 가까운 도로(들)의 가운데선 높이 (폭 방향 평평), 교차로는 가까운 도로들의 거리 가중 평균
  4) 차도 격자점끼리만 몇 번 고르게(교차로 이음매), 바깥 점은 그대로
- 검증: 수치지도 표고점(build_terrain_ngii.py와 같은 방식으로 뗀 검증용 20% + 전체)과 높이 차, 차도 위 최대 경사.
Python 표준 라이브러리만 사용.
"""
import base64
import json
import math
import random
import shutil
import statistics
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ngii  # noqa: E402
from build_terrain_ngii import load_grid, height_at  # noqa: E402

ROOT = ngii.ROOT
TERRAIN = ROOT / "data" / "terrain.json"
BASE_COPY = ROOT / "data" / "raw" / "terrain_ngii.json"
REPORT = ROOT / "data" / "raw" / "smooth_road_report.json"
MARGIN = 3.5       # 차도 가장자리 밖으로 이만큼까지 격자점을 같이 고침 (5m 격자 삼각형이 차도를 다 덮도록)
STEP = 2.5         # 가운데선 자르는 간격
WINDOW = 25.0      # 이동 평균 길이 (m)
MAX_SLOPE = 0.12   # 차도 최대 경사
PASSES = 8         # 단면 다시 잡기 횟수


def road_samples(pts, step=STEP):
    """가운데선을 step 간격 점으로: [(x, z, s, ux, uz)]"""
    out, s = [], 0.0
    for (x1, z1), (x2, z2) in zip(pts, pts[1:]):
        L = math.hypot(x2 - x1, z2 - z1)
        if L < 1e-6:
            continue
        ux, uz = (x2 - x1) / L, (z2 - z1) / L
        n = max(1, int(L / step))
        for k in range(n):
            t = L * k / n
            out.append((x1 + ux * t, z1 + uz * t, s + t, ux, uz))
        s += L
    if out:
        x, z = pts[-1]
        out.append((x, z, s, out[-1][3], out[-1][4]))
    return out


def profile(samples, hw, h_at):
    """도로 높이 단면: 폭 방향 5점 중앙값 → 이동 평균 → 경사 제한"""
    raw = []
    for x, z, s, ux, uz in samples:
        vals = [h_at(x - uz * hw * f, z + ux * hw * f) for f in (-1, -0.5, 0, 0.5, 1)]
        raw.append(statistics.median(vals))
    ss = [p[2] for p in samples]
    sm = []
    for i, s in enumerate(ss):
        acc = [raw[k] for k in range(len(ss)) if abs(ss[k] - s) <= WINDOW / 2]
        sm.append(sum(acc) / len(acc))
    fw, bw = sm[:], sm[:]
    for i in range(1, len(ss)):          # 앞에서부터 깎기
        d = (ss[i] - ss[i - 1]) * MAX_SLOPE
        fw[i] = min(max(fw[i], fw[i - 1] - d), fw[i - 1] + d)
    for i in range(len(ss) - 2, -1, -1):  # 뒤에서부터 깎기
        d = (ss[i + 1] - ss[i]) * MAX_SLOPE
        bw[i] = min(max(bw[i], bw[i + 1] - d), bw[i + 1] + d)
    return [(a + b) / 2 for a, b in zip(fw, bw)], raw


def max_slope(samples, h_at):
    worst = (0.0, None)
    for a, b in zip(samples, samples[1:]):
        ds = b[2] - a[2]
        if ds < 0.5:
            continue
        sl = abs(h_at(b[0], b[1]) - h_at(a[0], a[1])) / ds
        if sl > worst[0]:
            worst = (sl, (round((a[0] + b[0]) / 2, 1), round((a[1] + b[1]) / 2, 1)))
    return worst


def spot_sets(meta):
    """build_terrain_ngii.py와 같은 방식의 표고점 (전체, 검증용)"""
    g = ngii.GameTM()
    zones = []
    for b in ngii.ngi_bounds():
        (xa, za), (xb, zb) = g.to_game(b[0], b[3]), g.to_game(b[2], b[1])
        zones.append((min(xa, xb), min(za, zb), max(xa, xb), max(za, zb)))
    in2020 = lambda x, z: any(a <= x <= c and b <= z <= d for a, b, c, d in zones)  # noqa: E731
    spots, extra = [], []
    for a, typ, parts in ngii.layer("N3P_F0020000"):
        x, z = g.to_game(*parts[0][0])
        (extra if in2020(x, z) else spots).append((x, z, float(a["수치"]), 2025))
    for a, typ, parts in ngii.read_ngi("F0020000"):
        x, z = g.to_game(*parts[0][0])
        spots.append((x, z, float(a["수치"]), 2020))
    x0, z0, nx, nz, st = meta["x0"], meta["z0"], meta["nx"], meta["nz"], meta["step"]
    inside = lambda x, z: x0 < x < x0 + (nx - 1) * st and z0 < z < z0 + (nz - 1) * st  # noqa: E731
    spots = [s for s in spots if inside(s[0], s[1])]
    rnd = random.Random(20261026)
    rnd.shuffle(spots)
    hold = spots[:int(len(spots) * 0.2)] + [s for s in extra if inside(s[0], s[1])]
    return spots + [s for s in extra if inside(s[0], s[1])], hold


def main():
    if not BASE_COPY.exists():
        shutil.copy(TERRAIN, BASE_COPY)
        print(f"수치지도 지형 사본 → {BASE_COPY.relative_to(ROOT)}")
    meta, base = load_grid(BASE_COPY)
    x0, z0, nx, nz, st = meta["x0"], meta["z0"], meta["nx"], meta["nz"], meta["step"]
    old_at = lambda x, z: height_at(meta, base, x, z)  # noqa: E731
    campus = json.loads((ROOT / "data" / "campus.json").read_text(encoding="utf-8"))
    widths = json.loads((ROOT / "data" / "road-widths.json").read_text(encoding="utf-8")) if (ROOT / "data" / "road-widths.json").exists() else {}
    roads = []
    for r in campus["roads"]:
        if not r.get("car"):
            continue
        w = r["width"]
        wv = widths.get("roads", {}).get(r["id"])
        if isinstance(wv, (int, float)):
            w = wv
        elif isinstance(wv, dict) and isinstance(wv.get("width"), (int, float)):
            w = wv["width"]
        sm = road_samples(r["points"])
        if len(sm) < 2:
            continue
        roads.append({"id": r["id"], "hw": w / 2, "samples": sm})
    # 격자점 → 가까운 도로 가운데선 점들 (거리 MARGIN 안)
    cell = 10.0
    grid = {}
    for ri, r in enumerate(roads):
        for k, (x, z, s, ux, uz) in enumerate(r["samples"]):
            grid.setdefault((int(x // cell), int(z // cell)), []).append((ri, k))
    near = {}
    for j in range(nz):
        for i in range(nx):
            x, z = x0 + i * st, z0 + j * st
            best = {}
            gx, gz = int(x // cell), int(z // cell)
            for a in (-2, -1, 0, 1, 2):
                for b in (-2, -1, 0, 1, 2):
                    for ri, k in grid.get((gx + a, gz + b), ()):
                        r = roads[ri]
                        d = math.hypot(r["samples"][k][0] - x, r["samples"][k][1] - z)
                        if d <= r["hw"] + MARGIN and (ri not in best or d < best[ri][0]):
                            best[ri] = (d, k)
            if best:
                near[j * nx + i] = [(1 / (d + 0.5) ** 2, ri, k) for ri, (d, k) in best.items()]
    masked = list(near)
    mset = set(masked)

    # 단면 → 격자 → 이음매 고르기를 PASSES번: 두 번째부터는 고친 지형에서 다시 단면을 잡아 교차로에서 생긴 경사도 깎는다
    new = base[:]
    for _ in range(PASSES):
        cur = new[:]
        cur_at = lambda x, z, h=cur: height_at(meta, h, x, z)  # noqa: E731
        for r in roads:
            r["prof"] = profile(r["samples"], r["hw"], cur_at)[0]
        for idx, lst in near.items():
            new[idx] = sum(w * roads[ri]["prof"][k] for w, ri, k in lst) / sum(w for w, _, _ in lst)
        for _ in range(6):  # 차도 격자점끼리만 고르게 (교차로 이음매), 바깥 점은 그대로
            nxt = new[:]
            for idx in masked:
                j, i = divmod(idx, nx)
                acc, n = new[idx] * 2, 2
                for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    q = (j + b) * nx + (i + a)
                    if 0 <= i + a < nx and 0 <= j + b < nz and q in mset:
                        acc += new[q]
                        n += 1
                nxt[idx] = acc / n
            new = nxt
    new_at = lambda x, z: height_at(meta, new, x, z)  # noqa: E731

    # 검증
    allspots, hold = spot_sets(meta)
    near_road = lambda x, z: (int(round((z - z0) / st)) * nx + int(round((x - x0) / st))) in mset  # noqa: E731
    road_spots = [s for s in allspots if near_road(s[0], s[1])]
    mae = lambda fn, ss: statistics.mean(abs(fn(x, z) - v) for x, z, v, _ in ss) if ss else 0  # noqa: E731
    slopes_old = sorted((max_slope(r["samples"], old_at) + (r["id"],) for r in roads), key=lambda t: -t[0])
    slopes_new = sorted((max_slope(r["samples"], new_at) + (r["id"],) for r in roads), key=lambda t: -t[0])
    report = {
        "masked_points": len(masked), "roads": len(roads),
        "holdout_mae": [round(mae(old_at, hold), 3), round(mae(new_at, hold), 3), len(hold)],
        "all_spots_mae": [round(mae(old_at, allspots), 3), round(mae(new_at, allspots), 3), len(allspots)],
        "road_spots_mae": [round(mae(old_at, road_spots), 3), round(mae(new_at, road_spots), 3), len(road_spots)],
        "max_slope_old": [(round(a, 3), p, i) for a, p, i in slopes_old[:8]],
        "max_slope_new": [(round(a, 3), p, i) for a, p, i in slopes_new[:8]],
        "roads_over_12pct": [sum(1 for t in slopes_old if t[0] > MAX_SLOPE + 0.01), sum(1 for t in slopes_new if t[0] > MAX_SLOPE + 0.01)],
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=1))

    # 저장 (출발점 높이 기준 그대로)
    base_el = meta["baseElevation"]
    cm = [round((v - base_el) * 100) for v in new]
    lo = min(cm)
    out = dict(meta)
    out.update({"source": meta["source"].split(" / 차도")[0] + " / 차도 위 단차 정리(scripts/smooth_road_terrain.py)",
                "offsetCm": lo, "data": base64.b64encode(struct.pack(f"<{len(cm)}H", *(v - lo for v in cm))).decode("ascii")})
    TERRAIN.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"저장 → {TERRAIN.relative_to(ROOT)} (차도 격자점 {len(masked)}개 고침)")


if __name__ == "__main__":
    main()
