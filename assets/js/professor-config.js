// 부엉이 교수님 외형 값. 실제 인물의 외모·체형은 반영하지 않는다.
// 길이 단위는 scale을 곱하기 전 값. 3등신: 머리 1 : 몸통 1.4 : 다리 0.6
export const PROFESSOR = {
  scale: 1.05,
  colors: {
    feather: '#7d624c',     // 칙칙한 갈색 깃털
    face: '#d6c9ae',        // 얼굴판
    tuft: '#594433',        // 깃털 뿔·부스스한 깃털·눈썹
    eye: '#d2b356',         // 눈 테두리 (흐린 노랑)
    pupil: '#1b1b1f',
    eyelid: '#6b5442',      // 처진 위 눈꺼풀
    darkCircle: '#8a7c98',  // 다크서클
    beak: '#d48a3c',
    mouth: '#3a2c22',
    feet: '#e09a3c',
    glasses: '#c9ced6',     // 은색 작은 사각테 돋보기
    shirt: '#f4f4f0',
    button: '#cfcfcf',
    tie: '#1f2a4d',
    pants: '#45484f',       // 진회색 배바지
    belt: '#6e4424',
    buckle: '#d9dde3',
    jacket: '#26345c',      // 남색 재킷
    jacketInner: '#141b30', // 재킷 안쪽 면
    lapel: '#2d3d6c',
  },
  leg: { height: 0.42, x: 0.16 },           // 짧고 뭉툭한 다리 (0.6)
  body: { radius: 0.42, sy: 1.17, sz: 1.12 }, // 몸통 타원체 (높이 약 0.98 = 1.4), sz: 배가 앞뒤로 둥글게
  head: { radius: 0.35 },                   // 머리 지름 0.7 (= 1)
  waist: 1.25,     // 바지 허리선 (몸통 위에서부터 각도, 1.57이 배 한가운데. 작을수록 높다)
  eye: { radius: 0.1, x: 0.125, y: -0.01, lid: 1 / 3 }, // lid: 위 눈꺼풀이 덮는 비율
  posture: { hunch: 0.09, headDown: 0.1 }, // 등 굽힘, 고개 숙임 (rad)
  arm: { rest: 0.4 },                      // 팔을 몸 옆으로 벌린 각도 (소매가 재킷에 박히지 않게)
  walk: {
    speed: 1.6,      // 걷는 속도 (m/s, scale 반영 전)
    stepRate: 7,     // 한 걸음 박자 (rad/s)
    bounce: 0.06,    // 통통 튀는 높이
    waddle: 0.13,    // 좌우 뒤뚱 기울기 (rad)
  },
  nod: { rate: 9, amount: 0.08 }, // 말할 때 끄덕임
};
