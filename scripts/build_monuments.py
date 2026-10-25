"""조형물·기념물 27개의 형태·크기·재료와 근거를 data/monuments.json으로.

사용법:  python scripts/build_monuments.py
- 근거: OSM 태그(data/raw/features.json), 국토지리정보원 정사영상(2025, 25cm; ref/monuments/sheet_N.png 칸으로 확인),
  위키미디어 공용 사진(용봉탑만 있음). 위키미디어에서 이름으로 검색한 결과 다른 기념물 사진은 없었고,
  전남대 5·18 사적지 안내 사이트(518trail.jnu.ac.kr)는 robots.txt가 막아 보지 않았다.
- 근거 등급: "확실(사진)" / "준확실(정사영상·태그)" / "근거 없음". 근거가 없는 값은 단순한 기본 형태·크기.
- 정사영상에서 읽은 값(OSM 점에서 떨어진 거리 dx·dz, 지름·길이)은 0.07 m/px 조각에서 눈으로 잰 것(±0.5m).
- 바닥 포장·화단 색은 정사영상 픽셀 중앙값(자동), 지붕색과 같은 화이트 밸런스 보정(정사영상의 청록빛 빼기).
Python 표준 라이브러리만 사용.
"""
import json
import math
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ngii  # noqa: E402

ROOT = ngii.ROOT
OUT = ROOT / "data" / "monuments.json"
ORTHO = "국토지리정보원 정사영상 2025 (ref/monuments/sheet_{s}.png {k}번 칸)"
YB_PHOTO = '위키미디어 공용 "CNU Yongbong Tower.JPG" (Wikicnu, CC BY 3.0, 2010)'
NONE = "근거 없음"

# 번호는 campus.json monuments 순서(1부터). 형태 종류:
# tower 용봉탑 / stele 비석 / bust 흉상 / statue 동상 / stoneFigure 석인 / jangseung 장승 / group 군상 /
# sculpture 추상 조형물 / installation 설치물 / mural 벽화 / plaza 기념 공간(바닥만)
SPEC = {
    1: dict(form="stele", note="정사영상 범위 밖(서쪽 끝)", grade=NONE),
    2: dict(form="group", dx=-3.8, dz=-2.7, base=dict(shape="round", d=4.5, h=0.5), figures=3, material="stone",
            grade="준확실(정사영상·태그)",
            evidence={"위치·바닥": "정사영상: OSM 점에서 서쪽 3.8m에 지름 약 4.5m의 흰 원형 받침", "재료": "OSM material=stone, artwork_type=statue",
                      "인물 수·자세·높이": NONE + " (사진 없음 → 단순한 인물 실루엣 3개, 사람 키)"}),
    3: dict(form="sculpture", material="stone", grade="준확실(정사영상·태그)",
            evidence={"재료·종류": "OSM material=stone, artwork_type=sculpture", "형태·크기": NONE + " (정사영상에서 식별 안 됨)"}),
    4: dict(form="stele", material="stone", grade="준확실(정사영상·태그)",
            evidence={"종류": "OSM historic=memorial, memorial=stone", "형태·크기": NONE + " (정사영상에서 나무에 가림)"}),
    5: dict(form="stele", dx=-1.8, dz=1.8, length=8.7, width=1.7, angle=46, material="stone", grade="준확실(정사영상·태그)",
            evidence={"바닥 크기·방향": "정사영상: 길이 약 8.7m × 폭 1.7m의 흰 돌 판이 북동-남서로 놓임", "재료": "OSM material=stone",
                      "높이": NONE + " (기본 1.5m)"}),
    6: dict(form="bust", grade="준확실(정사영상·태그)",
            evidence={"종류": "OSM artwork_type=bust (작가 최은태)", "재료·크기·자세": NONE + " (사진 없음 → 받침대 + 매끈한 흉상, 실물 크기)",
                      "주변": "정사영상: 나무 아래, 옆에 OSM 기념 공간(27번)"}),
    7: dict(form="installation", dx=-2.6, dz=-1.1, d=3.5, colors=True, grade="준확실(정사영상·태그)",
            evidence={"위치·크기·색": "정사영상: 잔디밭에 지름 약 3.5m로 노랑·주황·흰 작은 조각들이 모여 있음", "형태·높이": NONE + " (낮은 꽃잎 모양 덩이로 단순화)"}),
    8: dict(form="tower", dx=-5.0, dz=1.8, height=17, material="bronze", grade="확실(사진)",
            colors={"body": "#404848", "base": "#b2afa4"},
            evidence={"형태·재료·색": YB_PHOTO + " — 높은 흰 돌 받침(위에 비스듬한 돌 판) 위 짙은 청동 몸체(둥근 마디가 엉킨 모양), 꼭대기에 목이 길고 꼬리 깃이 부채처럼 펼쳐진 새. 색은 사진 픽셀",
                      "위치": "정사영상: OSM 점에서 서쪽 5m에 밝은 받침",
                      "높이": "추정(사진) — 받침 폭 약 3.6m를 자로 삼은 사진 비례: 받침 약 6m, 청동 몸체 약 8.6m, 새 약 2m, 전체 약 17m",
                      "넣지 않은 것": "사진 속 받침 앞 낮은 비스듬한 돌 벽은 정확한 자리를 몰라 넣지 않음",
                      "표현": "몸체의 인물 모양은 얼굴 없이 둥근 마디 기둥으로 단순화"}),
    9: dict(form="stele", dx=-2.0, dz=0.3, material="metal", grade="준확실(정사영상·태그)",
            evidence={"위치": "정사영상: OSM 점 서쪽 2m에 약 1.2m 크기 갈색 물체", "재료": "OSM material=metal", "형태·높이": NONE}),
    10: dict(form="mural", grade="준확실(정사영상·태그)",
             evidence={"종류": "OSM artwork_type=mural (건물 벽 옆)", "그림·크기": NONE + " (안내 사이트는 robots.txt로 막혀 보지 않음)"}),
    11: dict(form="stele", material="stone", grade="준확실(정사영상·태그)",
             evidence={"재료": "OSM material=stone, memorial=stone", "형태·크기": NONE + " (정사영상의 흰 상자 모양이 비석인지 설비인지 확실하지 않아 쓰지 않음)"}),
    12: dict(form="stoneFigure", material="stone", grade="준확실(정사영상·태그)",
             evidence={"종류·재료": "OSM artwork_type=statue, material=stone", "형태·크기": NONE + " (정사영상에서 1m 남짓한 회색 물체만 보임)"}),
    13: dict(form="stoneFigure", grade="준확실(정사영상·태그)",
             evidence={"종류": "OSM artwork_type=statue", "재료·형태·크기": NONE}),
    14: dict(form="jangseung", material="stone", grade="준확실(정사영상·태그)",
             evidence={"종류·재료": "OSM artwork_type=statue, material=stone, 이름 석장승", "형태·크기": NONE + " (정사영상에서 작은 회색 물체만 보임)"}),
    15: dict(form="jangseung", material="stone", grade="준확실(정사영상·태그)",
             evidence={"종류·재료": "OSM artwork_type=statue, material=stone, 이름 석장승", "형태·크기": NONE}),
    16: dict(form="stele", dx=-3.9, dz=-0.3, material="stone", plaza=dict(shape="rings", d=10.5, rings=[5.2, 3.6, 2.2]),
             grade="준확실(정사영상·태그)",
             evidence={"바닥": "정사영상: 지름 약 10.5m 원형 포장에 동심원 띠 3개, 가운데 약 2m 물체", "재료": "OSM material=stone",
                       "비석 형태·높이": NONE}),
    17: dict(form="sculpture", dx=-3.4, dz=-0.2, base=dict(shape="round", d=4.2, h=0.5), grade="준확실(정사영상·태그)",
             evidence={"받침": "정사영상: 붉은 벽돌 포장 광장 안 지름 약 4.2m 원형 받침", "종류": "OSM artwork_type=sculpture", "형태·재료·높이": NONE}),
    18: dict(form="sculpture", material="stone", grade="준확실(정사영상·태그)",
             evidence={"종류·재료": "OSM artwork_type=sculpture, material=stone (작가 최규철)", "형태·크기": NONE + " (정사영상에서 식별 안 됨)"}),
    19: dict(form="bust", grade="준확실(정사영상·태그)",
             evidence={"종류": "OSM artwork_type=bust", "재료·크기": NONE + " (사진 없음 → 받침대 + 매끈한 흉상)"}),
    20: dict(form="sculpture", grade=NONE, evidence={"종류": "OSM artwork_type=sculpture (이름 없음)", "형태": NONE + " (나무에 가림)"}),
    21: dict(form="sculpture", grade=NONE, evidence={"종류": "OSM artwork_type=sculpture (이름 없음)", "형태": NONE + " (나무·주차장)"}),
    22: dict(form="stele", material="stone", grade="준확실(정사영상·태그)",
             evidence={"재료·글자": "OSM material=stone, inscription 있음(게임에 넣지 않음)", "형태·크기": NONE}),
    23: dict(form="statue", material="metal", grade="준확실(정사영상·태그)",
             evidence={"종류·재료": "OSM artwork_type=statue, material=metal (작가 김행신)", "자세·크기": NONE + " (사진 없음 → 받침대 + 선 자세 인물 실루엣, 사람 키)"}),
    24: dict(form="mural", grade=NONE, evidence={"종류": "OSM artwork_type=mural (선 3점, 이름 없음)", "그림": NONE + " (나무에 가림)"}),
    25: dict(form="plaza", plaza=dict(shape="osm"), grade="준확실(정사영상·태그)",
             evidence={"바닥": "OSM 외곽선 + 정사영상: 지름 약 7m 둥근 화단 섬, 안에 작은 흰 물체들", "기념물 형태": NONE}),
    26: dict(form="plaza", plaza=dict(shape="osm"), grade="준확실(정사영상·태그)",
             evidence={"바닥": "OSM 외곽선 + 정사영상: 둥근 잔디 둘레의 포장 고리", "기념물 형태": NONE}),
    27: dict(form="plaza", plaza=dict(shape="osm"), grade="준확실(정사영상·태그)",
             evidence={"바닥": "OSM 외곽선 + 정사영상: 윤상원 열사 흉상 옆 포장 공간, 둥근 화분 여러 개", "기념물 형태": NONE}),
}

WB = (125.3 / 106, 125.3 / 133, 125.3 / 137)  # scripts/ngii_buildings.py와 같은 보정
MATERIAL_COLOR = {"stone": "#cfcac0", "metal": "#5b5a4f", "bronze": "#404848"}


def ortho_median(g, o, pts):
    cols = [o.rgb(*g.to_tm(x, z)) for x, z in pts]
    cols = [c for c in cols if c]
    if not cols:
        return None
    return wb(tuple(statistics.median(c[i] for c in cols) for i in range(3)))


def wb(c):
    """정사영상 색 보정. 밝은 흰 돌은 보정하면 분홍으로 넘치므로 밝을수록 보정을 줄임"""
    w = min(1.0, max(0.0, (sum(c) / 3 - 150) / 70))
    return "#%02x%02x%02x" % tuple(min(255, round(c[i] * (WB[i] * (1 - w) + w))) for i in range(3))


def main():
    campus = json.loads((ROOT / "data" / "campus.json").read_text(encoding="utf-8"))
    raw = json.loads((ROOT / "data" / "raw" / "features.json").read_text(encoding="utf-8"))
    g = ngii.GameTM(campus)
    o = ngii.Ortho()
    osm = {}
    for e in raw["elements"]:
        t = e.get("tags", {})
        if t.get("tourism") == "artwork" or t.get("historic") in ("memorial", "monument"):
            osm[(e["type"], e["id"])] = e
    out = []
    for i, m in enumerate(campus["monuments"], 1):
        sp = SPEC[i]
        # 가장 가까운 OSM 요소(태그·외곽선)
        best, bd = None, 1e9
        for e in osm.values():
            if e["type"] == "node":
                x, z = g.to_game(*ngii.ll_to_tm(e["lat"], e["lon"]))
            else:
                gg = e.get("geometry") or []
                if not gg:
                    continue
                x = statistics.mean(g.to_game(*ngii.ll_to_tm(p["lat"], p["lon"]))[0] for p in gg)
                z = statistics.mean(g.to_game(*ngii.ll_to_tm(p["lat"], p["lon"]))[1] for p in gg)
            d = math.dist((x, z), m["p"])
            if d < bd:
                best, bd = e, d
        tags = {k: v for k, v in best.get("tags", {}).items()}
        cx, cz = m["p"][0] + sp.get("dx", 0), m["p"][1] + sp.get("dz", 0)
        rec = {"no": i, "name": m["name"], "osm": f"{best['type'][0]}{best['id']}", "tags": tags, "p": [round(cx, 1), round(cz, 1)],
               "form": sp["form"], "grade": sp["grade"], "evidence": sp.get("evidence", {"형태": NONE + (" — " + sp["note"] if sp.get("note") else "")}),
               "source": []}
        mat = sp.get("material") or tags.get("material")
        rec["material"] = mat or None
        body = sp["colors"].get("body") if isinstance(sp.get("colors"), dict) else None
        rec["color"] = body or MATERIAL_COLOR.get(mat or "", "#cfcac0" if sp["form"] not in ("bust", "statue") else "#5b5a4f")
        if sp["form"] in ("bust", "statue") and not mat:
            rec["evidence"]["재료"] = NONE + " (청동색 기본값)"
        for k in ("length", "width", "angle", "height", "figures", "d"):
            if k in sp:
                rec[k] = sp[k]
        if "base" in sp:
            b = dict(sp["base"])
            ring = [(cx + math.cos(a / 12 * math.pi * 2) * b["d"] / 2 * 0.7, cz + math.sin(a / 12 * math.pi * 2) * b["d"] / 2 * 0.7) for a in range(12)]
            b["color"] = ortho_median(g, o, ring) if sp["grade"] != NONE else None
            rec["base"] = b
        if sp.get("colors") is True:  # 피어나다: 조각 색을 정사영상에서
            pts = [(cx + dx * 0.5, cz + dz * 0.5) for dx in range(-3, 4) for dz in range(-3, 4)]
            cols = [o.rgb(*g.to_tm(x, z)) for x, z in pts]
            # 잔디(초록이 가장 큰 픽셀)를 빼고 채도 높은 것 = 조각
            bright = sorted([c for c in cols if c and max(c) - min(c) > 40 and c[1] < max(c[0], c[2]) + 5], key=lambda c: -sum(c))[:4]
            rec["pieceColors"] = [wb(c) for c in bright]
            if not rec["pieceColors"]:
                rec["pieceColors"] = ["#d8b04a", "#d77a3a", "#e8e4dc"]
                rec["evidence"]["색"] = NONE + " (픽셀에서 못 골라 기본 노랑·주황·흰색)"
        if isinstance(sp.get("colors"), dict):
            rec["baseColor"] = sp["colors"]["base"]
        if "plaza" in sp:
            pl = dict(sp["plaza"])
            if pl["shape"] == "osm":
                pl["outline"] = [[round(v, 2) for v in g.to_game(*ngii.ll_to_tm(p["lat"], p["lon"]))] for p in best["geometry"]]
                ring = pl["outline"]
                pl["color"] = ortho_median(g, o, [((ring[k][0] + ring[(k + 1) % len(ring)][0]) / 2, (ring[k][1] + ring[(k + 1) % len(ring)][1]) / 2) for k in range(len(ring))])
                inner = [(statistics.mean(p[0] for p in ring) + dx, statistics.mean(p[1] for p in ring) + dz) for dx in (-1, 0, 1) for dz in (-1, 0, 1)]
                pl["innerColor"] = ortho_median(g, o, inner)
                # 초록(잔디·나무 그늘)이면 포장으로 칠하지 않고 땅을 그대로 둠
                for k in ("color", "innerColor"):
                    h = pl.get(k)
                    rgb = [int(h[i:i + 2], 16) for i in (1, 3, 5)] if h else None
                    if rgb and (rgb[1] > max(rgb[0], rgb[2]) + 8 or sum(rgb) / 3 < 100):
                        pl[k] = None
                        rec["evidence"]["바닥 색"] = "정사영상 색이 잔디·나무 그늘(초록 또는 어두움)인 곳은 포장으로 칠하지 않음"
            else:
                pl["color"] = ortho_median(g, o, [(cx + math.cos(a / 16 * math.pi * 2) * pl["d"] / 2 * 0.85, cz + math.sin(a / 16 * math.pi * 2) * pl["d"] / 2 * 0.85) for a in range(16)])
                pl["ringColor"] = ortho_median(g, o, [(cx + math.cos(a / 16 * math.pi * 2) * pl["rings"][0], cz + math.sin(a / 16 * math.pi * 2) * pl["rings"][0]) for a in range(16)])
            rec["plaza"] = pl
        src = ["OpenStreetMap 태그 (ODbL)"]
        if sp["grade"] != NONE or sp.get("dx"):
            sheet, slot = (i - 1) // 8 + 1, (i - 1) % 8 + 1
            src.append(ORTHO.format(s=sheet, k=slot))
        if sp["form"] == "tower":
            src.append(YB_PHOTO)
        rec["source"] = src
        out.append(rec)
    OUT.write_text(json.dumps({
        "_설명": "조형물·기념물 형태·크기·재료와 근거. 등급: 확실(사진) / 준확실(정사영상·태그) / 근거 없음. 근거 없는 값은 단순한 기본 형태·크기. 이름표는 OSM의 공식 이름만.",
        "monuments": out}, ensure_ascii=False, indent=1), encoding="utf-8")
    from collections import Counter
    print(Counter(r["grade"] for r in out), "→", OUT.relative_to(ROOT))


if __name__ == "__main__":
    main()
