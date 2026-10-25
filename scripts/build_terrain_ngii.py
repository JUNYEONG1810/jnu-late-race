"""국토지리정보원 수치지도(등고선·표고점·옹벽)로 5m 격자 지형을 다시 만들어 data/terrain.json을 바꾼다.

사용법 (저장소 루트에서):  python scripts/build_terrain_ngii.py
먼저 python scripts/build_terrain.py 로 AWS 지형(data/terrain.json)이 있어야 한다. 처음 실행 때 그 파일을
data/raw/terrain_aws.json 으로 복사해 두고, 이후로는 그 사본을 바탕으로 쓴다. Python 표준 라이브러리만 사용.

방법
- 바탕은 AWS 지형(약 30m 정밀도). 수치지도 값과의 차이(보정량)를 매끄럽게 퍼뜨려 더한다:
  보정량의 이웃 차이 제곱 합(매끄러움) + 등고선 점·표고점에서 (지형 − 측량값)² + 옹벽 위아래 높이 차 조건을
  가장 작게 하는 값을 거친 격자(20m)→10m→5m 순서로 가우스-자이델로 푼다.
- 2020 1:1,000(등고선 1m 간격)이 있는 구역은 그것만 쓰고, 그 밖은 2025 1:5,000(등고선 5m 간격).
- 옹벽·석축·제방(상단·하단 선)과 절토·성토(법면) 선을 지나는 격자 이음은 매끄러움 조건을 끊어 단차가 날카롭게 남게 하고,
  옹벽 상단 선과 가까운 하단 선 사이에는 "위쪽 − 아래쪽 = 높이" 조건을 건다.
- 수치지도가 없는 바깥(캠퍼스 서쪽 끝 등)은 보정량이 수치지도 구역의 평균 보정량으로 서서히 이어지게 한다(AWS 모양 유지).
- 검증: 표고점의 20%와 등고선의 10%(선 단위)를 따로 떼어 두고(지형 만들 때 안 씀) 새 지형·AWS 지형의 오차를 비교한다.
  2020 구역 안의 2025 표고점은 학습에 쓰지 않고 모두 검증에만 쓴다.
  새 지형이 더 나쁘면 data/terrain.json을 바꾸지 않는다.
결과: data/terrain.json, docs/terrain-ngii-diff.png(새 − AWS, 정문 기준 상대 높이), 화면에 검증 표.
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
from terrain_report import write_png  # noqa: E402

ROOT = ngii.ROOT
TERRAIN = ROOT / "data" / "terrain.json"
AWS_COPY = ROOT / "data" / "raw" / "terrain_aws.json"
REPORT = ROOT / "data" / "raw" / "terrain_ngii_report.json"
DIFF_PNG = ROOT / "docs" / "terrain-ngii-diff.png"
SAMPLE_M = 2.5            # 등고선·옹벽 선을 이 간격으로 점으로 나눔
HOLDOUT = 0.2             # 검증용으로 떼어 두는 표고점 비율
LAMBDA = {"contour": 2.0, "spot": 10.0, "pair": 5.0}
MU = 0.004                # 보정량을 평균 보정량 쪽으로 약하게 끌어당김 (데이터가 없는 곳)
LEVELS = [(20, 300), (10, 150), (5, 150)]  # (격자 간격 m, 반복 횟수)
CONTOUR_HOLDOUT = 0.1
OMEGA = 1.6


def load_grid(path):
    j = json.loads(path.read_text(encoding="utf-8"))
    bin_ = base64.b64decode(j["data"])
    vals = struct.unpack(f"<{j['nx'] * j['nz']}H", bin_)
    h = [(v + j["offsetCm"]) / 100 + j["baseElevation"] for v in vals]  # 해발(m)
    return j, h


def height_at(j, h, x, z):
    """terrain.js heightAt과 같은 삼각형 보간 (해발 m)"""
    step, nx, nz = j["step"], j["nx"], j["nz"]
    u = min(nx - 1.0001, max(0, (x - j["x0"]) / step))
    v = min(nz - 1.0001, max(0, (z - j["z0"]) / step))
    i, k = int(u), int(v)
    fu, fv = u - i, v - k
    a, b, c, d = h[k * nx + i], h[k * nx + i + 1], h[(k + 1) * nx + i], h[(k + 1) * nx + i + 1]
    return a + (b - a) * fu + (c - a) * fv if fu + fv <= 1 else d + (c - d) * (1 - fu) + (b - d) * (1 - fv)


def sample_line(pts, step=SAMPLE_M):
    out = []
    for (x1, z1), (x2, z2) in zip(pts, pts[1:]):
        L = math.hypot(x2 - x1, z2 - z1)
        n = max(1, int(L / step))
        for k in range(n):
            out.append((x1 + (x2 - x1) * k / n, z1 + (z2 - z1) * k / n))
    if pts:
        out.append(pts[-1])
    return out


def seg_cross(p1, p2, q1, q2):
    def orient(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    d1, d2 = orient(q1, q2, p1), orient(q1, q2, p2)
    d3, d4 = orient(p1, p2, q1), orient(p1, p2, q2)
    return (d1 > 0) != (d2 > 0) and (d3 > 0) != (d4 > 0)


def main():
    if not AWS_COPY.exists():
        shutil.copy(TERRAIN, AWS_COPY)
        print(f"AWS 지형 사본 → {AWS_COPY.relative_to(ROOT)}")
    meta, aws = load_grid(AWS_COPY)
    g = ngii.GameTM()
    to_game = lambda pts: [g.to_game(E, N) for E, N in pts]  # noqa: E731

    # 2020 구역 (게임 좌표 사각형들)
    zones = []
    for b in ngii.ngi_bounds():
        (xa, za), (xb, zb) = g.to_game(b[0], b[3]), g.to_game(b[2], b[1])
        zones.append((min(xa, xb), min(za, zb), max(xa, xb), max(za, zb)))
    in2020 = lambda x, z: any(a <= x <= c and b <= z <= d for a, b, c, d in zones)  # noqa: E731

    contours, spots, tops, bottoms, cuts = [], [], [], [], []

    def add_walls(rows, src):
        for a, typ, parts in rows:
            if typ != 3:
                continue
            pts = to_game(parts[0])
            if src == 2025 and all(in2020(x, z) for x, z in pts):
                continue
            cuts.append(pts)
            kind = a.get("상하구분", "")
            try:
                H = float(a.get("높이") or 0)
            except ValueError:
                H = 0
            if kind == "상단" and H > 0.3:
                tops.append((pts, H))
            elif kind == "하단":
                bottoms.append(pts)

    rnd_c = random.Random(7)
    hold_contours = []
    for a, typ, parts in ngii.layer("N3L_F0010000"):
        pts = to_game(parts[0])
        v = float(a["등고수치"])
        pts_s = [(x, z, v) for x, z in sample_line(pts) if not in2020(x, z)]
        (hold_contours if rnd_c.random() < CONTOUR_HOLDOUT else contours).extend(pts_s)
    for a, typ, parts in ngii.read_ngi("F0010000"):
        v = float(a["등고수치"])
        pts_s = [(x, z, v) for x, z in sample_line(to_game(parts[0]))]
        (hold_contours if rnd_c.random() < CONTOUR_HOLDOUT else contours).extend(pts_s)
    extra_hold = []
    for a, typ, parts in ngii.layer("N3P_F0020000"):
        x, z = g.to_game(*parts[0][0])
        (extra_hold if in2020(x, z) else spots).append((x, z, float(a["수치"]), 2025))
    for a, typ, parts in ngii.read_ngi("F0020000"):
        x, z = g.to_game(*parts[0][0])
        spots.append((x, z, float(a["수치"]), 2020))
    add_walls(ngii.layer("N3L_F0040000") + ngii.layer("N3L_C0050000"), 2025)
    add_walls(ngii.read_ngi("F0040000") + ngii.read_ngi("C0050000"), 2020)
    for a, typ, parts in ngii.layer("N3L_F0030000"):  # 절토·성토 법면 선: 매끄러움만 끊음
        cuts.append(to_game(parts[0]))

    # 격자 안 데이터만
    x0, z0, nx, nz, step0 = meta["x0"], meta["z0"], meta["nx"], meta["nz"], meta["step"]
    x1, z1 = x0 + (nx - 1) * step0, z0 + (nz - 1) * step0
    inside = lambda x, z: x0 < x < x1 and z0 < z < z1  # noqa: E731
    contours = [c for c in contours if inside(c[0], c[1])]
    spots = [s for s in spots if inside(s[0], s[1])]
    rnd = random.Random(20261026)
    rnd.shuffle(spots)
    nhold = int(len(spots) * HOLDOUT)
    holdout, train = spots[:nhold], spots[nhold:]
    holdout += [s for s in extra_hold if inside(s[0], s[1])]  # 2020 구역 안 2025 표고점: 검증만
    hold_contours = [c for c in hold_contours if inside(c[0], c[1])]

    # 옹벽 높이 조건: 상단 선의 점 → 가장 가까운 하단 선 점(4m 안), 위쪽 점과 아래쪽 점을 1.5m 바깥으로
    bottom_pts = [p for pts in bottoms for p in sample_line(pts, 1.0)]
    bgrid = {}
    for p in bottom_pts:
        bgrid.setdefault((int(p[0] // 10), int(p[1] // 10)), []).append(p)
    pairs = []
    for pts, H in tops:
        for p in sample_line(pts):
            best, bd = None, 4.0
            for i in (-1, 0, 1):
                for k in (-1, 0, 1):
                    for q in bgrid.get((int(p[0] // 10) + i, int(p[1] // 10) + k), []):
                        d = math.dist(p, q)
                        if 0.2 < d < bd:
                            best, bd = q, d
            if best and inside(*p):
                ux, uz = (p[0] - best[0]) / bd, (p[1] - best[1]) / bd
                pairs.append(((p[0] + ux * 1.5, p[1] + uz * 1.5), (best[0] - ux * 1.5, best[1] - uz * 1.5), H))

    aws_at = lambda x, z: height_at(meta, aws, x, z)  # noqa: E731
    resid = [v - aws_at(x, z) for x, z, v in contours] + [v - aws_at(x, z) for x, z, v, _ in train]
    m0 = statistics.median(resid) if resid else 0.0
    print(f"데이터: 등고선 점 {len(contours)}, 표고점 학습 {len(train)} / 검증 {len(holdout)}, "
          f"옹벽 위아래 조건 {len(pairs)}, 매끄러움 끊는 선 {len(cuts)}개, 평균 보정량(중앙값) {m0:+.2f}m")

    # 끊는 선분 격자
    cut_segs = {}
    for pts in cuts:
        for a, b in zip(pts, pts[1:]):
            for i in range(int(min(a[0], b[0]) // 20), int(max(a[0], b[0]) // 20) + 1):
                for k in range(int(min(a[1], b[1]) // 20), int(max(a[1], b[1]) // 20) + 1):
                    cut_segs.setdefault((i, k), []).append((a, b))

    def crosses_cut(p, q):
        keys = {(int(p[0] // 20), int(p[1] // 20)), (int(q[0] // 20), int(q[1] // 20))}
        return any(seg_cross(p, q, a, b) for key in keys for a, b in cut_segs.get(key, []))

    r = None
    prev = None
    for step, iters in LEVELS:
        f = step // step0
        gnx, gnz = (nx - 1) // f + 1, (nz - 1) // f + 1
        N = gnx * gnz
        node_xy = lambda i: (x0 + (i % gnx) * step, z0 + (i // gnx) * step)  # noqa: E731
        # 이웃 (끊는 선을 지나지 않는 것만)
        nbrs = [[] for _ in range(N)]
        for k in range(gnz):
            for i in range(gnx):
                a = k * gnx + i
                for b in ((a + 1) if i + 1 < gnx else None, (a + gnx) if k + 1 < gnz else None):
                    if b is None:
                        continue
                    if step <= 10 and crosses_cut(node_xy(a), node_xy(b)):
                        continue
                    nbrs[a].append(b)
                    nbrs[b].append(a)

        def bilin(x, z):
            u, v = (x - x0) / step, (z - z0) / step
            i, k = min(gnx - 2, max(0, int(u))), min(gnz - 2, max(0, int(v)))
            fu, fv = u - i, v - k
            n0 = k * gnx + i
            return [(n0, (1 - fu) * (1 - fv)), (n0 + 1, fu * (1 - fv)), (n0 + gnx, (1 - fu) * fv), (n0 + gnx + 1, fu * fv)]

        terms = []  # (계수 목록, 목표 보정량, 가중치)
        for x, z, v in contours:
            terms.append((bilin(x, z), v - aws_at(x, z), LAMBDA["contour"]))
        for x, z, v, _ in train:
            terms.append((bilin(x, z), v - aws_at(x, z), LAMBDA["spot"]))
        if step <= 10:
            for up, dn, H in pairs:
                co = bilin(*up) + [(n, -w) for n, w in bilin(*dn)]
                terms.append((co, H - (aws_at(*up) - aws_at(*dn)), LAMBDA["pair"]))
        node_terms = [[] for _ in range(N)]
        for t, (co, _, _) in enumerate(terms):
            for n, c in co:
                if c:
                    node_terms[n].append((t, c))

        # 처음 값: 거친 격자 해를 보간
        if prev is None:
            r = [m0] * N
        else:
            pstep, pgnx, pr = prev
            r = []
            for i in range(N):
                x, z = node_xy(i)
                u, v = (x - x0) / pstep, (z - z0) / pstep
                pi, pk = min(pgnx - 2, int(u)), min(len(pr) // pgnx - 2, int(v))
                fu, fv = u - pi, v - pk
                n0 = pk * pgnx + pi
                r.append(pr[n0] * (1 - fu) * (1 - fv) + pr[n0 + 1] * fu * (1 - fv) + pr[n0 + pgnx] * (1 - fu) * fv + pr[n0 + pgnx + 1] * fu * fv)
        S = [sum(c * r[n] for n, c in co) for co, _, _ in terms]
        tgt = [t for _, t, _ in terms]
        lam = [l for _, _, l in terms]
        for it in range(iters):
            for i in range(N):
                num, den = MU * m0, MU
                for j in nbrs[i]:
                    num += r[j]
                    den += 1
                ri = r[i]
                for t, c in node_terms[i]:
                    num += lam[t] * c * (tgt[t] - (S[t] - c * ri))
                    den += lam[t] * c * c
                d = (num / den - ri) * OMEGA
                if d:
                    r[i] = ri + d
                    for t, c in node_terms[i]:
                        S[t] += c * d
        prev = (step, gnx, r)
        rms = math.sqrt(sum((S[t] - tgt[t]) ** 2 for t in range(len(terms))) / max(1, len(terms)))
        print(f"  {step}m 격자 {gnx}×{gnz}, 반복 {iters}회, 조건 잔차 RMS {rms:.2f}m")

    new = [aws[i] + r[i] for i in range(nx * nz)]

    # ---------- 검증 ----------
    def stats(fn):
        e = [fn(x, z) - v for x, z, v, _ in holdout]
        return {"평균": statistics.mean(e), "평균절대": statistics.mean(abs(v) for v in e),
                "RMS": math.sqrt(statistics.mean(v * v for v in e)), "최대절대": max(abs(v) for v in e)}
    old_s = stats(aws_at)
    new_s = stats(lambda x, z: height_at(meta, new, x, z))
    print("검증(떼어 둔 표고점 %d개, 측량값과의 차 m):" % len(holdout))
    for k in old_s:
        print(f"  {k}: AWS {old_s[k]:+.2f}  →  수치지도 {new_s[k]:+.2f}")
    # 2020 구역 / 2025 구역 따로
    by = {}
    for src in (2020, 2025):
        hs = [s for s in holdout if s[3] == src]
        if hs:
            by[src] = (len(hs), statistics.mean(abs(aws_at(x, z) - v) for x, z, v, _ in hs),
                       statistics.mean(abs(height_at(meta, new, x, z) - v) for x, z, v, _ in hs))
    for src, (n, a, b) in by.items():
        print(f"  {src} 표고점 {n}개 평균절대: AWS {a:.2f} → 수치지도 {b:.2f}")
    if hold_contours:
        ea = [aws_at(x, z) - v for x, z, v in hold_contours]
        en = [height_at(meta, new, x, z) - v for x, z, v in hold_contours]
        hc = {"점": len(hold_contours), "AWS평균절대": statistics.mean(abs(v) for v in ea), "수치지도평균절대": statistics.mean(abs(v) for v in en),
              "AWS최대": max(abs(v) for v in ea), "수치지도최대": max(abs(v) for v in en)}
        print(f"  떼어 둔 등고선 점 {hc['점']}개 평균절대: AWS {hc['AWS평균절대']:.2f} → 수치지도 {hc['수치지도평균절대']:.2f} "
              f"(최대 {hc['AWS최대']:.2f} → {hc['수치지도최대']:.2f})")
        by["contour_holdout"] = hc

    # 옹벽 단차 검증: 높이 2m 이상 옹벽 상단 선 가운데에서 위아래 4m 높이 차
    steps = []
    for up, dn, H in pairs:
        if H >= 2:
            steps.append((up, dn, H, height_at(meta, new, *up) - height_at(meta, new, *dn), aws_at(*up) - aws_at(*dn)))

    better = new_s["RMS"] < old_s["RMS"]
    report = {"holdout": len(holdout), "aws": old_s, "ngii": new_s, "by_source": by, "m0": m0,
              "data": {"contour_pts": len(contours), "spots_train": len(train), "pairs": len(pairs), "cuts": len(cuts)},
              "steps": [{"up": [round(v, 1) for v in u], "dn": [round(v, 1) for v in d], "H": H, "new": round(nw, 2), "aws": round(ow, 2)}
                        for u, d, H, nw, ow in steps],
              "adopted": better}
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")

    # 차이 지도 (정문 앞 출발점 기준 상대 높이끼리: 게임에서 보이는 차이). 1칸 = 5m
    campus = json.loads((ROOT / "data" / "campus.json").read_text(encoding="utf-8"))
    sx, sz = campus["spawn"]["position"]
    base_new, base_old = height_at(meta, new, sx, sz), aws_at(sx, sz)
    diff = [(new[i] - base_new) - (aws[i] - base_old) for i in range(nx * nz)]
    px = []
    for k in range(nz):
        for i in range(nx):
            d = max(-6, min(6, diff[k * nx + i])) / 6
            px.append((255, int(255 * (1 - d)), int(255 * (1 - d))) if d > 0 else (int(255 * (1 + d)), int(255 * (1 + d)), 255))
    bd = campus["boundary"]
    for (ax, az), (bx, bz) in zip(bd, bd[1:] + bd[:1]):
        n = int(math.dist((ax, az), (bx, bz)) / 2) + 1
        for t in range(n + 1):
            i, k = int((ax + (bx - ax) * t / n - x0) / step0), int((az + (bz - az) * t / n - z0) / step0)
            if 0 <= i < nx and 0 <= k < nz:
                px[k * nx + i] = (40, 40, 40)
    write_png(DIFF_PNG, nx, nz, px)
    # 3m 이상 차이 덩어리
    big = [(i, k) for k in range(nz) for i in range(nx) if abs(diff[k * nx + i]) >= 3]
    seen, blobs = set(), []
    bigset = set(big)
    for c in big:
        if c in seen:
            continue
        stack, comp = [c], []
        seen.add(c)
        while stack:
            a = stack.pop()
            comp.append(a)
            for di, dk in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                q = (a[0] + di, a[1] + dk)
                if q in bigset and q not in seen:
                    seen.add(q)
                    stack.append(q)
        ds = [diff[k * nx + i] for i, k in comp]
        cx = x0 + statistics.mean(i for i, _ in comp) * step0
        cz = z0 + statistics.mean(k for _, k in comp) * step0
        inc = ngii_point_in(cx, cz, bd)
        blobs.append({"x": round(cx), "z": round(cz), "넓이m2": len(comp) * step0 * step0, "최대차m": round(max(ds, key=abs), 1), "캠퍼스안": inc})
    blobs.sort(key=lambda b: -b["넓이m2"])
    report["diff_blobs"] = blobs[:40]
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"차이 지도 → {DIFF_PNG.relative_to(ROOT)}, 3m 이상 차이 덩어리 {len(blobs)}개 (캠퍼스 안 {sum(b['캠퍼스안'] for b in blobs)}개)")
    print(f"옹벽(2m 이상) {len(steps)}곳: 새 지형 위아래 차 중앙값 {statistics.median([s[3] for s in steps]) if steps else 0:.2f}m, "
          f"AWS {statistics.median([s[4] for s in steps]) if steps else 0:.2f}m")

    if not better:
        print("새 지형이 표고점 기준으로 AWS보다 나쁨 → data/terrain.json 그대로 둠")
        return
    base = round(height_at(meta, new, sx, sz), 1)
    cm = [round((v - base) * 100) for v in new]
    lo = min(cm)
    out = dict(meta)
    out.update({
        "source": "국토지리정보원 수치지도(2020 1:1,000·2025 1:5,000 등고선·표고점·옹벽) + 바깥은 AWS Terrain Tiles, 정문 앞 출발점 높이 기준 상대 높이",
        "baseElevation": base, "offsetCm": lo,
        "data": base64.b64encode(struct.pack(f"<{len(cm)}H", *(v - lo for v in cm))).decode("ascii"),
    })
    TERRAIN.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"저장 → {TERRAIN.relative_to(ROOT)} (출발점 해발 {base}m = 0, {TERRAIN.stat().st_size / 1024:.0f} KB)")


def ngii_point_in(x, z, poly):
    inside = False
    for (x1, z1), (x2, z2) in zip(poly, poly[1:] + poly[:1]):
        if (z1 > z) != (z2 > z) and x < x1 + (z - z1) * (x2 - x1) / (z2 - z1):
            inside = not inside
    return inside


if __name__ == "__main__":
    main()
