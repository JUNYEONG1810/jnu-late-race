// 부엉이 교수님: 도형으로 만든 캐릭터, 뒤뚱 걷기·끄덕임·엄지 동작, 그리고 말풍선.
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
    this.pose = 'rest';  // rest(뒷짐) | thumbsUp | stern
    this.phase = 0;
    this.time = 0;
    this.thumb = 0;      // 엄지 동작 정도 0~1
  }

  build() {
    const C = P.colors;
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const ball = (r, c, x, y, z, sx = 1, sy = 1, sz = 1, parent = this.body) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), typeof c === 'string' ? mat(c) : c);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // 몸통 + 배
    ball(P.body.radius, C.feather, 0, P.body.y, 0, 1, 1.05, 0.95);
    ball(0.4, C.belly, 0, P.body.y - 0.04, 0.27, 0.85, 0.95, 0.5);
    for (const [x, y] of [[-0.12, 0.5], [0.12, 0.5], [0, 0.38], [-0.14, 0.28], [0.14, 0.28]]) {
      ball(0.05, C.belly_mark, x, y, 0.47, 1, 0.55, 0.4); // 배 깃털 무늬
    }
    // 흰 셔츠 + 넥타이
    ball(0.15, C.shirt, 0, 0.95, 0.36, 1, 1, 0.45);
    const tieMat = mat(C.tie);
    const knot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.05), tieMat);
    knot.position.set(0, 0.97, 0.43);
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.26, 4).rotateZ(Math.PI), tieMat);
    blade.position.set(0, 0.8, 0.45);
    blade.rotation.x = -0.25;
    blade.scale.z = 0.4;
    this.body.add(knot, blade);

    // 발
    this.feet = [-1, 1].map((s) => ball(0.1, C.feet, s * 0.17, 0.05, 0.2, 1, 0.45, 1.3));

    // 날개: 어깨에서 뒤로 모아 뒷짐
    this.wings = [-1, 1].map((s) => {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.4, 0.9, -0.12);
      const wing = ball(0.3, C.wing, 0, -0.28, -0.12, 0.32, 0.95, 0.7, pivot);
      const thumb = ball(0.08, C.wing, s * 0.1, -0.56, 0.02, 1.6, 1, 1, pivot); // 엄지 (엄지 척일 때만)
      thumb.visible = false;
      this.body.add(pivot);
      return { pivot, wing, thumb, side: s };
    });

    // 머리 (끄덕임 축)
    this.head = new THREE.Group();
    this.head.position.y = P.head.y;
    this.body.add(this.head);
    const h = this.head;
    ball(P.head.radius, C.head, 0, 0, 0, 1.08, 0.95, 1, h);
    for (const s of [-1, 1]) {
      ball(0.2, C.belly, s * P.eye.x, 0, 0.33, 1, 1, 0.4, h);                 // 눈 주위 얼굴판
      ball(P.eye.radius, C.eye, s * P.eye.x, 0.02, 0.39, 1, 1, 0.6, h);       // 큰 노란 눈
      ball(0.07, C.pupil, s * P.eye.x, 0.02, 0.46, 1, 1, 0.5, h);             // 눈동자
      ball(0.022, '#ffffff', s * P.eye.x - 0.03, 0.06, 0.5, 1, 1, 0.5, h);    // 눈 반짝임
      // 동그란 금테 안경
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 8, 28), mat(C.glasses));
      ring.position.set(s * P.eye.x, 0.02, 0.5);
      h.add(ring);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.32), mat(C.glasses));
      arm.position.set(s * 0.33, 0.04, 0.34);
      arm.rotation.y = s * 0.35;
      h.add(arm);
      // 머리 위 깃털 뿔
      const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 6), mat(C.tuft));
      tuft.position.set(s * 0.27, 0.42, 0);
      tuft.rotation.z = -s * 0.45;
      h.add(tuft);
    }
    const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.06, 6).rotateZ(Math.PI / 2), mat(C.glasses));
    bridge.position.set(0, 0.06, 0.51);
    h.add(bridge);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.17, 8), mat(C.beak));
    beak.position.set(0, -0.11, 0.47);
    beak.rotation.x = Math.PI / 2 + 0.45; // 앞·아래로
    h.add(beak);
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
    return out.set(0, P.head.y + 0.75, 0).multiplyScalar(P.scale).add(this.object.position);
  }

  update(dt) {
    this.time += dt;
    const W = P.walk;
    if (this.walking) this.phase += dt * W.stepRate;
    else this.phase += (Math.round(this.phase / Math.PI) * Math.PI - this.phase) * Math.min(1, dt * 10); // 발 모으기
    const s = Math.sin(this.phase);
    // 뒤뚱(좌우 기울기) + 통통(위아래)
    const walk01 = this.walking ? 1 : 0;
    this.body.rotation.z = s * W.waddle * walk01;
    this.body.position.y = Math.abs(s) * W.bounce * walk01 + Math.sin(this.time * 2) * 0.008; // 가만히 있어도 숨쉬기
    this.feet[0].position.y = 0.05 + Math.max(0, s) * 0.12 * walk01;
    this.feet[1].position.y = 0.05 + Math.max(0, -s) * 0.12 * walk01;

    // 말할 때 끄덕임, stern이면 고개 살짝 숙임
    const nod = this.talking ? Math.sin(this.time * P.nod.rate) * P.nod.amount : 0;
    const tilt = this.pose === 'stern' ? 0.12 : 0;
    this.head.rotation.x += (nod + tilt - this.head.rotation.x) * Math.min(1, dt * 12);

    // 날개: 평소엔 뒤로 모은 뒷짐, thumbsUp이면 오른쪽 날개(로컬 -x)를 앞으로 들어 엄지 척
    this.thumb += ((this.pose === 'thumbsUp' ? 1 : 0) - this.thumb) * Math.min(1, dt * 8);
    for (const w of this.wings) {
      const up = w.side < 0 ? this.thumb : 0;
      w.pivot.rotation.y = 0;
      w.pivot.rotation.x = 0.7 * (1 - up) + 0.6 * up;                  // 뒤로 젖혀 모으기 / 살짝 앞으로
      w.pivot.rotation.z = -w.side * 0.5 * (1 - up) + w.side * 2.4 * up; // 날개 끝을 등 가운데로 / 옆 위로 번쩍
      w.thumb.visible = up > 0.5;
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
