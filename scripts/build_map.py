"""data/raw/의 OSM 데이터를 게임용 data/campus.json으로 바꾼다.

사용법 (저장소 루트에서):  python scripts/build_map.py
좌표: 캠퍼스 중심 기준 미터, x 동쪽(+), z 남쪽(+). 소수점 1자리.
지도 데이터 © OpenStreetMap 기여자 (ODbL).
"""
import json
import math
import sys
from pathlib import Path

import building_floors

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
OUT = ROOT / "data" / "campus.json"

MARGIN_M = 50
LEVEL_M = 3.5
DEFAULT_HEIGHT_M = 14.0
EARTH_R = 6378137.0

# 도로 종류별 폭(m)과 차도/보행로 구분
CAR_ROAD_WIDTHS = {
    "motorway": 16, "trunk": 14, "primary": 14, "secondary": 12, "tertiary": 10,
    "motorway_link": 9, "trunk_link": 9, "primary_link": 9, "secondary_link": 8, "tertiary_link": 7,
    "residential": 8, "unclassified": 8, "road": 8, "living_street": 7, "service": 7,
}
FOOT_ROAD_WIDTHS = {"footway": 3, "path": 2.5, "pedestrian": 4, "steps": 3,
                    "cycleway": 3, "track": 3.5, "bridleway": 3}

# 녹지(물 포함) 종류: OSM 태그 값 → 게임에서 쓸 kind
# park/garden은 대부분 광장·조경 구역이라 게임에서 초록으로 칠하지 않고 나무만 심는다.
# sports_centre·stadium·recreation_ground는 시설 전체 구역이라 넣지 않는다.
GREEN_KINDS = {
    "landuse": {"reservoir": "water", "basin": "water", "grass": "grass", "meadow": "grass", "village_green": "grass",
                "forest": "forest", "orchard": "farm",
                "farmland": "farm", "allotments": "farm", "plant_nursery": "farm",
                "greenhouse_horticulture": "farm", "flowerbed": "grass", "cemetery": "grass"},
    "leisure": {"park": "park", "garden": "park", "pitch": "pitch", "track": "track",
                "playground": "park", "golf_course": "grass", "nature_reserve": "forest"},
    "natural": {"wood": "forest", "scrub": "forest", "grassland": "grass", "heath": "grass",
                "water": "water", "wetland": "water"},
}
DIRT_SURFACES = {"dirt", "ground", "sand", "clay", "gravel", "fine_gravel", "compacted", "earth"}
SPAWN_BEFORE_GATE_M = 20
# 조형물·기념물 모양: 인물 모양은 만들지 않고 비석·받침대·기둥으로만
TOWER_NAMES = {"용봉탑"}  # 정문 바깥쪽에서 출발해 문을 지나 들어가게


# ---------- 좌표 변환과 기하 ----------

class Projector:
    def __init__(self, lat0, lon0):
        self.lat0, self.lon0 = lat0, lon0
        self.kx = math.radians(1) * EARTH_R * math.cos(math.radians(lat0))
        self.kz = math.radians(1) * EARTH_R

    def __call__(self, lat, lon):
        return ((lon - self.lon0) * self.kx, -(lat - self.lat0) * self.kz)


def signed_area(poly):
    return sum(x1 * z2 - x2 * z1 for (x1, z1), (x2, z2) in zip(poly, poly[1:] + poly[:1])) / 2


def centroid(poly):
    a = signed_area(poly)
    if abs(a) < 1e-9:
        return (sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly))
    cx = cz = 0.0
    for (x1, z1), (x2, z2) in zip(poly, poly[1:] + poly[:1]):
        c = x1 * z2 - x2 * z1
        cx += (x1 + x2) * c
        cz += (z1 + z2) * c
    return (cx / (6 * a), cz / (6 * a))


def point_in_poly(p, poly):
    x, z = p
    inside = False
    for (x1, z1), (x2, z2) in zip(poly, poly[1:] + poly[:1]):
        if (z1 > z) != (z2 > z) and x < x1 + (z - z1) * (x2 - x1) / (z2 - z1):
            inside = not inside
    return inside


def dist_to_ring(p, poly):
    best = math.inf
    px, pz = p
    for (x1, z1), (x2, z2) in zip(poly, poly[1:] + poly[:1]):
        dx, dz = x2 - x1, z2 - z1
        L = dx * dx + dz * dz
        t = 0 if L == 0 else max(0, min(1, ((px - x1) * dx + (pz - z1) * dz) / L))
        best = min(best, math.hypot(px - x1 - t * dx, pz - z1 - t * dz))
    return best


def r1(v):
    return round(v, 1)


def rpts(pts):
    return [[r1(x), r1(z)] for x, z in pts]


def open_ring(pts):
    """닫힌 고리의 마지막 중복 점을 빼고, 반시계(+면적) 방향으로 맞춘다."""
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if signed_area(pts) < 0:
        pts = pts[::-1]
    return pts


def stitch_rings(segments):
    """멀티폴리곤의 조각난 outer 선들을 이어 닫힌 고리들로 만든다."""
    segs = [list(s) for s in segments if len(s) >= 2]
    rings = []
    while segs:
        ring = segs.pop(0)
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == ring[-1]:
                    ring += s[1:]
                elif s[-1] == ring[-1]:
                    ring += s[::-1][1:]
                elif s[-1] == ring[0]:
                    ring = s[:-1] + ring
                elif s[0] == ring[0]:
                    ring = s[::-1][:-1] + ring
                else:
                    continue
                segs.pop(i)
                changed = True
                break
        if len(ring) >= 4 and ring[0] == ring[-1]:
            rings.append(ring)
    return rings


# ---------- OSM 요소 → 다각형/선 ----------

def element_rings(el):
    """way나 relation의 외곽 고리들 (위경도 튜플 목록)."""
    if el["type"] == "way":
        g = [(p["lat"], p["lon"]) for p in el.get("geometry", [])]
        return [g] if len(g) >= 4 and g[0] == g[-1] else []
    if el["type"] == "relation":
        outers = [[(p["lat"], p["lon"]) for p in m.get("geometry", [])]
                  for m in el.get("members", []) if m.get("role") == "outer" and m.get("geometry")]
        return stitch_rings(outers)
    return []


def parse_height(tags):
    h = tags.get("height", "").replace("m", "").strip()
    try:
        return float(h), "height"
    except ValueError:
        pass
    try:
        lv = float(tags.get("building:levels", ""))
        return lv * LEVEL_M, "levels"
    except ValueError:
        return DEFAULT_HEIGHT_M, "default"


def road_width(hw):
    return CAR_ROAD_WIDTHS.get(hw) or FOOT_ROAD_WIDTHS.get(hw)


def green_kind(tags):
    if tags.get("leisure") == "pitch":
        return "dirt" if tags.get("surface") in DIRT_SURFACES else "pitch"
    for key, table in GREEN_KINDS.items():
        if tags.get(key) in table:
            return table[tags[key]]
    return None


# ---------- 메인 ----------

def main():
    boundary_el = json.loads((RAW_DIR / "boundary.json").read_text(encoding="utf-8"))["elements"][0]
    raw = json.loads((RAW_DIR / "features.json").read_text(encoding="utf-8"))
    elements = raw["elements"]

    b_ll = [(p["lat"], p["lon"]) for p in boundary_el["geometry"]]
    lat0 = (min(p[0] for p in b_ll) + max(p[0] for p in b_ll)) / 2
    lon0 = (min(p[1] for p in b_ll) + max(p[1] for p in b_ll)) / 2
    proj = Projector(lat0, lon0)
    boundary = open_ring([proj(*p) for p in b_ll])

    def in_campus(p):
        return point_in_poly(p, boundary)

    def in_region(p):  # 경계 안 또는 경계에서 50m 이내
        return in_campus(p) or dist_to_ring(p, boundary) <= MARGIN_M

    # 건물
    buildings = []
    height_src = {"height": 0, "levels": 0, "default": 0}
    for el in elements:
        tags = el.get("tags", {})
        if "building" not in tags or tags["building"] == "no":
            continue
        for ring_ll in element_rings(el):
            ring = open_ring([proj(*p) for p in ring_ll])
            if len(ring) < 3 or not any(in_region(p) for p in ring):
                continue
            h, src = parse_height(tags)
            height_src[src] += 1
            c = centroid(ring)
            b = {"id": f"{el['type'][0]}{el['id']}", "name": tags.get("name", ""),
                 "height": r1(h), "inCampus": in_campus(c),
                 "center": [r1(c[0]), r1(c[1])], "outline": rpts(ring)}
            try:
                b["osmLevels"] = int(float(tags["building:levels"]))
            except (KeyError, ValueError):
                b["osmLevels"] = None
            buildings.append(b)

    # 도로: 영역 안 구간만 남기고, 끝에서 한 점씩 더 붙여 가장자리까지 이어지게
    roads = []
    for el in elements:
        tags = el.get("tags", {})
        hw = tags.get("highway")
        if el["type"] != "way" or not hw or tags.get("area") == "yes":
            continue
        width = road_width(hw)
        if width is None:
            continue
        pts = [proj(p["lat"], p["lon"]) for p in el.get("geometry", [])]
        inside = [in_region(p) for p in pts]
        n = len(pts)
        keep = [inside[i] or (i > 0 and inside[i - 1]) or (i < n - 1 and inside[i + 1]) for i in range(n)]
        run = []
        for i in range(n + 1):
            if i < n and keep[i]:
                run.append(pts[i])
            elif run:
                if len(run) >= 2:
                    road = {"id": f"w{el['id']}", "type": hw, "car": hw in CAR_ROAD_WIDTHS,
                            "width": width, "points": rpts(run)}
                    if tags.get("name"):
                        road["name"] = tags["name"]
                    roads.append(road)
                run = []

    # 녹지(물 포함)
    greens = []
    for el in elements:
        tags = el.get("tags", {})
        if "building" in tags:
            continue
        kind = green_kind(tags)
        if not kind:
            continue
        for ring_ll in element_rings(el):
            ring = open_ring([proj(*p) for p in ring_ll])
            if len(ring) >= 3 and any(in_region(p) for p in ring):
                g = {"id": f"{el['type'][0]}{el['id']}", "kind": kind, "outline": rpts(ring)}
                if kind in ("pitch", "dirt") and tags.get("sport"):
                    g["sport"] = tags["sport"].split(";")[0]
                if kind == "water" and tags.get("name"):
                    g["name"] = tags["name"]
                greens.append(g)

    # 주차장 바닥 (지하·건물 주차장 제외)
    parking = []
    for el in elements:
        tags = el.get("tags", {})
        if tags.get("amenity") != "parking" or tags.get("parking") in ("underground", "multi-storey") or "building" in tags:
            continue
        for ring_ll in element_rings(el):
            ring = open_ring([proj(*p) for p in ring_ll])
            if len(ring) >= 3 and any(in_region(p) for p in ring) and abs(signed_area(ring)) > 30:
                parking.append(rpts(ring))

    # 작은 소품(벤치·자전거 보관소·버스정류장)과 조형물·기념물
    props, monuments = [], []
    for el in elements:
        tags = el.get("tags", {})
        if el["type"] == "node":
            p = proj(el["lat"], el["lon"])
        else:
            rings = element_rings(el)
            if rings:
                p = centroid(open_ring([proj(*q) for q in rings[0]]))
            elif el.get("geometry"):
                g = el["geometry"]
                p = proj(sum(q["lat"] for q in g) / len(g), sum(q["lon"] for q in g) / len(g))
            else:
                continue
        if not in_region(p):
            continue
        a = tags.get("amenity")
        kind = ("bench" if a == "bench" or tags.get("leisure") == "picnic_table" else
                "bike" if a == "bicycle_parking" else
                "bus" if tags.get("highway") == "bus_stop" and el["type"] == "node" else None)
        if kind:
            props.append({"type": kind, "p": [r1(p[0]), r1(p[1])], **({"name": tags["name"]} if kind == "bus" and tags.get("name") else {})})
            continue
        if tags.get("tourism") == "artwork" or tags.get("historic") in ("memorial", "monument"):
            name = tags.get("name", "")
            art = tags.get("artwork_type", "")
            if name in TOWER_NAMES:
                shape = "tower"
            elif art == "mural":
                shape = "wall"
            elif art in ("bust", "statue"):
                shape = "pedestal"  # 인물상 자리: 단정한 받침대만
            elif art in ("sculpture", "installation"):
                shape = "sculpture"
            else:
                shape = "stele"
            monuments.append({"name": name, "shape": shape, "p": [r1(p[0]), r1(p[1])]})

    # 정문 → 시작 위치
    spawn = find_spawn(elements, proj, boundary)

    xs = [p[0] for p in boundary]
    zs = [p[1] for p in boundary]
    campus = {
        "meta": {
            "attribution": "지도 데이터 © OpenStreetMap 기여자 (ODbL)",
            "source": f"OpenStreetMap, 캠퍼스 경계 way {boundary_el['id']}",
            "osmTimestamp": raw.get("osm3s", {}).get("timestamp_osm_base"),
            "origin": {"lat": round(lat0, 7), "lon": round(lon0, 7)},
            "axes": "x 동쪽(+), z 남쪽(+), 단위 m",
        },
        "size": {"width": r1(max(xs) - min(xs)), "depth": r1(max(zs) - min(zs))},
        "boundary": rpts(boundary),
        "spawn": spawn,
        "buildings": buildings,
        "roads": roads,
        "greens": greens,
        "parking": parking,
        "props": props,
        "monuments": monuments,
    }
    building_floors.apply_floors(campus)
    OUT.write_text(json.dumps(campus, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # ---------- 요약 ----------
    print(f"건물 {len(buildings)}개 (캠퍼스 안 {sum(b['inCampus'] for b in buildings)}개)")
    print("  높이: 층수 × 4m + 난간 1m (scripts/building_floors.py, data/building-floors.csv)")
    print(f"도로 {len(roads)}개 구간, 녹지 {len(greens)}개, 주차장 {len(parking)}개")
    print(f"소품 {len(props)}개 ({', '.join(f'{k} {sum(1 for q in props if q["type"] == k)}' for k in ('bench', 'bike', 'bus'))}), 조형물 {len(monuments)}개")
    print(f"캠퍼스 크기: 동서 {campus['size']['width']}m × 남북 {campus['size']['depth']}m")
    print(f"정문 {spawn['gate']}, 시작 {spawn['position']}, 방향 {spawn['dir']}")
    print(f"campus.json {OUT.stat().st_size / 1024:.0f} KB")
    report_missions(buildings)


def find_spawn(elements, proj, boundary):
    """이름에 '정문'이 있는 점(없으면 정문 gate)을 찾아, 그 점을 지나는 차도를 따라
    캠퍼스 안쪽으로 25m 들어간 곳을 시작 위치로 한다."""
    nodes = [e for e in elements if e["type"] == "node"]
    gates = [e for e in nodes if "정문" in e.get("tags", {}).get("name", "")]
    if not gates:
        gates = [e for e in nodes if e.get("tags", {}).get("barrier") == "gate"
                 and e["tags"].get("entrance") == "main"]
    if not gates:
        print("정문을 찾지 못했습니다. 후보:")
        for e in nodes:
            t = e.get("tags", {})
            if t.get("barrier") == "gate" or "문" in t.get("name", ""):
                print(f"  node {e['id']} {t.get('name', '(이름 없음)')} {proj(e['lat'], e['lon'])}")
        sys.exit(1)
    if len(gates) > 1:
        print("정문 후보가 여러 개 → 첫 번째 사용:", [(g["id"], g["tags"].get("name")) for g in gates])
    gate = gates[0]
    gp = proj(gate["lat"], gate["lon"])

    # 정문 점을 지나는 차도 중, 캠퍼스 쪽(경계 안)으로 향하는 방향을 고른다
    best = None
    for el in elements:
        tags = el.get("tags", {})
        if el["type"] != "way" or tags.get("highway") not in CAR_ROAD_WIDTHS:
            continue
        ids = el.get("nodes", [])
        if gate["id"] not in ids:
            continue
        pts = [proj(p["lat"], p["lon"]) for p in el["geometry"]]
        i = ids.index(gate["id"])
        for path in (pts[i:], pts[i::-1]):
            if len(path) < 2:
                continue
            pos, _ = walk(path, 25)
            _, d0 = walk(path, 0.01)  # 정문에서 처음 나아가는 방향
            # 경계 안쪽으로 깊을수록 높은 점수 (밖이면 음수)
            score = dist_to_ring(pos, boundary) * (1 if point_in_poly(pos, boundary) else -1)
            if best is None or score > best[0]:
                best = (score, d0, CAR_ROAD_WIDTHS[tags["highway"]])
    if best is None:  # 정문을 지나는 차도가 없으면 캠퍼스 중심(0,0)을 향하게
        L = math.hypot(*gp) or 1
        d, road_w = (-gp[0] / L, -gp[1] / L), 8
    else:
        _, d, road_w = best
    # 정문 바깥에서 출발해 문을 바라보게
    pos = (gp[0] - d[0] * SPAWN_BEFORE_GATE_M, gp[1] - d[1] * SPAWN_BEFORE_GATE_M)
    return {"gateNode": gate["id"], "gate": [r1(gp[0]), r1(gp[1])], "gateRoadWidth": road_w,
            "position": [r1(pos[0]), r1(pos[1])], "dir": [round(d[0], 3), round(d[1], 3)]}


def walk(path, dist):
    """선을 따라 dist만큼 간 위치와 그 지점의 진행 방향(단위 벡터)."""
    for (x1, z1), (x2, z2) in zip(path, path[1:]):
        seg = math.hypot(x2 - x1, z2 - z1)
        if seg == 0:
            continue
        d = ((x2 - x1) / seg, (z2 - z1) / seg)
        if dist <= seg:
            return (x1 + d[0] * dist, z1 + d[1] * dist), d
        dist -= seg
    return path[-1], d


def report_missions(buildings):
    wanted = ["중앙도서관", "농생대 1호관", "제1학생마루", "생활관", "공과대 2호관"]
    print("\n미션 건물:")
    for w in wanted:
        if w == "생활관":
            hits = [b for b in buildings if b["name"].startswith("생활관")]
        else:
            hits = [b for b in buildings if b["name"] == w]
        if not hits:
            print(f"  {w}: 없음!")
        for b in hits:
            print(f"  {b['name']}: 중심 {b['center']}, 높이 {b['height']}m, 캠퍼스 안 {b['inCampus']}")


if __name__ == "__main__":
    main()
