"""도로 노면 표시 근거 → data/road-marks.json

사용법:  python scripts/build_road_marks.py
- 횡단보도: OSM footway=crossing 길(data/raw/features.json) 중 crossing=marked·uncontrolled·traffic_signals·zebra (unmarked는 칠이 없어 뺌)
- 과속방지턱: OSM traffic_calming 점 (Overpass로 한 번 받아 data/raw/traffic_calming.json에 둠, 없으면 빈 목록)
- 도로 태그: 차도마다 highway 종류, oneway, junction=roundabout (정지선·화살표 규칙에 씀)
정지선·방향 화살표 위치는 게임(assets/js/roadmarks.js)이 이 태그와 차도 폭으로 규칙에 따라 정한다.
Python 표준 라이브러리만 사용.
"""
import json
import math
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "road-marks.json"
CALM = RAW / "traffic_calming.json"
EARTH_R = 6378137.0
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
UA = {"User-Agent": "jnu-late-race/1.0 (student project)"}
PAINTED = {"marked", "uncontrolled", "traffic_signals", "zebra"}


def main():
    campus = json.loads((ROOT / "data" / "campus.json").read_text(encoding="utf-8"))
    terr = json.loads((ROOT / "data" / "terrain.json").read_text(encoding="utf-8"))
    o = campus["meta"]["origin"]
    kx = math.radians(1) * EARTH_R * math.cos(math.radians(o["lat"]))
    kz = math.radians(1) * EARTH_R
    game = lambda lat, lon: [round((lon - o["lon"]) * kx, 2), round((o["lat"] - lat) * kz, 2)]  # noqa: E731
    raw = json.loads((RAW / "features.json").read_text(encoding="utf-8"))
    car_ids = {r["id"] for r in campus["roads"] if r.get("car")}

    crossings, kinds = [], {}
    tags = {}
    for e in raw["elements"]:
        t = e.get("tags", {})
        if e["type"] != "way":
            continue
        rid = f"w{e['id']}"
        if rid in car_ids:
            tags[rid] = {k: t[k] for k in ("highway", "oneway", "junction", "lanes") if k in t}
        if t.get("footway") == "crossing" and "geometry" in e:
            c = t.get("crossing", "")
            kinds[c] = kinds.get(c, 0) + 1
            if c in PAINTED:
                crossings.append({"id": rid, "kind": c, "points": [game(p["lat"], p["lon"]) for p in e["geometry"]]})

    if not CALM.exists():
        x0, z0 = terr["x0"], terr["z0"]
        x1, z1 = x0 + (terr["nx"] - 1) * terr["step"], z0 + (terr["nz"] - 1) * terr["step"]
        bbox = f"{o['lat'] - z1 / kz:.6f},{o['lon'] + x0 / kx:.6f},{o['lat'] - z0 / kz:.6f},{o['lon'] + x1 / kx:.6f}"
        q = f'[out:json][timeout:60][bbox:{bbox}];(node["traffic_calming"];way["traffic_calming"];);out tags geom;'
        for url in OVERPASS:
            try:
                req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": q}).encode(), headers=UA)
                with urllib.request.urlopen(req, timeout=120) as res:
                    CALM.write_text(json.dumps(json.load(res), ensure_ascii=False), encoding="utf-8")
                break
            except Exception as ex:  # 다음 서버로
                print("Overpass 실패:", url, ex)
                time.sleep(5)
    bumps = []
    if CALM.exists():
        for e in json.loads(CALM.read_text(encoding="utf-8"))["elements"]:
            t = e.get("tags", {})
            if e["type"] == "node":
                bumps.append({"id": f"n{e['id']}", "kind": t.get("traffic_calming"), "p": game(e["lat"], e["lon"])})
            elif "geometry" in e:
                g = e["geometry"]
                bumps.append({"id": f"w{e['id']}", "kind": t.get("traffic_calming"),
                              "p": game(sum(p["lat"] for p in g) / len(g), sum(p["lon"] for p in g) / len(g))})
    out = {
        "source": "OpenStreetMap 기여자(ODbL): footway=crossing 길, traffic_calming, 차도 태그",
        "crossings": crossings, "bumps": bumps, "roadTags": tags,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"횡단보도 길 {len(crossings)}개 (종류별 전체 {kinds}), 과속방지턱 {len(bumps)}개, 도로 태그 {len(tags)}개 → {OUT.relative_to(ROOT)}")
    rb = sum(1 for t in tags.values() if t.get("junction") == "roundabout")
    ow = sum(1 for t in tags.values() if t.get("oneway") == "yes")
    print(f"  회전교차로 {rb}개, 일방통행 {ow}개")


if __name__ == "__main__":
    main()
