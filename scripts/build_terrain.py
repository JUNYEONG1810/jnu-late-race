"""AWS Terrain Tiles(terrarium) 높이를 5m 격자로 구워 data/terrain.json에 저장한다.

사용법 (저장소 루트에서):  python scripts/build_terrain.py
먼저 scripts/fetch_terrain.py로 data/raw/terrain/ 타일을 받아 둔다. Python 표준 라이브러리만 사용.
- 범위: campus.json의 경계·건물·도로·녹지를 모두 덮는 사각형 + 여유 150m.
- 높이는 정문 앞 출발점 높이를 0으로 한 상대 높이(m). 게임 좌표 y와 같다.
- 저장 형식: 높이 × 100(cm)에서 최솟값을 뺀 값을 16비트 정수(리틀 엔디언)로 이어 붙여 base64.
  격자 (i, j)의 점 = (x0 + i·step, z0 + j·step), 순서는 j(남북) 바깥, i(동서) 안쪽.
"""
import base64
import json
import math
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import terrain_report as T  # noqa: E402  타일 읽기(Dem.at)를 같이 쓴다

ROOT = Path(__file__).resolve().parent.parent
CAMPUS = ROOT / "data" / "campus.json"
OUT = ROOT / "data" / "terrain.json"
STEP_M = 5
PAD_M = 150


def main():
    campus = json.loads(CAMPUS.read_text(encoding="utf-8"))
    o = campus["meta"]["origin"]
    kx = math.radians(1) * T.EARTH_R * math.cos(math.radians(o["lat"]))
    kz = math.radians(1) * T.EARTH_R

    pts = list(campus["boundary"])
    for b in campus["buildings"]:
        pts += b["outline"]
    for r in campus["roads"]:
        pts += r["points"]
    for g in campus["greens"]:
        pts += g["outline"]
    x0 = math.floor((min(p[0] for p in pts) - PAD_M) / STEP_M) * STEP_M
    z0 = math.floor((min(p[1] for p in pts) - PAD_M) / STEP_M) * STEP_M
    x1 = math.ceil((max(p[0] for p in pts) + PAD_M) / STEP_M) * STEP_M
    z1 = math.ceil((max(p[1] for p in pts) + PAD_M) / STEP_M) * STEP_M
    nx, nz = (x1 - x0) // STEP_M + 1, (z1 - z0) // STEP_M + 1

    dem = T.Dem()

    def height(x, z):
        return dem.at(o["lat"] - z / kz, o["lon"] + x / kx)

    sx, sz = campus["spawn"]["position"]
    base = round(height(sx, sz), 1)
    cm = [round((height(x0 + i * STEP_M, z0 + j * STEP_M) - base) * 100) for j in range(nz) for i in range(nx)]
    lo = min(cm)
    packed = struct.pack(f"<{len(cm)}H", *(v - lo for v in cm))
    out = {
        "source": "AWS Terrain Tiles (terrarium z15), 정문 앞 출발점 높이 기준 상대 높이",
        "baseElevation": base,
        "step": STEP_M, "x0": x0, "z0": z0, "nx": nx, "nz": nz,
        "offsetCm": lo,
        "data": base64.b64encode(packed).decode("ascii"),
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"격자 {nx}×{nz} = {nx * nz}점, {STEP_M}m 간격, x {x0}~{x1}, z {z0}~{z1}")
    print(f"출발점 해발 {base}m = 0, 상대 높이 {lo / 100:.1f} ~ {max(cm) / 100:.1f}m")
    print(f"저장 → {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
