// 부엉이 교수님: 도형으로 만든 3등신 캐릭터. 몸 위에 셔츠·배바지·재킷을 따로 만든 껍데기로 입힌다.
// 뒤뚱 걷기·숨쉬기·말할 때 몸짓, 그리고 말풍선. 캐릭터의 앞은 로컬 +z.
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
    const R = P.body.radius, SY = P.body.sy, SZ = P.body.sz;
    const cy = L + R * SY; // 몸통 중심 높이
    // 몸통 타원체를 k배 키운 껍데기의 앞면 z (높이 y에서)
    const frontZ = (y, k) => R * k * SZ * Math.sqrt(Math.max(0, 1 - ((y - cy) / (R * k * SY)) ** 2));

    // ---- 다리: 몸 다리 + 짧은 바짓가랑이 + 빼꼼 나온 발. 걸을 때 다리 그룹째 들린다 ----
    this.legs = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.x = s * P.leg.x;
      add(new THREE.CylinderGeometry(0.08, 0.09, L, 10), C.feather, 0, L / 2, 0, g);          // 부엉이 다리
      add(new THREE.CylinderGeometry(0.125, 0.13, L - 0.06, 14), C.pants, 0, L / 2 + 0.04, 0, g); // 바짓가랑이
      ball(0.1, C.feet, 0, 0.045, 0.09, [1, 0.45, 1.45], g);                                    // 발
      this.body.add(g);
      return g;
    });

    // ---- 윗몸: 엉덩이를 축으로 살짝 앞으로 굽힌다 (피곤한 자세) ----
    this.upper = new THREE.Group();
    this.upper.position.y = L;
    this.body.add(this.upper);
    const U = this.upper;
    const uy = (y) => y - L; // 윗몸 그룹 안 좌표
    const shell = (k, c, thetaStart = 0, thetaLen = Math.PI) => {
      const m = add(new THREE.SphereGeometry(R * k, 32, 20, 0, Math.PI * 2, thetaStart, thetaLen), c, 0, uy(cy), 0, U);
      m.scale.set(1, SY, SZ);
      return m;
    };

    // a. 몸: 배가 둥글게 나온 부엉이 몸통
    shell(1, C.feather);
    // b. 셔츠: 몸통보다 4% 큰 껍데기
    shell(1.04, C.shirt);
    // c. 배바지: 허리선이 배 한가운데보다 높다
    shell(1.08, C.pants, P.waist, Math.PI - P.waist);
    const waistY = cy + R * 1.08 * SY * Math.cos(P.waist);
    const beltR = R * 1.085 * Math.sin(P.waist); // 재킷(1.16배) 안쪽에 들어가게
    add(new THREE.TorusGeometry(beltR, 0.022, 8, 44).rotateX(Math.PI / 2).scale(1, 1, SZ), C.belt, 0, uy(waistY), 0, U);
    box(0.09, 0.065, 0.025, C.buckle, 0, uy(waistY), beltR * SZ + 0.025, U);
    // 셔츠 단추 (허리 위, 넥타이 아래)
    for (const y of [waistY + 0.05, waistY + 0.11]) ball(0.016, C.button, 0, uy(y), frontZ(y, 1.04) + 0.004, [1, 1, 0.5], U);
    // 짧은 넥타이
    const tieTop = cy + R * SY * 0.86;
    box(0.065, 0.05, 0.04, C.tie, 0, uy(tieTop), frontZ(tieTop, 1.04) + 0.01, U);
    const bladeY = tieTop - 0.08;
    const blade = add(new THREE.ConeGeometry(0.045, 0.12, 4).rotateZ(Math.PI), C.tie, 0, uy(bladeY), frontZ(bladeY, 1.04) + 0.012, U);
    blade.rotation.x = -0.55;
    blade.scale.z = 0.4;

    // d. 재킷: 앞이 갈라진 회전체 껍데기. 밑단은 엉덩이 아래까지, 살짝 벌어짐. 안쪽 면은 더 어둡게
    const k = 1.16, gap = 0.62;
    const profile = [];
    for (let th = 2.55; th >= 0.32; th -= 0.07) { // 아래 → 위
      let r = R * k * Math.sin(th);
      if (th > 1.9) r += (th - 1.9) * 0.16; // 밑단 벌어짐
      profile.push(new THREE.Vector2(r, uy(cy) + R * k * SY * Math.cos(th)));
    }
    const jacketGeo = new THREE.LatheGeometry(profile, 40, gap, Math.PI * 2 - gap * 2);
    for (const [c, side] of [[C.jacket, THREE.FrontSide], [C.jacketInner, THREE.BackSide]]) {
      const j = add(jacketGeo, mat(c, side), 0, 0, 0, U);
      j.scale.z = SZ;
    }
    // 라펠: 얇은 판을 접어 세운 모양 (위는 벌어지고 아래로 모이는 V)
    for (const s of [-1, 1]) {
      const y = cy + R * SY * 0.55;
      const lapel = box(0.1, 0.3, 0.016, C.lapel, s * 0.19, uy(y), frontZ(y, k) * 0.92, U);
      lapel.rotation.order = 'YXZ';
      lapel.rotation.set(-0.35, s * 0.6, -s * 0.3);
    }

    // ---- 팔(날개): 어깨에서 내려온 날개 + 재킷 소매 통 + 셔츠 소맷단 + 깃털 손 (모두 팔 그룹의 자식) ----
    const shoulderY = cy + R * SY * 0.62;
    this.wings = [-1, 1].map((s) => {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.47, uy(shoulderY), 0);
      add(new THREE.CylinderGeometry(0.06, 0.07, 0.4, 10), C.feather, 0, -0.2, 0, pivot);   // 날개 (팔)
      add(new THREE.CylinderGeometry(0.095, 0.11, 0.38, 14), C.jacket, 0, -0.19, 0, pivot); // 소매
      add(new THREE.CylinderGeometry(0.082, 0.082, 0.05, 14), C.shirt, 0, -0.4, 0, pivot);  // 셔츠 소맷단
      ball(0.1, C.feather, 0, -0.5, 0, [0.6, 1.1, 0.85], pivot);                            // 깃털 손
      const thumb = ball(0.05, C.feather, -s * 0.06, -0.45, 0.05, [1, 1.6, 1], pivot);      // 엄지 (엄지 척일 때만)
      thumb.visible = false;
      U.add(pivot);
      return { pivot, thumb, side: s, rx: 0, rz: s * P.arm.rest };
    });

    // ---- 머리 (끄덕임 축): 피곤한 얼굴 ----
    this.head = new THREE.Group();
    const HR = P.head.radius;
    this.head.position.set(0, uy(cy + R * SY + HR * 0.88), 0.04); // 고개가 살짝 앞으로
    U.add(this.head);
    const h = this.head, E = P.eye;
    ball(HR, C.feather, 0, 0, 0, [1.06, 1, 1], h);
    ball(HR * 0.76, C.face, 0, -0.03, HR * 0.6, [1.12, 0.95, 0.5], h);   // 얼굴판
    const faceZ = HR * 0.6 + HR * 0.76 * 0.5;                            // 얼굴판 앞면
    for (const s of [-1, 1]) {
      const ex = s * E.x;
      ball(E.radius * 1.15, mat(C.darkCircle), ex, E.y - 0.06, faceZ - 0.035, [1.15, 0.55, 0.3], h); // 다크서클
      ball(E.radius, C.eye, ex, E.y, faceZ - 0.02, [1, 1, 0.45], h);                                  // 눈
      ball(E.radius * 0.38, C.pupil, ex, E.y - 0.012, faceZ + 0.012, [1, 1, 0.4], h);                // 작은 눈동자
      // 위 눈꺼풀: 눈의 위쪽 1/3을 덮는 구 조각, 바깥쪽이 처지게 기울임
      const lid = add(new THREE.SphereGeometry(E.radius * 1.06, 20, 10, 0, Math.PI * 2, 0, Math.acos(1 - 2 * E.lid)),
        C.eyelid, ex, E.y, faceZ - 0.02, h);
      lid.scale.set(1, 1, 0.5);
      lid.rotation.z = -s * 0.28;
      // 눈썹 깃털: 바깥쪽으로 축 처짐
      const brow = box(0.13, 0.026, 0.03, C.tuft, ex + s * 0.01, E.y + E.radius + 0.035, faceZ - 0.01, h);
      brow.rotation.z = -s * 0.38;
      // 머리 위 깃털 뿔
      const tuft = add(new THREE.ConeGeometry(0.07, 0.2, 6), C.tuft, s * 0.21, HR * 0.86, 0, h);
      tuft.rotation.z = -s * 0.5;
    }
    // 부스스하게 삐져나온 깃털 몇 가닥
    for (const [x, z, rz, rx] of [[-0.06, 0.05, 0.5, 0.3], [0.04, -0.02, -0.35, -0.2], [0.1, 0.08, -0.8, 0.4], [-0.12, -0.06, 0.9, -0.3], [0.0, 0.12, 0.1, 0.7]]) {
      const f = add(new THREE.ConeGeometry(0.022, 0.13, 5), C.tuft, x, HR * 0.95, z, h);
      f.rotation.set(rx, 0, rz);
    }
    const beak = add(new THREE.ConeGeometry(0.03, 0.07, 8), C.beak, 0, E.y - 0.1, faceZ + 0.01, h);
    beak.rotation.x = Math.PI / 2 + 0.6;
    // 부리 아래 살짝 처진 입선 (∧)
    for (const s of [-1, 1]) {
      const m = box(0.05, 0.01, 0.01, C.mouth, s * 0.022, E.y - 0.165, faceZ - 0.012, h);
      m.rotation.z = -s * 0.4;
    }
    // 은색 작은 사각테 돋보기: 부리 쪽으로 내려 걸침
    const G = { y: E.y - 0.065, z: faceZ + 0.03, w: 0.11, h: 0.06, t: 0.009 };
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
    const W = P.walk, t = this.time;
    if (this.walking) this.phase += dt * W.stepRate;
    else this.phase += (Math.round(this.phase / Math.PI) * Math.PI - this.phase) * Math.min(1, dt * 10); // 발 모으기
    const s = Math.sin(this.phase);
    const walk01 = this.walking ? 1 : 0;
    // 뒤뚱(좌우 기울기) + 통통(위아래). 서 있을 때는 숨 쉬듯 살짝 오르내림
    const breath = Math.sin(t * 2.2);
    this.body.rotation.z = s * W.waddle * walk01;
    this.body.position.y = Math.abs(s) * W.bounce * walk01;
    this.upper.position.y = P.leg.height + breath * 0.01 * (1 - walk01);
    this.upper.rotation.x = P.posture.hunch + breath * 0.01;  // 등이 약간 굽은 피곤한 자세
    this.legs[0].position.y = Math.max(0, s) * 0.1 * walk01;
    this.legs[1].position.y = Math.max(0, -s) * 0.1 * walk01;

    // 고개: 피곤해서 살짝 숙임 + 말할 때 끄덕임, stern이면 더 숙임
    const nod = this.talking ? Math.sin(t * P.nod.rate) * P.nod.amount : 0;
    const tilt = P.posture.headDown + (this.pose === 'stern' ? 0.14 : 0);
    this.head.rotation.x += (nod + tilt - this.head.rotation.x) * Math.min(1, dt * 12);

    // 팔(날개). rx: 앞뒤(음수 = 앞으로 듦), rz: 옆으로 벌림 (side 방향이 바깥)
    // 오른쪽 날개 = 로컬 -x (side -1)가 손짓·가리키기·엄지를 맡는다
    for (const w of this.wings) {
      const right = w.side < 0;
      let rx = Math.sin(this.phase) * 0.35 * w.side * walk01;  // 걸을 때 앞뒤로 흔들
      let rz = w.side * (P.arm.rest + breath * 0.02);          // 몸 옆에 처진 어깨로 내림
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
