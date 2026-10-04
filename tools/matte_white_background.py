"""002.mp4(흰 배경) → 배경 투명한 금삼이 영상(WebM VP9 알파) + 투명 PNG 정지 그림."""
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC, OUT_WEBM, OUT_PNG, OUT_PREVIEW = sys.argv[1:5]
W, H, FPS = 720, 1280, 24
OUT_H = 640  # 화면에는 최대 300px 안팎으로 보이므로 2배 해상도

raw = subprocess.run(["ffmpeg", "-v", "error", "-i", SRC, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
n = len(raw) // (W * H * 3)
frames = np.frombuffer(raw[: n * W * H * 3], np.uint8).reshape(n, H, W, 3)

seeds = [(x, 0) for x in range(0, W, 24)] + [(x, H - 1) for x in range(0, W, 24)] + \
        [(0, y) for y in range(0, H, 24)] + [(W - 1, y) for y in range(0, H, 24)]


def alpha_for(rgb):
    f = rgb.astype(np.int16)
    mn, mx = f.min(axis=2), f.max(axis=2)
    cand = (mn >= 228) & ((mx - mn) <= 16)          # 거의 흰색이고 무채색
    img = Image.fromarray((cand * 255).astype(np.uint8)).copy()
    for s in seeds:
        if img.getpixel(s) == 255:
            ImageDraw.floodfill(img, s, 128)          # 가장자리와 이어진 흰 영역 = 배경
    # 막힌 흰 틈(잎 사이, 다리 사이)도 배경으로 지운다. 얼굴(눈 반짝임) 영역은 제외.
    strict = (mn >= 244) & ((mx - mn) <= 10)
    arr = np.array(img)
    todo = strict & (arr == 255)
    todo[430:660, 170:580] = False
    while True:
        pts = np.argwhere(todo)
        if len(pts) == 0:
            break
        yy, xx = int(pts[0][0]), int(pts[0][1])
        ImageDraw.floodfill(img, (xx, yy), 60)
        arr = np.array(img)
        comp = arr == 60
        area = int(comp.sum())
        todo &= ~comp
        img_val = 128 if area >= 150 else 250
        arr[comp] = img_val
        img = Image.fromarray(arr).copy()
    bg = np.array(img) == 128
    # 배경 바로 옆 2px 띠는 밝기에 따라 반투명(부드러운 가장자리)
    bg_img = Image.fromarray((bg * 255).astype(np.uint8))
    near = np.asarray(bg_img.filter(ImageFilter.MaxFilter(5))) > 0
    edge = near & ~bg
    white = np.clip((mn.astype(np.float32) - 200.0) / 53.0, 0, 1)
    alpha = np.ones((H, W), np.float32)
    alpha[bg] = 0.0
    alpha[edge] = 1.0 - white[edge] * 0.9
    return alpha


alphas = [alpha_for(fr) for fr in frames]

# 모든 프레임을 덮는 금삼이 영역으로 자르기
union = np.zeros((H, W), bool)
for a in alphas:
    union |= a > 0.05
ys, xs = np.nonzero(union)
pad = 12
x0, x1 = max(0, xs.min() - pad), min(W, xs.max() + pad + 1)
y0, y1 = max(0, ys.min() - pad), min(H, ys.max() + pad + 1)
cw, ch = x1 - x0, y1 - y0
out_w = int(round(cw * OUT_H / ch / 2) * 2)
print("frames", n, "crop", (x0, y0, x1, y1), "out", out_w, OUT_H)

enc = subprocess.Popen(
    ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{out_w}x{OUT_H}", "-r", str(FPS), "-i", "-",
     "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "40", "-row-mt", "1", "-auto-alt-ref", "0", "-an", OUT_WEBM],
    stdin=subprocess.PIPE,
)
for i, (fr, a) in enumerate(zip(frames, alphas)):
    rgb = fr.astype(np.float32) / 255.0
    a3 = a[..., None]
    # 흰 테두리 번짐 제거: 흰 배경과 섞인 색을 원래 색으로 되돌림
    safe = np.where(a3 > 0.02, a3, 1.0)
    rgb = np.clip((rgb - (1.0 - a3)) / safe, 0, 1)
    rgba = np.dstack([rgb, a3]) [y0:y1, x0:x1]
    im = Image.fromarray((rgba * 255).astype(np.uint8)).resize((out_w, OUT_H), Image.LANCZOS)
    if i == 0:
        im.save(OUT_PNG, optimize=True)
        bg = Image.new("RGBA", im.size, (20, 16, 50, 255))
        bg.alpha_composite(im)
        bg.convert("RGB").save(OUT_PREVIEW)
    enc.stdin.write(im.tobytes())
enc.stdin.close()
enc.wait()
print("done")
