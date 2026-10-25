"""국토지리정보원 자료로 건물 참고값 만들기 → data/raw/ngii_buildings.json (커밋 안 함)

사용법:  python scripts/ngii_buildings.py   (그다음 python scripts/building_floors.py 로 csv·campus.json 반영)
- 층수: 수치지도 2025 1:5,000 건물(N3A_B0010000)의 '층수'를 OSM 건물과 겹치는 면적으로 짝지음(겹침 30% 이상).
- 지붕색: 정사영상(2025, 25cm)에서 건물 외곽선 1.5m 안쪽 점들의 색 중앙값(태양광 패널·그림자에 덜 흔들리게).
- 외관(추정): 위에서 찍은 사진이라 외벽은 거의 안 보여 규칙으로만 추정한다.
  생활관 → 타일, 2015년 이후 지은 건물·유리 아트리움이 보이는 교육융합관 → 커튼월, 1990년 전에 지은 건물 → 벽돌, 나머지는 비움(기본 콘크리트).
게임에는 사진이 아니라 색·층수·종류 값만 쓴다.
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ngii  # noqa: E402
from building_floors import area, point_in_poly  # noqa: E402

OUT = ngii.ROOT / "data" / "raw" / "ngii_buildings.json"
CURTAIN_WALL = {"교육융합관"}


def facade_guess(b, tags):
    name = b["name"] or ""
    year = tags.get("start_date", "")[:4]
    if name.startswith("생활관"):
        return "타일"
    if name in CURTAIN_WALL or (year.isdigit() and int(year) >= 2015):
        return "커튼월"
    if year.isdigit() and int(year) < 1990:
        return "벽돌"
    return ""


def inner_points(o, step, inset):
    xs, zs = [p[0] for p in o], [p[1] for p in o]
    pts = []
    x = min(xs) + step / 2
    while x < max(xs):
        z = min(zs) + step / 2
        while z < max(zs):
            if point_in_poly(x, z, o) and all(_dseg(x, z, a, c) > inset for a, c in zip(o, o[1:] + o[:1])):
                pts.append((x, z))
            z += step
        x += step
    return pts


def _dseg(px, pz, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    L = dx * dx + dz * dz
    t = 0 if L == 0 else max(0, min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / L))
    return math.hypot(px - a[0] - t * dx, pz - a[1] - t * dz)


def main():
    campus = json.loads((ngii.ROOT / "data" / "campus.json").read_text(encoding="utf-8"))
    raw = json.loads((ngii.ROOT / "data" / "raw" / "features.json").read_text(encoding="utf-8"))
    tags_by_id = {f"{e['type'][0]}{e['id']}": e.get("tags", {}) for e in raw["elements"]}
    g = ngii.GameTM(campus)
    ortho = ngii.Ortho()

    maps = []
    for attr, typ, parts in ngii.layer("N3A_B0010000"):
        if typ != 5 or not parts:
            continue
        ring = [g.to_game(E, N) for E, N in parts[0]]
        xs, zs = [p[0] for p in ring], [p[1] for p in ring]
        try:
            floors = int(float(attr.get("층수") or 0))
        except ValueError:
            floors = 0
        maps.append((ring, (min(xs), min(zs), max(xs), max(zs)), floors, attr.get("명칭") or attr.get("주기") or ""))
    cell = 50
    grid = {}
    for k, m in enumerate(maps):
        x0, z0, x1, z1 = m[1]
        for gx in range(int(x0 // cell), int(x1 // cell) + 1):
            for gz in range(int(z0 // cell), int(z1 // cell) + 1):
                grid.setdefault((gx, gz), []).append(k)

    out, n_floor, n_roof = {}, 0, 0
    for b in campus["buildings"]:
        if not b["inCampus"]:
            continue
        o = b["outline"]
        step = max(0.75, min(3.0, math.sqrt(area(o)) / 20))
        pts = inner_points(o, step, 0)
        counts = {}
        for x, z in pts:
            for k in grid.get((int(x // cell), int(z // cell)), []):
                bb = maps[k][1]
                if bb[0] <= x <= bb[2] and bb[1] <= z <= bb[3] and point_in_poly(x, z, maps[k][0]):
                    counts[k] = counts.get(k, 0) + 1
                    break
        rec = {"name": b["name"]}
        if pts and counts:
            k = max(counts, key=counts.get)
            if counts[k] / len(pts) >= 0.3 and maps[k][2] > 0:
                rec["mapFloors"] = maps[k][2]
                rec["mapName"] = maps[k][3]
                n_floor += 1
        cols = []
        for x, z in inner_points(o, 1.0, 1.5):
            v = ortho.rgb(*g.to_tm(x, z))
            if v:
                cols.append(v)
        if len(cols) >= 8:
            # 밝기 순 가운데 60%의 평균 (그림자·반사 빼기)
            cols.sort(key=sum)
            mid = cols[len(cols) // 5: len(cols) * 4 // 5] or cols
            rec["roof"] = "#%02x%02x%02x" % tuple(round(sum(c[i] for c in mid) / len(mid)) for i in range(3))
            n_roof += 1
        f = facade_guess(b, tags_by_id.get(b["id"], {}))
        if f:
            rec["facade"] = f
        out[b["id"]] = rec
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"캠퍼스 안 {len(out)}동: 수치지도 층수 짝 {n_floor}동, 지붕색 {n_roof}동, 외관 추정 {sum('facade' in r for r in out.values())}동 → {OUT.relative_to(ngii.ROOT)}")


if __name__ == "__main__":
    main()
