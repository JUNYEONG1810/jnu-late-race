"""기념물·조형물 근거용 정사영상 조각: ref/monuments/sheet_N.png (8개씩, 1칸 = 20m × 20m, 0.07 m/px) + index.json
(ref/는 커밋 안 함). 칸 가운데 빨간 십자 = OSM 점, 흰 점 = 2m 눈금.

사용법:  python scripts/monument_crops.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ngii  # noqa: E402
from terrain_report import write_png  # noqa: E402

SPAN, T, COLS, ROWS = 20.0, 286, 4, 2


def main():
    campus = json.loads((ngii.ROOT / "data" / "campus.json").read_text(encoding="utf-8"))
    g = ngii.GameTM(campus)
    o = ngii.Ortho()
    mons = campus["monuments"]
    out = ngii.ROOT / "ref" / "monuments"
    out.mkdir(parents=True, exist_ok=True)
    res = SPAN / T
    index = []
    for s in range(0, len(mons), COLS * ROWS):
        group = mons[s:s + COLS * ROWS]
        W, H = COLS * T, ROWS * T
        px = [(0, 0, 0)] * (W * H)
        for k, m in enumerate(group):
            cx, cz = m["p"]
            ox, oy = (k % COLS) * T, (k // COLS) * T
            for j in range(T):
                for i in range(T):
                    x, z = cx - SPAN / 2 + (i + 0.5) * res, cz - SPAN / 2 + (j + 0.5) * res
                    v = o.rgb(*g.to_tm(x, z))
                    if abs((x - cx) % 2) < res and abs((z - cz) % 2) < res:
                        v = (255, 255, 255)
                    px[(oy + j) * W + ox + i] = v or (0, 0, 0)
            for t in range(-6, 7):
                for a, b in ((t, 0), (0, t)):
                    px[(oy + T // 2 + b) * W + ox + T // 2 + a] = (255, 30, 30)
            for t in range(T):
                px[oy * W + ox + t] = px[(oy + t) * W + ox] = (255, 255, 255)
            index.append({"no": s + k + 1, "sheet": s // (COLS * ROWS) + 1, "slot": k + 1, "name": m["name"], "shape": m["shape"], "p": m["p"]})
        write_png(out / f"sheet_{s // (COLS * ROWS) + 1}.png", W, H, px)
    (out / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(mons)}개 → ref/monuments/sheet_1..{(len(mons) + 7) // 8}.png (1칸 {SPAN}m, {res:.3f} m/px)")


if __name__ == "__main__":
    main()
