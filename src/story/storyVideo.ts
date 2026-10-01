// 동화 6쪽을 하나의 영상(mp4/webm)으로 묶는 녹화 엔진.
// - 정지 쪽: 그림을 천천히 줌인/줌아웃(켄 번스 효과), 글자는 또렷이 고정
// - 선택한 1쪽: Veo로 만든 "움직이는 클립"을 재생하며 글자를 얹음
// - 배경음악: 영상 시작에 서서히 커지고(페이드 인), 끝에 서서히 작아짐(페이드 아웃)
// 이 작업은 전부 브라우저 안에서 처리되므로 AI API 비용이 들지 않는다.

export type StoryVideoOptions = {
  title: string;                 // 표지 제목
  footer: string;                // 표지 아래 작은 글씨(배경 · 아이디 등)
  pages: string[];               // 6쪽 본문
  images: (string | null)[];     // 6쪽 그림(데이터 URL), 인덱스 정렬
  animatedIndex?: number;        // 움직이게 만들 쪽 (0~5). 없으면(-1/생략) 모두 정지 그림
  animatedVideoUrl?: string;     // Veo 클립의 object URL (무음). 없으면 정지 그림만으로 영상 제작
  musicSrc?: string;             // 배경음악 주소
  musicVolume?: number;          // 0~1
  coverSeconds?: number;         // 표지 길이(기본 3초)
  staticSeconds?: number;        // 정지 쪽 길이(기본 4.5초)
  fps?: number;                  // 기본 30
  onProgress?: (ratio: number, label: string) => void;
};

export type StoryVideoResult = { blob: Blob; ext: "mp4" | "webm"; mime: string };

// 출력 해상도. 오래된 태블릿에서 메모리 부족으로 탭이 강제 종료되는 것을 막기 위해
// 녹화 시작 시 기기 사양에 맞춰 더 작은 값으로 낮춘다(아래 buildStoryVideo 참고).
let W = 960;
let H = 540; // 16:9 유지
// 글자/여백 크기를 기준 폭(1280)에 맞춰 자동으로 비례 축소하기 위한 배율
let R = W / 1280;

function pickMime(): { mime: string; ext: "mp4" | "webm" } {
  const candidates: Array<{ mime: string; ext: "mp4" | "webm" }> = [
    { mime: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", ext: "mp4" },
    { mime: "video/mp4", ext: "mp4" },
    { mime: "video/webm;codecs=vp9,opus", ext: "webm" },
    { mime: "video/webm;codecs=vp8,opus", ext: "webm" },
    { mime: "video/webm", ext: "webm" }
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c.mime)) return c;
  }
  return { mime: "video/webm", ext: "webm" };
}

type Drawable = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;

// 원본 그림(보통 1024px 이상)을 매 프레임 줄여 그리면 오래된 태블릿 CPU에 큰 부담이 된다.
// 출력 크기에 맞춰 미리 한 번만 줄여 둔 캔버스를 만들어 재사용한다.
function downscale(img: HTMLImageElement | null, maxDim: number): HTMLCanvasElement | null {
  if (!img || !img.width || !img.height) return null;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const cw = Math.max(1, Math.round(img.width * scale));
  const ch = Math.max(1, Math.round(img.height * scale));
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const cx = c.getContext("2d");
  if (!cx) return null;
  cx.drawImage(img, 0, 0, cw, ch);
  return c;
}

function loadImg(src: string | null): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// 가로 글줄 나누기 (한글: 글자 단위로도 끊김)
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = (text || "").split(/(\s+)/);
  const lines: string[] = [];
  let line = "";
  const pushChar = (chunk: string) => {
    for (const ch of chunk) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
  };
  for (const w of words) {
    const test = line + w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line.trimEnd());
      line = w.trimStart();
      if (ctx.measureText(line).width > maxWidth) {
        const carry = line;
        line = "";
        pushChar(carry);
      }
    } else {
      line = test;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.length ? lines : [""];
}

// 그림을 프레임에 꽉 차게(cover) 그리기 + 줌/팬 효과
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: Drawable,
  scale = 1,
  panX = 0,
  panY = 0
) {
  const iw = "videoWidth" in img ? img.videoWidth : img.width;
  const ih = "videoHeight" in img ? img.videoHeight : img.height;
  if (!iw || !ih) return;
  const base = Math.max(W / iw, H / ih);
  const s = base * scale;
  const dw = iw * s;
  const dh = ih * s;
  const dx = (W - dw) / 2 + panX;
  const dy = (H - dh) / 2 + panY;
  ctx.drawImage(img, dx, dy, dw, dh);
}

// 그림 전체가 잘리지 않게 프레임 안에 맞춰(contain) 그리기 + 줌/팬
function drawContain(
  ctx: CanvasRenderingContext2D,
  img: Drawable,
  scale = 1,
  panX = 0,
  panY = 0
) {
  const iw = "videoWidth" in img ? img.videoWidth : img.width;
  const ih = "videoHeight" in img ? img.videoHeight : img.height;
  if (!iw || !ih) return;
  const base = Math.min(W / iw, H / ih);
  const s = base * scale;
  const dw = iw * s;
  const dh = ih * s;
  const dx = (W - dw) / 2 + panX;
  const dy = (H - dh) / 2 + panY;
  ctx.drawImage(img, dx, dy, dw, dh);
}

// 정사각형 그림을 16:9에 넣을 때 빈 옆면을 채우도록, 같은 그림을 흐릿하게 깔고 어둡게 덮는다
function drawBlurBackground(ctx: CanvasRenderingContext2D, img: Drawable) {
  ctx.save();
  ctx.filter = "blur(26px)";
  drawCover(ctx, img, 1.18, 0, 0); // 살짝 키워 블러 가장자리 빈틈 방지
  ctx.restore();
  ctx.fillStyle = "rgba(8,12,32,0.45)";
  ctx.fillRect(0, 0, W, H);
}

// 본문 글자를 하단 반투명 띠에 얹기
function drawCaption(ctx: CanvasRenderingContext2D, text: string, pageLabel: string) {
  if (!text) return;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const bodyFont = `800 ${Math.round(27 * R)}px Pretendard, sans-serif`;
  const pad = Math.round(44 * R);
  ctx.font = bodyFont;
  const lines = wrapText(ctx, text, W - pad * 2);
  const lineH = Math.round(37 * R);
  const labelH = Math.round(26 * R);
  const bandH = labelH + lines.length * lineH + Math.round(30 * R);
  const bandY = H - bandH - Math.round(22 * R);

  ctx.fillStyle = "rgba(12,16,40,0.72)";
  const r = Math.round(22 * R);
  const left = Math.round(24 * R);
  const right = W - Math.round(24 * R);
  ctx.beginPath();
  ctx.moveTo(left + r, bandY);
  ctx.arcTo(right, bandY, right, bandY + bandH, r);
  ctx.arcTo(right, bandY + bandH, left, bandY + bandH, r);
  ctx.arcTo(left, bandY + bandH, left, bandY, r);
  ctx.arcTo(left, bandY, right, bandY, r);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#FFD073";
  ctx.font = `900 ${Math.round(17 * R)}px Pretendard, sans-serif`;
  ctx.fillText(pageLabel, pad, bandY + Math.round(14 * R));

  ctx.fillStyle = "#ffffff";
  ctx.font = bodyFont;
  let y = bandY + Math.round(14 * R) + labelH;
  for (const ln of lines) {
    ctx.fillText(ln, pad, y);
    y += lineH;
  }
}

function drawCover0(ctx: CanvasRenderingContext2D, title: string, footer: string) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#101a38");
  g.addColorStop(1, "#1a244c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  ctx.fillStyle = "#FFD073";
  ctx.font = `800 ${Math.round(34 * R)}px Pretendard, sans-serif`;
  ctx.fillText("금산교육지원청 찾아가는 AI동화 수업", W / 2, H / 2 - Math.round(110 * R));

  ctx.fillStyle = "#ffffff";
  ctx.font = `900 ${Math.round(56 * R)}px Pretendard, sans-serif`;
  const lines = wrapText(ctx, title, W - Math.round(220 * R));
  let y = H / 2 - Math.round(50 * R);
  for (const ln of lines) {
    ctx.fillText(ln, W / 2, y);
    y += Math.round(70 * R);
  }

  ctx.fillStyle = "#dff9ff";
  ctx.font = `700 ${Math.round(24 * R)}px Pretendard, sans-serif`;
  ctx.fillText(footer, W / 2, H - Math.round(70 * R));
}

export async function buildStoryVideo(opts: StoryVideoOptions): Promise<StoryVideoResult> {
  const {
    title,
    footer,
    pages,
    images,
    animatedIndex,
    animatedVideoUrl,
    musicSrc,
    musicVolume = 0.6,
    coverSeconds = 3,
    staticSeconds = 4.5,
    fps: fpsOpt,
    onProgress
  } = opts;

  // 아주 오래된 태블릿/브라우저는 녹화 기능 자체가 없을 수 있으니 먼저 확인하고
  // 멈추는 대신 분명한 안내를 띄운다.
  const supportsCapture =
    typeof (document.createElement("canvas") as HTMLCanvasElement & { captureStream?: unknown }).captureStream ===
    "function";
  if (typeof MediaRecorder === "undefined" || !supportsCapture) {
    throw new Error("이 태블릿의 브라우저가 영상 저장을 지원하지 않아요. 크롬 최신 버전에서 다시 시도해 주세요.");
  }

  // 기기 사양을 보고 녹화 화질을 정한다. 오래된 태블릿(메모리·코어 적음)은
  // 움직이는 클립 재생 + 영상 인코딩이 겹치는 끝부분에서 메모리가 터져 탭이 꺼지므로,
  // 해상도·프레임·비트레이트를 더 낮춰 부담을 크게 줄인다.
  const navInfo = navigator as unknown as { deviceMemory?: number; hardwareConcurrency?: number };
  const lowEnd =
    (typeof navInfo.deviceMemory === "number" && navInfo.deviceMemory <= 4) ||
    (typeof navInfo.hardwareConcurrency === "number" && navInfo.hardwareConcurrency <= 4);
  const profile = lowEnd
    ? { w: 640, h: 360, fps: 18, bitrate: 900_000 }
    : { w: 960, h: 540, fps: 24, bitrate: 1_600_000 };
  W = profile.w;
  H = profile.h;
  R = W / 1280;
  const fps = fpsOpt ?? profile.fps;

  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* 시스템 폰트로 대체 */
    }
  }

  const pageImgs = await Promise.all(images.map((src) => loadImg(src)));
  // 출력 해상도에 맞춰 미리 축소(블러 배경이 살짝 키워 쓰므로 여유를 둔다).
  const maxDim = Math.round(W * 1.3);
  const pageBitmaps = pageImgs.map((img) => downscale(img, maxDim));

  // 움직이는 쪽 클립 준비(있을 때만). Veo 할당량이 없거나 클립을 안 만들었으면
  // 클립 없이 정지 그림들만으로 영상을 만든다.
  const hasClip = Boolean(animatedVideoUrl);
  const animIdx = hasClip ? animatedIndex ?? -1 : -1;
  let clip: HTMLVideoElement | null = null;
  if (hasClip) {
    clip = document.createElement("video");
    clip.src = animatedVideoUrl as string;
    clip.muted = true;
    clip.playsInline = true;
    clip.crossOrigin = "anonymous";
    const clipEl = clip;
    await new Promise<void>((resolve) => {
      clipEl.onloadedmetadata = () => resolve();
      clipEl.onerror = () => resolve();
    });
  }
  // 움직이는 클립 재생(디코딩)과 녹화(인코딩)가 겹치는 가장 무거운 구간이라,
  // 저사양 기기에서는 길이를 짧게 잘라 크래시 위험을 줄인다.
  const rawClipSeconds = clip && Number.isFinite(clip.duration) && clip.duration > 0 ? clip.duration : 8;
  const clipSeconds = Math.min(rawClipSeconds, lowEnd ? 5 : 8);

  // 세그먼트 타임라인 [start, end, type]
  type Seg = { start: number; end: number; kind: "cover" | "static" | "animated"; page?: number };
  const segs: Seg[] = [];
  let t = 0;
  segs.push({ start: 0, end: coverSeconds, kind: "cover" });
  t = coverSeconds;
  for (let i = 0; i < pages.length; i += 1) {
    const dur = i === animIdx ? clipSeconds : staticSeconds;
    segs.push({ start: t, end: t + dur, kind: i === animIdx ? "animated" : "static", page: i });
    t += dur;
  }
  const total = t;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context 없음");

  // ----- 오디오(배경음악) -----
  const AudioCtx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  const audioCtx = new AudioCtx();
  const dest = audioCtx.createMediaStreamDestination();
  let musicEl: HTMLAudioElement | null = null;
  let gain: GainNode | null = null;
  if (musicSrc) {
    musicEl = new Audio(musicSrc);
    musicEl.crossOrigin = "anonymous";
    musicEl.loop = true;
    const srcNode = audioCtx.createMediaElementSource(musicEl);
    gain = audioCtx.createGain();
    gain.gain.value = 0;
    srcNode.connect(gain);
    gain.connect(dest); // 녹음에만 연결(스피커로는 내보내지 않아 조용히 렌더링)
  }

  // ----- 스트림 구성 -----
  const canvasStream = canvas.captureStream(fps);
  const tracks = [...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks()];
  const stream = new MediaStream(tracks);

  const { mime, ext } = pickMime();
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: profile.bitrate });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  // 음악 페이드 스케줄
  if (audioCtx.state === "suspended") await audioCtx.resume();
  if (gain) {
    const now = audioCtx.currentTime;
    const fadeIn = 1.5;
    const fadeOut = 2;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(musicVolume, now + fadeIn);
    gain.gain.setValueAtTime(musicVolume, now + Math.max(fadeIn, total - fadeOut));
    gain.gain.linearRampToValueAtTime(0, now + total);
  }

  const done = new Promise<StoryVideoResult>((resolve, reject) => {
    recorder.onstop = () => {
      try {
        const blob = new Blob(chunks, { type: mime.split(";")[0] });
        resolve({ blob, ext, mime });
      } catch (e) {
        reject(e);
      }
    };
    recorder.onerror = () => reject(new Error("녹화 중 오류"));
  });

  // 녹화 동안 화면이 자동으로 꺼지면 그리기 루프(requestAnimationFrame)가 멈춰
  // 저장이 영영 끝나지 않는다. 지원하는 기기에서는 화면 잠금을 막는다.
  let wakeLock: { release: () => Promise<void> } | null = null;
  try {
    const nav = navigator as unknown as {
      wakeLock?: { request: (type: string) => Promise<{ release: () => Promise<void> }> };
    };
    if (nav.wakeLock) wakeLock = await nav.wakeLock.request("screen");
  } catch {
    /* 화면 잠금 막기를 지원하지 않는 기기 — 무시하고 진행 */
  }

  // 시작. timeslice(1초)를 주면 녹화 조각을 주기적으로 비워 메모리 사용을 줄인다.
  recorder.start(1000);
  if (musicEl) void musicEl.play().catch(() => undefined);

  const startMs = performance.now();
  let animatedStarted = false;
  let watchdog: ReturnType<typeof setInterval> | null = null;

  await new Promise<void>((resolveLoop) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      resolveLoop();
    };
    // 화면 절전 등으로 rAF가 잠시 멈춰도, 전체 길이를 지나면 강제로 마무리해
    // "마지막에 영영 멈춤"을 방지한다.
    watchdog = setInterval(() => {
      const elapsed = (performance.now() - startMs) / 1000;
      if (elapsed >= total + 1.5) finish();
    }, 500);

    const tick = () => {
      if (finished) return;
      const elapsed = (performance.now() - startMs) / 1000;
      if (elapsed >= total) {
        finish();
        return;
      }
      const seg = segs.find((s) => elapsed >= s.start && elapsed < s.end) ?? segs[segs.length - 1];
      const segProgress = (elapsed - seg.start) / (seg.end - seg.start);

      ctx.fillStyle = "#0b1029";
      ctx.fillRect(0, 0, W, H);

      if (seg.kind === "cover") {
        drawCover0(ctx, title, footer);
      } else if (seg.kind === "static" && seg.page != null) {
        const img = pageBitmaps[seg.page];
        if (img) {
          // 뒤에는 같은 그림을 흐리게 깔아 옆면을 채우고, 위에는 그림 전체가 보이도록 맞춘다(잘림 방지).
          drawBlurBackground(ctx, img);
          // 잘리지 않는 범위에서 아주 살짝만 줌(켄 번스)
          const zoomIn = seg.page % 2 === 0;
          const scale = zoomIn ? 1 + 0.03 * segProgress : 1.03 - 0.03 * segProgress;
          const panX = (zoomIn ? -1 : 1) * 8 * segProgress;
          drawContain(ctx, img, scale, panX, 0);
        } else {
          ctx.fillStyle = "#152138";
          ctx.fillRect(0, 0, W, H);
        }
        drawCaption(ctx, pages[seg.page] || "", `${seg.page + 1} / ${pages.length}쪽`);
      } else if (seg.kind === "animated" && seg.page != null && clip) {
        if (!animatedStarted) {
          animatedStarted = true;
          try {
            clip.currentTime = 0;
          } catch {
            /* noop */
          }
          void clip.play().catch(() => undefined);
        }
        if (clip.readyState >= 2) {
          drawCover(ctx, clip, 1, 0, 0); // Veo 클립은 16:9라 cover로 채워도 잘리지 않음
        } else {
          const img = pageBitmaps[seg.page];
          if (img) {
            drawBlurBackground(ctx, img);
            drawContain(ctx, img, 1, 0, 0);
          }
        }
        drawCaption(ctx, pages[seg.page] || "", `${seg.page + 1} / ${pages.length}쪽 · 움직이는 그림`);
      }

      onProgress?.(Math.min(1, elapsed / total), "영상을 만들고 있어요");
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // 정리
  if (watchdog) clearInterval(watchdog);
  try {
    clip?.pause();
  } catch {
    /* noop */
  }
  if (musicEl) {
    try {
      musicEl.pause();
    } catch {
      /* noop */
    }
  }
  try {
    if (recorder.state !== "inactive") recorder.stop();
  } catch {
    /* noop */
  }
  const result = await done;
  try {
    await audioCtx.close();
  } catch {
    /* noop */
  }
  if (wakeLock) {
    try {
      await wakeLock.release();
    } catch {
      /* noop */
    }
  }
  return result;
}
