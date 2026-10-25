"""정사영상(25cm)에서 잔디밭 찾기 → 게임에서 맨바닥으로 칠해진 곳만 data/lawns.json으로.

사용법:  python scripts/ngii_lawn.py [--preview]
- 2m 칸마다 정사영상 64점을 보고, 초록이 우세하고(G > R, G > B) 밝고(나무 그늘보다 밝음) 고르면(나무 수관보다 덜 얼룩짐) 잔디로 본다.
- 이미 게임에 녹지·운동장·물·도로·건물·주차장이 있는 칸은 뺀다. 작은 조각(칸 12개 = 48m² 미만)도 뺀다.
- 결과: 잔디 칸의 목록(게임 좌표, 2m 격자). 게임은 이 칸들을 바닥 그림에 잔디색(미세한 얼룩)으로 칠한다.
- --preview: ref/lawn-preview.png (빨강 = 새로 칠할 잔디, 초록 = 이미 녹지) — ref/는 커밋 안 함.
이미지 자체는 게임에 쓰지 않고, 칸의 위치만 쓴다.
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ngii  # noqa: E402

CELL = 2.0
OUT = ngii.ROOT / "data" / "lawns.json"


def is_lawn(samples):
    if not samples:
        return False
    n = len(samples)
    r = sum(s[0] for s in samples) / n
    g = sum(s[1] for s in samples) / n
    b = sum(s[2] for s in samples) / n
    bright = (r + g + b) / 3
    sd = math.sqrt(sum((s[1] - g) ** 2 for s in samples) / n)
    return g > r + 6 and g > b + 4 and bright > 82 and sd < 13


def point_in(x, z, poly):
    inside = False
    for (x1, z1), (x2, z2) in zip(poly, poly[1:] + poly[:1]):
        if (z1 > z) != (z2 > z) and x < x1 + (z - z1) * (x2 - x1) / (z2 - z1):
            inside = not inside
    return inside


def dist_seg(px, pz, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    L = dx * dx + dz * dz
    t = 0 if L == 0 else max(0, min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / L))
    return math.hypot(px - a[0] - t * dx, pz - a[1] - t * dz)


def main():
    campus = json.loads((ngii.ROOT / "data" / "campus.json").read_text(encoding="utf-8"))
    g = ngii.GameTM(campus)
    ortho = ngii.Ortho()
    bd = campus["boundary"]
    xs, zs = [p[0] for p in bd], [p[1] for p in bd]
    x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs)
    nx, nz = int((x1 - x0) / CELL) + 1, int((z1 - z0) / CELL) + 1

    # 이미 칠해진 것: 녹지(공원 제외)·물·운동장, 주차장, 건물 → 칸 단위 표시
    taken = bytearray(nx * nz)

    def mark_poly(o, val=1):
        oxs, ozs = [p[0] for p in o], [p[1] for p in o]
        for i in range(max(0, int((min(oxs) - x0) / CELL)), min(nx, int((max(oxs) - x0) / CELL) + 1)):
            for j in range(max(0, int((min(ozs) - z0) / CELL)), min(nz, int((max(ozs) - z0) / CELL) + 1)):
                if point_in(x0 + (i + 0.5) * CELL, z0 + (j + 0.5) * CELL, o):
                    taken[j * nx + i] = val

    for gr in campus["greens"]:
        if gr["kind"] != "park":
            mark_poly(gr["outline"], 1)
    for o in campus.get("parking", []):
        mark_poly(o, 2)
    for b in campus["buildings"]:
        mark_poly(b["outline"], 2)
    for r in campus["roads"]:
        pad = r["width"] / 2 + 0.5
        pts = r["points"]
        for a, b in zip(pts, pts[1:]):
            for i in range(max(0, int((min(a[0], b[0]) - pad - x0) / CELL)), min(nx, int((max(a[0], b[0]) + pad - x0) / CELL) + 1)):
                for j in range(max(0, int((min(a[1], b[1]) - pad - z0) / CELL)), min(nz, int((max(a[1], b[1]) + pad - z0) / CELL) + 1)):
                    if dist_seg(x0 + (i + 0.5) * CELL, z0 + (j + 0.5) * CELL, a, b) < pad:
                        taken[j * nx + i] = taken[j * nx + i] or 3

    lawn = bytearray(nx * nz)
    for j in range(nz):
        cz = z0 + j * CELL
        for i in range(nx):
            cx = x0 + i * CELL
            if taken[j * nx + i] or not point_in(cx + 1, cz + 1, bd):
                continue
            samples = []
            for a in range(8):
                for b in range(8):
                    v = ortho.rgb(*g.to_tm(cx + (a + 0.5) * CELL / 8, cz + (b + 0.5) * CELL / 8))
                    if v:
                        samples.append(v)
            if is_lawn(samples):
                lawn[j * nx + i] = 1

    # 작은 조각 빼기 (4방향 연결 12칸 미만)
    seen = bytearray(nx * nz)
    keep = []
    for k in range(nx * nz):
        if not lawn[k] or seen[k]:
            continue
        comp, stack = [], [k]
        seen[k] = 1
        while stack:
            c = stack.pop()
            comp.append(c)
            ci, cj = c % nx, c // nx
            for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ni, nj = ci + di, cj + dj
                if 0 <= ni < nx and 0 <= nj < nz:
                    q = nj * nx + ni
                    if lawn[q] and not seen[q]:
                        seen[q] = 1
                        stack.append(q)
        if len(comp) >= 12:
            keep += comp
    cells = sorted([c % nx, c // nx] for c in keep)
    OUT.write_text(json.dumps({
        "source": "국토지리정보원 정사영상(2025, 25cm)에서 판단한 잔디 칸 (게임에서 맨바닥이던 곳만)",
        "cell": CELL, "x0": round(x0, 1), "z0": round(z0, 1), "cells": cells,
    }, separators=(",", ":")), encoding="utf-8")
    print(f"잔디 칸 {len(cells)}개 = 약 {len(cells) * CELL * CELL:.0f}m² → {OUT.relative_to(ngii.ROOT)} ({OUT.stat().st_size / 1024:.0f} KB)")

    if "--preview" in sys.argv:
        from terrain_report import write_png
        px = []
        keepset = set(keep)
        for j in range(nz):
            for i in range(nx):
                k = j * nx + i
                px.append((230, 40, 40) if k in keepset else (90, 170, 80) if taken[k] == 1 else
                          (60, 60, 60) if taken[k] == 3 else (140, 140, 150) if taken[k] == 2 else (235, 235, 230))
        (ngii.ROOT / "ref").mkdir(exist_ok=True)
        write_png(ngii.ROOT / "ref" / "lawn-preview.png", nx, nz, px)
        print("미리보기 → ref/lawn-preview.png")


if __name__ == "__main__":
    main()
