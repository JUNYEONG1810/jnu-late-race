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
  fail: { text: 'Serious한 상황이 생겼네… F다.', emphasis: 'Serious', big: 'F다.' },
};
