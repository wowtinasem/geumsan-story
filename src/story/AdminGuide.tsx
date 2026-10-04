"use client";

import { useEffect, useRef } from "react";

export type GuideSectionId = "read" | "restartRequest" | "ok" | "busy" | "check" | "offline" | "relogin" | "student" | "before" | "restart";

type GuideSection = {
  id: GuideSectionId;
  title: string;
  badge?: { text: string; tone: string };
  intro?: string;
  steps: string[];
  note?: string;
};

// 관리자(선생님)용 안내. 개발 지식 없이 따라 할 수 있도록 행동 순서로 쓴다.
const sections: GuideSection[] = [
  {
    id: "read",
    title: "현황판 보는 방법",
    steps: [
      "맨 위 불 3개: 서버 · 글 AI · 그림 AI가 초록이면 정상이에요. AI 연결은 5분마다 비용 없이 확인해요.",
      "지금 상태: 원활(초록) · 붐빔(노랑) · 확인 필요(빨강) 중 하나가 크게 보여요. 색만 보면 돼요.",
      "지금 그리는 중: 지금 이 순간 만들고 있는 그림 수예요. 한 번에 최대 16장까지 그려요.",
      "순서 기다리는 그림: 줄 서서 기다리는 그림 수예요. 0~10이면 여유, 20 이상이면 붐비는 중이에요.",
      "최근 1분 시작: 1분 동안 보낸 그림 수 / 한도(90)예요. 90에 가까우면 잠시 뒤 순서가 와요.",
      "오늘 만든 수: 오늘 입장한 학생, 완성된 동화 글, 그림, 실패 횟수예요. 학교별 표에서 학교마다 볼 수 있어요.",
      "숫자는 5초마다 저절로 바뀌어요. 새로 고침 버튼을 누를 필요가 없어요."
    ],
    note: "숫자는 서버가 기억하는 값이라 서버가 다시 켜지면 0부터 다시 세요. 학생들의 로그인과 작업은 그대로예요."
  },
  {
    id: "restartRequest",
    title: "다시 만들기 요청이 왔을 때",
    intro: "학생은 동화를 한 편 만들 수 있어요. 마음에 안 들어 처음부터 다시 만들려면 선생님 허락이 필요해요.",
    steps: [
      "학생이 \"다시 만들기\" → \"선생님께 요청하기\"를 누르면 현황판 위쪽 \"다시 만들기 요청\"에 학교·학년·반·번호·이름이 떠요.",
      "손 든 학생의 학년·반·번호·이름이 목록과 같은지 확인하세요.",
      "\"허락\"을 누르면 몇 초 안에 그 학생 화면이 주인공 고르기부터 다시 시작해요. 지금까지 만든 동화와 그림은 지워지고, 동화 1편·그림 8장을 새로 쓸 수 있어요.",
      "\"거절\"을 누르면 학생 화면에 지금 동화를 완성하라는 안내가 떠요.",
      "\"다시 만들기 n번 허락받음\"이 보이면 이미 다시 만든 학생이에요. 여러 번 허락하면 그만큼 비용(그림 1장 약 90원)이 들어요."
    ],
    note: "튕기거나 실수로 로그아웃한 학생은 허락이 필요 없어요. 같은 기기에서 같은 학교명·학년·반·번호·이름으로 들어오면 \"이어서 만들기\"로 계속할 수 있어요."
  },
  {
    id: "ok",
    title: "원활일 때",
    badge: { text: "원활", tone: "bg-[#173F2E] border-[#5BE3A0]" },
    intro: "그림이 바로바로 만들어지고 있어요.",
    steps: ["따로 할 일은 없어요. 수업을 그대로 진행하세요.", "가끔 현황판을 보며 실패 수가 늘지 않는지만 확인하세요."]
  },
  {
    id: "busy",
    title: "붐빔일 때",
    badge: { text: "붐빔", tone: "bg-[#5A4316] border-[#FFC857]" },
    intro: "여러 학생이 한꺼번에 그림을 만들어 순서를 기다리는 중이에요. 고장이 아니에요.",
    steps: [
      "학생들에게 이렇게 안내하세요: \"그림은 순서대로 만들어져요. 화면을 끄거나 새로 고치지 말고 그대로 기다려요.\"",
      "학생 화면에 \"순서를 기다리는 중이에요\"가 보이면 정상이에요. 브라우저가 알아서 다시 줄을 서요.",
      "새로 고침을 하거나 버튼을 여러 번 누르면 순서가 뒤로 밀려요. 누르지 않게 해 주세요.",
      "기다리는 동안 이야기 읽기, 제목 정하기, 그림 설명 발표 같은 활동을 하면 좋아요.",
      "보통 1~3분 안에 다시 원활로 돌아와요. 10분 넘게 붐빔이면 아래 \"확인 필요일 때\"를 보세요."
    ]
  },
  {
    id: "check",
    title: "확인 필요일 때",
    badge: { text: "확인 필요", tone: "bg-[#5A1F2A] border-[#FF7A8A]" },
    intro: "오늘 그림 실패가 10% 이상이에요. 대부분 Google 쪽 한도나 결제 문제예요.",
    steps: [
      "먼저 학생들에게: 실패한 학생은 1~2분 기다린 뒤 \"출력용 그림 만들기\"를 다시 누르게 하세요. 이미 만든 그림은 그대로 두고 남은 그림만 이어서 만들어요.",
      "Google AI Studio(aistudio.google.com)에 동화 앱 API 키를 만든 계정으로 로그인하세요.",
      "왼쪽 메뉴에서 사용량(Usage)과 한도(Rate limit) 화면을 열어 그림 모델(gemini-3.1-flash-image)이 한도를 넘었는지 보세요.",
      "결제(Billing) 화면에서 결제 카드가 정상인지, 지출 한도(Tier 1은 약 250달러)에 닿지 않았는지 확인하세요.",
      "결제가 막혔거나 한도에 닿았다면 결제 정보를 고치거나 한도를 올리세요. 고친 뒤 몇 분 지나면 다시 그려져요.",
      "결제·한도 모두 정상인데 계속 실패하면 아래 \"서버 다시 켜기\"를 한 번 해 보세요."
    ],
    note: "실패 비율은 오늘 하루 전체로 계산해요. 문제가 해결돼도 빨강이 바로 사라지지 않을 수 있어요. 이때는 \"지금 그리는 중\"과 그림 수가 다시 늘어나는지를 보세요."
  },
  {
    id: "offline",
    title: "\"서버에 연결하지 못했어요\"가 보일 때",
    intro: "현황판이 동화 서버(Render)에 닿지 못하는 상태예요.",
    steps: [
      "먼저 이 컴퓨터의 인터넷(와이파이)이 되는지 확인하세요. 다른 사이트가 열리는지 보세요.",
      "인터넷이 되는데 1분 넘게 계속 이 문구가 보이면 학생 화면에서도 동화 만들기가 안 되는지 확인하세요.",
      "학생 화면도 안 되면 아래 \"서버 다시 켜기\"를 하세요.",
      "배포 직후라면 2~3분 동안 이 문구가 보일 수 있어요. 잠시 기다리세요."
    ]
  },
  {
    id: "relogin",
    title: "\"관리자 로그인이 풀렸어요\"가 보일 때",
    steps: [
      "로그인은 12시간 동안 유지돼요. 시간이 지나면 다시 들어와야 해요.",
      "오른쪽 위 \"동화 만들기 화면으로\"를 누르세요.",
      "왼쪽 위 \"관리자\" 버튼 → 비밀번호 입력 → 시작 화면 오른쪽 아래 \"현황판\"을 누르세요."
    ]
  },
  {
    id: "student",
    title: "학생 화면에 이런 문구가 보일 때",
    steps: [
      "\"이미 동화를 만들었어요\" / \"그림을 만들 수 있는 몫을 모두 썼어요\": 학생 한 명은 동화 1편·그림 8장을 만들 수 있어요. 새로 만들고 싶어 하면 \"다시 만들기\"를 눌러 요청하게 하고 현황판에서 허락하세요.",
      "튕겨서 나갔을 때: 같은 기기에서 같은 학교명·학년·반·번호·이름으로 들어오면 시작 화면에 \"이어서 만들기\"가 나와요. 누르면 만들던 동화와 그림이 그대로 있어요.",
      "\"순서를 기다리는 중이에요\": 정상이에요. 화면을 그대로 두게 하세요(위 \"붐빔일 때\").",
      "\"그림을 만들지 못했어요. 잠시 뒤 다시 눌러 주세요\": 1~2분 뒤 같은 그림 버튼을 다시 누르게 하세요. 여러 학생에게 같은 문구가 나오면 \"확인 필요일 때\"를 보세요.",
      "로그인 화면으로 돌아갔을 때: 학교명·학년·반·번호·이름을 처음과 똑같이 적어 다시 들어오게 하세요. 글자가 다르면 다른 학생이 되어 만들던 동화가 보이지 않아요. 띄어쓰기나 \"금산초/금산초등학교\" 차이는 같은 학생으로 봐요."
    ]
  },
  {
    id: "before",
    title: "수업 전 점검 (10분 전)",
    intro: "서버는 유료 요금제라 항상 켜져 있어요. 깨우려고 동화를 만들 필요가 없어요. 현황판만 열면 점검이 끝나요.",
    steps: [
      "교사용 기기에서 왼쪽 위 \"관리자\" 버튼 → 비밀번호로 들어가 시작 화면 오른쪽 아래 \"현황판\"을 누르세요.",
      "현황판 맨 위 줄의 불 3개(서버 · 글 AI · 그림 AI)가 모두 초록이면 수업 준비 끝이에요.",
      "지금 상태가 원활(초록)인지, \"시험 모드\" 문구가 없는지 확인하고 수업 내내 열어 두세요.",
      "학생들에게 미리 알려 주세요: 학교명은 모두 똑같이 적기(예: 금산초등학교), 그림을 기다릴 땐 새로 고침 하지 않기."
    ],
    note: "불이 빨강이면 1분 뒤 현황판을 새로 고쳐 보세요. 그래도 빨강이면 서버는 \"서버에 연결하지 못했어요\", 글·그림 AI는 \"확인 필요일 때\" 항목을 따라 하세요."
  },
  {
    id: "restart",
    title: "서버 다시 켜기 (문제가 있을 때만)",
    intro: "평소에는 할 필요가 없어요(서버는 항상 켜져 있어요). 위 방법으로 해결되지 않을 때만 하세요. 다시 켜는 데 1~3분 걸리고, 그동안 그림을 만들던 학생은 다시 눌러야 해요. 학생 로그인은 유지돼요.",
    steps: [
      "dashboard.render.com에 로그인하고, 왼쪽 위 작업 공간이 \"숙향's workspace\"인지 확인하세요.",
      "서비스 목록에서 \"geumsan-story-proxy\"를 누르세요. (mosan-story-proxy는 다른 사업이니 누르지 마세요.)",
      "오른쪽 위 \"Manual Deploy\" 단추를 누르고 \"Restart service\"를 고르세요.",
      "2~3분 뒤 현황판이 다시 숫자를 보여 주면 끝이에요. 숫자는 0부터 다시 세요.",
      "그래도 안 되면 \"Logs\" 탭 화면을 사진으로 찍어 개발 담당자에게 보내 주세요."
    ]
  }
];

export function AdminGuide({ focus, onClose }: { focus: GuideSectionId; onClose: () => void }) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = bodyRef.current?.querySelector(`#guide-${focus}`);
    if (target && focus !== "read") target.scrollIntoView({ block: "start" });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/70 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="관리자 가이드" onClick={onClose}>
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden bg-[#0D1430] sm:rounded-3xl sm:border sm:border-[#73DFFF]/40" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-[#73DFFF]/25 px-5 py-4">
          <h2 className="text-xl font-black sm:text-2xl">관리자 가이드</h2>
          <button type="button" onClick={onClose} className="rounded-2xl bg-[#F0633C] px-5 py-2 font-black">
            닫기
          </button>
        </div>

        <nav className="flex flex-wrap gap-2 border-b border-[#73DFFF]/15 px-5 py-3 text-sm">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => bodyRef.current?.querySelector(`#guide-${section.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className={`rounded-full border px-3 py-1 font-bold ${section.id === focus ? "border-[#FFB15D] bg-[#FFB15D]/20 text-[#FFE2C2]" : "border-[#73DFFF]/30 text-[#C9E9F5]"}`}
            >
              {section.title}
            </button>
          ))}
        </nav>

        <div ref={bodyRef} className="overflow-y-auto px-5 py-5">
          {sections.map((section) => (
            <section
              key={section.id}
              id={`guide-${section.id}`}
              className={`mb-5 scroll-mt-2 rounded-2xl border p-4 ${section.id === focus ? "border-[#FFB15D] bg-[#FFB15D]/10" : "border-[#73DFFF]/20 bg-[#111A39]"}`}
            >
              <h3 className="flex flex-wrap items-center gap-2 text-lg font-black">
                {section.badge ? <span className={`rounded-xl border-2 px-2 py-0.5 text-sm ${section.badge.tone}`}>{section.badge.text}</span> : null}
                {section.title}
                {section.id === focus && focus !== "read" ? <span className="text-sm font-bold text-[#FFB15D]">← 지금 상황</span> : null}
              </h3>
              {section.intro ? <p className="mt-2 font-bold text-[#E8FCFF]">{section.intro}</p> : null}
              <ol className="mt-2 list-decimal space-y-1.5 pl-5 leading-relaxed text-[#D5E6F5]">
                {section.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              {section.note ? <p className="mt-3 text-sm text-[#9FB4D0]">※ {section.note}</p> : null}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
