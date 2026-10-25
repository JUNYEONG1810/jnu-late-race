// 부엉이 교수님 외형 값. 실제 인물의 외모·체형은 반영하지 않는다.
// 길이 단위는 scale을 곱하기 전 값. 3등신: 머리 1 : 몸통 1.4 : 다리 0.6
export const PROFESSOR = {
  scale: 1.05,
  colors: {
    feather: '#8b5e3c',     // 맑은 갈색 깃털
    face: '#efdfbd',        // 얼굴판 베이지
    tuft: '#5e3b22',        // 깃털 뿔
    eyeWhite: '#ffffff',    // 아주 맑은 흰자
    eyeRim: '#3b2a1e',      // 눈 테두리
    pupil: '#141417',       // 가운데 작은 점 눈동자
    beak: '#f08a24',
    mouth: '#4a3324',       // 잔잔한 미소 선
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
  head: { radius: 0.35 },                     // 머리 지름 0.7 (= 1)
  waist: 1.25,     // 바지 허리선 (몸통 위에서부터 각도, 1.57이 배 한가운데. 작을수록 높다)
  shell: { shirt: 1.03, pants: 1.055, jacket: 1.12 }, // 옷 껍데기 크기 (몸통 대비)
  eye: { radius: 0.12, x: 0.13, y: 0.0, pupil: 0.026 }, // 크게 뜬 맑은 눈, 가운데 작은 점
  blink: { min: 5, max: 8, time: 0.12 },   // 5~8초에 한 번, 아주 빠르게
  posture: { hunch: 0.05, headDown: 0.0 }, // 등 굽힘, 고개 숙임 (rad)
  arm: { rest: 0.4 },                      // 팔을 몸 옆으로 벌린 각도 (소매가 재킷에 박히지 않게)
  talk: { tiltRate: 1.3, tilt: 0.16, lean: 0.09 }, // 말할 때 천천히 갸웃, "Serious"에서 고개를 앞으로
  walk: {
    speed: 1.6,      // 걷는 속도 (m/s, scale 반영 전)
    stepRate: 7,     // 한 걸음 박자 (rad/s)
    bounce: 0.06,    // 통통 튀는 높이
    waddle: 0.13,    // 좌우 뒤뚱 기울기 (rad)
  },
};
