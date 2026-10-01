# 금산 AI 동화 만들기

금산교육지원청이 관내 초등학교로 찾아가는 AI 동화 수업용 앱입니다.
초등 3~6학년 학생이 태블릿으로 주인공·배경·사건을 골라 AI 동화책을 만듭니다.

## 주요 구성

```txt
src/app/story/             /story 페이지
src/story/                 동화 만들기 UI, 데이터, 클라이언트 엔진
story-proxy/               Gemini 프록시 서버
public/images/             기본 이미지와 안내 캐릭터 '삼이'
install-geumsan-story.bat  수업용 PC 설치 스크립트
start-geumsan-story.bat    키오스크 실행 스크립트
stop-geumsan-story.bat     서버 종료 스크립트
```

## 개발 실행

```bash
npm install
npm run dev
```

별도 터미널에서:

```bash
cd story-proxy
npm install
node server.js
```

브라우저에서 확인:

```txt
http://127.0.0.1:3000/story
```

## 수업용 PC 설치

자세한 설치 안내는 `AI_CENTER_INSTALL.md`를 확인합니다.

수업용 PC에서는 아래 순서로 사용합니다.

```txt
install-geumsan-story.bat
start-geumsan-story.bat
```

## 환경 변수

API 키는 GitHub에 올리지 않습니다.

```txt
story-proxy\.env
```

예시는 아래 파일을 참고합니다.

```txt
story-proxy\.env.example
```
