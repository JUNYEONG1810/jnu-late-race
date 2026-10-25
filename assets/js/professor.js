// 부엉이 교수님: 도형으로 만든 3등신 캐릭터. 몸 위에 셔츠·배바지·재킷을 따로 만든 껍데기로 입힌다.
// 맑은 눈(거의 안 깜빡임)·잔잔한 미소, 뒤뚱 걷기·숨쉬기·말할 때 몸짓, 그리고 말풍선. 캐릭터의 앞은 로컬 +z.
import * as THREE from 'three';
import { PROFESSOR as P } from './professor-config.js';
import { speak } from './voice.js';

export class Professor {
  constructor() {
    this.object = new THREE.Group();   // 위치·방향
    this.object.scale.setScalar(P.scale);
    this.body = new THREE.Group();     // 뒤뚱·통통 (다리 + 윗몸)
    this.object.add(this.body);
    this.build();

    this.walking = false;
    this.talking = false;
    this.pose = 'rest';    // rest | thumbsUp | stern
    this.gesture = null;   // 말하는 중 몸짓: null(손짓) | emphasis(양 날개 벌림) | point(카메라 가리키기)
    this.phase = 0;
    this.time = 0;
    this.blinkIn = this.nextBlink();
    this.blinkT = -1;
  }

  build() {
    const C = P.colors;
    const mats = {};
    const mat = (c, side = THREE.FrontSide) => (mats[c + side] ||= new THREE.MeshLambertMaterial({ color: c, side }));
    const add = (geo, m, x, y, z, parent) => {
      const mesh = new THREE.Mesh(geo, typeof m === 'string' ? mat(m) : m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const ball = (r, c, x, y, z, s, parent) => {
      const m = add(new THREE.SphereGeometry(r, 22, 16), c, x, y, z, parent);
      m.scale.set(...s);
      return m;
    };
    const box = (w, h, d, c, x, y, z, parent) => add(new THREE.BoxGeometry(w, h, d), c, x, y, z, parent);

    const L = P.leg.height;
    const R = P.body.radius, SY = P.body.sy, SZ = P.body.sz, K = P.shell;
    const cy = L + R * SY; // 몸통 중심 높이

    // ---- 다리: 몸 다리 + 짧은 바짓가랑이(주름선) + 갈색 구두. 걸을 때 다리 그룹째 들린다 ----
    this.legs = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.x = s * P.leg.x;
      add(new THREE.CylinderGeometry(0.08, 0.09, L, 10), C.feather, 0, L / 2, 0, g);           // 부엉이 다리
      add(new THREE.CylinderGeometry(0.125, 0.13, L - 0.07, 14), C.pants, 0, L / 2 + 0.045, 0, g); // 바짓가랑이
      box(0.008, L - 0.09, 0.008, C.crease, 0, L / 2 + 0.045, 0.131, g);                         // 앞 주름선
      ball(0.1, C.shoe, 0, 0.055, 0.07, [1.05, 0.55, 1.55], g);                                 // 구두 (앞코 둥글게)
      box(0.2, 0.025, 0.32, C.sole, 0, 0.0125, 0.07, g);                                          // 밑창
      this.body.add(g);
      return g;
    });

    // ---- 윗몸: 엉덩이를 축으로 아주 살짝 굽힌 자세 ----
    this.upper = new THREE.Group();
    this.upper.position.y = L;
    this.body.add(this.upper);
    const U = this.upper;
    const uy = (y) => y - L; // 윗몸 그룹 안 좌표
    // 몸통 타원체를 k배 키운 껍데기 위의 점. th: 위에서부터 각도, ph: 앞(+z)에서 둘레 각도(+x 쪽이 +)
    const at = (th, ph, k) => new THREE.Vector3(
      R * k * Math.sin(th) * Math.sin(ph), uy(cy) + R * k * SY * Math.cos(th), R * k * SZ * Math.sin(th) * Math.cos(ph));
    // 껍데기 표면에 붙이는 납작한 장식 (표면을 바라보도록 회전)
    const stick = (mesh, th, ph, k) => {
      mesh.position.copy(at(th, ph, k));
      mesh.rotation.order = 'YXZ';
      mesh.rotation.y = ph;
      mesh.rotation.x = -(Math.PI / 2 - th) * 0.9;
      return mesh;
    };
    const shell = (k, c, thetaStart = 0, thetaLen = Math.PI) => {
      const m = add(new THREE.SphereGeometry(R * k, 32, 20, 0, Math.PI * 2, thetaStart, thetaLen), c, 0, uy(cy), 0, U);
      m.scale.set(1, SY, SZ);
      return m;
    };

    // a. 몸: 배가 살짝 나온 부엉이 몸통
    shell(1, C.feather);

    // b. 셔츠: 뾰족한 셔츠 깃, 단추 줄, 넥타이(매듭 + 은색 넥타이핀)
    shell(K.shirt, C.shirt);
    for (const s of [-1, 1]) {
      const collar = stick(add(new THREE.ConeGeometry(0.045, 0.1, 3).rotateZ(Math.PI), C.shirt, 0, 0, 0, U), 0.36, s * 0.16, K.shirt + 0.02);
      collar.rotation.z = s * 0.45;
      collar.scale.z = 0.35;
    }
    for (const th of [0.86, 1.0, 1.14]) stick(ball(0.014, C.button, 0, 0, 0, [1, 1, 0.5], U), th, 0, K.shirt + 0.005);
    stick(box(0.06, 0.05, 0.035, C.tie, 0, 0, 0, U), 0.4, 0, K.shirt + 0.025);                         // 매듭
    const blade = stick(add(new THREE.ConeGeometry(0.042, 0.17, 4).rotateZ(Math.PI), C.tie, 0, 0, 0, U), 0.6, 0, K.shirt + 0.03);
    blade.scale.z = 0.35;
    stick(box(0.07, 0.01, 0.012, C.tiePin, 0, 0, 0, U), 0.62, 0, K.shirt + 0.045);                     // 넥타이핀

    // c. 배바지: 허리선이 배 한가운데보다 높음 + 벨트·버클·벨트 고리
    shell(K.pants, C.pants, P.waist, Math.PI - P.waist);
    const beltK = K.pants + 0.006;
    const beltR = R * beltK * Math.sin(P.waist), beltY = uy(cy) + R * beltK * SY * Math.cos(P.waist);
    add(new THREE.TorusGeometry(beltR, 0.017, 8, 44).rotateX(Math.PI / 2).scale(1, 1, SZ), C.belt, 0, beltY, 0, U);
    stick(box(0.085, 0.06, 0.02, C.buckle, 0, 0, 0, U), P.waist, 0, beltK + 0.04);
    for (const ph of [-1.25, -0.5, 0.5, 1.25, Math.PI]) stick(box(0.022, 0.06, 0.012, C.belt, 0, 0, 0, U), P.waist, ph, beltK + 0.04);
    // 바지 앞 주름선 (허리 아래)
    for (const s of [-1, 1]) {
      const crease = stick(box(0.007, 0.2, 0.007, C.crease, 0, 0, 0, U), 2.0, s * 0.42, K.pants + 0.005);
      crease.rotation.x = 0.35;
    }

    // d. 재킷: 셔츠 바깥 한 겹. 앞이 갈라진 회전체, 몸 윤곽을 따라 내려오고 밑단만 살짝 벌어짐
    const k = K.jacket, gap = 0.6;
    const profile = [];
    for (let th = 2.5; th >= 0.32; th -= 0.06) { // 아래 → 위
      let r = R * k * Math.sin(th);
      if (th > 2.1) r += (th - 2.1) * 0.06; // 밑단 살짝 벌어짐
      profile.push(new THREE.Vector2(r, uy(cy) + R * k * SY * Math.cos(th)));
    }
    const jacketGeo = new THREE.LatheGeometry(profile, 44, gap, Math.PI * 2 - gap * 2);
    for (const [c, side] of [[C.jacket, THREE.FrontSide], [C.jacketInner, THREE.BackSide]]) {
      const j = add(jacketGeo, mat(c, side), 0, 0, 0, U);
      j.scale.z = SZ;
    }
    const jk = k + 0.012; // 재킷 위 장식 높이
    for (const s of [-1, 1]) {
      // 노치 라펠: 아래 깃(라펠)과 위 깃(칼라) 사이를 벌려 V 홈
      const lapel = stick(box(0.1, 0.3, 0.014, C.lapel, 0, 0, 0, U), 0.85, s * (gap + 0.07), jk);
      lapel.rotation.z = -s * 0.28;
      lapel.rotation.y += s * 0.3; // 접혀서 세워진 느낌
      const collar = stick(box(0.08, 0.075, 0.014, C.lapel, 0, 0, 0, U), 0.5, s * (gap + 0.24), jk);
      collar.rotation.z = s * 0.55;
      collar.rotation.y += s * 0.3;
      // 양옆 덮개 주머니
      stick(box(0.16, 0.05, 0.012, C.jacket, 0, 0, 0, U), 2.0, s * 1.05, jk);
      stick(box(0.16, 0.006, 0.014, C.seam, 0, 0, 0, U), 1.96, s * 1.05, jk + 0.01);
    }
    // 앞 단추 2개 (재킷 왼쪽 앞자락 가장자리)
    for (const th of [1.55, 1.75]) stick(ball(0.017, C.jacketButton, 0, 0, 0, [1, 1, 0.5], U), th, gap + 0.07, jk);
    // 왼쪽 가슴 주머니 + 흰 행커치프 (부엉이의 왼쪽 = 로컬 +x)
    stick(box(0.11, 0.012, 0.012, C.seam, 0, 0, 0, U), 1.0, 0.95, jk);
    const hanky = stick(box(0.06, 0.04, 0.01, C.shirt, 0, 0, 0, U), 0.95, 0.95, jk + 0.004);
    hanky.rotation.z = 0.25;
    // 뒤트임 (등 가운데 밑단)
    stick(box(0.008, 0.2, 0.01, C.seam, 0, 0, 0, U), 2.25, Math.PI, jk);

    // ---- 팔(날개): 날개 + 재킷 소매 통(어깨 솔기·소매 단추) + 셔츠 소맷단 + 깃털 손 — 모두 팔 그룹의 자식 ----
    const shoulderY = cy + R * SY * 0.62;
    this.wings = [-1, 1].map((s) => {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.46, uy(shoulderY), 0);
      add(new THREE.CylinderGeometry(0.06, 0.07, 0.4, 10), C.feather, 0, -0.2, 0, pivot);   // 날개 (팔)
      add(new THREE.CylinderGeometry(0.095, 0.11, 0.4, 14), C.jacket, 0, -0.185, 0, pivot); // 소매 (날개 윗면보다 살짝 높게: 깜빡임 방지)
      add(new THREE.TorusGeometry(0.097, 0.007, 6, 20).rotateX(Math.PI / 2), C.seam, 0, -0.012, 0, pivot); // 어깨 솔기
      for (const y of [-0.3, -0.335]) ball(0.012, C.jacketButton, s * 0.106, y, 0.015, [0.5, 1, 1], pivot); // 소매 단추
      add(new THREE.CylinderGeometry(0.082, 0.082, 0.05, 14), C.shirt, 0, -0.4, 0, pivot);  // 셔츠 소맷단
      ball(0.1, C.feather, 0, -0.5, 0, [0.6, 1.1, 0.85], pivot);                            // 깃털 손
      const thumb = ball(0.05, C.feather, -s * 0.06, -0.45, 0.05, [1, 1.6, 1], pivot);      // 엄지 (엄지 척일 때만)
      thumb.visible = false;
      U.add(pivot);
      return { pivot, thumb, side: s, rx: 0, rz: s * P.arm.rest };
    });

    // ---- 머리 (갸웃·내밀기 축): 맑은 눈, 잔잔한 미소 ----
    this.head = new THREE.Group();
    const HR = P.head.radius;
    this.headBase = new THREE.Vector3(0, uy(cy + R * SY + HR * 0.88), 0.02);
    this.head.position.copy(this.headBase);
    U.add(this.head);
    const h = this.head, E = P.eye;
    ball(HR, C.feather, 0, 0, 0, [1.06, 1, 1], h);
    ball(HR * 0.78, C.face, 0, -0.02, HR * 0.58, [1.12, 0.97, 0.5], h);  // 얼굴판
    const faceZ = HR * 0.58 + HR * 0.78 * 0.5;                           // 얼굴판 앞면
    this.lids = [];
    for (const s of [-1, 1]) {
      const ex = s * E.x;
      add(new THREE.TorusGeometry(E.radius, 0.009, 8, 32), C.eyeRim, ex, E.y, faceZ + 0.005, h);         // 눈 테두리
      ball(E.radius, C.eyeWhite, ex, E.y, faceZ - 0.02, [1, 1, 0.42], h);                                 // 크게 뜬 맑은 흰자
      ball(E.pupil, C.pupil, ex, E.y, faceZ + 0.032, [1, 1, 0.5], h);                                     // 가운데 작은 점
      ball(0.011, '#ffffff', ex - 0.012, E.y + 0.013, faceZ + 0.045, [1, 1, 0.5], h);                     // 또렷한 반짝임 1개
      // 깜빡임용 눈꺼풀 (평소엔 숨김)
      const lid = ball(E.radius * 1.08, C.feather, ex, E.y, faceZ - 0.015, [1, 1, 0.5], h);
      lid.visible = false;
      this.lids.push(lid);
      const tuft = add(new THREE.ConeGeometry(0.07, 0.2, 6), C.tuft, s * 0.21, HR * 0.86, 0, h); // 깃털 뿔
      tuft.rotation.z = -s * 0.5;
    }
    const beak = add(new THREE.ConeGeometry(0.03, 0.07, 8), C.beak, 0, E.y - 0.13, faceZ + 0.01, h);
    beak.rotation.x = Math.PI / 2 + 0.6;
    // 부리 아래 잔잔하게 올라간 미소 (∪ 모양 호)
    const arc = 1.6;
    const smile = add(new THREE.TorusGeometry(0.05, 0.006, 6, 20, arc), C.mouth, 0, E.y - 0.16, faceZ - 0.008, h);
    smile.rotation.z = -Math.PI / 2 - arc / 2;
    // 은색 작은 사각테 돋보기: 부리 쪽으로 내려 걸침
    const G = { y: E.y - 0.085, z: faceZ + 0.05, w: 0.11, h: 0.06, t: 0.009 };
    const lensMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.12, depthWrite: false });
    for (const s of [-1, 1]) {
      const gx = s * E.x;
      box(G.w, G.t, G.t, C.glasses, gx, G.y + G.h / 2, G.z, h);
      box(G.w, G.t, G.t, C.glasses, gx, G.y - G.h / 2, G.z, h);
      box(G.t, G.h, G.t, C.glasses, gx - G.w / 2, G.y, G.z, h);
      box(G.t, G.h, G.t, C.glasses, gx + G.w / 2, G.y, G.z, h);
      add(new THREE.PlaneGeometry(G.w, G.h), lensMat, gx, G.y, G.z - 0.002, h).castShadow = false;
      const a = new THREE.Vector3(gx + s * G.w / 2, G.y + 0.015, G.z), b = new THREE.Vector3(s * HR * 0.98, 0, 0.05);
      const temple = box(G.t, G.t, a.distanceTo(b), C.glasses, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, h);
      temple.rotation.order = 'YXZ';
      temple.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      temple.rotation.x = -Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
    }
    box(2 * (E.x - G.w / 2), G.t, G.t, C.glasses, 0, G.y + 0.018, G.z, h); // 코걸이 다리
    this.headTopY = cy + R * SY + HR * 0.88 + HR + 0.2;
  }

  nextBlink() {
    return P.blink.min + Math.random() * (P.blink.max - P.blink.min);
  }

  // 위치 (x, z)와 바라보는 방향 (dx, dz)
  place(x, z, dx, dz) {
    this.object.position.set(x, 0, z);
    this.face(dx, dz);
  }

  face(dx, dz) {
    this.object.rotation.y = Math.atan2(dx, dz);
  }

  // 머리 꼭대기 근처의 월드 좌표 (말풍선 위치용)
  headTop(out = new THREE.Vector3()) {
    return out.set(0, this.headTopY, 0).multiplyScalar(P.scale).add(this.object.position);
  }

  update(dt) {
    this.time += dt;
    const W = P.walk, T = P.talk, t = this.time;
    if (this.walking) this.phase += dt * W.stepRate;
    else this.phase += (Math.round(this.phase / Math.PI) * Math.PI - this.phase) * Math.min(1, dt * 10); // 발 모으기
    const s = Math.sin(this.phase);
    const walk01 = this.walking ? 1 : 0;
    // 뒤뚱(좌우 기울기) + 통통(위아래). 서 있을 때는 숨 쉬듯 살짝 오르내림
    const breath = Math.sin(t * 2.2);
    this.body.rotation.z = s * W.waddle * walk01;
    this.body.position.y = Math.abs(s) * W.bounce * walk01;
    this.upper.position.y = P.leg.height + breath * 0.01 * (1 - walk01);
    this.upper.rotation.x = P.posture.hunch + breath * 0.01;
    this.legs[0].position.y = Math.max(0, s) * 0.1 * walk01;
    this.legs[1].position.y = Math.max(0, -s) * 0.1 * walk01;

    // 거의 깜빡이지 않음: 5~8초에 한 번 아주 빠르게
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) { this.blinkT = 0; this.blinkIn = this.nextBlink(); }
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const k = this.blinkT / P.blink.time;
      const closed = k < 0.5 ? k * 2 : 2 - k * 2; // 0 → 1 → 0
      for (const lid of this.lids) { lid.visible = k < 1; lid.scale.y = Math.max(0.05, closed); }
      if (k >= 1) this.blinkT = -1;
    }

    // 고개: 말할 때 천천히 갸웃, "Serious"에서는 미소 그대로 앞으로 쑥, stern이면 숙임
    const tiltZ = this.talking ? Math.sin(t * T.tiltRate) * T.tilt : 0;
    const tiltX = P.posture.headDown + (this.pose === 'stern' ? 0.16 : 0);
    const lean = this.gesture === 'emphasis' ? T.lean : 0;
    const kh = Math.min(1, dt * 6);
    this.head.rotation.z += (tiltZ - this.head.rotation.z) * kh;
    this.head.rotation.x += (tiltX - this.head.rotation.x) * kh;
    this.head.position.z += (this.headBase.z + lean - this.head.position.z) * kh;

    // 팔(날개). rx: 앞뒤(음수 = 앞으로 듦), rz: 옆으로 벌림 (side 방향이 바깥)
    // 오른쪽 날개 = 로컬 -x (side -1)가 손짓·가리키기·엄지를 맡는다
    for (const w of this.wings) {
      const right = w.side < 0;
      let rx = Math.sin(this.phase) * 0.35 * w.side * walk01;  // 걸을 때 앞뒤로 흔들
      let rz = w.side * (P.arm.rest + breath * 0.02);          // 몸 옆에 자연스럽게 내림
      if (this.pose === 'thumbsUp') {
        if (right) { rx = -0.2; rz = w.side * 2.5; }           // 옆 위로 번쩍, 엄지 척
      } else if (this.gesture === 'point') {
        if (right) { rx = -1.5; rz = w.side * 0.15; }          // 카메라를 가리킴
      } else if (this.gesture === 'emphasis') {
        rx = -0.35; rz = w.side * 1.1;                         // 양 날개를 살짝 벌림
      } else if (this.talking && right) {
        const wave = 0.5 + 0.5 * Math.sin(t * 5);               // 가볍게 들었다 내렸다
        rx = -0.45;
        rz = w.side * (0.6 + 0.5 * wave);
      }
      const k = Math.min(1, dt * 10);
      w.rx += (rx - w.rx) * k;
      w.rz += (rz - w.rz) * k;
      w.pivot.rotation.x = w.rx;
      w.pivot.rotation.z = w.rz;
      w.thumb.visible = right && this.pose === 'thumbsUp';
    }
  }
}

// ---------- 말풍선 ----------

// 대사 한 줄을 목소리와 같은 박자로 한 글자씩 보여 준다.
// line: { text, emphasis?: 강조할 단어, big?: 크게 보일 부분 }
export class SpeechBubble {
  constructor(name) {
    this.el = document.getElementById('speech');
    this.el.querySelector('.speech-name').textContent = name;
    this.textEl = this.el.querySelector('.speech-text');
    this.moreEl = this.el.querySelector('.speech-more');
    this.active = false;
  }

  say(line, { onBig } = {}) {
    this.timeline?.stop();
    this.line = line;
    this.cls = charClasses(line);
    this.timeline = speak(line.text, { emphasis: line.emphasis, big: line.big });
    this.t = 0;
    this.shown = -1;
    this.done = false;
    this.onBig = onBig;
    this.bigFired = false;
    this.active = true;
    this.el.classList.remove('hidden');
    this.render(0);
  }

  // 지금 말하는 부분에 맞는 몸짓: 'point'("F다." 이후) | 'emphasis'("Serious" 말하는 중) | null
  get gesture() {
    if (!this.active || this.shown <= 0) return null;
    if (this.cls.slice(0, this.shown).includes('big')) return 'point';
    return !this.done && this.cls[this.shown - 1] === 'em' ? 'emphasis' : null;
  }

  // 남은 글자를 바로 다 보여 준다 (클릭·Space). 이미 다 나왔으면 false
  skipTyping() {
    if (this.done) return false;
    this.t = this.timeline.duration;
    this.timeline.stop();
    return true;
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    let n = 0;
    for (const s of this.timeline.steps) if (s.at <= this.t) n = s.end;
    if (this.t >= this.timeline.duration) n = this.line.text.length;
    if (n !== this.shown) this.render(n);
    this.done = n >= this.line.text.length;
    if (!this.bigFired && this.onBig && this.cls.slice(0, n).includes('big')) {
      this.bigFired = true;
      this.onBig();
    }
  }

  render(n) {
    this.shown = n;
    const text = this.line.text;
    let html = '', cur = null, buf = '';
    const flush = () => { if (buf) html += cur ? `<span class="${cur}">${esc(buf)}</span>` : esc(buf); buf = ''; };
    for (let i = 0; i < n; i++) {
      if (this.cls[i] !== cur) { flush(); cur = this.cls[i]; }
      buf += text[i];
    }
    flush();
    this.textEl.innerHTML = html || '&nbsp;';
    this.moreEl.style.visibility = n >= text.length ? 'visible' : 'hidden';
  }

  // 화면 좌표 (말풍선 꼬리 끝)
  place(x, y) {
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    const left = Math.min(innerWidth - w - 12, Math.max(12, x - w * 0.25));
    const top = Math.min(innerHeight - h - 140, Math.max(12, y - h - 16));
    this.el.style.transform = `translate(${left}px, ${top}px)`;
  }

  hide() {
    this.timeline?.stop();
    this.active = false;
    this.el.classList.add('hidden');
  }
}

// 글자마다 'em'(강조) / 'big'(크게) / null
function charClasses({ text, emphasis, big }) {
  const cls = new Array(text.length).fill(null);
  const mark = (word, c) => {
    if (!word) return;
    for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + 1)) {
      for (let j = i; j < i + word.length; j++) cls[j] = c;
    }
  };
  mark(emphasis, 'em');
  mark(big, 'big');
  return cls;
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}
