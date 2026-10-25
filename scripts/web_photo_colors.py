"""참고 사진(ref/web/commons/, 위키미디어 공용)에서 벽·재료 색을 뽑는다. 사진은 커밋하지 않고 색 값만 쓴다.

사용법:  python scripts/web_photo_colors.py   → ref/web/colors.json (커밋 안 함)과 화면 표
- 사진마다 사람이 정한 벽 영역(사각형) 안에서 재료에 맞는 픽셀만 고른다:
  brick = 붉은 계열(R이 G·B보다 20 이상 큼), white = 밝고 무채색(밝기 150 이상, 채도 30 미만),
  granite = 중간 밝기 무채색, dark = 어두운 픽셀(밝기 90 미만).
- 고른 픽셀의 채널별 중앙값을 색으로. 그림자·창·하늘이 섞이는 것을 줄이려고 밝기 상하위 15%는 뺀다.
- 노출·화이트 밸런스 보정: 사진 전체의 채널별 98% 지점을 245로 맞춘다(흐린 날 사진이 어둡고 푸르게 나오는 것 보정).
  보정 전 값(raw)도 함께 남긴다.
PIL(Pillow) 사용.
"""
import json
import statistics
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "ref" / "web" / "commons"

# (사진 파일, 영역 x0 y0 x1 y1 (원본 픽셀), 재료 필터, 대상, 쓰임)
SAMPLES = [
    ("CNU College of Humanities Building 1.jpg", (990, 480, 1900, 1280), "brick", "w271056106", "인문대 1호관 벽돌"),
    ("Chonnam national university3.jpg", (0, 80, 800, 420), "brick", "w271056106", "인문대 1호관 벽돌 (다른 방향)"),
    ("CNU University Library Red.jpg", (150, 200, 1700, 700), "brick", "w270549104", "중앙도서관 벽돌"),
    ("전남대 _4 홍도 - panoramio.jpg", (0, 0, 950, 1000), "brick", "w270549104", "중앙도서관 벽돌 (다른 방향)"),
    ("518memorial hall in Chonnam National University.jpg", (140, 260, 1780, 1030), "brick", "w290680706", "용봉관 벽돌"),
    ("Chonnam national university2.jpg", (0, 20, 890, 440), "brick", "w290680706", "용봉관 벽돌 (다른 방향)"),
    ("CNU University Library annex white.jpg", (60, 330, 1920, 940), "white", "w1125314697", "도서관 별관 흰 벽"),
    ("Chonnam National University Front Gate.jpg", (1700, 150, 1920, 1150), "granite", "gate", "정문 화강석 기둥"),
    ("Chonnam National University Front Gate.jpg", (470, 300, 1680, 950), "white", "gate", "정문 흰 벽(글자 판)"),
    ("Chonnam National University Front Gate.jpg", (0, 40, 1600, 110), "dark", "gate", "정문 지붕 철제 관"),
    ("CNU Yongbong Tower.jpg", (770, 575, 1025, 1535), "dark", "yongbong", "용봉탑 청동 몸체"),
    ("CNU Yongbong Tower.jpg", (680, 1446, 1110, 1600), "white", "yongbong", "용봉탑 흰 돌 받침"),
]


def keep(px, kind):
    r, g, b = px[:3]
    lum = (r + g + b) / 3
    sat = max(r, g, b) - min(r, g, b)
    if kind == "brick":
        return r > g + 20 and r > b + 20 and 40 < lum < 200
    if kind == "white":
        return lum >= 150 and sat < 30
    if kind == "granite":
        return 100 <= lum <= 200 and sat < 30
    if kind == "dark":
        return lum < 90
    return False


def main():
    out = []
    for name, box, kind, target, label in SAMPLES:
        im = Image.open(SRC / name).convert("RGB")
        small = list(im.resize((200, max(1, round(200 * im.height / im.width)))).get_flattened_data())
        ref = [sorted(px[i] for px in small)[int(len(small) * 0.98)] for i in range(3)]
        gain = [245 / max(1, v) for v in ref]
        x0, y0, x1, y1 = box
        crop = im.crop((x0, y0, min(x1, im.width), min(y1, im.height)))
        pxs = [p for p in crop.get_flattened_data() if keep(p, kind)]
        total = crop.width * crop.height
        if len(pxs) < 200:
            out.append({"target": target, "label": label, "photo": name, "color": None, "share": len(pxs) / total})
            continue
        pxs.sort(key=sum)
        cut = len(pxs) * 15 // 100
        mid = pxs[cut: len(pxs) - cut]
        raw = tuple(round(statistics.median(p[i] for p in mid)) for i in range(3))
        col = tuple(min(255, round(raw[i] * gain[i])) for i in range(3))
        out.append({"target": target, "label": label, "photo": name, "kind": kind, "box": box,
                    "color": "#%02x%02x%02x" % col, "raw": "#%02x%02x%02x" % raw, "share": round(len(pxs) / total, 2)})
    (ROOT / "ref" / "web" / "colors.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    for o in out:
        print(f"{o['label']}: {o['color']} (보정 전 {o.get('raw')}, 영역 안 해당 픽셀 {o['share'] * 100:.0f}%)")


if __name__ == "__main__":
    main()
