// 캠퍼스 산책 (걷는 중에 즐기는 것들): 벤치에 앉기, 용지 오리, 고양이 쓰다듬기, 산책하는 교수님(자유 주행만),
// 동물 학생들(보행로를 걷고 황소·굴착기를 미리 비켜 감, G로 서로 손 흔들기), 명소 도장, 물에 빠지면 풍덩 물보라.
// 오리·고양이는 InstancedMesh, 동물 학생은 몸 1 + 흔드는 팔 1 메시. 멀리 있는 것은 계산을 쉰다.
// 5·18 기념물과 인물상 둘레에는 오리·고양이·동물 학생·도장을 두지 않는다.
import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { pointInPolygon, area } from './map.js';
import { LIFE_LINES } from './dialogue-data.js';

export const LIFE = {
  far: 130,            // 이보다 멀면 계산을 쉼 (m)
  quiet: 45,           // 5·18 기념물·인물상 둘레 이 거리 안에는 아무것도 두지 않음
  ducks: 5, cats: 4, students: 6,
  duck: { speed: 0.5, flee: 1.8, fear: 9, back: 5 },   // 오리: 헤엄, 도망, 겁먹는 거리, 돌아오기까지 (초)
  cat: { pet: 2.4 },                                      // 쓰다듬을 수 있는 거리
  student: { speed: 1.05, dodge: 9, dodgeWalk: 3, minWalker: 1.2, minCar: 3.6, side: 2.4, sideWalk: 1.1, greet: 5 }, // 굴착기는 멀리서·크게, 걷는 황소는 가까이서·살짝 비킴
  prof: { meet: 5, again: 25, pace: 12, show: 80 },       // 교수님: 말 거는 거리, 다시 말하기까지, 앞뒤로 걷는 거리, 이 안에서만 보임 (메시 105개라 가까이에서만)
  bench: { reach: 2.0, seat: 0.42 },
  stamp: { near: 14 },
  splash: 10,                                             // 물보라 조각 수
};
// 5·18 관련 장소 (이 둘레에는 장난스러운 요소를 두지 않음)
const QUIET_NAMES = ['임을 위한 행진', '5.18사적비', '혁명정신 계승비', '윤상원 열사 흉상', '광주민중항쟁도', '민주마루', '민주역사기념관'];
// 명소 도장: [이름, 이모지, 찾는 법]
const STAMPS = [
  ['용봉관 시계탑', '🕰️', { building: '용봉관' }],
  ['중앙도서관', '📚', { building: '중앙도서관' }],
  ['용지', '🦆', { water: true }],
  ['대운동장', '⚽', { pitch: true }],
  ['공과대 2호관', '🏫', { building: '공과대 2호관' }],
  ['제1학생마루', '☕', { building: '제1학생마루' }],
  ['대학본부', '🏛️', { building: '대학본부' }],
  ['예술대', '🎨', { building: '예술대 1호관' }],
  ['생활관', '🛏️', { building: '생활관 9C동 예향학사' }],
];
const STAMP_KEY = 'jnu-late-race-stamps', PET_KEY = 'jnu-late-race-pets';
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 못 해도 계속 */ } };

// onEvent(이름, 값): 칭호 (records.js) — 'pet' {count}, 'stamps' {done, total}, 'splash'
export function buildCampusLife(scene, { campus, collider, hud, lateMode, walker, car, speak, sounds, onEvent = () => {} }) {
  const group = new THREE.Group();
  scene.add(group);
  const quietPts = [];
  for (const m of campus.monuments || []) if (QUIET_NAMES.some((n) => m.name && m.name.includes(n))) quietPts.push(m.p);
  for (const b of campus.buildings) if (QUIET_NAMES.includes(b.name)) quietPts.push(b.center);
  const isQuiet = (x, z) => quietPts.some((p) => Math.hypot(p[0] - x, p[1] - z) < LIFE.quiet);
  const inCampus = (x, z) => pointInPolygon(x, z, campus.boundary);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });

  const ducks = buildDucks(group, campus, mat);
  const cats = buildCats(group, campus, mat, isQuiet, inCampus);
  const students = buildStudents(group, campus, mat, isQuiet, inCampus, collider);
  const splash = buildSplash(group);
  const benches = (campus.props || []).filter((p) => p.type === 'bench' && !isQuiet(...p.p)).map((p) => ({ x: p.p[0], z: p.p[1] }));
  const stamps = buildStamps(campus, isQuiet);
  const got = load(STAMP_KEY, {});
  let pets = load(PET_KEY, 0);
  hud.setStamps(stamps, got);

  // 산책하는 교수님: 지각 모드의 교수님을 자유 주행 동안 공대 2호관 앞에서 앞뒤로 걷게 (지각 모드 중에는 지각 모드가 맡음)
  const prof = { t: 0, dir: 1, wait: 0, talkT: 0, lineI: -1, on: false, push: new THREE.Vector2() }; // push: 굴착기·황소를 비켜 선 만큼
  const S = lateMode.stage, n = new THREE.Vector2(S.n.x, S.n.z), side = new THREE.Vector2(-n.y, n.x);
  const paceA = new THREE.Vector2(S.to.x, S.to.z).addScaledVector(n, 2), paceB = paceA.clone();
  for (let d = LIFE.prof.pace; d > 2; d -= 1) { // 건물 앞을 따라 막히지 않는 곳까지
    const p = paceA.clone().addScaledVector(side, d);
    if (!collider.resolve(p.clone(), 0.6)) { paceB.copy(p); break; }
  }

  let enabled = true;
  const api = {
    group, ducks, cats, students, stamps,
    get pets() { return pets; },
    setEnabled(on) { // 가벼운 모드: 오리·고양이·동물 학생·산책하는 교수님을 숨김
      enabled = on;
      ducks.mesh.visible = cats.fur.visible = cats.face.visible = on;
      for (const s of students.list) s.object.visible = on;
      if (!on && prof.proxy) { prof.proxy.visible = false; prof.on = false; }
    },
    // E: 고양이 쓰다듬기 > 벤치에 앉기. 했으면 true
    interact() {
      if (!walker.walking) return false;
      const c = enabled ? cats.nearest(walker.pos, LIFE.cat.pet) : null;
      if (c) {
        pets++;
        save(PET_KEY, pets);
        c.happy = 1.2;
        c.look = Math.atan2(walker.pos.x - c.x, walker.pos.y - c.z);
        walker.heading = Math.atan2(c.x - walker.pos.x, c.z - walker.pos.y);
        walker.setEmote(1);
        sounds.meow?.();
        hud.toast(`🐱 냐옹~ (고양이를 쓰다듬은 횟수 ${pets}번)`, 2200);
        onEvent('pet', { count: pets });
        return true;
      }
      const b = benches.reduce((a, q) => { const d = Math.hypot(q.x - walker.pos.x, q.z - walker.pos.y); return d < LIFE.bench.reach && (!a || d < a.d) ? { ...q, d } : a; }, null);
      if (b) {
        walker.sitOn(b.x, b.z, benchYaw(campus, b), LIFE.bench.seat);
        hud.toast('벤치에 앉았어요. 움직이면 일어나요', 1800);
        return true;
      }
      return false;
    },
    // G: 가까운 동물 학생과 서로 손 흔들기. 했으면 true
    greet() {
      if (!walker.walking || !enabled) return false;
      const s = students.nearest(walker.pos, LIFE.student.greet);
      walker.setEmote(1);
      if (!s) return false;
      s.wave = 2.4;
      s.stop = 2.6;
      s.face = Math.atan2(walker.pos.x - s.pos.x, walker.pos.y - s.pos.y);
      const line = LIFE_LINES.student[Math.floor(Math.random() * LIFE_LINES.student.length)].replace('{emoji}', s.kind.emoji);
      hud.sayNpc(line, speak(line, { pitch: s.kind.pitch }), () => s.headTop());
      return true;
    },
    splashAt(x, z) { splash.start(x, (ducks.level ?? heightAt(x, z)) + 0.08, z); sounds.splash?.(); ducks.scare(x, z, 30); onEvent('splash'); },

    update(dt, camera, focus, free) {
      const walking = walker.active;
      const threats = [];
      if (walking) threats.push({ x: walker.pos.x, z: walker.pos.y, r: LIFE.student.minWalker });
      threats.push({ x: car.pos.x, z: car.pos.y, r: LIFE.student.minCar, car: true, v: car.vel });
      splash.update(dt);
      if (!enabled) return;
      ducks.update(dt, focus, threats);
      cats.update(dt, focus, walking ? walker.pos : null);
      students.update(dt, focus, threats, collider);
      // 도장 (걸어서만)
      if (walker.walking) {
        for (const s of stamps) {
          if (got[s.name] || !s.near(walker.pos.x, walker.pos.y)) continue;
          got[s.name] = Date.now();
          save(STAMP_KEY, got);
          hud.setStamps(stamps, got);
          const n = Object.keys(got).length;
          hud.toast(`${s.emoji} ${s.name} 도장 쾅! (${n}/${stamps.length})${n === stamps.length ? ' — 도장판 완성!' : ''}`, 2600);
          sounds.stamp?.();
          onEvent('stamps', { done: n, total: stamps.length });
        }
      }
      this.updateProfessor(dt, camera, focus, free);
    },

    // 산책하는 교수님: 지각 모드 교수님(메시 105개)을 그대로 쓰면 그리기 호출이 크게 늘어서, 서 있는 모습을 메시 하나로 합친
    // 가벼운 대역(정점 색)을 걷게 한다. 몸 전체를 뒤뚱뒤뚱 흔들고, 말할 때 끄덕임. 지각 모드는 원래 교수님 그대로.
    updateProfessor(dt, camera, focus, free) {
      const P = lateMode.professor;
      if (!P) return;
      if (!prof.proxy) { prof.proxy = professorProxy(P); prof.proxy.visible = false; group.add(prof.proxy); }
      const Q = prof.proxy;
      const show = free && enabled && Math.hypot(paceA.x - focus.x, paceA.y - focus.y) < LIFE.prof.show;
      if (!show) { Q.visible = false; prof.on = false; return; }
      if (!prof.on) { prof.on = true; Q.visible = true; prof.t = 0; prof.ph = 0; }
      const who = walker.active ? walker.pos : car.pos;
      const here = new THREE.Vector2(Q.position.x, Q.position.z);
      const d = here.distanceTo(who);
      prof.talkT = Math.max(0, prof.talkT - dt);
      if (d < LIFE.prof.meet && prof.talkT === 0) { // 만나면 멈춰서 한마디
        prof.talkT = LIFE.prof.again;
        prof.wait = 5.5; // 말풍선이 끝날 때까지 바라봄
        let i = Math.floor(Math.random() * LIFE_LINES.professor.length);
        if (i === prof.lineI) i = (i + 1) % LIFE_LINES.professor.length;
        prof.lineI = i;
        const line = LIFE_LINES.professor[i];
        const voice = speak(line);
        prof.talk = voice.duration;
        hud.sayNpc(line, voice, () => Q.position.clone().setY(Q.position.y + Q.userData.top + 0.25), '교수님');
      }
      prof.talk = Math.max(0, (prof.talk || 0) - dt);
      if (d < 1.6 && prof.wait <= 0) prof.wait = 1; // 황소·굴착기와 부딪히지 않게 잠깐 멈춤
      // 굴착기(3.6m)·황소(1.2m)보다 가까워지면 그만큼 옆으로 비켜 서고, 멀어지면 천천히 제자리로
      const base = paceA.clone().lerp(paceB, prof.t);
      const away = base.clone().add(prof.push);
      let pushed = false;
      for (const [q, r] of [[car.pos, LIFE.student.minCar], ...(walker.active ? [[walker.pos, LIFE.student.minWalker]] : [])]) {
        let dx = away.x - q.x, dz = away.y - q.y, dd = Math.hypot(dx, dz);
        if (dd < 1e-3) { dx = n.x; dz = n.y; dd = 1; } // 딱 겹치면 건물 바깥쪽으로
        if (dd < r) { away.set(q.x + (dx / dd) * r, q.y + (dz / dd) * r); pushed = true; }
      }
      prof.push.copy(away).sub(base);
      if (!pushed) prof.push.multiplyScalar(Math.exp(-dt * 0.8));
      let walking = false, yaw = Q.rotation.y;
      if (prof.wait > 0) {
        Q.position.set(away.x, heightAt(away.x, away.y), away.y);
        prof.wait -= dt;
        yaw = Math.atan2(who.x - here.x, who.y - here.y);
      } else {
        const L = paceA.distanceTo(paceB);
        prof.t += prof.dir * dt * 0.55 / Math.max(1, L);
        if (prof.t > 1 || prof.t < 0) { prof.t = THREE.MathUtils.clamp(prof.t, 0, 1); prof.dir *= -1; prof.wait = 1.5; }
        const p = paceA.clone().lerp(paceB, prof.t).add(prof.push);
        Q.position.set(p.x, heightAt(p.x, p.y), p.y);
        const dir = paceB.clone().sub(paceA).multiplyScalar(prof.dir);
        yaw = Math.atan2(dir.x, dir.y);
        walking = true;
      }
      prof.ph = (prof.ph || 0) + dt * (walking ? 7 : 2);
      const nod = prof.talk > 0 ? Math.sin(prof.ph * 3) * 0.05 : 0;
      Q.rotation.set(nod, yaw, walking ? Math.sin(prof.ph) * 0.07 : 0); // 뒤뚱뒤뚱
      Q.position.y += walking ? Math.abs(Math.sin(prof.ph)) * 0.03 : Math.sin(prof.ph) * 0.005; // 숨쉬기
    },
  };
  return api;
}

// 교수님을 서 있는 모습 그대로 메시 하나로 (재질 색 × 정점 색 → 정점 색). 투명한 안경알 등은 뺌
function professorProxy(P) {
  P.walking = false; P.talking = false; P.pose = 'rest';
  P.update(0);
  P.object.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(P.object.matrixWorld).invert(), m = new THREE.Matrix4();
  const pos = [], nor = [], col = [], c = new THREE.Color();
  P.object.traverse((o) => {
    if (!o.isMesh || o.material.transparent || !o.geometry.attributes.position) return;
    for (let q = o; q && q !== P.object; q = q.parent) if (!q.visible) return;
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
    g.applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld));
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    const vc = o.material.vertexColors && g.attributes.color;
    for (let k = 0; k < g.attributes.position.count; k++) {
      c.copy(o.material.color);
      if (vc) c.multiply(new THREE.Color(vc.getX(k), vc.getY(k), vc.getZ(k)));
      col.push(c.r, c.g, c.b);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingBox();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.scale.copy(P.object.scale);
  mesh.castShadow = true;
  mesh.userData.top = geo.boundingBox.max.y * P.object.scale.y;
  return mesh;
}

// 벤치 방향 (landscape.js와 같은 방식: 가장 가까운 길을 바라봄) 대신 간단히: 가까운 길 쪽 → 걷는 학생은 그쪽을 보고 앉음
function benchYaw(campus, b) {
  let best = null, bd = 20;
  for (const r of campus.roads) {
    for (let i = 0; i < r.points.length - 1; i++) {
      const [x1, z1] = r.points[i], [x2, z2] = r.points[i + 1];
      const dx = x2 - x1, dz = z2 - z1, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((b.x - x1) * dx + (b.z - z1) * dz) / L2));
      const qx = x1 + dx * t, qz = z1 + dz * t, d = Math.hypot(qx - b.x, qz - b.z);
      if (d < bd && d > 0.3) { bd = d; best = [qx, qz]; }
    }
  }
  return best ? Math.atan2(best[0] - b.x, best[1] - b.z) : 0;
}

// ---------- 정점 색 도형 묶음 ----------
class Shape {
  constructor() { this.pos = []; this.nor = []; this.col = []; }
  add(geo, color, m = null) {
    const g = (geo.index ? geo.toNonIndexed() : geo);
    if (m) g.applyMatrix4(m);
    const c = new THREE.Color(color);
    this.pos.push(...g.attributes.position.array);
    this.nor.push(...g.attributes.normal.array);
    for (let i = 0; i < g.attributes.position.count; i++) this.col.push(c.r, c.g, c.b);
    return this;
  }
  // 타원체: 반지름 (rx, ry, rz), 자리 (x, y, z)
  ball(r, color, x, y, z, sx = 1, sy = 1, sz = 1, detail = 1) {
    return this.add(new THREE.IcosahedronGeometry(r, detail).scale(sx, sy, sz).translate(x, y, z), color);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), SC = new THREE.Vector3(), E = new THREE.Euler();

// ---------- 용지 오리 ----------
function buildDucks(group, campus, mat) {
  const s = new Shape();
  s.ball(0.2, '#fbfaf3', 0, 0.12, 0, 1.05, 0.7, 1.45);         // 몸
  s.ball(0.12, '#fbfaf3', 0, 0.33, 0.2, 1, 1, 1);              // 머리
  s.add(new THREE.ConeGeometry(0.05, 0.13, 6).rotateX(Math.PI / 2).scale(1.3, 0.55, 1).translate(0, 0.31, 0.34), '#f2a33a'); // 부리
  for (const sx of [-1, 1]) s.ball(0.022, '#1d1f24', sx * 0.07, 0.36, 0.29, 1, 1, 1, 0);
  s.add(new THREE.ConeGeometry(0.08, 0.14, 5).rotateX(-Math.PI / 2.6).translate(0, 0.2, -0.3), '#f1efe6'); // 꼬리
  const waters = campus.greens.filter((g) => g.kind === 'water');
  const pond = waters.reduce((a, g) => (!a || Math.abs(area(g.outline)) > Math.abs(area(a.outline)) ? g : a), null);
  const N = pond ? 5 : 0;
  const mesh = new THREE.InstancedMesh(s.geometry(), mat, Math.max(1, N));
  mesh.count = N;
  mesh.frustumCulled = false;
  group.add(mesh);
  const list = [];
  if (pond) {
    const o = pond.outline, xs = o.map((p) => p[0]), zs = o.map((p) => p[1]);
    const edgeDist = (x, z) => { let d = Infinity; for (let i = 0; i < o.length; i++) { const a = o[i], b = o[(i + 1) % o.length]; d = Math.min(d, segDist(x, z, a, b)); } return d; };
    const ok = (x, z) => pointInPolygon(x, z, o) && edgeDist(x, z) > 3;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // 엄마 오리 한 마리 + 새끼 넷이 모여 다님
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    let cx = 0, cz = 0;
    for (let k = 0; k < 400; k++) {
      cx = x0 + (x1 - x0) * rnd();
      cz = z0 + (z1 - z0) * rnd();
      if (pointInPolygon(cx, cz, o) && edgeDist(cx, cz) > 10) break;
    }
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, r = i ? 1.6 + rnd() * 1.4 : 0;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      list.push({ x, z, hx: x, hz: z, yaw: rnd() * 6.28, s: i ? 0.62 : 1, fear: 0, wander: rnd() * 5, tx: x, tz: z, ph: rnd() * 6 });
    }
    const D = LIFE.duck;
    const api = {
      mesh, list, level: pond.level,
      scare(x, z, r) { for (const d of list) if (Math.hypot(d.x - x, d.z - z) < r) { d.fear = D.back; d.fx = x; d.fz = z; } },
      update(dt, focus, threats) {
        if (Math.hypot(cx - focus.x, cz - focus.y) > LIFE.far + 60) return;
        for (const t of threats) if (!t.car) for (const d of list) if (Math.hypot(d.x - t.x, d.z - t.z) < D.fear) { d.fear = D.back; d.fx = t.x; d.fz = t.z; }
        list.forEach((d, i) => {
          let vx = 0, vz = 0, sp = D.speed;
          if (d.fear > 0) { // 도망: 겁준 곳 반대쪽으로 빠르게
            d.fear -= dt;
            const ax = d.x - d.fx, az = d.z - d.fz, L = Math.hypot(ax, az) || 1;
            vx = ax / L; vz = az / L; sp = D.flee;
          } else { // 집(무리 자리) 둘레를 천천히 헤엄
            if ((d.wander -= dt) <= 0) { d.wander = 3 + Math.random() * 4; d.tx = d.hx + (Math.random() - 0.5) * 6; d.tz = d.hz + (Math.random() - 0.5) * 6; }
            const ax = d.tx - d.x, az = d.tz - d.z, L = Math.hypot(ax, az);
            if (L > 0.3) { vx = ax / L; vz = az / L; sp = D.speed * Math.min(1, L / 2); }
          }
          const nx = d.x + vx * sp * dt, nz = d.z + vz * sp * dt;
          if (ok(nx, nz)) { d.x = nx; d.z = nz; }
          else if (d.fear > 0) { const L = Math.hypot(cx - d.x, cz - d.z) || 1; d.x += (cx - d.x) / L * sp * dt * 0.5; d.z += (cz - d.z) / L * sp * dt * 0.5; }
          if (vx || vz) d.yaw += angleDiff(Math.atan2(vx, vz), d.yaw) * Math.min(1, dt * 5);
          d.ph += dt * (d.fear > 0 ? 9 : 2.5);
          const y = (pond.level ?? heightAt(d.x, d.z)) + 0.08 + Math.sin(d.ph) * 0.015;
          M4.compose(V.set(d.x, y, d.z), Q.setFromEuler(E.set(Math.sin(d.ph * 0.8) * 0.06, d.yaw, Math.sin(d.ph) * 0.05)), SC.setScalar(d.s));
          mesh.setMatrixAt(i, M4);
        });
        mesh.instanceMatrix.needsUpdate = true;
      },
    };
    api.update(0, { x: cx, y: cz }, []);
    return api;
  }
  return { mesh, list, scare() {}, update() {} };
}

// ---------- 고양이 ----------
const CAT_COATS = ['#f0a35b', '#8f9198', '#f4efe4', '#5b5550'];
function buildCats(group, campus, mat, isQuiet, inCampus) {
  // 털(인스턴스 색으로 무늬) + 얼굴·발 같은 고정 색, 두 메시
  const fur = new Shape(), face = new Shape();
  fur.ball(0.17, '#ffffff', 0, 0.16, -0.02, 1, 0.95, 1.35);           // 식빵 자세 몸
  fur.ball(0.13, '#ffffff', 0, 0.33, 0.17, 1.1, 0.95, 1);              // 머리
  for (const sx of [-1, 1]) fur.add(new THREE.ConeGeometry(0.05, 0.1, 4).rotateZ(-sx * 0.25).translate(sx * 0.075, 0.45, 0.16), '#ffffff'); // 귀
  fur.add(new THREE.TorusGeometry(0.13, 0.03, 5, 10, Math.PI * 1.1).rotateY(Math.PI / 2).translate(0.05, 0.12, -0.2), '#ffffff'); // 꼬리 (몸을 감음)
  for (const sx of [-1, 1]) face.ball(0.028, '#2f3a2a', sx * 0.05, 0.35, 0.29, 1, 1.3, 0.6, 0); // 눈
  face.ball(0.018, '#e88a8f', 0, 0.31, 0.3, 1.2, 0.8, 0.8, 0);       // 코
  for (const sx of [-1, 1]) face.ball(0.045, '#fbf6ee', sx * 0.07, 0.05, 0.19, 1, 0.6, 1.2, 0); // 앞발
  const spots = [];
  const benches = (campus.props || []).filter((p) => p.type === 'bench');
  for (const b of benches) {
    const [x, z] = b.p;
    if (isQuiet(x, z) || !inCampus(x, z)) continue;
    if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 120)) continue;
    spots.push({ x: x + 0.9, z: z + 0.6 });
    if (spots.length >= LIFE.cats) break;
  }
  const N = spots.length;
  const furMesh = new THREE.InstancedMesh(fur.geometry(), mat, Math.max(1, N));
  const faceMesh = new THREE.InstancedMesh(face.geometry(), mat, Math.max(1, N));
  furMesh.count = faceMesh.count = N;
  spots.forEach((c, i) => { furMesh.setColorAt(i, new THREE.Color(CAT_COATS[i % CAT_COATS.length])); c.yaw = i * 2.1; c.look = c.yaw; c.happy = 0; c.t = i; });
  if (furMesh.instanceColor) furMesh.instanceColor.needsUpdate = true;
  group.add(furMesh, faceMesh);
  const place = (c, i) => {
    const sq = c.happy > 0 ? 1 + Math.sin(c.happy * 12) * 0.08 : 1 + Math.sin(c.t * 1.8) * 0.015; // 숨쉬기·좋아서 들썩
    M4.compose(V.set(c.x, heightAt(c.x, c.z), c.z), Q.setFromEuler(E.set(0, c.yaw, 0)), SC.set(1, sq, 1));
    furMesh.setMatrixAt(i, M4);
    faceMesh.setMatrixAt(i, M4);
  };
  spots.forEach(place);
  return {
    fur: furMesh, face: faceMesh, list: spots,
    nearest(p, r) { let best = null, bd = r; for (const c of spots) { const d = Math.hypot(c.x - p.x, c.z - p.y); if (d < bd) { bd = d; best = c; } } return best; },
    update(dt, focus, bull) {
      let any = false;
      spots.forEach((c, i) => {
        if (Math.hypot(c.x - focus.x, c.z - focus.y) > LIFE.far) return;
        any = true;
        c.t += dt;
        c.happy = Math.max(0, c.happy - dt);
        if (bull && Math.hypot(bull.x - c.x, bull.y - c.z) < 6) c.look = Math.atan2(bull.x - c.x, bull.y - c.z); // 황소 쪽을 봄
        c.yaw += angleDiff(c.look, c.yaw) * Math.min(1, dt * 2);
        place(c, i);
      });
      if (any) { furMesh.instanceMatrix.needsUpdate = true; faceMesh.instanceMatrix.needsUpdate = true; }
    },
  };
}

// ---------- 동물 학생 ----------
// 몸 색만 다른 저폴리 동물 학생 (토끼·곰·다람쥐·너구리·펭귄). 가방 색으로도 구별
const KINDS = [
  { name: '토끼', emoji: '🐰', body: '#f3efe8', belly: '#fffaf4', bag: '#5b8def', pitch: 2.3, ears: 'rabbit' },
  { name: '곰', emoji: '🐻', body: '#9a6b47', belly: '#d9b48c', bag: '#e8574b', pitch: 1.5, ears: 'round' },
  { name: '다람쥐', emoji: '🐿️', body: '#c97b45', belly: '#f4d9b4', bag: '#46b07a', pitch: 2.5, ears: 'pointy', tail: 'bushy' },
  { name: '너구리', emoji: '🦝', body: '#8e8a86', belly: '#e7e2da', bag: '#f2b134', pitch: 1.9, ears: 'round', mask: true, tail: 'ring' },
  { name: '펭귄', emoji: '🐧', body: '#2f3440', belly: '#fbfbf7', bag: '#ff8fb1', pitch: 2.0, ears: 'none', beak: true },
  { name: '토끼', emoji: '🐰', body: '#d9c2a8', belly: '#f6ece0', bag: '#8a63d2', pitch: 2.2, ears: 'rabbit' },
];
function studentShape(k) {
  const s = new Shape(), arm = new Shape();
  s.ball(0.22, k.body, 0, 0.36, 0, 1, 1.15, 0.9);            // 몸
  s.ball(0.15, k.belly, 0, 0.33, 0.1, 1, 1.2, 0.7);           // 배
  s.ball(0.2, k.body, 0, 0.78, 0.02, 1.08, 0.95, 1);          // 머리
  for (const sx of [-1, 1]) {
    s.ball(0.03, '#1f2329', sx * 0.075, 0.8, 0.19, 1, 1.2, 0.6, 0); // 눈
    s.ball(0.075, k.body, sx * 0.09, 0.06, 0.03, 1, 0.6, 1.3, 0);   // 발
    if (k.ears === 'rabbit') s.ball(0.06, k.body, sx * 0.08, 1.07, -0.01, 0.75, 2.4, 0.55);
    if (k.ears === 'round') s.ball(0.065, k.body, sx * 0.15, 0.95, -0.01, 1, 1, 0.6);
    if (k.ears === 'pointy') s.add(new THREE.ConeGeometry(0.055, 0.13, 4).translate(sx * 0.12, 0.98, 0), k.body);
    if (k.mask) s.ball(0.06, '#3b3836', sx * 0.075, 0.8, 0.165, 1.2, 0.8, 0.5, 0);
  }
  if (k.mask) for (const sx of [-1, 1]) s.ball(0.024, '#fdfdfb', sx * 0.075, 0.81, 0.2, 1, 1, 0.6, 0);
  if (k.beak) s.add(new THREE.ConeGeometry(0.045, 0.1, 6).rotateX(Math.PI / 2).translate(0, 0.74, 0.22), '#f4a338');
  else s.ball(0.03, '#3a2c2a', 0, 0.74, 0.205, 1.2, 0.8, 0.7, 0);  // 코
  if (k.tail === 'bushy') s.ball(0.12, k.body, 0, 0.5, -0.27, 0.9, 1.6, 0.8);
  if (k.tail === 'ring') s.ball(0.07, '#5b5753', 0, 0.3, -0.24, 1, 1, 1.6);
  // 가방 (등에 멘 책가방) + 멜빵
  s.add(new THREE.BoxGeometry(0.3, 0.3, 0.13).translate(0, 0.42, -0.24), k.bag);
  for (const sx of [-1, 1]) s.add(new THREE.BoxGeometry(0.035, 0.3, 0.035).translate(sx * 0.11, 0.48, 0.17), k.bag);
  s.ball(0.055, k.body, 0.22, 0.38, 0.02, 0.8, 1.6, 0.8);       // 왼팔(오른쪽 화면) 고정
  arm.ball(0.055, k.body, 0, -0.1, 0, 0.8, 1.6, 0.8);           // 흔드는 팔 (어깨 기준)
  return [s.geometry(), arm.geometry()];
}
function buildStudents(group, campus, mat, isQuiet, inCampus, collider) {
  // 보행로 중 길고 5·18 장소와 멀며 캠퍼스 안인 곳, 사람들이 자주 가는 곳 가까이
  const foci = ['중앙도서관', '제1학생마루', '공과대 2호관', '용봉관', '대학본부', '예술대 1호관']
    .map((n) => campus.buildings.find((b) => b.name === n)?.center).filter(Boolean);
  const paths = campus.roads.filter((r) => !r.car && ['footway', 'pedestrian', 'path'].includes(r.type)).map((r) => {
    let L = 0;
    for (let i = 1; i < r.points.length; i++) L += Math.hypot(r.points[i][0] - r.points[i - 1][0], r.points[i][1] - r.points[i - 1][1]);
    return { pts: r.points, L };
  }).filter((p) => p.L > 50 && p.pts.every(([x, z]) => !isQuiet(x, z) && inCampus(x, z)));
  const chosen = [];
  for (const f of foci) {
    const cand = paths.filter((p) => !chosen.includes(p) && p.pts.some(([x, z]) => Math.hypot(x - f[0], z - f[1]) < 90))
      .sort((a, b) => b.L - a.L)[0];
    if (cand) chosen.push(cand);
  }
  const list = [];
  chosen.slice(0, LIFE.students).forEach((p, i) => {
    const k = KINDS[i % KINDS.length];
    const [g, ag] = studentShape(k);
    const object = new THREE.Group();
    const body = new THREE.Mesh(g, mat);
    const shoulder = new THREE.Group();
    shoulder.position.set(-0.22, 0.48, 0.02);
    shoulder.add(new THREE.Mesh(ag, mat));
    object.add(body, shoulder);
    body.castShadow = true;
    group.add(object);
    // 경로 누적 거리
    const cum = [0];
    for (let j = 1; j < p.pts.length; j++) cum.push(cum[j - 1] + Math.hypot(p.pts[j][0] - p.pts[j - 1][0], p.pts[j][1] - p.pts[j - 1][1]));
    list.push({
      kind: k, object, body, shoulder, path: p.pts, cum, L: p.L, s: p.L * ((i * 0.37) % 1), dir: i % 2 ? 1 : -1,
      off: 0, pos: new THREE.Vector2(), yaw: 0, ph: i, wave: 0, stop: 0, face: null, pause: 0,
      headTop(v = new THREE.Vector3()) { return v.set(this.pos.x, this.object.position.y + 1.25, this.pos.y); },
    });
  });
  const at = (st, s) => {
    const c = st.cum;
    let j = 1;
    while (j < c.length - 1 && c[j] < s) j++;
    const [x0, z0] = st.path[j - 1], [x1, z1] = st.path[j], t = (s - c[j - 1]) / Math.max(1e-6, c[j] - c[j - 1]);
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz) || 1;
    return [x0 + dx * t, z0 + dz * t, dx / L, dz / L];
  };
  const D = LIFE.student;
  const tmp = new THREE.Vector2();
  const api = {
    list,
    nearest(p, r) { let best = null, bd = r; for (const s of list) { const d = s.pos.distanceTo(p); if (d < bd) { bd = d; best = s; } } return best; },
    update(dt, focus, threats, col) {
      for (const st of list) {
        const far = st.pos.distanceTo(tmp.set(focus.x, focus.y)) > LIFE.far && st.pos.lengthSq() > 0;
        if (far) continue; // 멀면 쉼 (화면에서도 작음)
        st.wave = Math.max(0, st.wave - dt);
        st.stop = Math.max(0, st.stop - dt);
        // 다가오는 황소·굴착기를 미리 알아채고 길 옆으로 비킴
        let want = 0, danger = false;
        const [px, pz, tx, tz] = at(st, st.s);
        for (const t of threats) {
          const dx = t.x - st.pos.x, dz = t.z - st.pos.y, d = Math.hypot(dx, dz);
          const range = t.car ? D.dodge + Math.min(12, (t.v?.length() || 0) * 0.8) : D.dodgeWalk;
          if (d < range) {
            const sideSign = (dx * -tz + dz * tx) > 0 ? -1 : 1; // 위협이 있는 반대쪽
            want = sideSign * (t.car ? D.side * 1.3 : D.sideWalk);
            danger = d < range * 0.6;
          }
        }
        st.off += (want - st.off) * Math.min(1, dt * 3.5);
        const moving = st.stop === 0 && !danger && st.pause <= 0;
        if (st.pause > 0) st.pause -= dt;
        if (moving) {
          st.s += st.dir * D.speed * dt;
          if (st.s > st.L || st.s < 0) { st.s = THREE.MathUtils.clamp(st.s, 0, st.L); st.dir *= -1; st.pause = 1 + Math.random() * 2; }
        }
        const nx = -tz, nz = tx;
        st.pos.set(px + nx * st.off, pz + nz * st.off);
        // 그래도 너무 가까우면 바로 밀려남 (절대 닿지 않게)
        for (const t of threats) {
          const dx = st.pos.x - t.x, dz = st.pos.y - t.z, d = Math.hypot(dx, dz);
          if (d < t.r && d > 1e-4) st.pos.set(t.x + (dx / d) * t.r, t.z + (dz / d) * t.r);
        }
        col.resolve(st.pos, 0.3); // 건물 벽은 뚫지 않게
        const goal = st.face !== null && st.wave > 0 ? st.face : Math.atan2(tx * st.dir, tz * st.dir);
        st.yaw += angleDiff(goal, st.yaw) * Math.min(1, dt * 6);
        if (st.wave === 0) st.face = null;
        st.ph += dt * (moving ? 7 : 2);
        const bob = moving ? Math.abs(Math.sin(st.ph)) * 0.05 : Math.sin(st.ph) * 0.008;
        st.object.position.set(st.pos.x, heightAt(st.pos.x, st.pos.y) + bob, st.pos.y);
        st.object.rotation.set(0, st.yaw, moving ? Math.sin(st.ph) * 0.09 : 0); // 뒤뚱뒤뚱
        st.shoulder.rotation.set(0, 0, st.wave > 0 ? -2.4 + Math.sin(st.wave * 14) * 0.45 : (moving ? Math.sin(st.ph) * 0.3 : 0) - 0.1);
      }
    },
  };
  api.update(0, { x: 0, y: 0 }, [], collider);
  for (const st of list) { // 처음 자리
    const [x, z, tx, tz] = at(st, st.s);
    st.pos.set(x, z);
    st.yaw = Math.atan2(tx * st.dir, tz * st.dir);
    st.object.position.set(x, heightAt(x, z), z);
    st.object.rotation.set(0, st.yaw, 0);
  }
  return api;
}

// ---------- 명소 도장 ----------
function buildStamps(campus, isQuiet) {
  const out = [];
  for (const [name, emoji, how] of STAMPS) {
    let near = null, p = null;
    if (how.building) {
      const b = campus.buildings.find((x) => x.name === how.building);
      if (!b) continue;
      const o = b.outline;
      p = b.center;
      near = (x, z) => { for (let i = 0; i < o.length; i++) if (segDist(x, z, o[i], o[(i + 1) % o.length]) < LIFE.stamp.near) return true; return pointInPolygon(x, z, o); };
    } else if (how.water) {
      const w = campus.greens.filter((g) => g.kind === 'water').sort((a, b) => Math.abs(area(b.outline)) - Math.abs(area(a.outline)))[0];
      if (!w) continue;
      const o = w.outline;
      p = [o.reduce((s, q) => s + q[0], 0) / o.length, o.reduce((s, q) => s + q[1], 0) / o.length];
      near = (x, z) => { for (let i = 0; i < o.length; i++) if (segDist(x, z, o[i], o[(i + 1) % o.length]) < 6) return true; return false; };
    } else if (how.pitch) {
      const f = campus.greens.filter((g) => g.kind === 'pitch' && g.sport === 'soccer').sort((a, b) => Math.abs(area(b.outline)) - Math.abs(area(a.outline)))[0];
      if (!f) continue;
      p = [f.outline.reduce((s, q) => s + q[0], 0) / f.outline.length, f.outline.reduce((s, q) => s + q[1], 0) / f.outline.length];
      near = (x, z) => pointInPolygon(x, z, f.outline);
    }
    if (!p || isQuiet(p[0], p[1])) continue; // 5·18 장소 둘레에는 도장 없음
    out.push({ name, emoji, p, near });
  }
  return out;
}

// ---------- 풍덩 물보라 (조각 10개, 한 메시) ----------
function buildSplash(group) {
  const N = LIFE.splash;
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.09, 0), new THREE.MeshLambertMaterial({ color: '#e8f6ff', transparent: true, opacity: 0.85 }), N);
  mesh.visible = false;
  mesh.frustumCulled = false;
  group.add(mesh);
  const parts = Array.from({ length: N }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3() }));
  let t = -1, y0 = 0;
  return {
    start(x, y, z) {
      t = 0;
      y0 = y;
      mesh.visible = true;
      parts.forEach((q, i) => {
        const a = (i / N) * Math.PI * 2 + Math.random() * 0.4, s = 1.2 + Math.random() * 1.4;
        q.p.set(x, y + 0.1, z);
        q.v.set(Math.cos(a) * s, 3 + Math.random() * 2.2, Math.sin(a) * s);
      });
    },
    update(dt) {
      if (t < 0) return;
      t += dt;
      if (t > 1.3) { t = -1; mesh.visible = false; return; }
      parts.forEach((q, i) => {
        q.v.y -= 9.8 * dt;
        q.p.addScaledVector(q.v, dt);
        const s = q.p.y < y0 ? 0 : 1 - t / 1.3;
        M4.compose(q.p, Q.identity(), SC.setScalar(Math.max(0.001, s * (0.8 + (i % 3) * 0.3))));
        mesh.setMatrixAt(i, M4);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

function segDist(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
  return Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z);
}
function angleDiff(a, b) { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
