"""조경 디테일 조사: Overpass로 캠퍼스 경계(OSM way 105125653) 안의 조경 요소를 종류별로 센다.

사용법 (저장소 루트에서):  python scripts/survey_landscape.py
Python 표준 라이브러리만 사용. 결과는 화면에 표로 출력하고 data/raw/landscape.json에 원본을 저장한다.
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

QUERY = """[out:json][timeout:120];
way(105125653);map_to_area->.c;
(
  nwr(area.c)[natural=water]; nwr(area.c)[water]; nwr(area.c)[landuse~"^(reservoir|basin)$"]; nwr(area.c)[waterway];
  node(area.c)[natural=tree]; way(area.c)[natural=tree_row];
  nwr(area.c)[amenity=parking];
  nwr(area.c)[leisure~"^(pitch|track|sports_centre|stadium|playground)$"];
  node(area.c)[amenity=bench]; node(area.c)[leisure=picnic_table];
  node(area.c)[highway=street_lamp];
  way(area.c)[barrier~"^(wall|fence|hedge|retaining_wall)$"];
  way(area.c)[highway=steps];
  way(area.c)[highway~"^(footway|path|pedestrian|cycleway)$"];
  node(area.c)[highway=bus_stop]; nwr(area.c)[public_transport=platform];
  nwr(area.c)[amenity=bicycle_parking];
  nwr(area.c)[tourism=artwork]; nwr(area.c)[historic~"^(memorial|monument)$"]; nwr(area.c)[memorial];
);
out tags;"""


def overpass(q):
    data = urllib.parse.urlencode({"data": q}).encode()
    for s in SERVERS:
        try:
            req = urllib.request.Request(s, data=data, headers={"User-Agent": "jnu-late-race/1.0 (student project)"})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            print(f"  실패 {s}: {e}")
            time.sleep(2)
    sys.exit("Overpass 실패")


def main():
    res = overpass(QUERY)
    (ROOT / "data" / "raw").mkdir(parents=True, exist_ok=True)
    (ROOT / "data" / "raw" / "landscape.json").write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")
    els = res["elements"]
    groups = {
        "연못·물": lambda t: t.get("natural") == "water" or "water" in t or t.get("landuse") in ("reservoir", "basin") or "waterway" in t,
        "개별 나무 (natural=tree)": lambda t: t.get("natural") == "tree",
        "가로수 (tree_row)": lambda t: t.get("natural") == "tree_row",
        "주차장": lambda t: t.get("amenity") == "parking",
        "벤치·피크닉 테이블": lambda t: t.get("amenity") == "bench" or t.get("leisure") == "picnic_table",
        "가로등": lambda t: t.get("highway") == "street_lamp",
        "담장·울타리·생울타리": lambda t: t.get("barrier") in ("wall", "fence", "hedge", "retaining_wall"),
        "계단": lambda t: t.get("highway") == "steps",
        "보행로 (footway/path/pedestrian/cycleway)": lambda t: t.get("highway") in ("footway", "path", "pedestrian", "cycleway"),
        "버스정류장": lambda t: t.get("highway") == "bus_stop" or t.get("public_transport") == "platform",
        "자전거 보관소": lambda t: t.get("amenity") == "bicycle_parking",
        "조형물·기념물": lambda t: t.get("tourism") == "artwork" or t.get("historic") in ("memorial", "monument") or "memorial" in t,
    }
    print("| 항목 | 개수 | 세부 |")
    print("|---|---|---|")
    for name, test in groups.items():
        hit = [e for e in els if test(e.get("tags", {}))]
        detail = ""
        if name == "연못·물":
            detail = ", ".join(f"{t.get('name', '(이름 없음)')}" for t in (e["tags"] for e in hit) if t.get("name"))
        elif name.startswith("담장"):
            detail = ", ".join(f"{k} {v}" for k, v in Counter(e["tags"]["barrier"] for e in hit).most_common())
        elif name.startswith("보행로"):
            detail = ", ".join(f"{k} {v}" for k, v in Counter(e["tags"]["highway"] for e in hit).most_common())
        elif name.startswith("조형물"):
            detail = ", ".join(e["tags"].get("name", "(이름 없음)") for e in hit)
        print(f"| {name} | {len(hit)} | {detail} |")
    sports = [e["tags"] for e in els if e.get("tags", {}).get("leisure") in ("pitch", "track", "sports_centre", "stadium", "playground")]
    kinds = Counter()
    for t in sports:
        lv = t["leisure"]
        kinds[f"{lv}:{t.get('sport', '-')}" if lv == "pitch" else lv] += 1
    print(f"| 운동장·체육 시설 | {len(sports)} | " + ", ".join(f"{k} {v}" for k, v in kinds.most_common()) + " |")


if __name__ == "__main__":
    main()
