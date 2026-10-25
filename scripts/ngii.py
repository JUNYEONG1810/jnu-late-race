"""국토지리정보원 자료(data/raw/ngii/) 읽기 도우미. Python 표준 라이브러리만 사용.

- 정사영상(2025, 25cm, 도엽 35616027·35616037): 압축 없는 RGB TIFF. 좌표 태그·월드 파일이 없어
  도엽 경계(1:5,000 도엽 = 1'30" 사각형)를 중부원점 TM(EPSG:5186)으로 바꾼 사각형 + 바깥 여유 50m를 영상 범위로 본다.
  (영상 크기 2379m가 도엽 폭 2279m + 100m와 맞음. 수치지도 건물 외곽선을 겹쳐 맞는지 검증한다.)
- 수치지도 2025 1:5,000: 셰이프파일(N3A 면, N3L 선, N3P 점), 속성은 cp949 DBF.
- 좌표: 게임 좌표(x 동쪽, z 남쪽, campus.json meta.origin 기준 m) ↔ 위경도 ↔ EPSG:5186.
"""
import json
import math
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NGII = ROOT / "data" / "raw" / "ngii"
EARTH_R = 6378137.0

# ---------- 좌표 ----------

_A, _F = 6378137.0, 1 / 298.257222101
_E2 = _F * (2 - _F)
_EP2 = _E2 / (1 - _E2)


def _M(p):
    e2 = _E2
    return _A * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * p
                 - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * math.sin(2 * p)
                 + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * math.sin(4 * p)
                 - (35 * e2 ** 3 / 3072) * math.sin(6 * p))


def ll_to_tm(lat, lon, lat0=38.0, lon0=127.0, k0=1.0, fe=200000.0, fn=600000.0):
    """위경도 → 횡메르카토르 (기본: EPSG:5186 중부원점)"""
    p, l = math.radians(lat), math.radians(lon)
    N = _A / math.sqrt(1 - _E2 * math.sin(p) ** 2)
    t = math.tan(p) ** 2
    C = _EP2 * math.cos(p) ** 2
    A = (l - math.radians(lon0)) * math.cos(p)
    x = fe + k0 * N * (A + (1 - t + C) * A ** 3 / 6 + (5 - 18 * t + t * t + 72 * C - 58 * _EP2) * A ** 5 / 120)
    y = fn + k0 * (_M(p) - _M(math.radians(lat0)) + N * math.tan(p) * (
        A * A / 2 + (5 - t + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * t + t * t + 600 * C - 330 * _EP2) * A ** 6 / 720))
    return x, y


class GameTM:
    """게임 좌표 ↔ EPSG:5186. 캠퍼스 안은 아핀 변환으로 충분히 정확(1cm 미만)하다."""

    def __init__(self, campus=None):
        campus = campus or json.loads((ROOT / "data" / "campus.json").read_text(encoding="utf-8"))
        o = campus["meta"]["origin"]
        self.lat0, self.lon0 = o["lat"], o["lon"]
        self.kx = math.radians(1) * EARTH_R * math.cos(math.radians(self.lat0))
        self.kz = math.radians(1) * EARTH_R
        # 게임 (x, z) → TM (E, N) 아핀: 격자 9점으로 최소제곱
        pts = [(x, z) for x in (-1000, 0, 1000) for z in (-1000, 0, 1000)]
        tms = [self.exact(x, z) for x, z in pts]
        self.fwd = [_fit([(x, z) for x, z in pts], [t[0] for t in tms]), _fit(pts, [t[1] for t in tms])]
        self.inv = [_fit(tms, [p[0] for p in pts]), _fit(tms, [p[1] for p in pts])]

    def exact(self, x, z):
        return ll_to_tm(self.lat0 - z / self.kz, self.lon0 + x / self.kx)

    def to_tm(self, x, z):
        (a, b, c), (d, e, f) = self.fwd
        return a * x + b * z + c, d * x + e * z + f

    def to_game(self, E, N):
        (a, b, c), (d, e, f) = self.inv
        return a * E + b * N + c, d * E + e * N + f


def _fit(src, dst):
    """dst ≈ a·u + b·v + c 최소제곱"""
    S = [[0.0] * 3 for _ in range(3)]
    r = [0.0] * 3
    for (u, v), w in zip(src, dst):
        row = (u, v, 1.0)
        for i in range(3):
            r[i] += row[i] * w
            for j in range(3):
                S[i][j] += row[i] * row[j]
    # 가우스 소거
    M = [S[i] + [r[i]] for i in range(3)]
    for i in range(3):
        piv = max(range(i, 3), key=lambda k: abs(M[k][i]))
        M[i], M[piv] = M[piv], M[i]
        for k in range(3):
            if k != i:
                f = M[k][i] / M[i][i]
                M[k] = [a - f * b for a, b in zip(M[k], M[i])]
    return [M[i][3] / M[i][i] for i in range(3)]


# ---------- 정사영상 ----------

def sheet_bbox(sheet):
    """1:5,000 도엽 번호(예 35616027) → TM 사각형 (minE, minN, maxE, maxN)"""
    s = str(sheet)
    lat_deg, lon_last, cell50, cell5 = int(s[:2]), int(s[2]), int(s[3:5]), int(s[5:8])
    lon_deg = 120 + lon_last if lon_last >= 4 else 130 + lon_last
    r50, c50 = (cell50 - 1) // 4, (cell50 - 1) % 4
    top = lat_deg + 1 - r50 * 0.25
    left = lon_deg + c50 * 0.25
    r5, c5 = (cell5 - 1) // 10, (cell5 - 1) % 10
    t, l = top - r5 * 0.025, left + c5 * 0.025
    cs = [ll_to_tm(la, lo) for la in (t - 0.025, t) for lo in (l, l + 0.025)]
    return min(c[0] for c in cs), min(c[1] for c in cs), max(c[0] for c in cs), max(c[1] for c in cs)


class OrthoTile:
    MARGIN = 50.0
    PX = 0.25

    def __init__(self, path, sheet):
        self.f = open(path, "rb")
        head = self.f.read(8)
        off = struct.unpack("<I", head[4:8])[0]
        self.f.seek(off)
        d = self.f.read(4096)
        n = struct.unpack("<H", d[:2])[0]
        tags = {}
        for i in range(n):
            tag, typ, cnt, v = struct.unpack("<HHII", d[2 + i * 12:14 + i * 12])
            tags[tag] = (typ, cnt, v)
        self.w, self.h = tags[256][2], tags[257][2]
        typ, cnt, v = tags[273]
        self.f.seek(v)
        self.rows = struct.unpack(f"<{cnt}I", self.f.read(4 * cnt))
        minE, minN, maxE, maxN = sheet_bbox(sheet)
        self.e0 = minE - self.MARGIN
        self.n0 = maxN + self.MARGIN
        self.cache = {}

    def row(self, r):
        if r not in self.cache:
            if len(self.cache) > 600:
                self.cache.clear()
            self.f.seek(self.rows[r])
            self.cache[r] = self.f.read(self.w * 3)
        return self.cache[r]

    def contains(self, E, N):
        c, r = (E - self.e0) / self.PX, (self.n0 - N) / self.PX
        return 0 <= c < self.w and 0 <= r < self.h

    def rgb(self, E, N):
        c, r = int((E - self.e0) / self.PX), int((self.n0 - N) / self.PX)
        if not (0 <= c < self.w and 0 <= r < self.h):
            return None
        row = self.row(r)
        return tuple(row[c * 3:c * 3 + 3])


class Ortho:
    def __init__(self):
        d = NGII / "정사영상"
        self.tiles = [OrthoTile(p, p.stem.split("_")[-1]) for p in sorted(d.glob("*.tif"))]

    def rgb(self, E, N):
        for t in self.tiles:
            v = t.rgb(E, N)
            if v is not None:
                return v
        return None


# ---------- 셰이프파일 ----------

def read_dbf(path):
    d = path.read_bytes()
    n = struct.unpack("<I", d[4:8])[0]
    hlen, rlen = struct.unpack("<HH", d[8:12])
    fields, i = [], 32
    while d[i] != 0x0D:
        fields.append((d[i:i + 11].split(b"\0")[0].decode("cp949", "replace"), d[i + 16]))
        i += 32
    out = []
    for k in range(n):
        rec = d[hlen + k * rlen: hlen + (k + 1) * rlen]
        pos, row = 1, {}
        for name, ln in fields:
            row[name] = rec[pos:pos + ln].decode("cp949", "replace").strip()
            pos += ln
        out.append(row)
    return out


def read_shp(path):
    """[(종류, [부분(점 목록)...])]  종류: 1 점, 3 선, 5 면"""
    d = path.read_bytes()
    pos, out = 100, []
    while pos < len(d):
        _, clen = struct.unpack(">II", d[pos:pos + 8])
        body = d[pos + 8:pos + 8 + clen * 2]
        pos += 8 + clen * 2
        typ = struct.unpack("<i", body[:4])[0]
        if typ in (0,):
            out.append((0, []))
        elif typ in (1, 11, 21):
            x, y = struct.unpack("<dd", body[4:20])
            out.append((1, [[(x, y)]]))
        else:
            nparts, npts = struct.unpack("<ii", body[36:44])
            parts = list(struct.unpack(f"<{nparts}i", body[44:44 + 4 * nparts]))
            p0 = 44 + 4 * nparts
            pts = [struct.unpack("<dd", body[p0 + 16 * i:p0 + 16 * i + 16]) for i in range(npts)]
            parts.append(npts)
            out.append((typ % 10, [pts[parts[i]:parts[i + 1]] for i in range(nparts)]))
    return out


def layer(code):
    """수치지도 2025 두 도엽에서 레이어(예 'N3A_B0010000') 모으기: [(속성, 종류, 부분들)]"""
    out = []
    for d in sorted((NGII / "수치지도" / "5000_2025").iterdir()):
        if not d.is_dir():
            continue
        shp = d / f"{code}.shp"
        if not shp.exists():
            continue
        for (typ, parts), attr in zip(read_shp(shp), read_dbf(d / f"{code}.dbf")):
            out.append((attr, typ, parts))
    return out


# ---------- 수치지도 2020 1:1,000 (NGI 도형 + NDA 속성, cp949 글자) ----------

def _ngi_blocks(text):
    """레이어 이름 → 레이어 본문"""
    import re
    out = {}
    for m in re.finditer(r'<LAYER_START>(.*?)<LAYER_END>', text, re.S):
        body = m.group(1)
        name = re.search(r'\$LAYER_NAME\s*"([^"]+)"', body)
        if name:
            out[name.group(1)] = body
    return out


def read_ngi(code):
    """2020 도엽 4장에서 레이어(예 'F0010000') 모으기: [(속성, 종류, 부분들)]  종류: 1 점, 3 선, 5 면. 좌표는 EPSG:5186"""
    import re
    out = []
    for ngi in sorted((NGII / "수치지도" / "1000_2020").glob("*.ngi")):
        geo = _ngi_blocks(ngi.read_bytes().decode("cp949", "replace")).get(code)
        att = _ngi_blocks(ngi.with_suffix(".nda").read_bytes().decode("cp949", "replace")).get(code)
        if not geo:
            continue
        names = re.findall(r'ATTRIB\("([^"]+)"', att or "")
        attrs = {}
        for rid, line in re.findall(r'\$RECORD (\d+)\s*\n([^\n$]*)', att or ""):
            vals = [v.strip().strip('"') for v in re.findall(r'"[^"]*"|[^,]+', line)]
            attrs[rid] = dict(zip(names, vals))
        for rid, kind, rest in re.findall(r'\$RECORD (\d+)\s*\n(POINT|LINESTRING|POLYGON)\s*\n(.*?)(?=\$RECORD|<END>)', geo, re.S):
            lines = [ln.strip() for ln in rest.strip().splitlines() if ln.strip() and ln.strip()[0] in '-0123456789']
            if kind == "POINT":
                x, y = map(float, lines[0].split())
                out.append((attrs.get(rid, {}), 1, [[(x, y)]]))
            elif kind == "LINESTRING":
                n = int(lines[0])
                pts = [tuple(map(float, ln.split())) for ln in lines[1:1 + n]]
                out.append((attrs.get(rid, {}), 3, [pts]))
            else:  # POLYGON: 고리 수, 그다음 고리마다 점 수와 점들
                k, parts, i = int(lines[0]), [], 1
                for _ in range(k):
                    n = int(lines[i]); i += 1
                    parts.append([tuple(map(float, ln.split())) for ln in lines[i:i + n]]); i += n
                out.append((attrs.get(rid, {}), 5, parts))
    return out


def ngi_bounds():
    """2020 도엽 4장의 TM 사각형 목록"""
    import re
    out = []
    for ngi in sorted((NGII / "수치지도" / "1000_2020").glob("*.ngi")):
        t = ngi.read_bytes().decode("cp949", "replace")
        b = [tuple(map(float, x.split(","))) for x in re.findall(r"BOUND\(([^)]*)\)", t)]
        out.append((min(v[0] for v in b), min(v[1] for v in b), max(v[2] for v in b), max(v[3] for v in b)))
    return out

