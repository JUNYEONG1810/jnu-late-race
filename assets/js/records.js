// 기록과 도전: 칭호(약 10개, 첫 화면 "칭호"에서 보고 대표 칭호 고르기), 첫 A+ 엔딩(약 20초 캠퍼스 비행 + 크레딧, 건너뛰기),
// 최고 기록 고스트(반투명 굴착기 한 대, 메시 하나), 판마다 무작위 사건(공사 우회·셔틀버스 고장, 미션 장소 피함, 길 안내에 반영).
// 기록은 모두 이 브라우저(localStorage)에만 둔다.
import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { makeBusGeometry } from './life.js';

export const TITLES = [
  { id: 'first', emoji: '📝', name: '첫 출석', hint: '지각 모드를 처음 끝까지 해 보기' },
  { id: 'aplus', emoji: '🅰️', name: '모범생', hint: '지각 모드에서 A+' },
  { id: 'close', emoji: '😅', name: '아슬아슬', hint: '10초 안쪽으로 남기고 A+' },
  { id: 'relaxed', emoji: '😎', name: '여유만만', hint: '40초 넘게 남기고 A+' },
  { id: 'regular', emoji: '🐢', name: '단골 지각생', hint: 'F를 세 번 받기' },
  { id: 'daily', emoji: '📅', name: '오늘의 도전자', hint: '오늘의 도전에서 A+' },
  { id: 'booster', emoji: '🔥', name: '부스터 중독', hint: '부스터를 모두 합쳐 60초 넘게' },
  { id: 'goal', emoji: '⚽', name: '골잡이', hint: '대운동장에서 골 넣기' },
  { id: 'drift', emoji: '🌀', name: '드리프트 장인', hint: '드리프트 한 번에 300점' },
  { id: 'attack', emoji: '🏁', name: '타임어택 완주', hint: '타임어택 세 코스 모두 기록' },
  { id: 'cat', emoji: '🐱', name: '고양이 집사', hint: '고양이를 10번 쓰다듬기' },
  { id: 'stamp', emoji: '🏅', name: '도장 수집가', hint: '캠퍼스 도장 모두 찍기' },
  { id: 'splash', emoji: '💦', name: '물놀이', hint: '용지에 풍덩' },
];
export const RECORD = {
  close: 10, relaxed: 40, regular: 3, booster: 60, drift: 300, pets: 10,
  ghostEvery: 0.1,     // 고스트 기록 간격 (초)
  ending: 20,          // 엔딩 비행 길이 (초)
  eventFar: 60,        // 무작위 사건은 미션 장소·출발점에서 이만큼 떨어진 곳에만
};
const KEY = 'jnu-late-race-records', GHOST_KEY = 'jnu-late-race-ghost';
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 못 해도 계속 */ } };

// ---------- 칭호 ----------
export class Records {
  constructor(hud) {
    this.hud = hud;
    const d = load(KEY, {});
    this.got = d.got || {};           // 칭호 id → 얻은 시각
    this.stats = { runs: 0, f: 0, boost: 0, ...(d.stats || {}) };
    this.current = d.current || null; // 대표 칭호 id
    this.endingSeen = !!d.endingSeen;
    this.dirty = 0;
  }
  save() { save(KEY, { got: this.got, stats: this.stats, current: this.current, endingSeen: this.endingSeen }); }
  get title() { const t = TITLES.find((x) => x.id === this.current); return t ? `${t.emoji} ${t.name}` : null; }
  setCurrent(id) { if (this.got[id]) { this.current = id; this.save(); } }
  // 얻었으면 true (처음일 때만 알림)
  unlock(id) {
    if (this.got[id]) return false;
    this.got[id] = Date.now();
    this.current = id; // 새로 얻은 칭호를 대표로
    this.save();
    const t = TITLES.find((x) => x.id === id);
    this.hud.toast(`🎖️ 칭호 획득: ${t.emoji} ${t.name}`, 3000);
    return true;
  }
  // 지각 모드 한 판이 끝남. 돌려줌: 이번에 새로 얻은 칭호 이름들
  run({ grade, remaining, daily }) {
    const before = Object.keys(this.got).length;
    const fresh = [];
    const u = (id) => { if (this.unlock(id)) fresh.push(id); };
    this.stats.runs++;
    u('first');
    if (grade === 'F') { this.stats.f++; if (this.stats.f >= RECORD.regular) u('regular'); }
    if (grade === 'A+') {
      u('aplus');
      if (remaining <= RECORD.close) u('close');
      if (remaining >= RECORD.relaxed) u('relaxed');
      if (daily) u('daily');
    }
    this.save();
    return { fresh: fresh.map((id) => TITLES.find((t) => t.id === id)), any: before !== Object.keys(this.got).length };
  }
  // 놀거리·산책에서 오는 일
  event(name, v = {}) {
    if (name === 'goal') this.unlock('goal');
    if (name === 'drift' && v.score >= RECORD.drift) this.unlock('drift');
    if (name === 'courses' && v.done >= v.total) this.unlock('attack');
    if (name === 'pet' && v.count >= RECORD.pets) this.unlock('cat');
    if (name === 'stamps' && v.done >= v.total) this.unlock('stamp');
    if (name === 'splash') this.unlock('splash');
  }
  // 부스터 쓴 시간 (매 프레임)
  boost(dt) {
    this.stats.boost += dt;
    if ((this.dirty += dt) > 5) { this.dirty = 0; this.save(); }
    if (this.stats.boost >= RECORD.booster) this.unlock('booster');
  }
}

// ---------- 고스트: 최고 기록(A+, 남은 시간 가장 긴 판)의 굴착기 움직임을 반투명 굴착기 한 대로 ----------
export class Ghost {
  constructor(scene, car) {
    this.car = car;
    this.mesh = new THREE.Mesh(mergeObject(car.object), new THREE.MeshBasicMaterial({
      color: '#9fd8ff', transparent: true, opacity: 0.32, depthWrite: false,
    }));
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.best = load(GHOST_KEY, null); // { order: 미션 순서, every, data: [x, z, heading, ...] }
    this.rec = null;
    this.acc = 0;
  }
  // 판 시작: 기록을 새로 시작. order가 최고 기록과 같을 때만 재생
  start(order) { this.rec = []; this.acc = 0; this.order = order; }
  stop() { this.rec = null; this.mesh.visible = false; }
  // 결과: A+이고 최고 기록이면 저장
  finish(isBest) {
    if (isBest && this.rec && this.rec.length > 10) {
      this.best = { order: this.order, every: RECORD.ghostEvery, data: this.rec };
      save(GHOST_KEY, this.best);
    }
    this.rec = null;
  }
  // elapsed: 지각 모드 경과 시간, play: 기록·재생 중인지, show: 보일지(설정)
  update(dt, elapsed, play, show) {
    if (play && this.rec) {
      this.acc += dt;
      while (this.acc >= RECORD.ghostEvery) {
        this.acc -= RECORD.ghostEvery;
        const c = this.car;
        this.rec.push(+c.pos.x.toFixed(2), +c.pos.y.toFixed(2), +c.heading.toFixed(3));
      }
    }
    const B = this.best;
    const on = play && show && B && B.order === this.order;
    this.mesh.visible = !!on;
    if (!on) return;
    const D = B.data, n = D.length / 3, f = elapsed / B.every, i = Math.min(n - 2, Math.floor(f)), k = Math.min(1, f - i);
    if (i < 0) return;
    const x = D[i * 3] + (D[i * 3 + 3] - D[i * 3]) * k, z = D[i * 3 + 1] + (D[i * 3 + 4] - D[i * 3 + 1]) * k;
    let h = D[i * 3 + 5] - D[i * 3 + 2];
    h = Math.atan2(Math.sin(h), Math.cos(h));
    this.mesh.position.set(x, heightAt(x, z), z);
    this.mesh.rotation.set(0, D[i * 3 + 2] + h * k, 0);
    // 기록이 끝나면(이미 도착) 서서히 사라짐
    this.mesh.material.opacity = f > n ? Math.max(0, 0.32 - (f - n) * 0.02) : 0.32;
    if (this.mesh.material.opacity === 0) this.mesh.visible = false;
  }
}

// 굴착기 모양을 지금 자세 그대로 한 메시로 (고스트용, 그리기 1번)
function mergeObject(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), m = new THREE.Matrix4();
  const pos = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position || o.geometry.attributes.position.count === 0) return;
    for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return;
    if (o.material?.transparent) return; // 유리창은 빼서 더 투명하게
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
    g.applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld));
    pos.push(...g.attributes.position.array);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return geo;
}

// ---------- 첫 A+ 엔딩: 캠퍼스 위를 천천히 나는 카메라 + 크레딧 (Esc·Space·클릭으로 건너뛰기) ----------
// 멀미 방지: 구간마다 ease-in-out, 롤 없음, FOV 고정, 시선은 각도(yaw·pitch)로 보간
export class Ending {
  constructor(rig, camera, campus, stage) {
    this.rig = rig;
    this.camera = camera;
    this.active = false;
    const B = (n) => campus.buildings.find((b) => b.name === n)?.center;
    const water = campus.greens.find((g) => g.kind === 'water');
    const wc = water ? [water.outline.reduce((s, p) => s + p[0], 0) / water.outline.length, water.outline.reduce((s, p) => s + p[1], 0) / water.outline.length] : null;
    const spots = [[stage.to.x, stage.to.z], B('용봉관'), wc, B('중앙도서관'), B('대학본부'), campus.spawn.position].filter(Boolean);
    this.keys = spots.map(([x, z], i) => { // 둘레를 돌며 내려다봄
      const a = i * 1.3 + 0.6, d = 70 + i * 6, y = heightAt(x, z);
      const pos = new THREE.Vector3(x + Math.sin(a) * d, y + 34 + i * 4, z + Math.cos(a) * d);
      return { pos, ...angles(pos, new THREE.Vector3(x, y + 6, z)) };
    });
    const last = this.keys[this.keys.length - 1]; // 끝: 높이 올라가 캠퍼스 전체
    const top = new THREE.Vector3(last.pos.x * 0.5, last.pos.y + 180, last.pos.z * 0.5 + 260);
    this.keys.push({ pos: top, ...angles(top, new THREE.Vector3(0, 0, 0)) });
    this.cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 55 };
  }
  start(onEnd) {
    this.active = true;
    this.t = 0;
    this.onEnd = onEnd;
    this.prevCine = this.rig.cine;
    this.rig.setCinematic(this.cam);
    document.body.classList.add('ending');
    const el = document.getElementById('ending');
    el.classList.remove('hidden');
    const roll = el.querySelector('.ending-roll');
    roll.style.animation = 'none';
    void roll.offsetWidth;
    roll.style.animation = '';
  }
  skip() { if (this.active) this.end(); }
  end() {
    this.active = false;
    this.rig.setCinematic(this.prevCine || null);
    document.body.classList.remove('ending');
    document.getElementById('ending').classList.add('hidden');
    this.onEnd?.();
  }
  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const K = this.keys, seg = RECORD.ending / (K.length - 1);
    const f = Math.min(K.length - 1.0001, this.t / seg), i = Math.floor(f), k = ease(f - i);
    const a = K[i], b = K[i + 1];
    this.cam.pos.lerpVectors(a.pos, b.pos, k);
    const yaw = a.yaw + angleDiff(b.yaw, a.yaw) * k, pitch = a.pitch + (b.pitch - a.pitch) * k;
    this.cam.look.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(20).add(this.cam.pos);
    this.cam.pos.y = Math.max(this.cam.pos.y, heightAt(this.cam.pos.x, this.cam.pos.z) + 1.2);
    if (this.t >= RECORD.ending + 2) this.end();
  }
}
function angles(from, to) {
  const d = new THREE.Vector3().subVectors(to, from).normalize();
  return { yaw: Math.atan2(d.x, d.z), pitch: Math.asin(d.y) };
}
function ease(k) { return k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; }
function angleDiff(a, b) { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }

// ---------- 판마다 무작위 사건: 공사로 길 막힘 / 셔틀버스 고장으로 길 막힘 ----------
// 다음 미션으로 가는 가장 짧은 길 위, 미션 장소·출발점에서 60m 넘게 떨어진 한 곳을 막는다(굴착기 충돌 + 길 안내 우회).
export class RunEvents {
  constructor(scene, campus, collider) {
    this.campus = campus;
    this.collider = collider;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.barrier = new THREE.Mesh(barrierGeometry(), this.mat);
    this.bus = new THREE.Mesh(makeBusGeometry(), this.mat);
    this.barrier.visible = this.bus.visible = false;
    this.group.add(this.barrier, this.bus);
    this.ids = [];
    this.current = null;
  }
  // 지각 모드 시작: 사건 하나를 고름 (gate: 출발점, targets: 미션 장소들, graph: 길 안내 그래프)
  pick(graph, start, targets) {
    this.clear(graph);
    const far = (x, z) => [start, ...targets].every((t) => Math.hypot(t.x - x, t.z - z) > RECORD.eventFar);
    // 다음 미션으로 가는 길 위의 후보 점 (구간 가운데쯤)
    const cands = [];
    let from = start;
    for (const t of targets) {
      const path = graph.path(from.x, from.z, t.x, t.z);
      for (let i = 1; i < path.length - 2; i++) {
        const [x0, z0] = path[i], [x1, z1] = path[i + 1], L = Math.hypot(x1 - x0, z1 - z0);
        if (L < 12) continue;
        const x = (x0 + x1) / 2, z = (z0 + z1) / 2;
        if (far(x, z)) cands.push({ x, z, ux: (x1 - x0) / L, uz: (z1 - z0) / L, from, to: t });
      }
      from = t;
    }
    for (let tries = 0; tries < 12 && cands.length; tries++) {
      const c = cands.splice(Math.floor(Math.random() * cands.length), 1)[0];
      const kind = Math.random() < 0.5 ? 'construction' : 'bus';
      graph.block(c.x, c.z, 6);
      // 막아도 다음 미션에 갈 수 있어야 함
      const p = graph.path(c.from.x, c.from.z, c.to.x, c.to.z);
      if (!p.ok) { graph.clearBlocks(); continue; }
      this.place(kind, c);
      this.current = { kind, x: c.x, z: c.z, near: nearestName(this.campus, c.x, c.z) };
      return this.current;
    }
    return null;
  }
  place(kind, c) {
    const road = nearestRoadWidth(this.campus, c.x, c.z);
    const w = road + 3, yaw = Math.atan2(c.ux, c.uz), m = kind === 'bus' ? this.bus : this.barrier;
    m.visible = true;
    m.position.set(c.x, heightAt(c.x, c.z), c.z);
    if (kind === 'bus') m.rotation.set(0, yaw + Math.PI / 2 + 0.25, 0); // 비스듬히 길을 가로막고 섬
    else { m.rotation.set(0, yaw, 0); m.scale.set(w / 10, 1, 1); }
    // 충돌: 길을 가로지르는 사각형 (길이 방향 3m, 폭 w)
    const half = [w / 2, kind === 'bus' ? 2.5 : 1.5];
    const rx = -c.uz, rz = c.ux; // 길에 수직
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [c.x + rx * a * half[0] + c.ux * b * half[1], c.z + rz * a * half[0] + c.uz * b * half[1]]);
    this.ids.push(this.collider.addObstacle(pts, kind === 'bus' ? '고장 난 셔틀버스' : '공사 중'));
  }
  clear(graph) {
    this.barrier.visible = this.bus.visible = false;
    this.barrier.scale.set(1, 1, 1);
    if (this.ids.length) this.collider.setEnabled(this.ids, false);
    this.ids = [];
    graph?.clearBlocks();
    this.current = null;
  }
}

function nearestRoadWidth(campus, x, z) {
  let best = 6, bd = Infinity;
  for (const r of campus.roads) {
    if (!r.car) continue;
    for (let i = 0; i < r.points.length - 1; i++) {
      const [x1, z1] = r.points[i], [x2, z2] = r.points[i + 1];
      const dx = x2 - x1, dz = z2 - z1, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / L2));
      const d = Math.hypot(x1 + dx * t - x, z1 + dz * t - z);
      if (d < bd) { bd = d; best = r.width; }
    }
  }
  return best;
}
function nearestName(campus, x, z) {
  let best = null, bd = 120;
  for (const b of campus.buildings) {
    if (!b.name) continue;
    const d = Math.hypot(b.center[0] - x, b.center[1] - z);
    if (d < bd) { bd = d; best = b.name; }
  }
  return best;
}

// 공사 가림막(주황·흰 줄무늬 판 + 다리) + 고깔 4개, 폭 10m 기준 (길 폭에 맞춰 x로 늘림)
function barrierGeometry() {
  const pos = [], nor = [], col = [];
  const add = (geo, color) => {
    const g = geo.toNonIndexed(), c = new THREE.Color(color);
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b);
  };
  for (let i = 0; i < 10; i++) {
    for (const y of [0.55, 0.95]) add(new THREE.BoxGeometry(0.98, 0.26, 0.08).translate(-4.5 + i, y, 0), (i + (y > 0.7 ? 1 : 0)) % 2 ? '#f6f4ee' : '#f07a1e');
  }
  for (const x of [-4.8, -1.6, 1.6, 4.8]) add(new THREE.BoxGeometry(0.08, 1.1, 0.5).translate(x, 0.55, 0), '#3b3f46');
  for (const x of [-3.2, 0, 3.2]) {
    add(new THREE.ConeGeometry(0.22, 0.7, 8).translate(x, 0.35, 1.2), '#f07a1e');
    add(new THREE.CylinderGeometry(0.15, 0.17, 0.12, 8).translate(x, 0.42, 1.2), '#f6f4ee');
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}
