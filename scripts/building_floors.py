"""건물 층수 정리: 브이월드 지상층수를 OSM 건물과 짝짓고, data/building-floors.csv와 campus.json 높이에 반영한다.

사용법 (저장소 루트에서):  python scripts/building_floors.py
- 먼저 scripts/fetch_vworld.py로 data/raw/vworld_buildings.json을 받아 둔다(없으면 브이월드 단계는 건너뜀).
- 짝짓기: OSM 건물 안에 점을 고르게 찍어, 그 점을 품은 브이월드 건물을 센다(겹치는 면적).
  가장 많이 겹친 브이월드 건물이 OSM 건물 면적의 30% 이상을 덮으면 짝.
- 층수 우선순위: csv에 직접 적은 값 > 브이월드 > OSM building:levels > 기본 4층.
  단, 브이월드에서 같은 이름의 건물 20동 이상이 모두(95%+) 같은 층수면 단지 대표값으로 보고 OSM 다음으로 미룬다.
  (전남대학교 이름의 123동 중 122동이 4층 → 진리관 9층, 교육융합관 10층 같은 OSM 값을 덮지 않게)
  이 대표값을 쓴 건물은 csv 출처 열에 "브이월드(일괄값)"으로 따로 표시한다 (실제 층수를 고쳐 넣을 건물 찾기용).
  csv의 층수 칸을 고치면(출처는 무엇이든) "직접"으로 보고 다시 실행해도 유지한다.
- 높이 = 층수 × 4m + 옥상 난간 1m.
- scripts/build_map.py도 끝에서 apply_floors()를 불러, 지도를 다시 만들어도 층수가 유지된다.
Python 표준 라이브러리만 사용.
"""
import csv
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "data" / "building-floors.csv"
VWORLD_PATH = ROOT / "data" / "raw" / "vworld_buildings.json"
CAMPUS_PATH = ROOT / "data" / "campus.json"
EARTH_R = 6378137.0
MISSIONS = ["농생대 1호관", "중앙도서관", "제1학생마루", "생활관 9C동 예향학사", "공과대 2호관"]
FLOOR_M = 4.0
PARAPET_M = 1.0
DEFAULT_FLOORS = 4
MIN_COVER = 0.3
BULK_LABEL = "브이월드(일괄값)"
BULK_MIN = 20  # 대표값 판단: 같은 이름 건물 수
HEADER = ["건물 이름", "지금 높이(m)", "층수", "출처", "osm_id", "바닥면적(m2)"]


def area(o):
    return abs(sum(x1 * z2 - x2 * z1 for (x1, z1), (x2, z2) in zip(o, o[1:] + o[:1]))) / 2


def point_in_poly(x, z, poly):
    inside = False
    for (x1, z1), (x2, z2) in zip(poly, poly[1:] + poly[:1]):
        if (z1 > z) != (z2 > z) and x < x1 + (z - z1) * (x2 - x1) / (z2 - z1):
            inside = not inside
    return inside


def height_of(floors):
    return round(floors * FLOOR_M + PARAPET_M, 1)


def load_vworld(campus):
    """브이월드 건물 외곽선을 캠퍼스 좌표(m)로. [(id, 층수, 이름, [고리...], bbox)]"""
    if not VWORLD_PATH.exists():
        return []
    o = campus["meta"]["origin"]
    lat0, lon0 = o["lat"], o["lon"]
    kx = math.radians(1) * EARTH_R * math.cos(math.radians(lat0))
    kz = math.radians(1) * EARTH_R
    out = []
    for f in json.loads(VWORLD_PATH.read_text(encoding="utf-8"))["features"]:
        try:
            floors = int(f["floors"])
        except (TypeError, ValueError):
            continue
        if floors <= 0:
            continue
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        rings = [[((lon - lon0) * kx, -(lat - lat0) * kz) for lon, lat in poly[0]] for poly in polys]
        xs = [p[0] for r in rings for p in r]
        zs = [p[1] for r in rings for p in r]
        out.append([f["id"], floors, f["name"], rings, (min(xs), min(zs), max(xs), max(zs)), False])
    by_name = {}
    for v in out:
        if v[2]:
            by_name.setdefault(v[2], []).append(v[1])
    for v in out:
        same = by_name.get(v[2], [])
        if len(same) >= BULK_MIN and same.count(v[1]) >= 0.95 * len(same):
            v[5] = True
    return out


def match_vworld(buildings, vw):
    """OSM 건물 id → (브이월드 층수, 덮은 비율, 대표값 여부)"""
    cell = 50
    grid = {}
    for i, v in enumerate(vw):
        x0, z0, x1, z1 = v[4]
        for gx in range(int(x0 // cell), int(x1 // cell) + 1):
            for gz in range(int(z0 // cell), int(z1 // cell) + 1):
                grid.setdefault((gx, gz), []).append(i)
    result = {}
    for b in buildings:
        o = b["outline"]
        xs = [p[0] for p in o]; zs = [p[1] for p in o]
        step = max(0.75, min(3.0, math.sqrt(area(o)) / 20))
        counts, total = {}, 0
        z = min(zs) + step / 2
        while z < max(zs):
            x = min(xs) + step / 2
            while x < max(xs):
                if point_in_poly(x, z, o):
                    total += 1
                    for i in grid.get((int(x // cell), int(z // cell)), []):
                        v = vw[i]
                        if v[4][0] <= x <= v[4][2] and v[4][1] <= z <= v[4][3] and any(point_in_poly(x, z, r) for r in v[3]):
                            counts[i] = counts.get(i, 0) + 1
                            break
                x += step
            z += step
        if total and counts:
            best = max(counts, key=counts.get)
            cover = counts[best] / total
            if cover >= MIN_COVER:
                result[b["id"]] = (vw[best][1], cover, vw[best][5])
    return result


def read_manual():
    """csv에 채워진 층수: osm_id → (층수, 출처)"""
    if not CSV_PATH.exists():
        return {}
    manual = {}
    with CSV_PATH.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            v = (row.get("층수") or "").strip()
            if not v:
                continue
            try:
                n = int(float(v))
            except ValueError:
                continue
            manual[row["osm_id"]] = (n, (row.get("출처") or "").strip())
    return manual


def apply_floors(campus, verbose=True):
    """campus의 모든 건물에 층수·높이를 정해 넣고, 캠퍼스 안 건물로 csv를 다시 쓴다."""
    buildings = campus["buildings"]
    vw = load_vworld(campus)
    matched = match_vworld(buildings, vw) if vw else {}
    previous = read_manual()
    rows, stats = [], {"직접": 0, "브이월드": 0, BULK_LABEL: 0, "OSM": 0, "없음": 0}
    overridden = 0
    for b in buildings:
        osm = b.get("osmLevels")
        if osm is None and b.get("levels"):  # 예전 campus.json 호환
            try:
                osm = int(float(b["levels"]))
            except ValueError:
                osm = None
        if b.get("levels") is not None:
            b["osmLevels"] = osm
            b.pop("levels", None)
        vw_floors = matched[b["id"]][0] if b["id"] in matched else None
        bulk = b["id"] in matched and matched[b["id"]][2]
        if vw_floors and not (bulk and osm):
            src, floors = (BULK_LABEL if bulk else "브이월드"), vw_floors
        else:
            src, floors = ("OSM", osm) if osm else ("없음", None)
        # csv 값이 그 출처가 자동으로 주는 값과 다르면 사람이 고친 값
        if bulk and osm and vw_floors != osm and b["inCampus"]:
            overridden += 1
        prev = previous.get(b["id"])
        if prev and prev[0] != floors and prev[0] != {"브이월드": vw_floors, BULK_LABEL: vw_floors, "OSM": osm}.get(prev[1]):
            src, floors = "직접", prev[0]
        b["floors"] = floors or DEFAULT_FLOORS
        b["floorsSource"] = src
        b["height"] = height_of(b["floors"])
        if b["inCampus"]:
            stats[src] += 1
            rows.append({"name": b["name"], "height": b["height"], "floors": floors or "", "source": src,
                         "id": b["id"], "area": round(area(b["outline"]))})
    order = {n: i for i, n in enumerate(MISSIONS)}
    rows.sort(key=lambda r: (order.get(r["name"], len(order)), -r["area"]))
    with CSV_PATH.open("w", encoding="utf-8-sig", newline="") as f:  # 엑셀에서 한글이 깨지지 않게 BOM
        w = csv.writer(f)
        w.writerow(HEADER)
        for r in rows:
            w.writerow([r["name"] or "(이름 없음)", r["height"], r["floors"], r["source"], r["id"], r["area"]])
    if verbose:
        print(f"브이월드 건물 {len(vw)}동 중 OSM 건물과 짝 {len(matched)}동 (전체 지도 {len(buildings)}동 기준)")
        print(f"캠퍼스 안 {len(rows)}동 층수 출처: " + ", ".join(f"{k} {v}" for k, v in stats.items()))
        print(f"  브이월드 단지 대표값 대신 OSM 층수를 쓴 건물 {overridden}동")
        for n in MISSIONS:
            b = next((x for x in buildings if x["name"] == n), None)
            if b:
                cover = matched.get(b["id"], (None, 0, False))[1]
                print(f"  {n}: {b['floors']}층 ({b['floorsSource']}{f', 겹침 {cover * 100:.0f}%' if cover else ''}) → {b['height']}m")
    return campus


def main():
    campus = json.loads(CAMPUS_PATH.read_text(encoding="utf-8"))
    apply_floors(campus)
    CAMPUS_PATH.write_text(json.dumps(campus, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"저장: {CSV_PATH.relative_to(ROOT)}, {CAMPUS_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
