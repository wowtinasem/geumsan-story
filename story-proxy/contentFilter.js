// 학생이 직접 쓰는 글(주인공 이름·특징·성격·사건·장소, 입장할 때 학교명·이름)에 쓰면 안 되는 말.
// 앱(src/story/contentFilter.ts)에도 같은 목록이 있다. 고칠 때는 두 곳을 함께 고친다.
// 띄어쓰기·기호·숫자를 지운 뒤 포함 여부로 본다(예: "씨 1 발" → "씨발").
// "새끼 고양이", "시바견", "칼로리", "불이 꺼져", "엄마를 졸라", "나비의 변태", "꼼꼼한 남자"(→한남)처럼
// 동화에 흔한 말이나 띄어쓰기를 지우면 우연히 생기는 말은 넣지 않는다(contentFilter.test.js에 예시).
export const blockedWords = [
  // 욕설·비하
  "씨발", "시발", "씨빨", "씨바", "ㅅㅂ", "ㅆㅂ", "병신", "븅신", "ㅂㅅ", "개새", "개색", "ㅅㄲ", "좆", "존나", "ㅈㄴ",
  "지랄", "ㅈㄹ", "미친놈", "미친년", "ㅁㅊ", "엿먹", "등신", "찐따", "틀딱", "급식충", "김치녀", "짱깨", "쪽바리",
  "바보", "멍청", "저능", "애미", "애비", "느금", "니엄", "패드립", "fuck", "shit", "bitch", "damn",
  // 성적인 말
  "섹스", "sex", "야동", "성관계", "자위", "포르노", "porn", "알몸", "nude", "음란",
  // 폭력·위험
  "죽여", "죽였", "죽이", "죽인", "죽일", "살인", "살해", "자살", "자해", "학살", "고문", "폭행", "폭탄", "테러", "총으로", "칼로찌", "칼을휘", "찔러",
  "피투성이", "피를흘", "때려", "패버", "납치", "학대",
  // 약물·술·담배
  "마약", "대마", "필로폰", "담배", "흡연", "음주", "술마시", "소주", "맥주",
  // 혐오
  "혐오", "나쁜말", "욕설"
];

export function normalizeForFilter(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s.,!?~\-_·'"`()[\]{}<>/\\|@#$%^&*+=:;0-9]/g, "");
}

export function containsBlockedWord(value) {
  const text = normalizeForFilter(value);
  if (!text) return false;
  return blockedWords.some((word) => text.includes(normalizeForFilter(word)));
}

// selection 안의 학생이 쓸 수 있는 글을 모두 모아 검사한다.
export function selectionHasBlockedWord(selection) {
  if (!selection) return false;
  const texts = [
    selection.character?.name,
    selection.character?.lookText,
    ...(Array.isArray(selection.character?.features) ? selection.character.features : []),
    selection.trait?.label,
    selection.place?.name,
    selection.events?.opening?.label,
    selection.events?.development?.label,
    selection.events?.climax?.label,
    selection.events?.ending?.label
  ];
  return texts.some((text) => containsBlockedWord(text));
}
