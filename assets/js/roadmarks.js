// 노면 표시: 횡단보도(OSM footway=crossing), 교차로 정지선, 주요 차로 방향 화살표, 과속방지턱(OSM traffic_calming).
// 차선과 같은 방식(지형을 따라 휘는 얇은 메시 + polygonOffset)으로, 차선보다 한 단계 위에 그려 깜빡이지 않게 한다.
// 근거: data/road-marks.json(scripts/build_road_marks.py). 정지선·화살표 자리는 규칙(교차로·차도 폭·일방통행 태그).
import * as THREE from 'three';
import { DrapeBuilder } from './map.js';

const MARK_LIFT = 0.12;
const WHITE = '#f1f1ec', YELLOW = '#f0bf2c';
const ZEBRA = { length: 3.5, bar: 0.45, gap: 0.45, edge: 0.4 }; // 횡단보도: 길이(도로 방향), 줄 폭, 간격, 가장자리 여유
const STOP = { width: 0.45, back: 1.5 };                     // 정지선 두께, 교차 도로 가장자리에서 물러난 거리
const ARROW = { every: 70, endGap: 22, shaft: 3.2, shaftW: 0.24, head: 1.8, headW: 0.95, maxTurn: 0.12 };
const BUMP = { depth: 3.0, stripe: 0.6, maxDist: 6 };          // 과속방지턱: 도로 방향 길이, 줄무늬 폭, 도로에서 찾는 거리

export function buildRoadMarks(campus, marks) {
  const white = new DrapeBuilder(MARK_LIFT), yellow = new DrapeBuilder(MARK_LIFT);
  const roads = campus.roads.filter((r) => r.car && r.points.length >= 2);
  const tagOf = (r) => marks.roadTags?.[r.id] || {};
  const stat = { crosswalks: 0, stops: 0, arrows: 0, bumps: 0, at: { crosswalks: [], stops: [], arrows: [], bumps: [] } }; // at: 확인용 위치 몇 개
  const note = (k, p, u) => { if (stat.at[k].length < 6) stat.at[k].push({ p, u }); };

  // ---- 횡단보도: 횡단 길과 차도 가운데선이 만나는 곳
  const seen = [];
  for (const c of marks.crossings || []) {
    for (let i = 0; i < c.points.length - 1; i++) {
      for (const r of roads) {
        for (let k = 0; k < r.points.length - 1; k++) {
          const P = segHit(c.points[i], c.points[i + 1], r.points[k], r.points[k + 1]);
          if (!P || seen.some((q) => Math.hypot(q[0] - P[0], q[1] - P[1]) < 3)) continue;
          seen.push(P);
          const u = dir(r.points[k], r.points[k + 1]), n = [-u[1], u[0]];
          const half = r.width / 2 - ZEBRA.edge;
          for (let s = -half + ZEBRA.bar / 2; s <= half - ZEBRA.bar / 2 + 1e-6; s += ZEBRA.bar + ZEBRA.gap) {
            const cx = P[0] + n[0] * s, cz = P[1] + n[1] * s;
            white.strip([cx - u[0] * ZEBRA.length / 2, cz - u[1] * ZEBRA.length / 2], [cx + u[0] * ZEBRA.length / 2, cz + u[1] * ZEBRA.length / 2], ZEBRA.bar / 2);
          }
          stat.crosswalks++;
          note('crosswalks', P, u);
        }
      }
    }
  }

  // ---- 교차로 정지선: 세 갈래 이상 만나는 곳으로 들어오는 차로에만
  const ends = [];
  for (const r of roads) {
    ends.push({ r, at: 0, p: r.points[0], q: r.points[1] });
    ends.push({ r, at: 1, p: r.points.at(-1), q: r.points.at(-2) });
  }
  for (const e of ends) {
    let arms = 0, cross = null;
    for (const r of roads) {
      for (let k = 0; k < r.points.length; k++) {
        if (Math.hypot(r.points[k][0] - e.p[0], r.points[k][1] - e.p[1]) > 1) continue;
        const endPt = k === 0 || k === r.points.length - 1;
        arms += endPt ? 1 : 2;
        if (r !== e.r && (!cross || r.width > cross.width)) cross = r;
      }
    }
    if (arms < 3 || !cross) continue;
    const t = tagOf(e.r);
    if (t.oneway === 'yes' && e.at === 0) continue; // 일방통행이 교차로에서 나가는 쪽
    const len = Math.hypot(e.p[0] - e.q[0], e.p[1] - e.q[1]);
    const back = cross.width / 2 + STOP.back;
    if (len < back + 3) continue;
    const u = dir(e.q, e.p);                 // 교차로 쪽으로 가는 방향
    const right = [-u[1], u[0]];             // 그 방향의 오른쪽 (x 동쪽, z 남쪽)
    const c = [e.p[0] - u[0] * back, e.p[1] - u[1] * back];
    const h = e.r.width / 2 - 0.3, m = (e.r.median || 0) / 2;
    const [s0, s1] = t.oneway === 'yes' ? [-h, h] : [m + 0.15, h];
    if (s1 - s0 < 1) continue;
    white.strip([c[0] + right[0] * s0, c[1] + right[1] * s0], [c[0] + right[0] * s1, c[1] + right[1] * s1], STOP.width / 2);
    stat.stops++;
    note('stops', c, u);
  }

  // ---- 방향 화살표: 주요 차로(잰 차로 2개 이상이거나 간선 도로), 곧은 구간에 약 70m마다
  for (const r of roads) {
    const t = tagOf(r);
    const major = (r.lanes || 0) >= 2 || ['primary', 'secondary', 'tertiary', 'trunk'].includes(t.highway);
    if (!major) continue;
    const total = polyLen(r.points);
    if (total < ARROW.endGap * 2 + 10) continue;
    const dirs = t.oneway === 'yes' ? [1] : [1, -1];
    const m = (r.median || 0) / 2;
    const perDir = Math.max(1, Math.round((r.lanes || 2) / (t.oneway === 'yes' ? 1 : 2)));
    for (let s = ARROW.endGap; s <= total - ARROW.endGap; s += ARROW.every) {
      const at = pointAt(r.points, s);
      if (!at || at.turn > ARROW.maxTurn) continue;
      if (ends.some((e) => e.r !== r && Math.hypot(e.p[0] - at.p[0], e.p[1] - at.p[1]) < ARROW.endGap)) continue; // 다른 길이 붙는 교차로 근처는 비움
      for (const d of dirs) {
        const u = [at.u[0] * d, at.u[1] * d], right = [-u[1], u[0]];
        const span = (t.oneway === 'yes' ? r.width : r.width / 2 - m);
        for (let k = 0; k < perDir; k++) {
          const off = t.oneway === 'yes' ? -r.width / 2 + span * (k + 0.5) / perDir : m + span * (k + 0.5) / perDir;
          const c = [at.p[0] + right[0] * off, at.p[1] + right[1] * off];
          arrow(white, c, u);
          stat.arrows++;
          note('arrows', c, u);
        }
      }
    }
  }

  // ---- 과속방지턱: OSM 점에서 가장 가까운 차도 위에 도로를 가로지르는 노랑·흰 줄무늬 띠
  for (const b of marks.bumps || []) {
    let best = null, bd = BUMP.maxDist;
    for (const r of roads) {
      for (let k = 0; k < r.points.length - 1; k++) {
        const q = nearestOnSeg(b.p, r.points[k], r.points[k + 1]);
        if (q.d < bd) { bd = q.d; best = { r, p: q.p, u: dir(r.points[k], r.points[k + 1]) }; }
      }
    }
    if (!best) continue;
    const { r, p, u } = best, n = [-u[1], u[0]], half = r.width / 2 - 0.2;
    let i = 0;
    for (let s = -half; s < half - 1e-6; s += BUMP.stripe, i++) {
      const s1 = Math.min(half, s + BUMP.stripe), mid = (s + s1) / 2;
      const cx = p[0] + n[0] * mid, cz = p[1] + n[1] * mid;
      (i % 2 ? white : yellow).strip([cx - u[0] * BUMP.depth / 2, cz - u[1] * BUMP.depth / 2], [cx + u[0] * BUMP.depth / 2, cz + u[1] * BUMP.depth / 2], (s1 - s) / 2);
    }
    stat.bumps++;
    note('bumps', p, u);
  }

  const mat = (color) => new THREE.MeshLambertMaterial({ color, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -6 });
  const meshes = [white.mesh(mat(WHITE)), yellow.mesh(mat(YELLOW))];
  for (const m of meshes) m.receiveShadow = true;
  return { meshes, stat };
}

// 곧은 화살표: 몸통 + 세모 머리 (c = 화살표 가운데, u = 가리키는 방향)
function arrow(b, c, u) {
  const L = ARROW.shaft + ARROW.head, back = [c[0] - u[0] * L / 2, c[1] - u[1] * L / 2];
  const neck = [back[0] + u[0] * ARROW.shaft, back[1] + u[1] * ARROW.shaft];
  b.strip(back, neck, ARROW.shaftW / 2);
  const n = [-u[1], u[0]], tip = [neck[0] + u[0] * ARROW.head, neck[1] + u[1] * ARROW.head];
  const l = [neck[0] + n[0] * ARROW.headW / 2, neck[1] + n[1] * ARROW.headW / 2];
  const r = [neck[0] - n[0] * ARROW.headW / 2, neck[1] - n[1] * ARROW.headW / 2];
  b.tri(b.vertex(...l), b.vertex(...r), b.vertex(...tip));
}

function dir(a, b) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
}

function polyLen(pts) {
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) s += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return s;
}

// 선 위 s m 지점, 방향, 그 둘레(±10m) 꺾임
function pointAt(pts, s) {
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (acc + L >= s && L > 1e-6) {
      const t = (s - acc) / L, u = dir(pts[i], pts[i + 1]);
      let turn = 0;
      if (t * L < 10 && i > 0) turn = Math.max(turn, angle(dir(pts[i - 1], pts[i]), u));
      if ((1 - t) * L < 10 && i < pts.length - 2) turn = Math.max(turn, angle(u, dir(pts[i + 1], pts[i + 2])));
      return { p: [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t], u, turn };
    }
    acc += L;
  }
  return null;
}

function angle(a, b) {
  return Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]));
}

// 두 선분이 만나는 점 (없으면 null)
function segHit(p1, p2, q1, q2) {
  const d1x = p2[0] - p1[0], d1z = p2[1] - p1[1], d2x = q2[0] - q1[0], d2z = q2[1] - q1[1];
  const den = d1x * d2z - d1z * d2x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q1[0] - p1[0]) * d2z - (q1[1] - p1[1]) * d2x) / den;
  const v = ((q1[0] - p1[0]) * d1z - (q1[1] - p1[1]) * d1x) / den;
  if (t < 0 || t > 1 || v < 0 || v > 1) return null;
  return [p1[0] + d1x * t, p1[1] + d1z * t];
}

function nearestOnSeg(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L)) : 0;
  const q = [a[0] + dx * t, a[1] + dz * t];
  return { p: q, d: Math.hypot(q[0] - p[0], q[1] - p[1]) };
}
