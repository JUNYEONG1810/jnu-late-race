// 놀거리 (자유 모드에서만): 대운동장 굴착기 축구, 짧은 타임어택 3코스, 넓은 주차장 드리프트 점수.
// 모두 몇 개의 단순한 도형(공 1, 골대 한 메시, 게이트 한 메시)만 쓰고, 멀리 있으면 계산을 쉰다.
import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { orientedRect, pointInPolygon, area } from './map.js';
import { RoadGraph } from './route.js';

export const PLAY = {
  ball: { r: 0.9, drag: 0.55, bounce: 0.6, kick: 1.35, near: 220 }, // 공 반지름(m), 굴러가다 서는 빠르기, 벽 튕김, 차기 세기, 이보다 멀면 계산 쉼
  goal: { w: 7.3, h: 2.44, depth: 2.0, post: 0.15 },                   // 골대 (실제 축구 골대 크기)
  drift: { idle: 1.2, k: 1 },                                          // 드리프트가 끝났다고 보는 시간, 점수 배율 (도는 빠르기 × 속도)
  checkEvery: 90, checkR: 16,                                          // 타임어택 중간 확인점 간격·반지름 (m): 다 지나야 기록
};
// 타임어택 코스: [이름, 출발 건물, 도착 건물] — 출발·도착은 그 건물에서 가장 가까운 차도 위
// (차도 길이 약 780~850m: 기본 속도 60km/h로 1분 안팎)
const COURSES = [
  ['A 스포츠센터 직선', '경영대 2호관', '전남대스포츠센터'],
  ['B 생활관 언덕', '생활관 5호관 정아학사', '예술대 3호관'],
  ['C 공대 골목', '공과대 7호관', '인문대 1호관'],
];
const RECORD_KEY = 'jnu-late-race-play';

function loadRecords() { try { return JSON.parse(localStorage.getItem(RECORD_KEY) || '{}'); } catch { return {}; } }
function saveRecords(r) { try { localStorage.setItem(RECORD_KEY, JSON.stringify(r)); } catch { /* 저장 못 해도 계속 */ } }

// onEvent(이름, 값): 칭호 (records.js) — 'goal', 'drift' {score}, 'courses' {done, total}
export function buildPlay(scene, campus, collider, hud, onEvent = () => {}) {
  const group = new THREE.Group();
  scene.add(group);
  const records = loadRecords();
  const soccer = buildSoccer(group, campus, collider);
  const attack = buildTimeAttack(group, campus);
  const lot = (campus.parking || []).reduce((a, o) => (!a || Math.abs(area(o)) > Math.abs(area(a)) ? o : a), null);
  const drift = { score: 0, idle: 0, on: false, heading: 0 };

  return {
    group, soccer, attack, records,
    courses: attack.courses.map((c) => ({ name: c.name, length: Math.round(c.length) })),
    // active: 자유 모드(지각 모드가 아닐 때)인지. walker: 걷는 중이면 황소
    update(dt, car, walker, active) {
      if (!active) { hud.setPlay(null); attack.cancel(); return; }
      const msgs = [];
      // 축구
      const s = soccer.update(dt, car, walker);
      if (s.goal) {
        hud.toast(`⚽ 골! (${soccer.score[0]} : ${soccer.score[1]})`, 2500);
        if (!records.firstGoal) { records.firstGoal = true; saveRecords(records); }
        onEvent('goal');
      }
      if (s.close) msgs.push(`⚽ ${soccer.score[0]} : ${soccer.score[1]}`);
      // 타임어택
      const a = attack.update(dt, walker ? null : car);
      if (a.started) hud.toast(`🏁 타임어택 ${a.started} 시작! 미니맵 파란 길을 따라 도착 게이트까지`, 2600);
      if (a.missed) hud.toast('🏁 길을 벗어나 확인점을 놓쳤어요. 기록 없음', 2600);
      if (a.finished) {
        const { name, time } = a.finished;
        const best = records[name];
        const isNew = !best || time < best;
        if (isNew) { records[name] = time; saveRecords(records); }
        onEvent('courses', { done: attack.courses.filter((c) => records[c.name]).length, total: attack.courses.length });
        hud.toast(`🏁 ${name} ${time.toFixed(2)}초${isNew ? ' — 최고 기록!' : ` (최고 ${best.toFixed(2)}초)`}`, 3500);
      }
      if (attack.running) msgs.push(`🏁 ${attack.running.name} ${attack.time.toFixed(1)}초 (확인점 ${attack.check}/${attack.running.checks.length})`);
      // 드리프트 (넓은 주차장 안에서 Space 드리프트)
      // 굴착기는 옆으로 미끄러지지 않고 Space로 더 날카롭게 도는 방식이라, 점수 = 도는 빠르기 × 속도
      const inLot = !walker && lot && pointInPolygon(car.pos.x, car.pos.y, lot);
      let turn = car.heading - drift.heading;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      drift.heading = car.heading;
      if (inLot && car.drifting && dt > 0) {
        drift.on = true;
        drift.idle = 0;
        drift.score += Math.abs(turn) * Math.abs(car.forwardSpeed) * PLAY.drift.k;
      } else if (drift.on && (drift.idle += dt) > PLAY.drift.idle) {
        const sc = Math.round(drift.score);
        const isNew = sc > (records.drift || 0);
        if (isNew) { records.drift = sc; saveRecords(records); }
        onEvent('drift', { score: sc });
        hud.toast(`🌀 드리프트 ${sc}점${isNew ? ' — 최고 기록!' : ` (최고 ${records.drift}점)`}`, 3000);
        drift.on = false;
        drift.score = 0;
      }
      if (drift.on) msgs.push(`🌀 드리프트 ${Math.round(drift.score)}점`);
      else if (inLot) msgs.push('🌀 Space로 드리프트!');
      hud.setPlay(msgs.length ? msgs.join('   ') : null);
    },
    route() { return attack.running ? attack.running.path : null; },
  };
}

// ---------- 축구 ----------

function buildSoccer(group, campus, collider) {
  const pitches = campus.greens.filter((g) => g.kind === 'pitch' && g.sport === 'soccer');
  const field = pitches.reduce((a, g) => (!a || Math.abs(area(g.outline)) > Math.abs(area(a.outline)) ? g : a), null);
  if (!field) return { score: [0, 0], update: () => ({}) };
  const R = orientedRect(field.outline);
  const G = PLAY.goal, B = PLAY.ball;
  const U = (u, v) => [R.cx + R.ux * u - R.uz * v, R.cz + R.uz * u + R.ux * v]; // 경기장 (u 긴 축, v 짧은 축) → 바닥
  // 골대 두 개 (기둥·가로대·뒤 그물 틀) 한 메시
  const parts = [];
  for (const side of [-1, 1]) {
    const u = side * (R.L / 2 - 1);
    const post = (v) => {
      const [x, z] = U(u, v);
      parts.push(new THREE.CylinderGeometry(G.post, G.post, G.h, 6).translate(x, heightAt(x, z) + G.h / 2, z));
      collider.addObstacle([[x - 0.3, z - 0.3], [x + 0.3, z - 0.3], [x + 0.3, z + 0.3], [x - 0.3, z + 0.3]], null, { quiet: true }); // 이름 없음: 건물 이름표에 안 뜨게
    };
    post(-G.w / 2); post(G.w / 2);
    const [ax, az] = U(u, 0);
    const bar = new THREE.CylinderGeometry(G.post, G.post, G.w, 6).rotateZ(Math.PI / 2).rotateY(-Math.atan2(R.uz, R.ux) + Math.PI / 2);
    parts.push(bar.translate(ax, heightAt(ax, az) + G.h, az));
    // 뒤 틀 (그물 대신 가는 막대)
    for (const v of [-G.w / 2, G.w / 2]) {
      const [x, z] = U(u + side * G.depth, v);
      parts.push(new THREE.CylinderGeometry(G.post * 0.6, G.post * 0.6, G.h * 0.8, 5).translate(x, heightAt(x, z) + G.h * 0.4, z));
    }
  }
  const goals = new THREE.Mesh(mergeGeos(parts), new THREE.MeshLambertMaterial({ color: '#f7f7f2' }));
  goals.castShadow = true;
  group.add(goals);
  // 공: 흰 바탕에 짙은 무늬 (20면체를 나눠 몇 면만 짙게, 정점 색)
  const geo = new THREE.IcosahedronGeometry(B.r, 1); // 다면체는 원래 인덱스가 없음
  const col = [], c1 = new THREE.Color('#f5f5f0'), c2 = new THREE.Color('#2b2e33');
  for (let f = 0; f < geo.attributes.position.count / 3; f++) {
    const c = f % 5 === 0 ? c2 : c1;
    col.push(c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const ball = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  ball.castShadow = true;
  group.add(ball);
  const S = { pos: new THREE.Vector2(...U(0, 0)), vel: new THREE.Vector2(), resetT: 0, score: [0, 0] };
  const place = () => { ball.position.set(S.pos.x, heightAt(S.pos.x, S.pos.y) + B.r, S.pos.y); };
  place();
  const axis = new THREE.Vector3(), q = new THREE.Quaternion();
  const toLocal = (x, z) => { const dx = x - R.cx, dz = z - R.cz; return [dx * R.ux + dz * R.uz, -dx * R.uz + dz * R.ux]; };
  const push = (cx, cz, rad, vx, vz) => { // 원(굴착기·황소)에 닿으면 공을 밀어내고 그 속도로 참
    const dx = S.pos.x - cx, dz = S.pos.y - cz, d = Math.hypot(dx, dz), min = rad + B.r;
    if (d >= min || d < 1e-4) return;
    const nx = dx / d, nz = dz / d;
    S.pos.set(cx + nx * min, cz + nz * min);
    const along = vx * nx + vz * nz;
    if (along > 0) S.vel.set(S.vel.x + nx * along * B.kick + vx * 0.3, S.vel.y + nz * along * B.kick + vz * 0.3);
    else S.vel.addScaledVector(new THREE.Vector2(nx, nz), 1.5);
  };
  return {
    ball, score: S.score, center: U(0, 0),
    update(dt, car, walker) {
      const who = walker || car;
      const near = Math.hypot(who.pos.x - S.pos.x, who.pos.y - S.pos.y) < B.near;
      if (!near) return { near: false };
      let goal = 0;
      if (S.resetT > 0) {
        if ((S.resetT -= dt) <= 0) { S.pos.set(...U(0, 0)); S.vel.set(0, 0); }
      } else {
        const f = car.forward();
        if (!walker) push(car.pos.x + f.x * 0.5, car.pos.y + f.y * 0.5, 1.9, car.vel.x, car.vel.y);
        else push(walker.pos.x, walker.pos.y, 0.35, walker.vel.x, walker.vel.y);
        S.pos.addScaledVector(S.vel, dt);
        S.vel.multiplyScalar(Math.exp(-B.drag * dt));
        // 경기장 밖 6m에서 튕김, 골 확인
        const [u, v] = toLocal(S.pos.x, S.pos.y);
        const hu = R.L / 2 + 6, hv = R.W / 2 + 6;
        if (Math.abs(u) > R.L / 2 - 1 && Math.abs(v) < G.w / 2 - B.r) { goal = u > 0 ? 1 : 2; S.score[goal - 1]++; S.resetT = 2; }
        else if (Math.abs(u) > hu || Math.abs(v) > hv) {
          const lu = THREE.MathUtils.clamp(u, -hu, hu), lv = THREE.MathUtils.clamp(v, -hv, hv);
          const vu = S.vel.x * R.ux + S.vel.y * R.uz, vv = -S.vel.x * R.uz + S.vel.y * R.ux;
          const nu = Math.abs(u) > hu ? -vu * PLAY.ball.bounce : vu, nv = Math.abs(v) > hv ? -vv * PLAY.ball.bounce : vv;
          S.vel.set(nu * R.ux - nv * R.uz, nu * R.uz + nv * R.ux);
          S.pos.set(R.cx + lu * R.ux - lv * R.uz, R.cz + lu * R.uz + lv * R.ux);
        }
      }
      // 굴러가는 모양
      const sp = S.vel.length();
      if (sp > 0.01) {
        axis.set(S.vel.y, 0, -S.vel.x).normalize();
        ball.quaternion.premultiply(q.setFromAxisAngle(axis, (sp * dt) / B.r));
      }
      place();
      return { near: true, close: Math.hypot(who.pos.x - R.cx, who.pos.y - R.cz) < R.L / 2 + 30, goal }; // 점수 안내는 경기장 가까이에서만
    },
  };
}

// ---------- 타임어택 ----------

function buildTimeAttack(group, campus) {
  const graph = new RoadGraph(campus);
  const roadPoint = (name) => {
    const b = campus.buildings.find((x) => x.name === name);
    if (!b) return null;
    const i = graph.nearest(b.center[0], b.center[1]);
    return graph.pts[i];
  };
  const courses = [];
  for (const [name, from, to] of COURSES) {
    const a = roadPoint(from), b = roadPoint(to);
    if (!a || !b) continue;
    const path = graph.path(a[0], a[1], b[0], b[1]);
    let length = 0;
    for (let i = 1; i < path.length; i++) length += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    courses.push({ name, start: a, end: b, path, length, checks: checkpoints(path), dirStart: dirAt(path, 0), dirEnd: dirAt(path, path.length - 1) });
  }
  // 게이트: 출발(초록 띠) · 도착(체크 무늬 띠). 모두 한 메시 (정점 색)
  const pos = [], nor = [], col = [];
  const add = (geo, color) => {
    const g = geo.toNonIndexed(), c = new THREE.Color(color);
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b);
  };
  const gate = ([x, z], [dx, dz], finish) => {
    const w = 11, h = 4.6, y = heightAt(x, z), yaw = Math.atan2(dx, dz);
    const M = (geo, ox, oy) => geo.translate(ox, oy, 0).rotateY(yaw).translate(x, y, z);
    for (const s of [-1, 1]) add(M(new THREE.BoxGeometry(0.35, h, 0.35), s * w / 2, h / 2), '#f2f2ee');
    const n = 10;
    for (let i = 0; i < n; i++) {
      const color = finish ? ((i % 2) ? '#1f2328' : '#f6f6f2') : (i % 2 ? '#2fb36a' : '#f6f6f2');
      add(M(new THREE.BoxGeometry(w / n, 0.9, 0.2), -w / 2 + (i + 0.5) * (w / n), h - 0.45), color);
    }
  };
  for (const c of courses) { gate(c.start, c.dirStart, false); gate(c.end, c.dirEnd, true); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  group.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true })));

  const T = {
    courses, running: null, time: 0, armed: true, check: 0,
    cancel() { T.running = null; },
    // car: 굴착기 (걷는 중이면 null → 타임어택 없음)
    update(dt, car) {
      const out = {};
      if (!car) { T.running = null; return out; }
      const at = (p, r) => Math.hypot(car.pos.x - p[0], car.pos.y - p[1]) < r;
      if (T.running) {
        T.time += dt;
        const C = T.running.checks;
        if (T.check < C.length && at(C[T.check], PLAY.checkR)) T.check++; // 중간 확인점 (차례대로)
        if (at(T.running.end, 7)) {
          if (T.check >= C.length) out.finished = { name: T.running.name, time: T.time };
          else out.missed = true;
          T.running = null; T.armed = false;
        } else if (T.time > 180) T.running = null; // 3분 넘으면 그만
      } else {
        const c = courses.find((k) => at(k.start, 6));
        if (c && T.armed) { T.running = c; T.time = 0; T.check = 0; out.started = c.name; T.armed = false; }
        if (!c) T.armed = true; // 출발 게이트를 벗어났다가 다시 들어오면 다시 시작
      }
      return out;
    },
  };
  return T;
}

// 경로를 따라 PLAY.checkEvery 간격의 중간 확인점 (처음·끝 근처는 뺌)
function checkpoints(path) {
  const out = [];
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const [x0, z0] = path[i - 1], [x1, z1] = path[i], L = Math.hypot(x1 - x0, z1 - z0);
    let t = PLAY.checkEvery - acc;
    while (t < L) { out.push([x0 + (x1 - x0) * (t / L), z0 + (z1 - z0) * (t / L)]); t += PLAY.checkEvery; }
    acc = (acc + L) % PLAY.checkEvery;
  }
  const end = path[path.length - 1];
  return out.filter((p) => Math.hypot(p[0] - end[0], p[1] - end[1]) > PLAY.checkEvery / 2);
}

function dirAt(path, i) {
  const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
  return [dx / L, dz / L];
}

function mergeGeos(list) {
  const pos = [], nor = [];
  for (const g0 of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return geo;
}
