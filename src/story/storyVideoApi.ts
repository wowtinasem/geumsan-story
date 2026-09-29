// 선택한 한 쪽의 그림을 프록시(Render)로 보내 Veo가 8초 클립으로 만들게 하는 클라이언트 헬퍼.
// 영상 생성은 비동기(보통 1~수 분)이므로 "시작 → 작업ID → 완료될 때까지 polling" 구조다.
// 완료된 영상은 blob(object URL)으로 받아 canvas에 그릴 때 보안(taint) 문제가 없게 한다.

const PROXY = process.env.NEXT_PUBLIC_STORY_PROXY_URL ?? "";

export type PageVideoArgs = {
  imageDataUrl: string;       // 그 쪽의 그림(데이터 URL)
  prompt: string;            // 움직임을 설명하는 짧은 프롬프트
  classId: string;
  sessionToken: string;
  onTick?: (elapsedSec: number) => void;
  // 대기열 진행 상태(대기 순번/진행 중)를 화면에 표시하기 위한 콜백
  onProgress?: (info: { phase: "queued" | "running"; position?: number; elapsedSec: number }) => void;
  signal?: AbortSignal;
};

type StartResp = { jobId?: string; message?: string; position?: number; capacity?: number };
type StatusResp = {
  status?: "queued" | "pending" | "running" | "done" | "error";
  position?: number;
  capacity?: number;
  videoBase64?: string;
  mimeType?: string;
  videoUrl?: string;
  message?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function toObjectUrl(resp: StatusResp): Promise<string> {
  if (resp.videoBase64) {
    const mime = resp.mimeType || "video/mp4";
    const res = await fetch(`data:${mime};base64,${resp.videoBase64}`);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }
  if (resp.videoUrl) {
    // 프록시가 같은 출처로 프록싱해 주는 URL이어야 taint가 안 생긴다.
    const res = await fetch(resp.videoUrl);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }
  throw new Error("영상 데이터를 받지 못했어요");
}

export async function generatePageVideo(args: PageVideoArgs): Promise<string> {
  const { imageDataUrl, prompt, classId, sessionToken, onTick, onProgress, signal } = args;

  const startRes = await fetch(`${PROXY}/api/video/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageDataUrl, prompt, classId, sessionToken }),
    signal
  });
  if (!startRes.ok) {
    // 서버가 알려주는 진짜 이유(할당량 초과·키 문제 등)를 그대로 보여준다.
    let serverMsg = "";
    try {
      const j = (await startRes.json()) as { message?: string; error?: string | { message?: string } };
      serverMsg =
        j?.message || (typeof j?.error === "object" ? j.error?.message : "") || (typeof j?.error === "string" ? j.error : "");
    } catch {
      /* 본문이 JSON이 아닐 수 있음 */
    }
    if (startRes.status === 429) {
      throw new Error(serverMsg || "지금은 영상 생성 사용량(할당량)을 초과했어요. 잠시 후 다시 시도하거나 선생님께 알려 주세요.");
    }
    if (startRes.status === 403) {
      throw new Error(serverMsg || "수업 연결이 끊어졌어요. ‘처음으로’를 눌러 아이디를 다시 입력해 주세요.");
    }
    throw new Error(serverMsg || `영상 만들기를 시작하지 못했어요 (오류 ${startRes.status})`);
  }
  const start = (await startRes.json()) as StartResp;
  if (!start.jobId) throw new Error(start.message || "영상 작업 번호를 받지 못했어요");

  const startedAt = Date.now();
  // 대기열에서 줄 서는 시간까지 고려해 넉넉히(최대 12분) 기다린다.
  const maxMs = 12 * 60 * 1000;
  const intervalMs = 5000;

  // 처음 응답에 대기 순번이 있으면 바로 표시
  if (typeof start.position === "number" && start.position > 1) {
    onProgress?.({ phase: "queued", position: start.position, elapsedSec: 0 });
  }

  while (Date.now() - startedAt < maxMs) {
    if (signal?.aborted) throw new DOMException("취소됨", "AbortError");
    await sleep(intervalMs);
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    onTick?.(elapsedSec);

    const statusRes = await fetch(
      `${PROXY}/api/video/status?jobId=${encodeURIComponent(start.jobId)}`,
      { signal }
    );
    if (!statusRes.ok) continue;
    const status = (await statusRes.json()) as StatusResp;

    if (status.status === "queued") {
      onProgress?.({ phase: "queued", position: status.position, elapsedSec });
      continue;
    }
    if (status.status === "running" || status.status === "pending") {
      onProgress?.({ phase: "running", elapsedSec });
    }
    if (status.status === "done") return toObjectUrl(status);
    if (status.status === "error") throw new Error(status.message || "영상 만들기에 실패했어요");
  }
  throw new Error("영상 만들기가 너무 오래 걸려요. 잠시 후 다시 시도해 주세요");
}
