// 부엉이 교수님 외형 값. 실제 인물의 외모·체형은 반영하지 않는다.
// 길이 단위는 scale을 곱하기 전 값 (scale 1이면 키 약 2m).
export const PROFESSOR = {
  scale: 1.1,
  colors: {
    feather: '#8b5e3c',     // 머리·날개 끝 갈색 깃털
    face: '#f3e3c3',        // 얼굴판 밝은 베이지
    tuft: '#5e3b22',        // 머리 위 깃털 뿔
    eye: '#ffd23a',         // 눈 테두리 노랑
    pupil: '#17171b',       // 큰 검은 눈동자
    beak: '#f08a24',
    cheek: '#ffb3c4',       // 볼터치
    feet: '#f0a030',
    glasses: '#c9ced6',     // 은색 사각테 돋보기
    shirt: '#ffffff',
    tie: '#1f2a4d',
    pants: '#45484f',       // 진회색 배바지
    belt: '#7a4a26',        // 갈색 가죽 벨트
    buckle: '#d9dde3',      // 은색 버클
    jacket: '#26345c',      // 남색 재킷
    lapel: '#31427a',
  },
  body: { radius: 0.5, y: 0.64, belly: 1.16 }, // 동그란 배 (belly: 앞뒤로 볼록한 정도)
  head: { radius: 0.5, y: 1.47 },      // 몸통과 머리 거의 1:1
  waist: 1.3,      // 바지 허리선 (구의 위에서부터 각도, 작을수록 높다. 1.57이 배 한가운데)
  eye: { radius: 0.16, x: 0.18, y: -0.07 }, // 크고 동그란 눈, 얼굴 가운데보다 조금 아래
  walk: {
    speed: 1.6,      // 걷는 속도 (m/s, scale 반영 전)
    stepRate: 7,     // 한 걸음 박자 (rad/s)
    bounce: 0.07,    // 통통 튀는 높이
    waddle: 0.16,    // 좌우 뒤뚱 기울기 (rad)
  },
  nod: { rate: 9, amount: 0.08 }, // 말할 때 끄덕임
};
