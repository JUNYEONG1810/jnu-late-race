// 부엉이 교수님: 도형으로 만든 캐릭터(배바지 정장), 뒤뚱 걷기·숨쉬기·말할 때 몸짓, 그리고 말풍선.
// 캐릭터의 앞은 로컬 +z.
import * as THREE from 'three';
import { PROFESSOR as P } from './professor-config.js';
import { speak } from './voice.js';

export class Professor {
  constructor() {
    this.object = new THREE.Group();   // 위치·방향
    this.object.scale.setScalar(P.scale);
    this.body = new THREE.Group();     // 뒤뚱·통통
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
    const mat = (c) => (mats[c] ||= new THREE.MeshLambertMaterial({ color: c }));
    const add = (geo, c, x, y, z, parent = this.body) => {
      const m = new THREE.Mesh(geo, typeof c === 'string' ? mat(c) : c);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    const ball = (r, c, x, y, z, sx = 1, sy = 1, sz = 1, parent = this.body) => {
      const m = add(new THREE.SphereGeometry(r, 22, 16), c, x, y, z, parent);
      m.scale.set(sx, sy, sz);
      return m;
    };
    const box = (w, h, d, c, x, y, z, parent = this.body) => add(new THREE.BoxGeometry(w, h, d), c, x, y, z, parent);

    const r = P.body.radius, cy = P.body.y, belly = P.body.belly; // 배는 앞뒤로 볼록

    // ---- 몸: 흰 셔츠 배 → 높은 배바지 → 벨트 → 앞이 열린 재킷 ----
    ball(r, C.shirt, 0, cy, 0, 1, 1, belly);
    const pants = add(new THREE.SphereGeometry(r * 1.015, 28, 18, 0, Math.PI * 2, P.waist, Math.PI - P.waist), C.pants, 0, cy, 0);
    pants.scale.z = belly;
    const beltR = r * 1.03 * Math.sin(P.waist), beltY = cy + r * Math.cos(P.waist);
    add(new THREE.TorusGeometry(beltR, 0.032, 8, 40).rotateX(Math.PI / 2).scale(1, 1, belly), C.belt, 0, beltY, 0);
    box(0.1, 0.075, 0.03, C.buckle, 0, beltY, beltR * belly + 0.02);

    const gap = 0.78; // 재킷 앞 열린 각도의 절반
    const jacketMat = new THREE.MeshLambertMaterial({ color: C.jacket, side: THREE.DoubleSide });
    const jacket = add(new THREE.SphereGeometry(r * 1.06, 32, 18, Math.PI / 2 + gap, Math.PI * 2 - gap * 2, 0.32, 1.72), jacketMat, 0, cy, 0);
    jacket.scale.z = belly;
    for (const s of [-1, 1]) { // 라펠: 위는 벌어지고 아래로 모이는 V
      const lapel = box(0.1, 0.3, 0.025, C.lapel, s * 0.2, cy + 0.3, 0.44);
      lapel.rotation.set(-0.55, 0, -s * 0.32);
    }

    // 짧은 넥타이 (배 위에 살짝 얹힘)
    box(0.08, 0.06, 0.05, C.tie, 0, cy + 0.31, 0.48);
    const blade = add(new THREE.ConeGeometry(0.05, 0.15, 4).rotateZ(Math.PI), C.tie, 0, cy + 0.21, 0.55);
    blade.rotation.x = -0.6;
    blade.scale.z = 0.45;

    // 발
    this.feet = [-1, 1].map((s) => ball(0.1, C.feet, s * 0.17, 0.05, 0.22, 1, 0.45, 1.3));

    // ---- 팔(날개): 재킷 소매 + 깃털 손. 어깨에서 몸 옆으로 내림 ----
    this.wings = [-1, 1].map((s) => {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.46, cy + 0.36, 0);
      add(new THREE.CylinderGeometry(0.085, 0.11, 0.36, 12), jacketMat, 0, -0.18, 0, pivot); // 소매
      ball(0.115, C.shirt, 0, -0.37, 0, 1, 0.35, 1, pivot);                                  // 셔츠 소맷부리
      ball(0.12, C.feather, 0, -0.47, 0, 0.6, 1.15, 0.9, pivot);                             // 깃털 손
      const thumb = ball(0.06, C.feather, -s * 0.07, -0.42, 0.06, 1, 1.6, 1, pivot);         // 엄지 (엄지 척일 때만)
      thumb.visible = false;
      this.body.add(pivot);
      return { pivot, thumb, side: s, rx: 0, rz: s * 0.25 };
    });

    // ---- 머리 (끄덕임 축): 몸과 거의 1:1로 크고 둥글게 ----
    this.head = new THREE.Group();
    this.head.position.y = P.head.y;
    this.body.add(this.head);
    const h = this.head, E = P.eye;
    ball(P.head.radius, C.feather, 0, 0, 0, 1.05, 1, 1, h);
    ball(0.38, C.face, 0, -0.06, 0.3, 1.12, 0.95, 0.5, h); // 얼굴판
    for (const s of [-1, 1]) {
      const ex = s * E.x;
      ball(E.radius, C.eye, ex, E.y, 0.44, 1, 1, 0.45, h);               // 눈 테두리
      ball(E.radius * 0.78, C.pupil, ex, E.y, 0.48, 1, 1, 0.4, h);       // 큰 검은 눈동자
      ball(0.036, '#ffffff', ex - 0.045, E.y + 0.05, 0.535, 1, 1, 0.4, h); // 반짝임 큰 점
      ball(0.018, '#ffffff', ex + 0.04, E.y - 0.04, 0.53, 1, 1, 0.4, h);   // 반짝임 작은 점
      ball(0.075, C.cheek, s * 0.34, -0.21, 0.33, 1.2, 0.7, 0.35, h);     // 볼터치
      const tuft = add(new THREE.ConeGeometry(0.09, 0.26, 6), C.tuft, s * 0.28, 0.45, 0, h); // 깃털 뿔
      tuft.rotation.z = -s * 0.45;
    }
    const beak = add(new THREE.ConeGeometry(0.035, 0.08, 8), C.beak, 0, -0.2, 0.51, h); // 작고 짧은 부리
    beak.rotation.x = Math.PI / 2 + 0.6;

    // 은색 가는 사각테 돋보기: 눈보다 작게, 부리 쪽으로 내려 눈 아래 절반에 걸침
    const G = { y: E.y - 0.11, z: 0.565, w: 0.17, h: 0.09, t: 0.012 };
    const lensMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.12, depthWrite: false });
    for (const s of [-1, 1]) {
      const gx = s * (E.x - 0.01);
      box(G.w, G.t, G.t, C.glasses, gx, G.y + G.h / 2, G.z, h);
      box(G.w, G.t, G.t, C.glasses, gx, G.y - G.h / 2, G.z, h);
      box(G.t, G.h, G.t, C.glasses, gx - G.w / 2, G.y, G.z, h);
      box(G.t, G.h, G.t, C.glasses, gx + G.w / 2, G.y, G.z, h);
      add(new THREE.PlaneGeometry(G.w, G.h), lensMat, gx, G.y, G.z - 0.003, h).castShadow = false;
      // 안경다리: 렌즈 바깥쪽 끝 → 머리 옆
      const a = new THREE.Vector3(gx + s * G.w / 2, G.y + 0.02, G.z), b = new THREE.Vector3(s * 0.48, -0.02, 0.1);
      const temple = box(G.t, G.t, a.distanceTo(b), C.glasses, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, h);
      temple.rotation.order = 'YXZ';
      temple.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      temple.rotation.x = -Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
    }
    box(2 * (E.x - 0.01 - G.w / 2), G.t, G.t, C.glasses, 0, G.y + 0.025, G.z, h); // 코걸이 다리
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
    return out.set(0, P.head.y + 0.8, 0).multiplyScalar(P.scale).add(this.object.position);
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
    this.body.position.y = Math.abs(s) * W.bounce * walk01 + breath * 0.012 * (1 - walk01);
    this.body.scale.set(1 + breath * 0.008, 1 - breath * 0.006, 1 + breath * 0.008);
    this.feet[0].position.y = 0.05 + Math.max(0, s) * 0.12 * walk01;
    this.feet[1].position.y = 0.05 + Math.max(0, -s) * 0.12 * walk01;

    // 말할 때 끄덕임, stern이면 고개 숙임
    const nod = this.talking ? Math.sin(t * P.nod.rate) * P.nod.amount : 0;
    const tilt = this.pose === 'stern' ? 0.14 : 0;
    this.head.rotation.x += (nod + tilt - this.head.rotation.x) * Math.min(1, dt * 12);

    // 팔(날개). rx: 앞뒤(음수 = 앞으로 듦), rz: 옆으로 벌림 (side 방향이 바깥)
    // 오른쪽 날개 = 로컬 -x (side -1)가 손짓·가리키기·엄지를 맡는다
    for (const w of this.wings) {
      const right = w.side < 0;
      let rx = Math.sin(this.phase) * 0.35 * w.side * walk01; // 걸을 때 앞뒤로 흔들
      let rz = w.side * (0.25 + breath * 0.03);               // 몸 옆에 자연스럽게
      if (this.pose === 'thumbsUp') {
        if (right) { rx = -0.2; rz = w.side * 2.5; }          // 옆 위로 번쩍, 엄지 척
      } else if (this.gesture === 'point') {
        if (right) { rx = -1.5; rz = w.side * 0.12; }         // 카메라를 가리킴
      } else if (this.gesture === 'emphasis') {
        rx = -0.35; rz = w.side * 1.1;                        // 양 날개를 살짝 벌림
      } else if (this.talking && right) {
        const wave = 0.5 + 0.5 * Math.sin(t * 5);              // 가볍게 들었다 내렸다
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
