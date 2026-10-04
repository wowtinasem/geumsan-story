# 금산 AI 동화 만들기 — Claude 작업 안내

금산교육지원청 "찾아가는 AI동화 수업"(창의융합 AI·진로 캠프) 앱. 자세한 기록은 `작업기록.md`.

## 대화 규칙
- 사용자에게는 **항상 한국어로** 답한다. 영어로 쓰지 않는다.
- 사용자는 개발자가 아니다. 클릭 위치·메뉴 이름까지 실제 행동 순서로 안내한다.

## 서비스 주소
| 항목 | 주소 |
|---|---|
| 앱 (Vercel 프로젝트 `geumsan-story`) | https://geumsan-story.vercel.app/story |
| 프록시 (Render, 숙향's workspace, 유료 Starter) | https://geumsan-story-proxy.onrender.com/api/health |
| GitHub (비공개) | wowtinasem/geumsan-story — `main`에 푸시하면 두 곳 모두 자동 배포 |
| 수업 일정표 | https://g-camp.vercel.app (23학급 411명, 2026-10-06 ~ 11-13) |

- 예전 모산 프로젝트(Vercel `mosan-story`, Render `mosan-story-proxy`)는 건드리지 않는다.

## 배포 규칙
- **수업이 있는 평일 08:30~12:30에는 배포하지 않는다.** 일정표에서 날짜를 확인한다.
- 배포 전: `npx tsc --noEmit -p .`, `npx vitest run src`, `cd story-proxy && npm test` 모두 통과.
- 커밋 작성자는 GitHub noreply 주소(이 저장소에 로컬 설정됨). 그래야 Vercel 배포가 막히지 않는다.
- 비밀값(Gemini 키, 관리자 비밀번호 해시)은 저장소에 넣지 않는다. 로컬은 `story-proxy/.env`, 운영은 Render 환경변수.

## 접속
- 학생: 학교명·학년·번호·이름. 관리자: 첫 화면 왼쪽 위 "관리자" 버튼 + 비밀번호(사용자에게 확인).
- 토큰은 `SESSION_SECRET`으로 서명 → 서버 재시작 후에도 12시간 유지.

## 동시 사용(최대 60명) 설정 — `render.yaml`
- Gemini 한도는 **프로젝트 단위**(API 키를 늘려도 안 늘어남). 그림 모델 RPM 100.
- 그림: 분당 90장(`IMAGE_RPM_LIMIT`), 동시 16장, 대기 40초 넘으면 `image_busy` → 브라우저가 대기 안내와 함께 자동 재시도.
- 학생당 동화 2편·그림 14장, 요청 제한은 학생(로그인)별 분당 60.
- 모델: 글 `gemini-3.8-flash`(thinkingLevel low), 그림 `gemini-3.1-flash-image`. 2.5 계열은 새 사용자에게 막힘.

## 시험 도구 — `tools/`
- `tools/loadtest.mjs`: 가상 학생 N명 동시 시험. 먼저 `MOCK_AI=1`로 프록시를 3002번에 띄운다(비용 없음).
  - PowerShell(**story-proxy 폴더에서** 실행해야 .env가 읽힘): `cd story-proxy; $env:PORT='3002'; $env:MOCK_AI='1'; node server.js`
  - 실행: `N=60 node tools/loadtest.mjs` (기본 대상 http://localhost:3002)
- `tools/realtest.mjs`: 운영 프록시에 실제 학생 1명(글 1번 + 그림 2장, 약 200원).

## 작업 요령
- 큰 수정은 Python 패치 스크립트를 **Write 도구로 파일에 써서** 실행한다. Bash heredoc 안에서는 `\n`, `\\` 같은 역슬래시가 깨진다.
- 화면 확인은 Edge 헤드리스 + CDP로 캡처한다(이 PC에 Playwright 없음).

## 남은 일 (2026-10-04 기준)
- [x] 중학생(학교명이 …중/…중학교) 동화 글 수준 조정, "초등" 표현 정리 (10/04)
- [x] 관리자 현황판 `/story/admin` + `POST /api/admin-stats` (10/04)
- [ ] 10/16까지: 첫 수업 기록으로 설정 다듬기
- [ ] 11/3까지: 11/5(60명) 대비 최종 60명 시험
- [ ] PDF 파일 이름에 학교·이름 넣기(패들렛 업로드용, 사용자 결정 대기)
- [ ] 휴대폰에서 단계 화면 정리(사용자 결정 대기)
- [ ] 동화 영상 표지를 PDF 표지와 같게(사용자 결정 대기)
