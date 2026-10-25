"""국토지리정보원 항공사진 원본(data/raw/ngii/항공사진/, 커밋 안 함)으로 건물 벽면·높이 보강 (밤샘 5단계).

필요: numpy, opencv-python(cv2). 사진은 1.1~1.3GB 압축 없는 TIFF라 통째로 읽지 않고 np.memmap으로 필요한 부분만 잘라 읽는다.

  python scripts/ngii_aerial.py register   사진마다 정사영상과 특징점(SIFT)을 맞춰 사진 픽셀 → 땅(EPSG:5186) 호모그래피
  python scripts/ngii_aerial.py heights    같은 날 겹친 사진 쌍의 시차로 건물 높이 (지붕 시차 − 둘레 땅 시차)
  python scripts/ngii_aerial.py crops      건물마다 벽이 가장 잘 보이는 사진에서 확대 조각 (ref/aerial/, 커밋 안 함) + 벽 색 픽셀 추출

결과(중간값)는 data/raw/ngii/항공사진/aerial.json에 쌓고, 사람이 본 판단은 data/building-styles.json에 근거와 함께 적는다.
메타데이터에 촬영 자세(각도·방향)가 비어 있어, 사진 중심을 주점·연직점으로 보고(거의 수직 촬영) 위치·방향은 정사영상과의 정합으로 구한다.
"""
import json
import math
import re
import struct
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ngii import GameTM, sheet_bbox, NGII, ROOT  # noqa: E402

AERIAL = NGII / "항공사진"
OUT = AERIAL / "aerial.json"
CROPS = ROOT / "ref" / "aerial"
DOWN = 8          # 정합용 축소 배율 (25cm → 2m)
ORTHO_PX = 0.25   # 정사영상 픽셀 (m)
# 카메라 픽셀 크기(mm): 사진 크기로 기종을 판단 (메타데이터 카메라 칸이 비어 있는 것이 있어서)
#  25728×14592 = DMC III (3.9µm), 26460×17004 = UltraCam Eagle Mark 3 (4.0µm)
PIXEL_MM = {(14592, 25728): 0.0039, (17004, 26460): 0.004}


def tiff_info(path):
    with open(path, "rb") as f:
        head = f.read(8)
        off = struct.unpack("<I", head[4:8])[0]
        f.seek(off)
        n = struct.unpack("<H", f.read(2))[0]
        tags = {}
        for _ in range(n):
            t, ty, c, v = struct.unpack("<HHII", f.read(12))
            tags[t] = (ty, c, v)
    w, h = tags[256][2], tags[257][2]
    assert tags[259][2] == 1 and tags[277][2] == 3, "압축 없는 RGB만"
    strip = tags[273]
    if strip[1] == 1:
        start = strip[2]
    else:  # 줄마다 띠: 첫 띠 위치 (연속이라고 가정하고 아래에서 확인)
        with open(path, "rb") as f:
            f.seek(strip[2])
            offs = struct.unpack(f"<{strip[1]}I", f.read(4 * strip[1]))
        assert all(offs[i + 1] - offs[i] == w * 3 for i in range(min(50, len(offs) - 1))), "띠가 연속이 아님"
        start = offs[0]
    return w, h, start


def open_photo(path):
    w, h, start = tiff_info(path)
    return np.memmap(path, np.uint8, "r", offset=start, shape=(h, w, 3))


def meta(xml_path):
    s = xml_path.read_text(encoding="utf-8")
    g = lambda t: (re.search(f"<{t}>(.*?)</{t}>", s) or [None, ""])[1]
    return {"id": g("메타데이터파일식별자"), "focal_mm": float(g("렌즈초점거리") or 0), "date": g("촬영일자"),
            "course": g("촬영코스번호"), "photo": g("사진번호"), "center_tm": [float(g("원점X좌표") or 0), float(g("원점Y좌표") or 0)]}


def photos():
    out = []
    for p in sorted(AERIAL.glob("*항공사진_*.tif")):
        pid = p.stem.split("_")[-1]
        m = meta(next(AERIAL.glob(f"*메타데이터_{pid}.xml")))
        w, h, _ = tiff_info(p)
        m.update(path=str(p), w=w, h=h, pixel_mm=PIXEL_MM.get((w, h)))
        out.append(m)
    return out


# ---------- 정사영상 모자이크 (2m 픽셀, 캠퍼스 둘레) ----------

def ortho_mosaic(bounds, px=ORTHO_PX * DOWN):
    """bounds: (minE, minN, maxE, maxN) → (회색조 이미지, (E0, N0, px)), 위가 북쪽"""
    E0, N0 = bounds[0], bounds[3]
    W, H = int((bounds[2] - bounds[0]) / px), int((bounds[3] - bounds[1]) / px)
    img = np.zeros((H, W, 3), np.uint8)
    for p in sorted((NGII / "정사영상").glob("*.tif")):
        sheet = p.stem.split("_")[-1]
        minE, minN, maxE, maxN = sheet_bbox(sheet)
        e0, n0 = minE - 50, maxN + 50
        m = open_photo(p)
        step = int(round(px / ORTHO_PX))
        # 모자이크 픽셀 중심의 TM → 타일 픽셀
        cols = ((E0 + (np.arange(W) + 0.5) * px) - e0) / ORTHO_PX
        rows = (n0 - (N0 - (np.arange(H) + 0.5) * px)) / ORTHO_PX
        ci, ri = cols.astype(int), rows.astype(int)
        okc = (ci >= 0) & (ci < m.shape[1]); okr = (ri >= 0) & (ri < m.shape[0])
        if not okc.any() or not okr.any():
            continue
        sub = m[ri[okr]][:, ci[okc]]  # 필요한 줄·칸만
        tgt = img[np.ix_(okr, okc)]
        mask = sub.sum(axis=2) > 0
        tgt[mask] = sub[mask]
        img[np.ix_(okr, okc)] = tgt
        del m
    return img, (E0, N0, px)


def gray(img):
    g = cv2.cvtColor(np.ascontiguousarray(img), cv2.COLOR_RGB2GRAY)
    return cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(g)


def register():
    tm = GameTM()
    campus = json.loads((ROOT / "data" / "campus.json").read_text(encoding="utf-8"))
    pts = [tm.to_tm(x, z) for b in campus["buildings"] if b.get("inCampus") for x, z in b["outline"]]
    E = [p[0] for p in pts]; N = [p[1] for p in pts]
    bounds = (min(E) - 600, min(N) - 600, max(E) + 600, max(N) + 600)
    ortho, (E0, N0, opx) = ortho_mosaic(bounds)
    (AERIAL / "ortho_mosaic_2m.jpg").write_bytes(cv2.imencode(".jpg", cv2.cvtColor(ortho, cv2.COLOR_RGB2BGR))[1].tobytes())
    og = gray(ortho)
    sift = cv2.SIFT_create(nfeatures=12000)
    ko, do = sift.detectAndCompute(og, None)
    print("정사영상 특징점", len(ko))
    out = {"bounds": bounds, "photos": {}}
    for ph in photos():
        m = open_photo(ph["path"])
        small = np.ascontiguousarray(m[::DOWN, ::DOWN])
        del m
        pg = gray(small)
        kp, dp = sift.detectAndCompute(pg, None)
        matches = cv2.BFMatcher().knnMatch(dp, do, k=2)
        good = [a for a, b in matches if a.distance < 0.75 * b.distance]
        src = np.float32([kp[g.queryIdx].pt for g in good]) * DOWN + (DOWN - 1) / 2  # 원본 픽셀
        dst = np.float32([[E0 + ko[g.trainIdx].pt[0] * opx, N0 - ko[g.trainIdx].pt[1] * opx] for g in good])
        Hm, inl = cv2.findHomography(src, dst, cv2.RANSAC, 6.0, maxIters=20000)
        ninl = int(inl.sum()) if inl is not None else 0
        # 잔차(m)
        res = None
        if Hm is not None and ninl:
            pr = cv2.perspectiveTransform(src[inl.ravel() == 1][None], Hm)[0]
            res = float(np.median(np.linalg.norm(pr - dst[inl.ravel() == 1], axis=1)))
        c = cv2.perspectiveTransform(np.float32([[[ph["w"] / 2, ph["h"] / 2]]]), Hm)[0][0] if Hm is not None else None
        # 사진 중심 둘레 1픽셀의 땅 크기 (m/px)
        if Hm is not None:
            q = cv2.perspectiveTransform(np.float32([[[ph["w"] / 2, ph["h"] / 2], [ph["w"] / 2 + 100, ph["h"] / 2]]]), Hm)[0]
            gsd = float(np.linalg.norm(q[1] - q[0]) / 100)
        else:
            gsd = None
        print(ph["id"], "맞춘 점", len(good), "인라이어", ninl, "잔차(m)", res and round(res, 2), "중심", c is not None and np.round(c).tolist(),
              "메타 중심", ph["center_tm"], "GSD", gsd and round(gsd, 4))
        out["photos"][ph["id"]] = {**ph, "H": Hm.tolist() if Hm is not None else None, "inliers": ninl, "matches": len(good),
                                   "residual_m": res, "center_ground": c.tolist() if c is not None else None, "gsd": gsd}
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


MIN_INLIERS = 100   # 이보다 적게 맞으면 그 사진은 쓰지 않음
GRID = 0.2          # 땅 격자 (m/px)
MARGIN = 45.0       # 건물 둘레 여유 (m): 높은 건물이 기울어 보이는 만큼
H_MAX = 70.0        # 찾는 높이 범위 (m)


def good_photos(reg):
    return {k: v for k, v in reg["photos"].items() if v["H"] and v["inliers"] >= MIN_INLIERS}


def candidates(min_floors=3):
    tm = GameTM()
    campus = json.loads((ROOT / "data" / "campus.json").read_text(encoding="utf-8"))
    styles = json.loads((ROOT / "data" / "building-styles.json").read_text(encoding="utf-8"))
    out = []
    for b in campus["buildings"]:
        if not b.get("inCampus"):
            continue
        st = styles.get(b["id"], {})
        floors = st.get("floors") or b.get("floors") or 0
        if floors < min_floors or st.get("canopy"):
            continue
        poly = [tm.to_tm(x, z) for x, z in b["outline"]]
        out.append({"id": b["id"], "name": b.get("name", ""), "floors": floors, "height": b["height"], "source": b.get("floorsSource"),
                    "poly": poly, "holes": [[tm.to_tm(x, z) for x, z in h] for h in b.get("holes", [])]})
    return out


def to_photo(Hinv, pts):
    return cv2.perspectiveTransform(np.float32(pts)[None], Hinv)[0]


def warp_to_ground(photo, H, region, grid=GRID):
    """photo(memmap)의 땅 사각형 region=(E0, N0, E1, N1)을 grid m/px 격자로 (위가 북쪽). 필요한 사진 조각만 읽는다"""
    E0, N0, E1, N1 = region
    W, Hh = int((E1 - E0) / grid), int((N1 - N0) / grid)
    corners = [[E0, N1], [E1, N1], [E1, N0], [E0, N0]]
    Hinv = np.linalg.inv(np.array(H))
    pc = to_photo(Hinv, corners)
    x0, y0 = np.floor(pc.min(axis=0)).astype(int) - 4
    x1, y1 = np.ceil(pc.max(axis=0)).astype(int) + 4
    if x0 < 0 or y0 < 0 or x1 >= photo.shape[1] or y1 >= photo.shape[0]:
        return None
    crop = np.ascontiguousarray(photo[y0:y1, x0:x1])
    # 격자 픽셀 (c, r) → 땅 (E, N) → 사진 → 조각
    G2E = np.array([[grid, 0, E0], [0, -grid, N1], [0, 0, 1]], np.float64)
    T = np.array([[1, 0, -x0], [0, 1, -y0], [0, 0, 1]], np.float64)
    M = T @ Hinv @ G2E
    return cv2.warpPerspective(crop, M, (W, Hh), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_CONSTANT)


def poly_mask(shape, region, polys, grid=GRID, holes=()):
    E0, N0, E1, N1 = region
    m = np.zeros(shape[:2], np.uint8)
    to = lambda pts: np.int32([[(e - E0) / grid, (N1 - n) / grid] for e, n in pts])
    for p in polys:
        cv2.fillPoly(m, [to(p)], 255)
    for h in holes:
        cv2.fillPoly(m, [to(h)], 0)
    return m


def ncc(a, b, mask):
    a = a[mask].astype(np.float32); b = b[mask].astype(np.float32)
    if a.size < 200:
        return -1
    a -= a.mean(); b -= b.mean()
    d = math.sqrt(float((a * a).sum() * (b * b).sum()))
    return float((a * b).sum() / d) if d > 0 else -1


def shifted(img, dx, dy):
    M = np.float32([[1, 0, dx], [0, 1, dy]])
    return cv2.warpAffine(img, M, (img.shape[1], img.shape[0]), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)


def height_scan(A, B, mask, si, sj, grid=GRID, hs=None):
    """A·B: 두 사진을 땅 격자로 편 것(회색조). si·sj: 높이 1m당 그 사진에서 보이는 밀림(땅 m, (dE, dN)).
    높이 h를 가정하고 두 사진을 그만큼 되돌려 mask 안이 가장 닮는 h를 찾는다. 돌려줌: (h, 최고 NCC, 곡선)"""
    hs = hs if hs is not None else np.arange(0, H_MAX + 0.01, 0.5)
    curve = []
    for h in hs:
        # 지붕이 si*h만큼 밀려 보이므로 -si*h 만큼 옮겨 제자리로 (격자: x=동쪽, y=남쪽)
        a = shifted(A, -si[0] * h / grid, si[1] * h / grid)
        b = shifted(B, -sj[0] * h / grid, sj[1] * h / grid)
        curve.append(ncc(a, b, mask > 0))
    k = int(np.argmax(curve))
    # 둘레 점으로 꼭짓점 보간
    hb = float(hs[k])
    if 0 < k < len(hs) - 1:
        y0, y1, y2 = curve[k - 1], curve[k], curve[k + 1]
        den = y0 - 2 * y1 + y2
        if den < 0:
            hb += float(hs[1] - hs[0]) * 0.5 * (y0 - y2) / den
    return hb, float(curve[k]), curve


def heights():
    reg = json.loads(OUT.read_text(encoding="utf-8"))
    ph = good_photos(reg)
    mm = {k: open_photo(v["path"]) for k, v in ph.items()}
    res = reg.setdefault("buildings", {})
    only = sys.argv[2:]  # 시험: 건물 id 몇 개만
    for b in candidates(3):
        if only and b["id"] not in only and b["name"] not in only:
            continue
        E = [p[0] for p in b["poly"]]; N = [p[1] for p in b["poly"]]
        cE, cN = (min(E) + max(E)) / 2, (min(N) + max(N)) / 2
        region = (min(E) - MARGIN, min(N) - MARGIN, max(E) + MARGIN, max(N) + MARGIN)
        # 이 건물이 들어 있는 사진들 (여유 포함 사각형이 사진 안)
        inside = {}
        for k, v in ph.items():
            Hinv = np.linalg.inv(np.array(v["H"]))
            pc = to_photo(Hinv, [[region[0], region[1]], [region[2], region[3]], [region[0], region[3]], [region[2], region[1]]])
            if (pc[:, 0] > 50).all() and (pc[:, 0] < v["w"] - 50).all() and (pc[:, 1] > 50).all() and (pc[:, 1] < v["h"] - 50).all():
                inside[k] = v
        entry = {"name": b["name"], "floors": b["floors"], "game_h": b["height"], "source": b["source"], "photos": sorted(inside)}
        if len(inside) < 2:
            entry["note"] = "겹친 사진이 2장보다 적음"
            res[b["id"]] = entry
            print(b["id"], b["name"], entry["note"])
            continue
        # 기선이 가장 긴 쌍
        keys = sorted(inside)
        pairs = sorted(((i, j) for i in keys for j in keys if i < j),
                       key=lambda p: -math.dist(inside[p[0]]["center_ground"], inside[p[1]]["center_ground"]))
        i, j = pairs[0]
        Pi, Pj = inside[i], inside[j]
        # 높이 1m당 밀림: (P - N) / H,  H = 초점거리(px) × GSD
        def per_m(v):
            Hfly = (v["focal_mm"] / v["pixel_mm"]) * v["gsd"]
            return ((cE - v["center_ground"][0]) / Hfly, (cN - v["center_ground"][1]) / Hfly), Hfly
        si, Hi = per_m(Pi); sj, Hj = per_m(Pj)
        A = warp_to_ground(mm[i], Pi["H"], region); B = warp_to_ground(mm[j], Pj["H"], region)
        if A is None or B is None:
            entry["note"] = "조각을 읽지 못함"
            res[b["id"]] = entry
            continue
        Ag, Bg = gray(A), gray(B)
        roof = poly_mask(Ag.shape, region, [b["poly"]], holes=b["holes"])
        roof = cv2.erode(roof, np.ones((7, 7), np.uint8))  # 가장자리 1.4m 안쪽만
        # 둘레 땅 고리: 건물 바깥 4~14m, 다른 건물(campus 전체)은 뺌
        ring = cv2.dilate(poly_mask(Ag.shape, region, [b["poly"]]), np.ones((141, 141), np.uint8))
        ring[cv2.dilate(poly_mask(Ag.shape, region, [b["poly"]]), np.ones((41, 41), np.uint8)) > 0] = 0
        others = poly_mask(Ag.shape, region, [c["poly"] for c in ALL_POLYS if c["id"] != b["id"]])
        ring[cv2.dilate(others, np.ones((41, 41), np.uint8)) > 0] = 0
        h_roof, c_roof, _ = height_scan(Ag, Bg, roof, si, sj)
        h_ground, c_ground, _ = height_scan(Ag, Bg, ring, si, sj, hs=np.arange(-8, 8.01, 0.25)) if ring.sum() > 255 * 300 else (0.0, None, None)
        h = h_roof - h_ground
        base = math.dist(Pi["center_ground"], Pj["center_ground"])
        entry.update(pair=[i, j], baseline_m=round(base, 1), H_fly=round((Hi + Hj) / 2), h_roof=round(h_roof, 2), ncc_roof=round(c_roof, 3),
                     h_ground=round(h_ground, 2), ncc_ground=c_ground and round(c_ground, 3), h_meas=round(h, 1),
                     floors_meas=max(1, round((h - 1) / 4)))
        res[b["id"]] = entry
        print(b["id"], b["name"], b["floors"], "층", "게임", b["height"], "m → 잰 높이", round(h, 1), "m (지붕", round(h_roof, 1), "NCC", round(c_roof, 2),
              "/ 땅", round(h_ground, 2), c_ground and round(c_ground, 2), ")", "기선", round(base))
    OUT.write_text(json.dumps(reg, ensure_ascii=False, indent=1), encoding="utf-8")


ALL_POLYS = []


def photo_gains(v, mm):
    """노출 보정: 캠퍼스 둘레(사진 가운데 2/3)의 회색 세계 가정으로 채널별 배율 (빛 색 치우침만 바로잡음)"""
    h, w = v["h"], v["w"]
    s = np.asarray(mm[h // 6:h * 5 // 6:64, w // 6:w * 5 // 6:64], np.float32).reshape(-1, 3)
    m = s.mean(axis=0)
    return (m.mean() / m).tolist(), float(m.mean())


def crops():
    """건물마다 벽이 가장 잘 보이는 사진(연직점에서 가장 먼 사진)에서 확대 조각 + 바닥선(노랑)·잰 높이 지붕선(하늘색)·게임 높이 지붕선(자홍).
    보이는 벽(연직점을 향한 면) 사각형의 픽셀로 벽 색(중앙값, 노출 보정)을 뽑는다."""
    reg = json.loads(OUT.read_text(encoding="utf-8"))
    ph = good_photos(reg)
    mm = {k: open_photo(v["path"]) for k, v in ph.items()}
    gains = {k: photo_gains(v, mm[k]) for k, v in ph.items()}
    reg["gains"] = gains
    CROPS.mkdir(parents=True, exist_ok=True)
    res = reg["buildings"]
    only = sys.argv[2:]
    for b in candidates(3):
        if only and b["id"] not in only and b["name"] not in only:
            continue
        e = res.setdefault(b["id"], {"name": b["name"]})
        poly = np.array(b["poly"])
        cE, cN = poly.mean(axis=0)
        h_meas = e.get("h_meas") or b["height"]
        hmax = max(h_meas, b["height"]) + 2
        best = None
        for k, v in ph.items():
            Hfly = (v["focal_mm"] / v["pixel_mm"]) * v["gsd"]
            Nn = np.array(v["center_ground"])
            roof = poly + (poly - Nn) * (hmax / Hfly)
            Hinv = np.linalg.inv(np.array(v["H"]))
            pc = to_photo(Hinv, np.vstack([poly, roof]))
            pad = 15 / v["gsd"]
            x0, y0 = pc.min(axis=0) - pad; x1, y1 = pc.max(axis=0) + pad
            if x0 < 0 or y0 < 0 or x1 >= v["w"] or y1 >= v["h"]:
                continue
            r = math.dist((cE, cN), Nn)
            if not best or r > best[0]:
                best = (r, k, v, Hfly, Nn, Hinv, (int(x0), int(y0), int(x1), int(y1)))
        if not best:
            e["crop_note"] = "건물과 기울어진 지붕이 모두 들어가는 사진 없음"
            continue
        r, k, v, Hfly, Nn, Hinv, (x0, y0, x1, y1) = best
        img = np.ascontiguousarray(mm[k][y0:y1, x0:x1])
        g = np.array(gains[k][0], np.float32)
        img_c = np.clip(img.astype(np.float32) * g, 0, 255).astype(np.uint8)
        # 보이는 벽 사각형 (연직점을 향한 면), 잰 높이로
        wall_px = []
        n = len(poly)
        area = 0.5 * sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))
        for i in range(n):
            p1, p2 = poly[i], poly[(i + 1) % n]
            d = p2 - p1
            L = math.hypot(*d)
            if L < 4:
                continue
            out = np.array([d[1], -d[0]]) / L if area > 0 else np.array([-d[1], d[0]]) / L  # 바깥 법선
            mid = (p1 + p2) / 2
            if np.dot(Nn - mid, out) <= 0:
                continue
            hh = h_meas * 0.85
            q = np.array([p1 + (p1 - Nn) * (1.0 / Hfly), p2 + (p2 - Nn) * (1.0 / Hfly),
                          p2 + (p2 - Nn) * (hh / Hfly), p1 + (p1 - Nn) * (hh / Hfly)])  # 바닥 1m 위 ~ 높이 85%
            wall_px.append(to_photo(Hinv, q) - [x0, y0])
        col = None
        if wall_px:
            mask = np.zeros(img.shape[:2], np.uint8)
            cv2.fillPoly(mask, [np.int32(q) for q in wall_px], 255)
            px = img_c[mask > 0]
            if len(px) > 50:
                col = np.median(px, axis=0)
                e["wall_rgb"] = [int(c) for c in col]
                e["wall_px"] = int(len(px))
        # 그림: 바닥선·지붕선
        out_img = cv2.cvtColor(img_c, cv2.COLOR_RGB2BGR)
        sc = min(1.0, 640 / max(out_img.shape[:2]))
        if sc < 1:
            out_img = cv2.resize(out_img, None, fx=sc, fy=sc, interpolation=cv2.INTER_AREA)
        def draw(pts, color, th=1):
            p = (to_photo(Hinv, pts) - [x0, y0]) * sc
            cv2.polylines(out_img, [np.int32(p)], True, color, th, cv2.LINE_AA)
        draw(poly, (0, 230, 255))
        draw(poly + (poly - Nn) * (b["height"] / Hfly), (255, 0, 255))
        if e.get("h_meas"):
            draw(poly + (poly - Nn) * (e["h_meas"] / Hfly), (255, 255, 0))
        for q in wall_px:
            cv2.polylines(out_img, [np.int32(q * sc)], True, (0, 140, 255), 1, cv2.LINE_AA)
        # 가장 넓게 보이는 벽 하나를 원본 해상도로 확대해 오른쪽에 붙임 (벽 재료·창 판단용)
        if wall_px:
            big = max(wall_px, key=lambda q: cv2.contourArea(np.float32(q)))
            bx0, by0 = np.maximum(big.min(axis=0) - 25, 0).astype(int)
            bx1, by1 = np.minimum(big.max(axis=0) + 25, [img.shape[1] - 1, img.shape[0] - 1]).astype(int)
            z = cv2.cvtColor(img_c[by0:by1, bx0:bx1], cv2.COLOR_RGB2BGR)
            if z.size:
                zs = min(3.0, 640 / max(z.shape[:2]))
                z = cv2.resize(z, None, fx=zs, fy=zs, interpolation=cv2.INTER_CUBIC if zs > 1 else cv2.INTER_AREA)
                Hh = max(out_img.shape[0], z.shape[0])
                canvas = np.full((Hh, out_img.shape[1] + 8 + z.shape[1], 3), 255, np.uint8)
                canvas[:out_img.shape[0], :out_img.shape[1]] = out_img
                canvas[:z.shape[0], out_img.shape[1] + 8:] = z
                out_img = canvas
        name = f"{b['id']}.jpg"
        (CROPS / name).write_bytes(cv2.imencode(".jpg", out_img, [cv2.IMWRITE_JPEG_QUALITY, 88])[1].tobytes())  # 한글 경로라 imwrite 대신
        e.update(crop=name, crop_photo=k, crop_r_m=round(r), crop_scale=round(sc, 3))
        print(b["id"], b["name"], "사진", k[-4:], "연직점에서", round(r), "m", "벽색", e.get("wall_rgb"))
    OUT.write_text(json.dumps(reg, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    if sys.argv[1] == "heights":
        ALL_POLYS = candidates(0)
    {"register": register, "heights": heights, "crops": crops}[sys.argv[1]]()
