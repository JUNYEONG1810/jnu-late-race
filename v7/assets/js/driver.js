// 굴착기 운전사 "학생"(황소 캐릭터). three.js 기본 도형(낮은 분할)을 부위마다 한 메시로 합치고(정점 색),
// 재질은 정점 색 하나 + 금색 코걸이 하나만 쓴다. 표정은 미리 만든 눈·입 모양을 보였다 숨기는 방식.
// 외형 값은 driver-config.js.
import * as THREE from 'three';
import { DRIVER as D } from './driver-config.js';

const SKIN = new THREE.MeshLambertMaterial({ vertexColors: true });
const GOLD = new THREE.MeshPhongMaterial({ color: D.colors.gold, specular: '#fff4c2', shininess: 90, emissive: '#3a2a00' });
// 운전 중 4종 + 걸을 때(walker.js): happy(음메·감정 표현), yawn(하품), sleep(꾸벅·낮잠), surprised(화들짝), dizzy(꽈당)
const FACES = {
  smile: ['eyesOpen', 'smile'],
  nervous: ['eyesOpen', 'nervousMouth', 'brows', 'sweat'],
  hooray: ['eyesHappy', 'open'],
  cry: ['eyesOpen', 'frown', 'brows', 'tears'],
  happy: ['eyesHappy', 'open'],
  yawn: ['eyesClosed', 'open'],
  sleep: ['eyesClosed'],
  surprised: ['eyesOpen', 'open', 'brows'],
  dizzy: ['eyesDizzy', 'nervousMouth'],
};

// 여러 도형을 정점 색으로 칠해 한 메시로 합친다
class Parts {
  constructor() { this.pos = []; this.nor = []; this.col = []; }

  add(geo, color, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
    const g = (geo.index ? geo.toNonIndexed() : geo).applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s)));
    const c = new THREE.Color(color);
    const P = g.attributes.position.array, N = g.attributes.normal.array;
    for (let i = 0; i < P.length; i++) { this.pos.push(P[i]); this.nor.push(N[i]); }
    for (let i = 0; i < P.length / 3; i++) this.col.push(c.r, c.g, c.b);
    return this;
  }

  // 공(타원체): 반지름 1인 구를 s배
  ball(color, p, s, r) { return this.add(new THREE.SphereGeometry(1, ...D.segments), color, { p, s, r }); }

  mesh(material = SKIN) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.computeBoundingSphere();
    return new THREE.Mesh(geo, material);
  }
}

const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 3, 8);
// 머리 겉면 위 점의 z (머리 가운데 기준 x, dy)
const onHead = (x, dy, out = 0) => Math.sqrt(Math.max(0, (D.head.r + out) ** 2 - (x / D.head.sx) ** 2 - dy ** 2));

export class Driver {
  constructor() {
    const C = D.colors, H = D.head;
    this.object = new THREE.Group();        // 엉덩이 자리(운전석)
    this.root = new THREE.Group();          // 고개 내밀기로 움직이는 몸 전체
    this.root.scale.setScalar(D.scale);
    this.object.add(this.root);
    this.expression = null;
    this.peek = 0;
    this.peekGoal = 0;
    this.time = 0;
    this.standing = false; // 내려서 걷는 중이면 자세·몸짓은 walker.js가 맡는다

    // ---- 의자 + 조종 레버 (움직이지 않음) ----
    const L = D.lever;
    const seat = new Parts()
      .add(new THREE.BoxGeometry(0.62, 0.08, 0.5), C.seat, { p: [0, -0.05, -0.02] })
      .add(new THREE.BoxGeometry(0.6, 0.55, 0.08), C.seat, { p: [0, 0.22, -0.32], r: [-0.12, 0, 0] });
    for (const s of [-1, 1]) {
      seat.add(new THREE.CylinderGeometry(0.02, 0.025, L.top + 0.05, 6), C.lever, { p: [s * L.x, (L.top - 0.05) / 2 - 0.05, L.z] })
        .ball(C.knob, [s * L.x, L.top + 0.02, L.z], [L.knob, L.knob, L.knob]);
    }
    this.seat = seat.mesh();
    this.object.add(this.seat);
    this.seat.scale.setScalar(D.scale);

    // ---- 몸 (2등신: 머리와 거의 같은 크기) + 크림색 배 ----
    const B = D.body;
    this.body = new Parts()
      .ball(C.body, [0, B.y, -0.02], [B.r, B.r * B.sy, B.r * B.sz])
      .ball(C.cream, [0, D.belly.y, D.belly.z], [D.belly.r, D.belly.r, D.belly.r * 0.45])
      .mesh();
    this.body.castShadow = true;
    this.root.add(this.body);

    // ---- 꼬리: 짧고 끝에 털 뭉치 ----
    const T = D.tail;
    this.tail = new THREE.Group();
    this.tail.position.set(0, T.y, T.z);
    this.tail.add(new Parts()
      .add(capsule(T.r, T.len), C.body, { p: [0, 0, -T.len / 2], r: [Math.PI / 2, 0, 0] })
      .ball(C.tuft, [0, 0, -T.len - T.tuft * 0.6], [T.tuft, T.tuft * 1.1, T.tuft])
      .mesh());
    this.tail.rotation.x = 0.5;
    this.root.add(this.tail);

    // ---- 앞다리(팔)·뒷다리: 짧고 짙은 색 발굽 ----
    const limb = (cfg, x) => {
      const g = new THREE.Group();
      g.position.set(x, cfg.y, cfg.z);
      g.add(new Parts()
        .add(capsule(cfg.r, cfg.len), C.body, { p: [0, -(cfg.len / 2 + cfg.r * 0.4), 0] })
        .add(new THREE.CylinderGeometry(cfg.r * 1.02, cfg.r * 1.08, cfg.r * 0.8, 10), C.hoof, { p: [0, -(cfg.len + cfg.r * 1.1), 0] })
        .mesh());
      this.root.add(g);
      return g;
    };
    this.arms = [-1, 1].map((s) => limb(D.arm, s * D.arm.x));
    this.legs = [-1, 1].map((s) => limb(D.leg, s * D.leg.x));

    // ---- 머리: 황갈색 + 크림색 주둥이·이마 + 콧구멍 + 볼터치 + 짧은 뿔 ----
    this.head = new THREE.Group();
    this.head.position.y = H.y;
    this.root.add(this.head);
    const M = D.muzzle, F = D.forehead, Hn = D.horn, K = D.cheek;
    const head = new Parts()
      .ball(C.body, [0, 0, 0], [H.r * H.sx, H.r, H.r])
      .ball(C.cream, [0, M.dy, M.z], [M.r * M.sx, M.r * M.sy, M.r * M.sz])
      .ball(C.cream, [0, F.dy, onHead(0, F.dy) - 0.02], [F.r * F.sx, F.r * F.sy, F.r * F.sz]);
    for (const s of [-1, 1]) {
      head.ball(C.nostril, [s * 0.07, M.dy + 0.01, M.z + M.r * M.sz * 0.86], [0.03, 0.022, 0.015])
        .ball(C.cheek, [s * K.x, K.dy, onHead(K.x, K.dy) - 0.015], [K.w, K.h, 0.02], [0, s * 0.6, 0])
        .add(capsule(Hn.r, Hn.len), C.horn, { p: [s * Hn.x, Hn.dy, 0.02], r: [0, 0, -s * Hn.tilt] });
    }
    this.head.add(head.mesh());
    this.head.children[0].castShadow = true;

    // 코걸이: 콧구멍 사이에 걸린 작은 금색 고리 (장신구처럼 작게)
    const R = D.noseRing;
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(R.r, R.tube, 6, 16), GOLD);
    this.ring.position.set(0, R.dy, R.z);
    this.ring.rotation.y = R.turn;
    this.head.add(this.ring);

    // 귀: 옆으로 뻗음 (펄럭이게 따로)
    const E = D.ear;
    this.ears = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * E.x, E.dy, -0.02);
      g.rotation.z = -s * E.droop;
      g.add(new Parts()
        .ball(C.body, [s * E.len * 0.9, 0, 0], [E.len, E.w * 0.62, E.w])
        .ball(C.earInner, [s * E.len * 0.95, 0, E.w * 0.45], [E.len * 0.72, E.w * 0.42, E.w * 0.35])
        .mesh());
      this.head.add(g);
      return g;
    });

    // ---- 표정 부품 (보였다 숨겼다) ----
    const Y = D.eye, Mo = D.mouth;
    const eyeZ = (x) => onHead(x, Y.dy) - 0.01;
    const eyesOpen = new Parts();
    for (const s of [-1, 1]) {
      const x = s * Y.x;
      eyesOpen.ball(C.eye, [x, Y.dy, eyeZ(x)], [Y.r, Y.r * 1.08, Y.r * Y.flat])
        .ball(C.shine, [x + 0.025, Y.dy + 0.03, eyeZ(x) + Y.r * Y.flat * 0.8], [Y.shine, Y.shine, Y.shine * 0.5])
        .ball(C.shine, [x - 0.02, Y.dy - 0.025, eyeZ(x) + Y.r * Y.flat * 0.8], [Y.shine * 0.45, Y.shine * 0.45, Y.shine * 0.3]);
    }
    const eyesHappy = new Parts(); // ^ ^ (감은 눈)
    for (const s of [-1, 1]) {
      const x = s * Y.x;
      eyesHappy.add(new THREE.TorusGeometry(Y.r * 0.7, 0.014, 4, 10, Math.PI), C.eye, { p: [x, Y.dy - 0.02, eyeZ(x) + 0.01], r: [-0.25, s * 0.35, 0] });
    }
    const eyesClosed = new Parts(); // ∪ ∪ 감은 눈 (졸 때)
    const eyesDizzy = new Parts();  // × × (꽈당)
    for (const s of [-1, 1]) {
      const x = s * Y.x;
      eyesClosed.add(new THREE.TorusGeometry(Y.r * 0.6, 0.013, 4, 10, Math.PI), C.eye, { p: [x, Y.dy + 0.01, eyeZ(x) + 0.01], r: [-0.25, s * 0.35, Math.PI] });
      for (const a of [0.8, -0.8]) {
        eyesDizzy.add(new THREE.BoxGeometry(Y.r * 1.5, 0.022, 0.012), C.eye, { p: [x, Y.dy, eyeZ(x) + 0.012], r: [-0.25, s * 0.35, a] });
      }
    }
    const arc = (r, down, y) => new Parts().add(new THREE.TorusGeometry(r, 0.012, 4, 10, Math.PI), C.mouth,
      { p: [0, Mo.dy + y, Mo.z], r: [-0.4, 0, down ? Math.PI : 0] });
    const brows = new Parts(); // 걱정 눈썹: 안쪽 끝이 올라감
    for (const s of [-1, 1]) brows.add(new THREE.BoxGeometry(0.075, 0.016, 0.012), C.hoof, { p: [s * (Y.x + 0.005), Y.dy + 0.115, eyeZ(Y.x) + 0.015], r: [-0.35, s * 0.3, s * 0.32] });
    const sweat = new Parts() // 이마 옆 땀방울 하나 (붙어 있는 장식)
      .ball(C.drop, [0.26, 0.2, onHead(0.26, 0.2) + 0.01], [0.032, 0.04, 0.02])
      .add(new THREE.ConeGeometry(0.03, 0.05, 8), C.drop, { p: [0.26, 0.245, onHead(0.26, 0.2) + 0.01], s: [1, 1, 0.65] });
    const tears = new Parts(); // 눈 아래 맺힌 눈물 (울먹)
    for (const s of [-1, 1]) tears.ball(C.drop, [s * (Y.x + 0.02), Y.dy - 0.095, eyeZ(Y.x) + 0.01], [0.026, 0.034, 0.018]);

    this.faces = {
      eyesOpen: eyesOpen.mesh(),
      eyesHappy: eyesHappy.mesh(),
      eyesClosed: eyesClosed.mesh(),
      eyesDizzy: eyesDizzy.mesh(),
      smile: arc(0.05, true, 0.02).mesh(),                     // ∪ 웃는 입
      nervousMouth: new Parts().add(new THREE.TorusGeometry(0.035, 0.011, 4, 8, Math.PI), C.mouth,
        { p: [0.01, Mo.dy - 0.005, Mo.z], r: [-0.4, 0, Math.PI + 0.25] })
        .add(new THREE.TorusGeometry(0.03, 0.011, 4, 8, Math.PI), C.mouth, { p: [-0.05, Mo.dy - 0.01, Mo.z - 0.005], r: [-0.4, 0, 0.2] }).mesh(), // 꼬불한 입
      open: new Parts().ball(C.mouth, [0, Mo.dy - 0.01, Mo.z - 0.01], [0.055, 0.045, 0.02])
        .ball(C.cheek, [0, Mo.dy - 0.03, Mo.z], [0.03, 0.018, 0.012]).mesh(), // 활짝 벌린 입
      frown: arc(0.042, false, -0.035).mesh(),                // ∩ 울먹이는 입
      brows: brows.mesh(),
      sweat: sweat.mesh(),
      tears: tears.mesh(),
    };
    for (const m of Object.values(this.faces)) this.head.add(m);
    this.setExpression('smile');
    this.update(0, 0);
  }

  // smile(자유 주행) | nervous(지각 모드) | hooray(A+ 만세) | cry(F 울먹) | 걸을 때 표정 (FACES)
  setExpression(name) {
    const show = FACES[name];
    if (!show || name === this.expression) return;
    this.expression = name;
    for (const [k, m] of Object.entries(this.faces)) m.visible = show.includes(k);
  }

  // G: 왼쪽 창문(굴착기 팔이 없는 쪽)으로 고개 내밀기 / 들어가기
  togglePeek() { this.peekGoal = this.peekGoal ? 0 : 1; }
  setPeek(on) { this.peekGoal = on ? 1 : 0; }

  // speed: 굴착기 앞뒤 속도(m/s) — 귀 펄럭임에만 씀
  update(dt, speed = 0) {
    this.time += dt;
    if (this.standing) return;
    const t = this.time, P = D.peek;
    this.peek += (this.peekGoal - this.peek) * Math.min(1, dt * P.speed);
    const k = this.peek * this.peek * (3 - 2 * this.peek);

    // 고개 내밀기: 몸을 왼쪽(+x)으로 옮기며 기울이고, 고개를 앞쪽으로 돌림
    this.root.position.x = k * P.x;
    this.root.rotation.z = -k * P.lean;
    this.head.rotation.set(0, k * P.turn * 0.4, k * P.lean * 0.5);

    // 숨 쉬듯 살짝 오르내림, 만세면 통통
    const hooray = this.expression === 'hooray';
    this.root.position.y = Math.sin(t * 2.4) * 0.008 + (hooray ? Math.abs(Math.sin(t * 7)) * 0.04 : 0);

    // 팔·다리 자세
    const A = hooray ? D.pose.hooray.arm : D.pose.sit.arm;
    this.arms.forEach((g, i) => {
      const s = i ? 1 : -1;
      const wave = hooray ? Math.sin(t * 7 + i) * 0.15 : 0;
      g.rotation.x += (A[0] + wave - g.rotation.x) * Math.min(1, dt * 10 || 1);
      g.rotation.z += (s * A[1] - g.rotation.z) * Math.min(1, dt * 10 || 1);
    });
    const Lg = D.pose.sit.leg;
    this.legs.forEach((g, i) => { g.rotation.x = Lg[0]; g.rotation.z = (i ? 1 : -1) * Lg[1]; });

    // 귀 펄럭임: 고개를 내밀거나 빨리 달릴수록 크게 (위치·회전만)
    const F = D.earFlap;
    const amp = F.idle + (F.peek - F.idle) * k * Math.min(1, 0.4 + Math.abs(speed) / 15);
    this.ears.forEach((g, i) => {
      const s = i ? 1 : -1;
      g.rotation.z = -s * D.ear.droop + s * Math.sin(t * F.rate + i * 1.3) * amp;
      g.rotation.y = s * Math.sin(t * F.rate * 0.7 + i) * amp * 0.5;
    });
    this.tail.rotation.y = Math.sin(t * 3) * 0.25;
  }
}
