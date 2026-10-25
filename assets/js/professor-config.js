// 교수님 캐릭터 외형 값. 실제 인물의 외모·체형은 반영하지 않는다.
// 길이 단위는 scale을 곱하기 전 값. 3등신: 머리 1 : 몸통 1.4 : 다리 0.6
export const PROFESSOR = {
  scale: 1.05,
  colors: {
    feather: '#8b5e3c',     // 맑은 갈색 깃털
    cream: '#f3e6c8',       // 얼굴 크림색 (단색)
    tuft: '#6e4527',        // 깃털 다발 귀깃·볼 깃털 (머리보다 약간 진한 갈색)
    tuftTip: '#b08559',     // 귀깃 끝부분만 살짝 밝게
    featherDark: '#5a3a22', // 손 역할 깃털 (끝부분은 cream)
    iris: '#f0a224',        // 호박색 홍채
    pupil: '#141417',       // 검은 눈동자
    beak: '#6c6f77',        // 작은 회색 갈고리 부리 (또렷하게 조금 진하게)
    glasses: '#c9ced6',     // 은색 작은 사각테 돋보기
    shirt: '#f6f6f2',
    button: '#d6d6d6',
    tie: '#1f2a4d',
    tiePin: '#d9dde3',
    pants: '#45484f',       // 진회색 배바지
    crease: '#5a5e66',      // 바지 주름선
    belt: '#6e4424',
    buckle: '#d9dde3',
    jacket: '#26345c',      // 남색 재킷
    jacketInner: '#141b30', // 재킷 안쪽 면
    lapel: '#2d3d6c',
    seam: '#1b2645',        // 솔기·주머니 선
    jacketButton: '#10162a',
    shoe: '#5b3a22',        // 갈색 구두
    sole: '#2a1d14',
  },
  leg: { height: 0.42, x: 0.16 },             // 짧고 뭉툭한 다리 (0.6)
  body: { radius: 0.42, sy: 1.17, sz: 1.06 }, // 몸통 타원체 (높이 약 0.98 = 1.4), sz: 배가 살짝만 앞뒤로 나옴
  // 새 머리: 가로:세로 약 1.15:1, 정수리·앞얼굴 평평, 이마 가운데 V, 아래로 좁아져 목 없이 몸통으로
  head: { radius: 0.35, hx: 1.15, sink: 0.8, topFlat: 0.55, frontFlat: 0.68, notch: 0.045, notchWidth: 0.13, chinNarrow: 0.35 },
  tuft: [[0.19, 0.42, 0], [0.22, 0.6, 0.01], [0.17, 0.8, 0.02]], // 귀깃 깃털 [길이, 바깥 기울기, 앞뒤 어긋남]
  cheek: [[-0.02, 1.95], [-0.08, 2.2], [-0.14, 2.45]],          // 볼 가장자리 깃털 끝 [높이, 각도]
  waist: 1.25,     // 바지 허리선 (몸통 위에서부터 각도, 1.57이 배 한가운데. 작을수록 높다)
  shell: { shirt: 1.03, pants: 1.055, jacket: 1.12 }, // 옷 껍데기 크기 (몸통 대비)
  // 얼굴: 두 눈 주변 크림색 테두리 (ring: 반지름, lift: 앞얼굴 면에서 띄우는 거리 m)
  face: { ring: 0.13, lift: 0.003 },
  eye: { radius: 0.075, x: 0.12, y: 0.0, pupil: 0.038 }, // 보통 크기의 새 눈
  blink: { min: 3, max: 6, time: 0.18 },   // 보통 속도로 가끔
  posture: { hunch: 0.05, headDown: 0.0 }, // 등 굽힘, 고개 숙임 (rad)
  // 날개 팔: 어깨 관절은 재킷 안쪽(x), 몸 옆으로 내린 각도(rest), 날개 판 납작함(flat), 앞쪽으로 돌린 정도(twist), 손 깃털 수
  arm: { x: 0.36, rest: 0.36, flat: 0.55, twist: 0.8, handFeathers: 5 },
  talk: { nodRate: 9, nod: 0.07 },          // 말할 때 가볍게 끄덕임
  walk: {
    speed: 1.6,      // 걷는 속도 (m/s, scale 반영 전)
    stepRate: 7,     // 한 걸음 박자 (rad/s)
    bounce: 0.06,    // 통통 튀는 높이
    waddle: 0.13,    // 좌우 뒤뚱 기울기 (rad)
  },
};
