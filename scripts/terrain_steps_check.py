"""새 지형(수치지도)에 옹벽·석축 단차가 생겼는지 확인: 높이 2m 이상 옹벽 12곳을 골라
정사영상 조각을 한 장에 모으고(ref/terrain-steps.png, 커밋 안 함) 위아래 높이 차(새 지형·AWS)를 표로 출력한다.

사용법:  python scripts/terrain_steps_check.py   (먼저 build_terrain_ngii.py 실행)
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ngii  # noqa: E402
from build_terrain_ngii import load_grid, height_at, REPORT, AWS_COPY, TERRAIN, ngii_point_in  # noqa: E402
from terrain_report import write_png  # noqa: E402

N_PICK = 12  # 높이 2m 이상, 서로 35m 넘게 떨어진 곳
TILE = 150      # 조각 크기(px)
RES = 0.2       # m/px


def main():
    rep = json.loads(REPORT.read_text(encoding="utf-8"))
    campus = json.loads((ngii.ROOT / "data" / "campus.json").read_text(encoding="utf-8"))
    mn, hn = load_grid(TERRAIN)
    ma, ha = load_grid(AWS_COPY)
    picks = []
    for s in sorted(rep["steps"], key=lambda s: -s["H"]):
        c = ((s["up"][0] + s["dn"][0]) / 2, (s["up"][1] + s["dn"][1]) / 2)
        if not ngii_point_in(*c, campus["boundary"]) or any(math.dist(c, p["c"]) < 35 for p in picks):
            continue
        # 위아래 4m 떨어진 점으로 단차 재기 (5m 격자라 위아래 점을 넉넉히)
        ux, uz = s["up"][0] - s["dn"][0], s["up"][1] - s["dn"][1]
        L = math.hypot(ux, uz) or 1
        up = (c[0] + ux / L * 4, c[1] + uz / L * 4)
        dn = (c[0] - ux / L * 4, c[1] - uz / L * 4)
        picks.append({"c": c, "H": s["H"],
                      "new": height_at(mn, hn, *up) - height_at(mn, hn, *dn),
                      "aws": height_at(ma, ha, *up) - height_at(ma, ha, *dn)})
        if len(picks) >= N_PICK:
            break
    g = ngii.GameTM(campus)
    o = ngii.Ortho()
    cols = 4
    rows = (len(picks) + cols - 1) // cols
    W, H = cols * TILE, rows * TILE
    px = [(0, 0, 0)] * (W * H)
    for k, p in enumerate(picks):
        ox, oy = (k % cols) * TILE, (k // cols) * TILE
        for j in range(TILE):
            for i in range(TILE):
                v = o.rgb(*g.to_tm(p["c"][0] + (i - TILE / 2) * RES, p["c"][1] + (j - TILE / 2) * RES))
                px[(oy + j) * W + ox + i] = v or (0, 0, 0)
        for t in range(-4, 5):  # 가운데 표시
            for a, b in ((t, 0), (0, t)):
                px[(oy + TILE // 2 + b) * W + ox + TILE // 2 + a] = (255, 40, 40)
        for t in range(TILE):
            px[oy * W + ox + t] = px[(oy + t) * W + ox] = (255, 255, 255)
    (ngii.ROOT / "ref").mkdir(exist_ok=True)
    write_png(ngii.ROOT / "ref" / "terrain-steps.png", W, H, px)
    print("| # | 위치 (x, z) | 옹벽 높이(수치지도) | 새 지형 위아래 차 | AWS 위아래 차 |")
    print("|---|---|---|---|---|")
    for k, p in enumerate(picks):
        print(f"| {k + 1} | ({p['c'][0]:.0f}, {p['c'][1]:.0f}) | {p['H']:.1f}m | {p['new']:.2f}m | {p['aws']:.2f}m |")


if __name__ == "__main__":
    main()
