"""브이월드(국토교통부) 2D 데이터 API에서 캠퍼스 범위 건물(건물통합정보 LT_C_SPBD)의 지상층수를 받아
data/raw/vworld_buildings.json에 저장한다 (커밋 안 함).

사용법 (저장소 루트에서):  python scripts/fetch_vworld.py
- 인증키는 .env의 VWORLD_KEY에서 읽는다. 키는 화면·파일·커밋 어디에도 남기지 않는다.
- 요청 domain은 브이월드에 등록한 서비스 URL(https://junyeong1810.github.io).
Python 표준 라이브러리만 사용.
"""
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
API = "https://api.vworld.kr/req/data"
DOMAIN = "https://junyeong1810.github.io"
MARGIN_M = 80
PAGE_SIZE = 1000


def read_key():
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            k, _, v = line.partition("=")
            if k.strip() == "VWORLD_KEY" and v.strip():
                return v.strip()
    sys.exit(".env에 VWORLD_KEY가 없습니다.")


def main():
    key = read_key()
    geom = json.loads((RAW / "boundary.json").read_text(encoding="utf-8"))["elements"][0]["geometry"]
    lats = [p["lat"] for p in geom]
    lons = [p["lon"] for p in geom]
    dlat = MARGIN_M / 111320
    dlon = MARGIN_M / (111320 * math.cos(math.radians(sum(lats) / len(lats))))
    box = f"BOX({min(lons) - dlon},{min(lats) - dlat},{max(lons) + dlon},{max(lats) + dlat})"

    features, page, total = [], 1, None
    while True:
        params = dict(service="data", request="GetFeature", data="LT_C_SPBD", key=key, domain=DOMAIN,
                      geomFilter=box, size=str(PAGE_SIZE), page=str(page), format="json",
                      geometry="true", attribute="true", crs="EPSG:4326")
        url = API + "?" + urllib.parse.urlencode(params)
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "jnu-late-race/1.0 (student project)"})
                with urllib.request.urlopen(req, timeout=90) as r:
                    data = json.loads(r.read().decode("utf-8"))
                break
            except Exception as e:  # 오류 메시지에 키가 섞이지 않게 가린다
                print(f"  {page}쪽 실패: {type(e).__name__} {str(e).replace(key, '<키>')}")
                time.sleep(2)
        else:
            sys.exit("브이월드 요청 실패")
        res = data.get("response", {})
        if res.get("status") != "OK":
            sys.exit(f"브이월드 응답 오류: {res.get('status')} {res.get('error')}")
        total = int(res["page"]["total"])
        for f in res["result"]["featureCollection"]["features"]:
            p = f["properties"]
            features.append({
                "id": p.get("bd_mgt_sn"), "name": p.get("buld_nm") or "", "floors": p.get("gro_flo_co"),
                "geometry": f["geometry"],
            })
        print(f"  {page}/{total}쪽, 누적 {len(features)}동")
        if page >= total:
            break
        page += 1
    out = RAW / "vworld_buildings.json"
    out.write_text(json.dumps({"source": "국토교통부 브이월드 건물통합정보(LT_C_SPBD)", "features": features},
                              ensure_ascii=False), encoding="utf-8")
    print(f"저장 → {out.relative_to(ROOT)} ({len(features)}동)")


if __name__ == "__main__":
    main()
