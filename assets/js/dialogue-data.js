// 교수님 대사. CLAUDE.md "대사" 표와 같게 유지한다.
// emphasis: 말풍선에서 굵게·다른 색, 목소리는 낮고 길게
// big: 말풍선에서 크게 + 화면 흔들림
export const SPEAKER = '교수님';

export const DIALOGUE = {
  intro: [
    { text: '어이~ 거기 학생.' },
    { text: '지각을 하게 되면 조금 Serious한 상황이 생길 거라고 볼 수 있겠지...', emphasis: 'Serious' },
    { text: '9시까지 공대 2호관으로 와요.' },
  ],
  success: { text: '음… 늦지 않았네. A+.' },
  // 시간 안에 도착했을 때 남은 시간별 등급 대사 (A+는 위 success와 같은 글자)
  grades: {
    'A+': { text: '음… 늦지 않았네. A+.' },
    A: { text: '음… 여유 있게 왔네. A.' },
    'B+': { text: '음… 조금만 더 일찍 오면 좋겠네. B+.' },
    B: { text: '음… 다음엔 좀 더 서둘러요. B.' },
    C: { text: '음… 아슬아슬하게 왔네. C.' },
  },
  fail: { text: 'Serious한 상황이 생겼네… F다.', emphasis: 'Serious', big: 'F다.' },
};
