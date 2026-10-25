"""건물 높이 조사: campus.json의 층수 현황을 세고 data/building-floors.csv를 만든다.

사용법 (저장소 루트에서):  python scripts/building_floors.py
- 층수 칸은 OSM building:levels가 있을 때만 채운다(출처 OSM). 없으면 비워 두고 출처 "없음" → 직접 채우는 용도.
- .env에 VWORLD_KEY가 있는지만 확인한다. 키 값은 출력하지 않는다(브이월드 연동은 키를 받은 뒤 추가).
- 정렬: 미션 장소 5곳 → 바닥 면적이 큰 순서.
"""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MISSIONS = ["농생대 1호관", "중앙도서관", "제1학생마루", "생활관 9C동 예향학사", "공과대 2호관"]


def area(o):
    return abs(sum(x1 * z2 - x2 * z1 for (x1, z1), (x2, z2) in zip(o, o[1:] + o[:1]))) / 2


def vworld_key_present():
    env = ROOT / ".env"
    if not env.exists():
        return False
    for line in env.read_text(encoding="utf-8").splitlines():
        k, _, v = line.partition("=")
        if k.strip() == "VWORLD_KEY" and v.strip():
            return True
    return False


def main():
    campus = json.loads((ROOT / "data" / "campus.json").read_text(encoding="utf-8"))
    rows = []
    stats = {"all": [0, 0, 0], "campus": [0, 0, 0]}  # [층수 있음, 높이 태그만, 기본값]
    for b in campus["buildings"]:
        if "levels" in b and b["levels"]:
            kind = 0
        elif "levels" in b:
            kind = 1
        else:
            kind = 2
        stats["all"][kind] += 1
        if not b["inCampus"]:
            continue
        stats["campus"][kind] += 1
        rows.append({
            "name": b["name"], "height": b["height"], "floors": b["levels"] if kind == 0 else "",
            "source": "OSM" if kind == 0 else "없음", "id": b["id"], "area": round(area(b["outline"])),
        })
    order = {n: i for i, n in enumerate(MISSIONS)}
    rows.sort(key=lambda r: (order.get(r["name"], len(order)), -r["area"]))

    out = ROOT / "data" / "building-floors.csv"
    with out.open("w", encoding="utf-8-sig", newline="") as f:  # 엑셀에서 한글이 깨지지 않게 BOM
        w = csv.writer(f)
        w.writerow(["건물 이름", "지금 높이(m)", "층수", "출처", "osm_id", "바닥면적(m2)"])
        for r in rows:
            w.writerow([r["name"] or "(이름 없음)", r["height"], r["floors"], r["source"], r["id"], r["area"]])

    for key, label in (("all", "전체(경계+50m)"), ("campus", "캠퍼스 안")):
        a, h, d = stats[key]
        print(f"{label}: {a + h + d}동 — 층수 있음 {a}, 높이 태그만 {h}, 기본값 14m {d}")
    print(f"VWORLD_KEY: {'있음' if vworld_key_present() else '없음 (.env에 VWORLD_KEY=... 필요)'}")
    print(f"저장: {out.relative_to(ROOT)} ({len(rows)}행)")
    print("\n위쪽 12행:")
    for r in rows[:12]:
        print(f"  {r['name'] or '(이름 없음)'} | {r['height']}m | {r['floors'] or '-'} | {r['source']} | {r['area']}m²")


if __name__ == "__main__":
    main()
