"""남은 캠퍼스 건물 외관 판단용 정사영상 묶음 사진: ref/e2/sheet_NN.png (8동씩, 4×2), ref/e2/index.json
(ref/는 커밋 안 함)

사용법:  python scripts/ngii_contact.py
- 대상: 캠퍼스 안 건물 중 data/building-styles.json에 없는 것, 바닥 면적 큰 순서.
- 칸마다 건물 외곽선(노랑) + 둘레 여유(높이의 0.6배 + 6m, 높은 건물은 사진에서 바깥으로 기울어 외벽이 보임).
- 정사영상 두 도엽 밖(캠퍼스 서쪽 끝)은 칸이 검게 나온다 → 근거 없음.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ngii  # noqa: E402
from building_floors import area  # noqa: E402
from terrain_report import write_png  # noqa: E402

T = 300
COLS, ROWS = 4, 2


def main():
    campus = json.loads((ngii.ROOT / "data" / "campus.json").read_text(encoding="utf-8"))
    styles = json.loads((ngii.ROOT / "data" / "building-styles.json").read_text(encoding="utf-8"))
    g = ngii.GameTM(campus)
    ortho = ngii.Ortho()
    todo = [b for b in campus["buildings"] if b["inCampus"] and b["id"] not in styles]
    todo.sort(key=lambda b: -abs(area(b["outline"])))
    out = ngii.ROOT / "ref" / "e2"
    out.mkdir(parents=True, exist_ok=True)
    index = []
    per = COLS * ROWS
    for s in range(0, len(todo), per):
        group = todo[s:s + per]
        W, H = COLS * T, ROWS * T
        px = [(0, 0, 0)] * (W * H)
        covered = []
        for k, b in enumerate(group):
            o = b["outline"]
            xs, zs = [p[0] for p in o], [p[1] for p in o]
            pad = 6 + b["height"] * 0.6
            cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
            span = max(max(xs) - min(xs), max(zs) - min(zs)) + 2 * pad
            res = span / T
            ox, oy = (k % COLS) * T, (k // COLS) * T
            hit = 0
            for j in range(T):
                for i in range(T):
                    v = ortho.rgb(*g.to_tm(cx - span / 2 + (i + 0.5) * res, cz - span / 2 + (j + 0.5) * res))
                    if v:
                        hit += 1
                    px[(oy + j) * W + ox + i] = v or (0, 0, 0)
            covered.append(hit > T * T * 0.5)
            for a, c in zip(o, o[1:] + o[:1]):
                n = int(max(abs(c[0] - a[0]), abs(c[1] - a[1])) / res) + 1
                for t in range(n + 1):
                    i = int((a[0] + (c[0] - a[0]) * t / n - (cx - span / 2)) / res)
                    j = int((a[1] + (c[1] - a[1]) * t / n - (cz - span / 2)) / res)
                    if 0 <= i < T and 0 <= j < T:
                        px[(oy + j) * W + ox + i] = (255, 230, 0)
            for t in range(T):
                px[oy * W + ox + t] = px[(oy + t) * W + ox] = (255, 255, 255)
        n = s // per + 1
        write_png(out / f"sheet_{n:02d}.png", W, H, px)
        index.append({"sheet": n, "buildings": [{"slot": k + 1, "id": b["id"], "name": b["name"], "floors": b["floors"],
                                                  "area": round(abs(area(b["outline"]))), "photo": cov}
                                                 for k, (b, cov) in enumerate(zip(group, covered))]})
    (out / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"대상 {len(todo)}동 → 묶음 {len(index)}장 (ref/e2/), 사진 없음 {sum(1 for s in index for b in s['buildings'] if not b['photo'])}동")


if __name__ == "__main__":
    main()
