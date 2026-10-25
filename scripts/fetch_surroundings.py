"""캠퍼스 바깥 풍경 자료 받기 → data/raw/ (커밋 안 함)

사용법:  python scripts/fetch_surroundings.py
1) AWS Terrain Tiles(terrarium PNG, 인증키 없음) z11 타일 — 캠퍼스 중심 둘레 약 ±15km(무등산 포함)
   → data/raw/terrain_far/11_x_y.png + tiles.json
2) OpenStreetMap(Overpass API) 건물 외곽선 — 지형 격자(data/terrain.json) 둘레 1.3km 안 → data/raw/surroundings_osm.json
요청 사이에는 쉬고(타일 1초), 받은 파일이 있으면 다시 받지 않는다. Python 표준 라이브러리만 사용.
"""
import json
import math
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
TILES = RAW / "terrain_far"
OSM_OUT = RAW / "surroundings_osm.json"
ZOOM = 11
RADIUS_M = 15000
RING_M = 1300
TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
UA = {"User-Agent": "jnu-late-race/1.0 (student project)"}
EARTH_R = 6378137.0


def tile_xy(lat, lon, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def main():
    campus = json.loads((ROOT / "data" / "campus.json").read_text(encoding="utf-8"))
    o = campus["meta"]["origin"]
    kx = math.radians(1) * EARTH_R * math.cos(math.radians(o["lat"]))
    kz = math.radians(1) * EARTH_R

    # 1) 먼 지형 타일
    TILES.mkdir(parents=True, exist_ok=True)
    dlat, dlon = RADIUS_M / kz, RADIUS_M / kx
    x0, y0 = tile_xy(o["lat"] + dlat, o["lon"] - dlon, ZOOM)
    x1, y1 = tile_xy(o["lat"] - dlat, o["lon"] + dlon, ZOOM)
    got = 0
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            p = TILES / f"{ZOOM}_{x}_{y}.png"
            if p.exists():
                continue
            req = urllib.request.Request(TILE_URL.format(z=ZOOM, x=x, y=y), headers=UA)
            p.write_bytes(urllib.request.urlopen(req, timeout=60).read())
            got += 1
            time.sleep(1.0)
    (TILES / "tiles.json").write_text(json.dumps({"zoom": ZOOM, "x": [x0, x1], "y": [y0, y1], "source": TILE_URL}), encoding="utf-8")
    print(f"z{ZOOM} 타일 {(x1 - x0 + 1) * (y1 - y0 + 1)}장 (새로 받음 {got}) → {TILES.relative_to(ROOT)}")

    # 2) 둘레 건물 (OSM)
    if OSM_OUT.exists():
        print("둘레 건물: 이미 있음", OSM_OUT.relative_to(ROOT))
        return
    t = json.loads((ROOT / "data" / "terrain.json").read_text(encoding="utf-8"))
    gx0, gz0 = t["x0"] - RING_M, t["z0"] - RING_M
    gx1, gz1 = t["x0"] + (t["nx"] - 1) * t["step"] + RING_M, t["z0"] + (t["nz"] - 1) * t["step"] + RING_M
    south, north = o["lat"] - gz1 / kz, o["lat"] - gz0 / kz
    west, east = o["lon"] + gx0 / kx, o["lon"] + gx1 / kx
    q = f"""[out:json][timeout:180][bbox:{south:.6f},{west:.6f},{north:.6f},{east:.6f}];
way["building"];out tags geom;"""
    for url in OVERPASS:
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": q}).encode(), headers=UA)
            with urllib.request.urlopen(req, timeout=240) as res:
                data = json.load(res)
            OSM_OUT.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            print(f"둘레 건물 {len(data['elements'])}개 → {OSM_OUT.relative_to(ROOT)}")
            return
        except Exception as e:  # 다음 서버로
            print("Overpass 실패:", url, e)
            time.sleep(5)
    raise SystemExit("Overpass 모든 서버 실패")


if __name__ == "__main__":
    main()
