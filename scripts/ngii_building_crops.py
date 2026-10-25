"""건물 외관 근거용 정사영상 조각: ref/e/<건물 이름>.png (ref/는 커밋 안 함)

사용법:  python scripts/ngii_building_crops.py 이름1 이름2 ...   (OSM 이름, 없으면 osm id)
- 건물 외곽선 + 둘레 여유(높이만큼, 높은 건물은 사진에서 바깥으로 기울어 외벽이 보임)를 0.12~0.2 m/px로 자른다.
- 노란 선 = OSM 외곽선(게임 건물), 칸마다 10m 눈금 점.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ngii  # noqa: E402
from terrain_report import write_png  # noqa: E402


def safe(name):
    return re.sub(r'[\\/:*?"<>|]', '_', name)


def crop(campus, g, ortho, b, out_dir):
    o = b["outline"]
    xs, zs = [p[0] for p in o], [p[1] for p in o]
    pad = 8 + b["height"] * 0.6
    x0, x1, z0, z1 = min(xs) - pad, max(xs) + pad, min(zs) - pad, max(zs) + pad
    res = max(0.12, min(0.25, max(x1 - x0, z1 - z0) / 700))
    w, h = int((x1 - x0) / res), int((z1 - z0) / res)
    px = []
    for j in range(h):
        z = z0 + (j + 0.5) * res
        for i in range(w):
            px.append(ortho.rgb(*g.to_tm(x0 + (i + 0.5) * res, z)) or (0, 0, 0))

    def put(x, z, c):
        i, j = int((x - x0) / res), int((z - z0) / res)
        if 0 <= i < w and 0 <= j < h:
            px[j * w + i] = c
    for a, c in zip(o, o[1:] + o[:1]):
        n = int(max(abs(c[0] - a[0]), abs(c[1] - a[1])) / res) + 1
        for k in range(n + 1):
            put(a[0] + (c[0] - a[0]) * k / n, a[1] + (c[1] - a[1]) * k / n, (255, 230, 0))
    for x in range(int(x0 // 10 * 10), int(x1) + 1, 10):
        for z in range(int(z0 // 10 * 10), int(z1) + 1, 10):
            put(x, z, (255, 255, 255))
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{safe(b['name'] or b['id'])}.png"
    write_png(path, w, h, px)
    return path, (x0, z0, res, w, h)


def main():
    campus = json.loads((ngii.ROOT / "data" / "campus.json").read_text(encoding="utf-8"))
    g = ngii.GameTM(campus)
    ortho = ngii.Ortho()
    out = ngii.ROOT / "ref" / "e"
    for name in sys.argv[1:]:
        for b in [x for x in campus["buildings"] if x["name"] == name or x["id"] == name]:
            path, (x0, z0, res, w, h) = crop(campus, g, ortho, b, out)
            print(f"{b['id']} {b['name']}: {path.relative_to(ngii.ROOT)} ({w}×{h}, {res:.2f} m/px, 왼쪽 위 = ({x0:.0f}, {z0:.0f}))")


if __name__ == "__main__":
    main()
