"""AWS Terrain Tiles(terrarium PNG, 인증키 없음)에서 캠퍼스 주변 z15 높이 타일을 받아 data/raw/terrain/에 저장한다.

사용법 (저장소 루트에서):  python scripts/fetch_terrain.py
Python 표준 라이브러리만 사용. 먼저 scripts/fetch_osm.py로 data/raw/boundary.json을 받아 둬야 한다.
terrarium 높이(m) = R*256 + G + B/256 - 32768
"""
import json
import math
import sys
import time
import urllib.request
from pathlib import Path

ZOOM = 15
MARGIN_M = 150  # 캠퍼스 경계 바깥 여유
URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = RAW / "terrain"


def tile_xy(lat, lon, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def main():
    boundary = json.loads((RAW / "boundary.json").read_text(encoding="utf-8"))["elements"][0]["geometry"]
    lats = [p["lat"] for p in boundary]
    lons = [p["lon"] for p in boundary]
    dlat = MARGIN_M / 111320
    dlon = MARGIN_M / (111320 * math.cos(math.radians(sum(lats) / len(lats))))
    x0, y0 = tile_xy(max(lats) + dlat, min(lons) - dlon, ZOOM)
    x1, y1 = tile_xy(min(lats) - dlat, max(lons) + dlon, ZOOM)
    xs = range(int(x0), int(x1) + 1)
    ys = range(int(y0), int(y1) + 1)
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"z{ZOOM} 타일 x {xs.start}~{xs.stop - 1}, y {ys.start}~{ys.stop - 1} ({len(xs) * len(ys)}장)")
    for x in xs:
        for y in ys:
            path = OUT / f"{ZOOM}_{x}_{y}.png"
            if path.exists():
                continue
            url = URL.format(z=ZOOM, x=x, y=y)
            for attempt in range(3):
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": "jnu-late-race/1.0 (student project)"})
                    with urllib.request.urlopen(req, timeout=60) as res:
                        path.write_bytes(res.read())
                    print(f"  받음 {path.name}")
                    break
                except Exception as e:
                    print(f"  실패 {url}: {e}")
                    time.sleep(2)
            else:
                sys.exit("타일을 받지 못했습니다.")
    meta = {"zoom": ZOOM, "x": [xs.start, xs.stop - 1], "y": [ys.start, ys.stop - 1], "source": URL}
    (OUT / "tiles.json").write_text(json.dumps(meta), encoding="utf-8")
    print(f"저장 → {OUT}")


if __name__ == "__main__":
    main()
