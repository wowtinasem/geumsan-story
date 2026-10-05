# 금산 AI 동화 만들기 — Claude 작업 안내

금산교육지원청 "찾아가는 AI동화 수업"(창의융합 AI·진로 캠프) 앱. 날짜별 자세한 기록은 `작업기록.md`(1~23절).

## 대화 규칙
- 사용자에게는 **항상 한국어로** 답한다. 영어로 쓰지 않는다.
- 사용자는 개발자가 아니다. 클릭 위치·메뉴 이름까지 실제 행동 순서로 안내한다.
- 사용자 결정이 필요한 디자인·정책은 제안하고 고르게 한다. 판단해서 정한 점은 답에 밝힌다.

## 서비스 주소
| 항목 | 주소 |
|---|---|
| 앱 (Vercel 프로젝트 `geumsan-story`) | https://geumsan-story.vercel.app/story |
| 관리자 현황판 | https://geumsan-story.vercel.app/story/admin |
| 프록시 (Render, 숙향's workspace, 유료 Starter, 항상 켜짐) | https://geumsan-story-proxy.onrender.com/api/health |
| GitHub (비공개) | wowtinasem/geumsan-story — `main`에 푸시하면 두 곳 모두 자동 배포 |
| 수업 일정표 | https://g-camp.vercel.app (11교 23학급 411명, 2026-10-06 ~ 11-13) |
| 패들렛(모든 반 공통) | https://padlet.com/dream4325/_-s0246akz2pa3rps68ms5 (`src/story/downloadHelp.ts`의 `padletUrl`) |

- 예전 모산 프로젝트(Vercel `mosan-story`, Render `mosan-story-proxy`)는 건드리지 않는다.

## 배포 규칙
- **수업이 있는 평일 08:30~12:30에는 배포하지 않는다.** 일정표에서 날짜를 확인한다.
- 배포 전: `npx tsc --noEmit -p .`, `npx vitest run src`, `cd story-proxy && npm test` 모두 통과.
- 커밋 작성자는 GitHub noreply 주소(이 저장소에 로컬 설정됨). 그래야 Vercel 배포가 막히지 않는다.
- 비밀값(Gemini 키, 관리자 비밀번호 해시)은 저장소에 넣지 않는다. 로컬은 `story-proxy/.env`, 운영은 Render 환경변수.
- **Render 환경변수는 `render.yaml`을 고쳐도 바뀌지 않는다.** 값 변경은 사용자가 Render → geumsan-story-proxy → Environment에서 한다. 적용 확인은 관리자 토큰으로 `POST /api/admin-stats`의 `limits`.
- Render는 푸시 후 약 30초에 새 서버가 뜨지만 잠깐 예전 서버가 응답할 수 있다. 운영 시험은 `serverStartedAt`(admin-stats)이 커밋 시각 뒤로 바뀌고 1분 더 기다린 뒤 한다(시각은 UTC로 비교).

## 학생 흐름 (화면)
1. 로그인: 학교(드롭다운 — 일정표 11교 + 드림초, 맨 아래 "직접 입력")·학년·반·번호·이름. 목록은 `StoryKioskApp.tsx`의 `schoolOptions`.
2. 시작 화면: 만들던 동화가 있으면 "이어서 만들기"/"다시 만들기", 없으면 "동화 만들기 시작". 오른쪽 아래 패들렛 바로가기·로그아웃(관리자는 현황판).
3. 1단계 주인공: 이름(친구 실명 쓰지 않게 안내), 유형·나이대·머리색, 특징은 **"골라서 선택" 또는 "직접 쓰기" 중 고른 탭 하나만** 반영. 직접 쓴 옷차림(공주 드레스·우주복 등)은 기본 옷 대신 그린다(`character.lookText`).
4. 2단계 성격, 3단계 배경(8곳 4열 + "장소 직접 쓰기", 장소는 언제나 한 곳, `sceneKey: "custom"`), 4단계 발단(기)·전개(승)·절정(전)·결말(결) + 직접 쓰기.
5. 결과 화면: 쪽 넘김 → 그림 스타일(3D 기본·수채화·색연필·클레이·종이 오리기·유화·크레파스, 그림을 만들면 고정) → 대표/출력용 그림 만들기 → 배경음악 → [PDF 저장][패들렛 바로가기]. 동화 영상은 `showVideoTools = false`로 숨김.
6. PDF 저장 뒤 "PDF를 저장했어요!" 창: 파일 이름(`학교약칭_학년-반-번호_이름_동화.pdf`), 폴더 열기(웹은 폴더를 직접 못 열어 기기별 찾는 순서 표시), PDF 바로 보기, 패들렛 올리는 순서.
- 화면 맨 위 머리줄에도 패들렛 바로가기(좁으면 "📌 패들렛").

## 사용량·동시 사용 (최대 60명) — `render.yaml`
- 학생당 기본 **동화 1편·그림 8장**(Render 환경변수 1/8 확인됨). "다시 만들기"는 학생 요청 → 현황판에서 학번 확인 후 허락하면 같은 양 추가(`/api/restart-*`, `/api/admin-restart-decide`). 관리자는 제한 없음.
- 학생 동일인: 학교·학년·반·번호·이름(학교 띄어쓰기·"초등학교/초"·"중학교/중" 무시). 서버 `usageKey`, 앱 `workOwnerOf`.
- 만들던 동화는 기기 IndexedDB(`src/story/workStore.ts`, 사흘 보관)에 학생별 저장. 서버·DB에는 저장하지 않는다. 사용 횟수·요청·현황판 숫자는 서버 메모리(재시작하면 처음부터).
- Gemini 한도는 프로젝트 단위(키를 늘려도 안 늘어남). 그림 분당 90장(`IMAGE_RPM_LIMIT`), 동시 16장, 40초 넘게 기다리면 `image_busy` → 브라우저가 안내와 함께 자동 재시도.
- 모델: 글 `gemini-3.8-flash`(thinkingLevel low), 그림 `gemini-3.1-flash-image`(장당 약 90원, 스타일과 무관). 2.5 계열은 막힘.

## 동화·그림 규칙 (고칠 곳)
- 동화 글 지시: `story-proxy/server.js`의 `buildPrompt`·`systemPrompt`.
  - 0) 안전 규칙이 가장 먼저(싸움·복수·괴물도 대화·화해로, 때리기·밀치기·피·무기·죽음 금지). 사건 보기는 `asTopic`으로 평서형 소재로 바꿔 넘김(문장 그대로 붙여 넣기 방지), 복수→다시 겨루기, 싸움→다툼.
  - 초등: 해요체 통일, 쪽당 2~3문장 70~130자. 중학생(학교명이 …중/…중학교, `isMiddleSchool`): ~했다체, 90~160자.
  - 시대는 오늘날, 한복은 명절 장면에서만. 칠백의총은 추모 분위기.
- 그림 지시: `buildImagePrompt`. 맨 앞 "ART STYLE"(스타일 `artStylePrompts`)과 한 장 그림(칸·격자·반복 금지), 아동 안전, 시대(요즘 옷, 명절이면 한복, 주인공은 직접 쓴 옷 우선), 그림 속 글자 금지.
- 금지어: `story-proxy/contentFilter.js` = `src/story/contentFilter.ts` **두 곳 함께 고친다**. 띄어쓰기·기호·숫자를 지우고 검사하므로 짧은 말은 오탐 주의(예: "꼼꼼한 남자"→한남). 오탐 예시는 `contentFilter.test.js`.
- Gemini 안전 필터는 글·그림 요청에 명시(성적 내용 LOW 이상 차단).

## 관리자
- 첫 화면 왼쪽 위 "관리자" + 비밀번호(사용자에게 확인). 현황판: 서버·글 AI·그림 AI 불(5초마다), 지금 상태(원활/붐빔/확인 필요), 다시 만들기 요청(허락/거절), 그림 대기 줄, 오늘 학교별 수. "가이드" 버튼에 상황별 대처.
- 수업 전 점검은 현황판 불 3개 초록이면 끝(서버를 깨울 필요 없음).

## 시험 도구
- `tools/loadtest.mjs`: 가상 학생 N명 동시 시험. `MOCK_AI=1` 프록시를 **story-proxy 폴더에서** 띄운다(.env 읽힘).
  - PowerShell: `cd story-proxy; $env:PORT='3002'; $env:MOCK_AI='1'; node server.js` → `N=60 node tools/loadtest.mjs`
- `tools/realtest.mjs`: 운영 프록시에 실제 학생 1명(글 1번 + 그림 2장, 약 200원).
- 운영 품질 점검은 관리자 토큰으로 `/api/story`(글만, 몇 원)·`/api/image`(장당 약 90원)를 직접 불러 확인한다. 임시 스크립트는 세션 scratchpad에 둔다($TMP는 세션이 바뀌면 지워진다).

## 작업 요령
- 큰 수정은 Python 패치 스크립트를 **Write 도구로 파일에 써서** 실행한다. Bash heredoc 안에서는 `\n`, `\\`, `\s` 같은 역슬래시가 깨진다.
- 화면 확인은 Edge 헤드리스 + CDP로 캡처한다(이 PC에 Playwright 없음). 로컬은 mock 프록시 3001 + `npx next dev -p 3000`.

## 남은 일 (2026-10-05 기준)
- [ ] 10/16까지: 첫 수업(10/6~) 기록과 현황판 숫자로 설정 다듬기
- [ ] 11/3까지: 11/5(60명, 금산중앙초 39명 같은 인터넷) 대비 최종 60명 시험
- [ ] 결정 대기: 태블릿 세로·휴대폰 단계 화면 정리(머리줄 단계 글자가 꺾임), 동화 영상 표지를 PDF 표지와 같게
- [ ] 제안해 둔 것: 결과 화면 "이 쪽 그림 다시 그리기"(여유 2장 활용), 관리자 가이드에 "수업 전 선생님 안내 문구"(실명 쓰지 않기·패들렛 비밀 링크/게시물 승인)
- [ ] 캠프가 끝나면 관리자 비밀번호 변경 권장
