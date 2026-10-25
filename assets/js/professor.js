// 부엉이 교수님: 도형으로 만든 3등신 캐릭터. 몸 위에 셔츠·배바지·재킷을 따로 만든 껍데기로 입힌다.
// 얼굴은 시안 A/B/C (주소 ?face=), 뒤뚱 걷기·숨쉬기·말할 때 몸짓, 그리고 말풍선. 캐릭터의 앞은 로컬 +z.
import * as THREE from 'three';
import { PROFESSOR as P } from './professor-config.js';
import { speak } from './voice.js';

export class Professor {
  // face: 얼굴 시안 'A' | 'B' | 'C' (생략하면 주소 ?face= 또는 기본값)
  constructor(face = defaultFace()) {
    this.faceStyle = face;
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

    // ---- 팔(날개): 어깨 관절은 재킷 안쪽에. 소매 통·소매 단추·셔츠 소맷단·깃털 손은 모두 팔 그룹의 자식 ----
    const shoulderY = cy + R * SY * 0.62;
    this.wings = [-1, 1].map((s) => {
      const pivot = new THREE.Group();
      pivot.position.set(s * P.arm.x, uy(shoulderY), 0);
      add(new THREE.CylinderGeometry(0.06, 0.07, 0.42, 10), C.feather, 0, -0.21, 0, pivot);  // 날개 (팔)
      add(new THREE.CylinderGeometry(0.1, 0.11, 0.44, 14), C.jacket, 0, -0.2, 0, pivot);     // 소매 (위쪽은 어깨 덮개 속으로)
      for (const y of [-0.34, -0.375]) ball(0.012, C.jacketButton, s * 0.107, y, 0.015, [0.5, 1, 1], pivot); // 소매 단추
      add(new THREE.CylinderGeometry(0.082, 0.082, 0.05, 14), C.shirt, 0, -0.44, 0, pivot);  // 셔츠 소맷단
      ball(0.1, C.feather, 0, -0.54, 0, [0.6, 1.1, 0.85], pivot);                            // 깃털 손
      const thumb = ball(0.05, C.feather, -s * 0.06, -0.49, 0.05, [1, 1.6, 1], pivot);       // 엄지 (엄지 척일 때만)
      thumb.visible = false;
      U.add(pivot);
      // 재킷 어깨의 둥근 덮개: 소매와 몸통의 이음매를 감춘다 (팔이 돌아도 제자리)
      ball(0.13, C.jacket, s * P.arm.x, uy(shoulderY) + 0.01, 0, [1, 0.85, 1.05], U);
      return { pivot, thumb, side: s, rx: 0, rz: s * P.arm.rest };
    });

    // ---- 머리 (끄덕임 축): 얼굴은 시안(A/B/C)에 따라 buildHead에서 ----
    this.head = new THREE.Group();
    const HR = P.head.radius;
    this.head.position.set(0, uy(cy + R * SY + HR * 0.88), 0.02);
    U.add(this.head);
    this.buildHead({ mat, add, ball, box });
    this.headTopY = cy + R * SY + HR * 0.88 + HR + 0.2;
  }

  // 갈색 둥근 머리 + 시안별 얼굴 + 공통(호박색 눈, 은색 사각 안경, 작고 둥근 귀깃)
  buildHead({ mat, add, ball, box }) {
    const C = P.colors, E = P.eye, F = P.faces[this.faceStyle], h = this.head;
    const HR = P.head.radius, HX = P.head.hx;
    // 머리 구를 k배 키운 표면의 앞쪽 z
    const surfZ = (x, y, k = 1) => HR * k * Math.sqrt(Math.max(0, 1 - (x / (HR * HX * k)) ** 2 - (y / (HR * k)) ** 2));
    // 머리 표면에 감싸 붙이는 단색 타원 패치. 면마다 lift를 달리해 겹쳐도 깜빡이지 않게
    const patch = (cx, cy, rx, ry, lift, color) =>
      h.add(wrapPatch((t) => [cx + rx * Math.cos(t), cy + ry * Math.sin(t)], cx, cy, HR * lift, HX, mat(color)));

    ball(HR, C.feather, 0, 0, 0, [HX, 1, 1], h);

    let eyeLift = 1, beakLift = 1, beakY = E.y - 0.1, beakColor = C.beak, hook = false;
    if (this.faceStyle === 'A') {
      // 두 눈 주변만 크림색 동그라미 2개, 가운데서 살짝 겹침 (오른쪽 것을 조금 더 띄움)
      patch(-E.x, E.y, F.ring, F.ring, F.lift, C.cream);
      patch(E.x, E.y, F.ring, F.ring, F.lift + 0.004, C.cream);
      eyeLift = F.lift + 0.004;
      beakColor = C.beakGray;
      hook = true;
    } else if (this.faceStyle === 'B') {
      // 눈은 갈색 머리 위, 얼굴 아래쪽 절반에 크림색 가로 타원(주둥이) + 그 안의 작은 주황 부리
      patch(0, F.muzzleY, F.rx, F.ry, F.lift, C.cream);
      beakY = F.muzzleY + 0.01;
      beakLift = F.lift;
    } else {
      // 세로로 긴 크림색 타원 하나 + 진한 갈색 테두리, 이마에 짧은 깃털 결
      patch(0, F.cy, F.rx + F.border, F.ry + F.border, F.lift - 0.006, C.rim);
      patch(0, F.cy, F.rx, F.ry, F.lift, C.cream);
      eyeLift = beakLift = F.lift;
      F.lines.forEach(([x, y, rz]) => {
        const line = box(0.009, 0.05, 0.006, C.featherLine, x, y, surfZ(x, y, F.lift) + 0.004, h);
        line.rotation.order = 'YXZ';
        line.rotation.x = -Math.asin(y / (HR * F.lift)); // 이마 곡면에 눕힘
        line.rotation.z = rz;
      });
    }

    // 공통: 호박색 홍채 + 검은 눈동자 + 작은 흰 반짝임 1개, 깜빡임용 눈꺼풀
    this.lids = [];
    for (const s of [-1, 1]) {
      const ex = s * E.x, ez = surfZ(ex, E.y, eyeLift);
      ball(E.radius, C.iris, ex, E.y, ez - 0.004, [1, 1, 0.35], h);
      ball(E.pupil, C.pupil, ex, E.y, ez + E.radius * 0.3, [1, 1, 0.45], h);
      ball(0.011, '#ffffff', ex - 0.018, E.y + 0.02, ez + E.radius * 0.3 + 0.016, [1, 1, 0.5], h);
      const lid = ball(E.radius * 1.12, C.feather, ex, E.y, ez - 0.002, [1, 1, 0.6], h);
      lid.visible = false;
      this.lids.push(lid);
      // 작고 둥근 귀깃
      const tuft = ball(0.06, C.tuft, s * 0.22, HR * 0.86, 0, [0.8, 1.3, 0.7], h);
      tuft.rotation.z = -s * 0.4;
    }

    // 부리: A는 작은 회색 갈고리, B·C는 작은 주황 부리
    const beak = add(new THREE.ConeGeometry(0.028, hook ? 0.08 : 0.065, 8), beakColor, 0, beakY, surfZ(0, beakY, beakLift) + 0.012, h);
    beak.rotation.x = Math.PI / 2 + (hook ? 1.05 : 0.6); // 갈고리는 더 아래로 휨
    if (hook) ball(0.026, beakColor, 0, beakY + 0.02, surfZ(0, beakY + 0.02, beakLift) + 0.006, [1, 0.8, 0.9], h);

    // 공통: 은색 작은 사각 안경 (부리 쪽에 걸침)
    const G = { y: E.y - 0.075, w: 0.11, h: 0.06, t: 0.009 };
    G.z = surfZ(E.x, G.y, Math.max(eyeLift, beakLift)) + 0.04;
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

    // 고개: 말할 때 가볍게 끄덕임만, stern이면 숙임
    const nod = this.talking ? Math.sin(t * T.nodRate) * T.nod : 0;
    const tiltX = P.posture.headDown + (this.pose === 'stern' ? 0.16 : 0);
    this.head.rotation.x += (nod + tiltX - this.head.rotation.x) * Math.min(1, dt * 12);

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

// 머리 구(가로 hx배, 반지름 R) 표면에 감싸 붙이는 단색 패치.
// boundary(t) → [x, y] 경계 곡선을 중심 (cx, cy)에서 바깥으로 고리 모양으로 잘게 나눠 곡면에 딱 붙게 한다.
function wrapPatch(boundary, cx, cy, R, hx, material, rings = 10, segs = 64) {
  const toHead = (x, y) => [x, y, R * Math.sqrt(Math.max(0, 1 - (x / (R * hx)) ** 2 - (y / R) ** 2))];
  const pos = [...toHead(cx, cy)];
  for (let i = 1; i <= rings; i++) {
    for (let j = 0; j < segs; j++) {
      const [bx, by] = boundary((j / segs) * Math.PI * 2);
      pos.push(...toHead(cx + ((bx - cx) * i) / rings, cy + ((by - cy) * i) / rings));
    }
  }
  const idx = [];
  const v = (i, j) => (i === 0 ? 0 : 1 + (i - 1) * segs + (j % segs));
  const tri = (a, b, c) => { // 앞(+z)을 보도록 감기 방향 맞춤
    const [ax, ay] = [pos[a * 3], pos[a * 3 + 1]];
    const cross = (pos[b * 3] - ax) * (pos[c * 3 + 1] - ay) - (pos[b * 3 + 1] - ay) * (pos[c * 3] - ax);
    idx.push(...(cross >= 0 ? [a, b, c] : [a, c, b]));
  };
  for (let j = 0; j < segs; j++) {
    tri(0, v(1, j), v(1, j + 1));
    for (let i = 1; i < rings; i++) {
      tri(v(i, j), v(i, j + 1), v(i + 1, j + 1));
      tri(v(i, j), v(i + 1, j + 1), v(i + 1, j));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  return mesh;
}

// 얼굴 시안: 주소 ?face=A|B|C, 없으면 config 기본값
function defaultFace() {
  const q = (new URLSearchParams(location.search).get('face') || '').toUpperCase();
  return ['A', 'B', 'C'].includes(q) ? q : P.faces.default;
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
