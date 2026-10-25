"""OpenStreetMap에서 전남대 광주캠퍼스 주변 데이터를 받아 data/raw/에 저장한다.

사용법 (저장소 루트에서):  python scripts/fetch_osm.py
Python 표준 라이브러리만 사용한다. 지도 데이터 © OpenStreetMap 기여자 (ODbL).
"""
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

CAMPUS_WAY_ID = 105125653  # 전남대학교 캠퍼스 경계
MARGIN_M = 50              # 경계 주변 여유

# 앞의 서버가 실패하면 다음 공개 미러로 재시도
SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"


def overpass(query):
    data = urllib.parse.urlencode({"data": query}).encode()
    last_error = None
    for server in SERVERS:
        for attempt in range(2):
            try:
                print(f"  요청: {server} (시도 {attempt + 1})")
                req = urllib.request.Request(
                    server, data=data,
                    headers={"User-Agent": "jnu-late-race/1.0 (student project)"})
                with urllib.request.urlopen(req, timeout=180) as res:
                    return json.loads(res.read().decode("utf-8"))
            except Exception as e:  # 네트워크 오류, 429, 504, JSON 깨짐 등
                last_error = e
                print(f"  실패: {e}")
                time.sleep(3)
    sys.exit(f"모든 Overpass 서버가 실패했습니다: {last_error}")


def main():
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    print("1/2 캠퍼스 경계 받는 중...")
    boundary = overpass(f"[out:json][timeout:60];way({CAMPUS_WAY_ID});out geom;")
    if not boundary.get("elements"):
        sys.exit(f"way {CAMPUS_WAY_ID}를 찾지 못했습니다.")
    (RAW_DIR / "boundary.json").write_text(
        json.dumps(boundary, ensure_ascii=False), encoding="utf-8")
    way = boundary["elements"][0]
    print(f"  경계: {way.get('tags', {}).get('name', '?')}, 점 {len(way['geometry'])}개")

    # 경계 사각형 + 여유 50m (건물 등은 build_map.py에서 경계+50m로 한 번 더 거른다)
    lats = [p["lat"] for p in way["geometry"]]
    lons = [p["lon"] for p in way["geometry"]]
    dlat = MARGIN_M / 111320
    dlon = MARGIN_M / (111320 * math.cos(math.radians(sum(lats) / len(lats))))
    s, n = min(lats) - dlat, max(lats) + dlat
    w, e = min(lons) - dlon, max(lons) + dlon
    bbox = f"{s:.7f},{w:.7f},{n:.7f},{e:.7f}"

    print("2/2 건물·도로·녹지·출입구·조경 받는 중...")
    query = f"""[out:json][timeout:180][bbox:{bbox}];
(
  way[building];
  relation[building];
  way[highway];
  way[landuse];
  relation[landuse];
  way[leisure];
  relation[leisure];
  way[natural];
  relation[natural];
  node[barrier];
  node[entrance];
  nwr[amenity~"^(parking|bench|bicycle_parking)$"];
  node[leisure=picnic_table];
  node[highway=bus_stop];
  nwr[tourism=artwork];
  nwr[historic~"^(memorial|monument)$"];
  nwr[name~"정문|후문|쪽문"];
);
out geom;"""
    features = overpass(query)
    features["bbox"] = bbox
    (RAW_DIR / "features.json").write_text(
        json.dumps(features, ensure_ascii=False), encoding="utf-8")
    print(f"  요소 {len(features['elements'])}개 저장 → {RAW_DIR}")


if __name__ == "__main__":
    main()
