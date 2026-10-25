"""참고 조사용 잘라낸 사진 만들기: 정사영상을 게임 좌표 그대로 잘라 ref/에 PNG로 저장 (ref/는 커밋 안 함).
겹쳐 그리기: 수치지도 2025 건물(빨강), OSM 건물(노랑), OSM 도로 중심선(하늘), 10m 눈금(흰 점), 50m 눈금(흰 선).

사용법:  python scripts/ngii_reference.py 이름 x0 z0 x1 z1 [m/px]
예:     python scripts/ngii_reference.py gate -60 400 90 560 0.25
잘라낸 사진의 픽셀 (i, j) = 게임 좌표 (x0 + i·m/px, z0 + j·m/px).
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ngii  # noqa: E402
from terrain_report import write_png  # noqa: E402

REF = ngii.ROOT / "ref"


def render(name, x0, z0, x1, z1, res=0.25, overlay=True):
    campus = json.loads((ngii.ROOT / "data" / "campus.json").read_text(encoding="utf-8"))
    g = ngii.GameTM(campus)
    ortho = ngii.Ortho()
    w, h = int((x1 - x0) / res), int((z1 - z0) / res)
    px = []
    for j in range(h):
        z = z0 + (j + 0.5) * res
        for i in range(w):
            E, N = g.to_tm(x0 + (i + 0.5) * res, z)
            px.append(ortho.rgb(E, N) or (0, 0, 0))

    def put(x, z, c):
        i, j = int((x - x0) / res), int((z - z0) / res)
        if 0 <= i < w and 0 <= j < h:
            px[j * w + i] = c

    def line(a, b, c):
        n = max(1, int(max(abs(b[0] - a[0]), abs(b[1] - a[1])) / res))
        for k in range(n + 1):
            put(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n, c)

    if overlay:
        for x in range(int(x0 // 10 * 10), int(x1) + 1, 10):
            for z in range(int(z0 // 10 * 10), int(z1) + 1, 10):
                put(x, z, (255, 255, 255))
        for x in range(int(x0 // 50 * 50), int(x1) + 1, 50):
            line((x, z0), (x, z1), (230, 230, 230))
        for z in range(int(z0 // 50 * 50), int(z1) + 1, 50):
            line((x0, z), (x1, z), (230, 230, 230))
        for attr, typ, parts in ngii.layer("N3A_B0010000"):
            for part in parts:
                pts = [g.to_game(E, N) for E, N in part]
                if all(not (x0 - 50 < x < x1 + 50 and z0 - 50 < z < z1 + 50) for x, z in pts):
                    continue
                for a, b in zip(pts, pts[1:]):
                    line(a, b, (255, 40, 40))
        for b in campus["buildings"]:
            o = b["outline"]
            for a, c in zip(o, o[1:] + o[:1]):
                line(a, c, (255, 230, 0))
        for r in campus["roads"]:
            for a, c in zip(r["points"], r["points"][1:]):
                line(a, c, (0, 220, 255) if r["car"] else (120, 255, 120))
    REF.mkdir(exist_ok=True)
    out = REF / f"{name}.png"
    write_png(out, w, h, px)
    print(f"저장 → {out.relative_to(ngii.ROOT)} ({w}×{h}, {res} m/px, x {x0}~{x1}, z {z0}~{z1})")


if __name__ == "__main__":
    a = sys.argv[1:]
    render(a[0], *map(float, a[1:5]), float(a[5]) if len(a) > 5 else 0.25, overlay=not (len(a) > 6 and a[6] == "plain"))
