// 부엉이 교수님 외형 값. 실제 인물의 외모·체형은 반영하지 않는다.
// 길이 단위는 scale을 곱하기 전 값 (scale 1이면 키 약 2m).
export const PROFESSOR = {
  scale: 1.1,
  colors: {
    feather: '#8b5e3c',     // 몸통 갈색 깃털
    head: '#99693f',
    belly: '#ead7b0',       // 배·얼굴 베이지
    belly_mark: '#c9ab7c',  // 배 무늬
    wing: '#64401f',
    tuft: '#5e3b22',        // 머리 위 깃털 뿔
    eye: '#ffd23a',         // 큰 노란 눈
    pupil: '#1b1b1f',
    beak: '#f08a24',
    feet: '#f0a030',
    glasses: '#d4ad3f',     // 동그란 금테 안경
    tie: '#1f2a4d',         // 짙은 남색 넥타이
    shirt: '#ffffff',
  },
  body: { radius: 0.5, y: 0.62 },      // 동그란 몸통
  head: { radius: 0.46, y: 1.28 },     // 2등신: 머리 ≈ 몸통
  eye: { radius: 0.13, x: 0.17 },
  walk: {
    speed: 1.6,      // 걷는 속도 (m/s, scale 반영 전)
    stepRate: 7,     // 한 걸음 박자 (rad/s)
    bounce: 0.07,    // 통통 튀는 높이
    waddle: 0.16,    // 좌우 뒤뚱 기울기 (rad)
  },
  nod: { rate: 9, amount: 0.08 }, // 말할 때 끄덕임
};
