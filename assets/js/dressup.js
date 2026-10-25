// 꾸미기: 황소 학생 머리(없음·학사모·헤드폰·리본), 얼굴(없음·선글라스·동그란 안경), 목(없음·목도리·나비넥타이).
// 고른 것만 만들어 운전사 학생의 머리(Driver.head)·몸(Driver.root)에 붙이므로 운전·걷기·만세 등 모든 몸짓을 그대로 따라간다.
// 좌표는 머리 가운데(또는 몸 기준점) 기준, Driver 크기 배율 안쪽 단위. 머리 꼭대기 장식은 운전석 지붕에 닿지 않게 낮게.
import * as THREE from 'three';
import { DRIVER as D } from './driver-config.js';

export const DRESS = {
  head: [['none', '없음'], ['cap', '🎓 학사모'], ['phones', '🎧 헤드폰'], ['ribbon', '🎀 리본']],
  face: [['none', '없음'], ['shades', '🕶️ 선글라스'], ['round', '👓 동그란 안경']],
  neck: [['none', '없음'], ['scarf', '🧣 목도리'], ['bowtie', '🎀 나비넥타이']],
};
const KEY = 'jnu-late-race-dress';

export function loadDress() {
  const d = { head: 'none', face: 'none', neck: 'none' };
  try { Object.assign(d, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* 기본값 */ }
  return d;
}
export function saveDress(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* 저장 못 해도 계속 */ } }

// 정점 색으로 한 메시
class Parts {
  constructor() { this.pos = []; this.nor = []; this.col = []; }
  add(geo, color) {
    const g = geo.index ? geo.toNonIndexed() : geo, c = new THREE.Color(color);
    this.pos.push(...g.attributes.position.array);
    this.nor.push(...g.attributes.normal.array);
    for (let i = 0; i < g.attributes.position.count; i++) this.col.push(c.r, c.g, c.b);
    return this;
  }
  mesh() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const m = new THREE.Mesh(g, MAT);
    m.castShadow = true;
    return m;
  }
}
const MAT = new THREE.MeshLambertMaterial({ vertexColors: true });

// 눈 앞 z (머리 겉면 + 조금 앞)
const H = D.head, Y = D.eye;
const faceZ = (x, dy, out = 0.03) => Math.sqrt(Math.max(0, H.r ** 2 - (x / H.sx) ** 2 - dy ** 2)) + out;

const BUILD = {
  // 학사모: 머리 위 낮은 모자 + 납작한 판 + 금색 술 (뿔 사이)
  cap() {
    const p = new Parts();
    p.add(new THREE.CylinderGeometry(0.25, 0.27, 0.1, 16).translate(0, 0.35, -0.01), '#23252b');
    p.add(new THREE.BoxGeometry(0.56, 0.03, 0.56).rotateY(Math.PI / 4).translate(0, 0.415, -0.01), '#23252b');
    p.add(new THREE.SphereGeometry(0.025, 8, 6).translate(0, 0.435, -0.01), '#e8b923');
    p.add(new THREE.BoxGeometry(0.012, 0.012, 0.36).rotateY(Math.PI / 4).translate(0.125, 0.437, 0.115), '#e8b923');
    p.add(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 5).translate(0.25, 0.36, 0.24), '#e8b923');
    p.add(new THREE.ConeGeometry(0.03, 0.08, 8).translate(0.25, 0.26, 0.24), '#e8b923');
    return { head: p.mesh() };
  },
  // 헤드폰: 머리를 넘는 띠 + 양옆 귀덮개
  phones() {
    const p = new Parts();
    p.add(new THREE.TorusGeometry(0.43, 0.028, 6, 24, Math.PI).translate(0, 0.02, -0.04), '#2f3440');
    for (const s of [-1, 1]) {
      p.add(new THREE.CylinderGeometry(0.11, 0.11, 0.09, 16).rotateZ(Math.PI / 2).translate(s * 0.44, 0.0, -0.04), '#ff6b5a');
      p.add(new THREE.CylinderGeometry(0.075, 0.075, 0.1, 14).rotateZ(Math.PI / 2).translate(s * 0.47, 0.0, -0.04), '#3b3f46');
    }
    return { head: p.mesh() };
  },
  // 리본: 머리 위 한쪽에 분홍 리본
  ribbon() {
    const p = new Parts(), c = '#ff7fae';
    const bow = new THREE.Group();
    for (const s of [-1, 1]) p.add(new THREE.ConeGeometry(0.09, 0.16, 8).rotateZ(s * Math.PI / 2).scale(1, 1, 0.55).translate(s * 0.08, 0, 0), c);
    p.add(new THREE.SphereGeometry(0.045, 10, 8).scale(1, 1, 0.8), '#ff5c97');
    const m = p.mesh();
    bow.add(m);
    m.position.set(-0.17, 0.33, 0.12);
    m.rotation.set(0.35, 0.2, 0.45);
    return { head: bow };
  },
  // 선글라스: 짙은 렌즈 둘 + 다리 + 귀까지 걸이
  shades() {
    const p = new Parts();
    const y = Y.dy + 0.005;
    for (const s of [-1, 1]) {
      const x = s * Y.x, z = faceZ(x, y, 0.035);
      p.add(new THREE.CylinderGeometry(0.085, 0.085, 0.02, 16).rotateX(Math.PI / 2).scale(1.12, 0.78, 1).rotateY(s * 0.32).translate(x, y, z), '#1d2026');
      p.add(new THREE.BoxGeometry(0.018, 0.018, 0.3).rotateY(s * 0.2).translate(s * 0.31, y + 0.02, z - 0.16), '#1d2026');
    }
    p.add(new THREE.BoxGeometry(0.09, 0.02, 0.018).translate(0, y + 0.03, faceZ(0, y, 0.05)), '#1d2026');
    return { head: p.mesh() };
  },
  // 동그란 안경: 금색 테
  round() {
    const p = new Parts();
    const y = Y.dy;
    for (const s of [-1, 1]) {
      const x = s * Y.x, z = faceZ(x, y, 0.035);
      p.add(new THREE.TorusGeometry(0.088, 0.011, 6, 20).rotateY(s * 0.32).translate(x, y, z), '#c9a24a');
      p.add(new THREE.BoxGeometry(0.012, 0.012, 0.3).rotateY(s * 0.2).translate(s * 0.31, y + 0.02, z - 0.16), '#c9a24a');
    }
    p.add(new THREE.TorusGeometry(0.04, 0.009, 4, 10, Math.PI).translate(0, y + 0.01, faceZ(0, y, 0.045)), '#c9a24a');
    return { head: p.mesh() };
  },
  // 목도리: 목(머리와 몸 사이)을 감는 빨간 고리 + 흰 줄 + 앞으로 늘어진 끝
  scarf() {
    const p = new Parts(), y = H.y - H.r * 0.82;
    p.add(new THREE.TorusGeometry(0.255, 0.075, 8, 22).rotateX(Math.PI / 2).translate(0, y, 0.0), '#e8574b');
    for (const dy of [-0.035, 0.035]) p.add(new THREE.TorusGeometry(0.262, 0.016, 4, 22).rotateX(Math.PI / 2).translate(0, y + dy, 0), '#fbf6ee');
    p.add(new THREE.BoxGeometry(0.11, 0.28, 0.05).rotateZ(-0.15).rotateX(0.25).translate(0.14, y - 0.15, 0.25), '#e8574b');
    p.add(new THREE.BoxGeometry(0.115, 0.02, 0.055).rotateZ(-0.15).rotateX(0.25).translate(0.12, y - 0.24, 0.27), '#fbf6ee');
    return { body: p.mesh() };
  },
  // 나비넥타이: 목 앞
  bowtie() {
    const p = new Parts(), y = H.y - H.r * 0.86;
    for (const s of [-1, 1]) p.add(new THREE.ConeGeometry(0.07, 0.12, 4).rotateZ(s * Math.PI / 2).scale(1, 1, 0.5).translate(s * 0.065, y, 0.26), '#e8412c');
    p.add(new THREE.BoxGeometry(0.05, 0.05, 0.04).translate(0, y, 0.27), '#b52f20');
    return { body: p.mesh() };
  },
};

// 고른 옷을 운전사 학생에게 입힘 (전에 입힌 것은 치움). 고른 것만 만든다.
export class Wardrobe {
  constructor(driver) {
    this.driver = driver;
    this.worn = [];
    this.choice = loadDress();
    this.apply(this.choice);
  }
  apply(choice) {
    for (const o of this.worn) {
      o.parent?.remove(o);
      o.traverse((m) => m.geometry?.dispose());
    }
    this.worn = [];
    this.choice = { ...choice };
    for (const slot of ['head', 'face', 'neck']) {
      const id = this.choice[slot];
      if (!id || id === 'none' || !BUILD[id]) continue;
      const parts = BUILD[id]();
      if (parts.head) { this.driver.head.add(parts.head); this.worn.push(parts.head); }
      if (parts.body) { this.driver.root.add(parts.body); this.worn.push(parts.body); }
    }
  }
  set(slot, id) {
    this.apply({ ...this.choice, [slot]: id });
    saveDress(this.choice);
  }
}
