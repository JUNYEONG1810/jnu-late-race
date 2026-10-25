// 조경 소품: 벤치·자전거 보관소·버스정류장, 조형물·기념물, 가로등.
// 소품과 조형물은 종류마다 한 메시로 합치고(정점 색), 가로등은 InstancedMesh.
// 기념물은 인물 모양을 만들지 않고 단정한 비석·받침대·탑으로만 표현한다.
import * as THREE from 'three';
import { mulberry32, distToSegment, pointInPolygon } from './map.js';
import { heightAt } from './terrain.js';

const LAMP = {
  spacing: 30,   // 같은 쪽 가로등 간격 (m)
  gap: 1.0,      // 차도 가장자리에서 떨어진 거리
  height: 6.2,
  minRoadLen: 80, // service 도로는 이보다 긴 것만 (주차장 통로 등 제외)
};
const STONE = '#c9c3b6', GRANITE = '#55585c', DARK_STONE = '#77746f', BRONZE = '#8a6c48';
const MONUMENT_LABEL_DIST = 70; // 이만큼 가까이 와야 이름표가 보인다

// 정문 진입로 가로수 (참고 조사: 정사영상. 수관 지름 6~7m가 거의 이어짐 → 간격 7m, 높이 약 16m)
const AVENUE = {
  road: 'w256927670',          // 정문 진입로
  spacing: 7,                  // 나무 간격 (m)
  stripOffset: 3.5,            // 차도 가장자리에서 가로수 띠 가운데까지
  west: [228, 437],            // 서쪽 줄: 정문(z≈440) 바로 북쪽 → 용봉탑 로터리 앞(z≈228)
  east: [300, 437],            // 동쪽 줄: 정문 바로 북쪽 → 주차 차단기 부근(z≈300)
  trunkH: 9, crownR: 3.3, crownH: 4.3, // 줄기 높이, 수관 반지름·세로 반지름 → 전체 약 16m
};

// 정문 진입로 주차 차단기 (참고 조사: 정사영상·수치지도, docs/참고-조사.md)
// 진입로를 덮는 지붕(16.7×11.6m) 아래, 상·하행 차도마다 빨강·흰 줄무늬 막대 + 길가 요금 부스
const BARRIER = {
  at: [73.8, 312.6],  // 지붕 가운데 (게임 좌표)
  replaces: 'w1163961970', // OSM이 이 지붕을 건물(층수 없음 → 기본 4층)로 그려 진입로를 막던 것 → 부스·차단기로 바꿈
  lane: 7,            // 한쪽 차도 폭 (m)
  median: 1.5,        // 가운데 분리대 폭 (m)
  roof: [16.7, 11.6], // 지붕: 도로를 가로지르는 폭, 도로 방향 길이
  roofH: 5.2,
  armH: 1.0,          // 막대 높이
  openDist: 15,       // 굴착기가 이만큼 가까우면 막대가 올라감 (m)
  lift: 80,           // 올라가는 각도 (°)
};

// 차단기로 바꾼 건물은 지도·충돌·미니맵에서 뺀다 (buildMap 전에 부른다)
export function removeReplacedBuildings(campus) {
  campus.buildings = campus.buildings.filter((b) => b.id !== BARRIER.replaces);
}

export function buildLandscape(scene, campus) {
  const group = new THREE.Group();
  const roads = makeRoadIndex(campus.roads);
  let parts = new PartBuilder();
  const obstacles = [];
  const labels = [];

  let removed = 0;
  for (const p of campus.props || []) {
    const [x, z] = p.p;
    if (roads.onRoad(x, z)) { removed++; continue; } // 넓힌 차도 위에 올라간 소품은 뺀다
    const near = roads.nearest(x, z, p.type === 'bus' ? 25 : 15, p.type === 'bus');
    // 앞(+z)이 가까운 도로를 보도록
    const yaw = near ? Math.atan2(near.x - x, near.z - z) : hashAngle(x, z);
    if (p.type === 'bench') bench(parts, x, z, yaw);
    else if (p.type === 'bike') bikeRack(parts, x, z, yaw);
    else if (p.type === 'bus') busShelter(parts, x, z, yaw);
  }

  // 기념물: data/monuments.json(형태·크기·근거)이 있으면 그것으로. 부딪혀도 조용히 멈추는 충돌(quietObstacles)
  const quietObstacles = [];
  const monList = campus.monumentsData || (campus.monuments || []).map((m) => ({ ...m, form: m.shape }));
  for (const m of monList) {
    const [x, z] = m.p;
    if (m.form !== 'plaza' && roads.onRoad(x, z)) { removed++; continue; }
    const near = roads.nearest(x, z, 30, false);
    const yaw = m.angle != null ? (m.angle * Math.PI) / 180 : near ? Math.atan2(near.x - x, near.z - z) : 0;
    const { top, half } = monument(parts, m, x, z, yaw);
    if (half > 0) quietObstacles.push(square(x, z, half, yaw));
    // 이름표는 OSM의 공식 이름만 (설명 문구 없음)
    if (m.name && m.form !== 'plaza') labels.push({ text: m.name, x, y: heightAt(x, z) + top + 1.2, z, maxDist: m.form === 'tower' ? 160 : MONUMENT_LABEL_DIST });
  }
  group.add(buildPavement(monList));

  const propMesh = parts.mesh();
  propMesh.castShadow = propMesh.receiveShadow = true;
  group.add(propMesh);
  parts = new PartBuilder(); // 차단기 지붕·부스

  const barrier = buildBarrier(roads, parts, obstacles);
  group.add(barrier.group);

  const propMesh2 = parts.mesh();
  propMesh2.castShadow = propMesh2.receiveShadow = true;
  group.add(propMesh2);

  const lamps = buildLamps(campus, roads);
  group.add(lamps);

  const avenue = buildAvenue(campus, barrier.center);
  group.add(avenue.group);

  scene.add(group);
  return {
    group, lamps, obstacles, quietObstacles, labels, barrier, removed, avenue,
    // 매 프레임: 차단기 막대 올리고 내리기
    update(dt, carX, carZ) { barrier.update(dt, carX, carZ); },
  };
}

// ---------- 정문 진입로 가로수 ----------

// 줄기가 곧고 키 큰 가로수. 품질 낮음에서도 보이도록 일반 나무(밀도 조절)와 따로 둔다
function buildAvenue(campus, barrierAt) {
  const r = campus.roads.find((x) => x.id === AVENUE.road);
  const spots = [];
  if (r) {
    const off = r.width / 2 + AVENUE.stripOffset;
    const rand = mulberry32(445);
    let next = 0, s = 0;
    for (let i = 0; i < r.points.length - 1; i++) {
      const [x1, z1] = r.points[i], [x2, z2] = r.points[i + 1];
      const L = Math.hypot(x2 - x1, z2 - z1);
      if (L < 1e-6) continue;
      const ux = (x2 - x1) / L, uz = (z2 - z1) / L;
      for (; next < s + L; next += AVENUE.spacing) {
        const t = next - s, x = x1 + ux * t, z = z1 + uz * t;
        for (const side of [1, -1]) { // +1 = 진행 방향(북쪽)의 오른쪽 = 동쪽
          const tx = x - uz * off * side, tz = z + ux * off * side;
          const [z0, zEnd] = side > 0 ? AVENUE.east : AVENUE.west;
          if (tz < z0 || tz > zEnd || Math.hypot(tx - barrierAt[0], tz - barrierAt[1]) < 11) continue;
          spots.push([tx, tz, 0.92 + rand() * 0.16]);
        }
      }
      s += L;
    }
  }
  const trunk = new THREE.CylinderGeometry(0.24, 0.36, AVENUE.trunkH, 7).translate(0, AVENUE.trunkH / 2, 0);
  const crown = new THREE.IcosahedronGeometry(1, 1).scale(AVENUE.crownR, AVENUE.crownH, AVENUE.crownR)
    .translate(0, AVENUE.trunkH + AVENUE.crownH * 0.55, 0);
  const trunks = new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: '#7a5c44' }), spots.length);
  const crowns = new THREE.InstancedMesh(crown, new THREE.MeshLambertMaterial({ color: '#4f8a42', flatShading: true }), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3();
  spots.forEach(([x, z, k], i) => {
    m.compose(new THREE.Vector3(x, heightAt(x, z) - 0.2, z), q.setFromAxisAngle(up, (i * 2.399) % (Math.PI * 2)), sc.set(k, k, k));
    trunks.setMatrixAt(i, m);
    crowns.setMatrixAt(i, m);
  });
  trunks.castShadow = crowns.castShadow = true;
  const group = new THREE.Group();
  group.add(trunks, crowns);
  return { group, spots };
}

// ---------- 주차 차단기 ----------

function buildBarrier(roads, parts, obstacles) {
  const [cx, cz] = BARRIER.at;
  const near = roads.nearest(cx, cz, 30, true);
  const ux = near ? near.ux : 0, uz = near ? near.uz : -1; // 도로 방향
  const ex = -uz, ez = ux;                                  // 도로를 가로지르는 방향
  const at = (s, t) => [cx + ex * s + ux * t, cz + ez * s + uz * t];
  const yaw = Math.atan2(ux, uz);
  const half = BARRIER.median / 2 + BARRIER.lane; // 가운데에서 차도 바깥 끝까지

  // 지붕 + 기둥 4개 (차도 밖)
  const [rw, rl] = BARRIER.roof;
  const gy = heightAt(cx, cz);
  const roofT = new THREE.Matrix4().makeRotationY(yaw).setPosition(cx, gy, cz);
  parts.box(roofT, 0, BARRIER.roofH, 0, rw, 0.35, rl, '#eef0f2');
  for (const sx of [-1, 1]) {
    for (const st of [-1, 1]) {
      const [px, pz] = at(sx * (rw / 2 - 0.3), st * (rl / 2 - 0.5));
      const T = parts.frame(px, pz, yaw);
      const h = BARRIER.roofH + gy - heightAt(px, pz) + 0.2;
      parts.box(T, 0, h / 2, 0, 0.35, h, 0.35, '#c9ccd1');
      obstacles.push(square(px, pz, 0.3, yaw));
    }
  }

  // 요금 부스(1층, 작은 창) 양쪽 길가 + 막대
  const group = new THREE.Group();
  const arms = [];
  for (const side of [1, -1]) {
    const [bx, bz] = at(side * (half + 2.0), 1.6 * side);
    const T = parts.frame(bx, bz, yaw);
    parts.box(T, 0, 1.3, 0, 2.2, 2.6, 3.0, '#ece9e2');
    parts.box(T, 0, 2.7, 0, 2.7, 0.2, 3.5, '#4a5160');
    for (const t of [-0.75, 0.75]) parts.box(T, -side * 1.11, 1.55, t, 0.04, 0.75, 0.9, '#3e5a74'); // 차도 쪽 작은 창
    parts.box(T, side * 1.11, 1.55, 0, 0.04, 0.75, 0.9, '#3e5a74');
    parts.box(T, 0, 1.55, 1.51, 0.9, 0.75, 0.04, '#3e5a74');
    obstacles.push(square(bx, bz, 1.6, yaw));

    // 막대: 차도 바깥 기둥에서 분리대 쪽으로. 로컬 +x가 분리대 쪽
    const [px, pz] = at(side * (half + 0.45), 0);
    parts.box(parts.frame(px, pz, yaw), 0, 0.55, 0, 0.45, 1.1, 0.45, '#d8dbe0');
    const L = BARRIER.lane - 0.3;
    const arm = new PartBuilder();
    const I = new THREE.Matrix4();
    const n = Math.round(L / 0.6);
    for (let i = 0; i < n; i++) arm.box(I, (i + 0.5) * (L / n), 0, 0, L / n, 0.12, 0.1, i % 2 ? '#ffffff' : '#e23b3b');
    const mesh = arm.mesh();
    mesh.castShadow = true;
    const pivot = new THREE.Group();
    pivot.add(mesh);
    const holder = new THREE.Group();
    holder.position.set(px, heightAt(px, pz) + BARRIER.armH, pz);
    holder.rotation.y = side > 0 ? yaw : yaw + Math.PI; // 로컬 +x = 분리대 쪽
    holder.add(pivot);
    group.add(holder);
    arms.push(pivot);
  }

  let open = 0;
  return {
    group, center: [cx, cz],
    update(dt, x, z) {
      const goal = Math.hypot(x - cx, z - cz) < BARRIER.openDist ? 1 : 0;
      open += (goal - open) * Math.min(1, dt * 3.5);
      for (const p of arms) p.rotation.z = open * THREE.MathUtils.degToRad(BARRIER.lift);
    },
  };
}

// ---------- 소품 ----------

function bench(b, x, z, yaw) {
  const T = b.frame(x, z, yaw);
  const wood = '#a8784c', metal = '#4b4f55';
  b.box(T, 0, 0.45, 0, 1.8, 0.07, 0.45, wood);
  b.box(T, 0, 0.78, -0.22, 1.8, 0.32, 0.06, wood);
  for (const sx of [-0.75, 0.75]) b.box(T, sx, 0.22, -0.05, 0.07, 0.44, 0.5, metal);
}

function bikeRack(b, x, z, yaw) {
  const T = b.frame(x, z, yaw);
  const metal = '#9aa1a8';
  b.box(T, 0, 0.03, 0, 3.4, 0.06, 0.12, metal);
  for (let i = 0; i < 5; i++) {
    const u = -1.4 + i * 0.7;
    b.box(T, u, 0.45, -0.25, 0.05, 0.9, 0.05, metal);
    b.box(T, u, 0.45, 0.25, 0.05, 0.9, 0.05, metal);
    b.box(T, u, 0.9, 0, 0.05, 0.05, 0.55, metal);
  }
}

// 버스정류장: 뒤판(유리) + 기둥 + 지붕 + 의자 + 표지판. 앞(+z)이 도로 쪽
function busShelter(b, x, z, yaw) {
  const T = b.frame(x, z, yaw);
  const glass = '#a9c6d4', frame = '#3d4652', sign = '#2f6fb5';
  b.box(T, 0, 1.3, -0.7, 3.6, 2.2, 0.08, glass);
  for (const sx of [-1.8, 1.8]) for (const sz of [-0.7, 0.6]) b.box(T, sx, 1.25, sz, 0.1, 2.5, 0.1, frame);
  b.box(T, 0, 2.55, -0.05, 4.0, 0.12, 1.7, frame);
  b.box(T, 0, 0.45, -0.45, 2.6, 0.08, 0.4, '#b08a5c');
  b.box(T, 2.4, 1.3, 0.6, 0.08, 2.6, 0.08, frame);
  b.box(T, 2.4, 2.45, 0.6, 0.6, 0.5, 0.06, sign);
}

// 기념물·조형물 (data/monuments.json: 형태·크기·재료와 근거 등급).
// 근거가 없는 값은 단순한 기본 형태·크기. 인물상은 실제 사람 비례로, 얼굴은 눈·입 없는 매끈한 조각으로만.
// 돌려주는 값: 꼭대기 높이, 충돌 사각형 반 폭(0이면 충돌 없음)
function monument(b, m, x, z, yaw) {
  const T = b.frame(x, z, yaw);
  const c = m.color || STONE;
  switch (m.form) {
    case 'tower': { // 용봉탑 (위키미디어 사진): 높은 흰 돌 받침 + 둥근 마디가 엉킨 청동 몸체 + 목이 길고 꼬리 깃이 부채처럼 펼쳐진 새
      // 비례는 사진에서 받침 폭(정사영상 약 3.6m)을 자로 삼음: 받침 약 0.36, 청동 몸체 약 0.51, 새 약 0.13
      const base = m.baseColor || STONE, H = m.height || 17;
      const P = H * 0.36, top = H * 0.87;
      b.box(T, 0, (P - 1) / 2, 0, 3.6, P + 1, 3.6, base);   // 받침 (비탈에서 뜨지 않게 아래로 1m 더)
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {   // 받침 위 네 귀퉁이 비스듬한 돌 판
        b.boxRot(T, sx * 1.45, P + 0.45, sz * 1.45, 1.1, 0.9, 0.3, 0, Math.atan2(sx, sz), 0.2, base);
      }
      b.box(T, 0, P + 0.45, 1.2, 1.2, 0.9, 0.3, base);      // 앞가운데 세운 돌 판
      for (let k = 0; k < 3; k++) {                          // 마디 진 몸체 셋이 서로 감기며 올라감
        for (let y = P; y < top; y += 1.7) {                 // 사진에서 기둥마다 마디 약 5개
          const a = k * (Math.PI * 2 / 3) + y * 0.3;
          const px = Math.cos(a) * 0.55, pz = Math.sin(a) * 0.55;
          b.cyl(T, px, y, pz, 0.28, 0.36, 1.75, c, 8);
          b.ell(T, px, y + 1.7, pz, 0.48, 0.36, 0.48, c);   // 마디
        }
      }
      b.ell(T, 0, top + 0.1, 0, 0.6, 0.45, 0.6, c);        // 몸체 꼭대기 둥근 덩이
      b.ell(T, 0, top + 0.65, 0, 0.6, 0.22, 0.28, c);      // 새 몸
      b.boxRot(T, 0.5, top + 1.25, 0, 0.1, 1.2, 0.1, 0, 0, -0.3, c);   // 긴 목
      b.ell(T, 0.72, top + 1.88, 0, 0.2, 0.1, 0.1, c);     // 머리
      b.boxRot(T, 0.98, top + 1.85, 0, 0.3, 0.05, 0.05, 0, 0, -0.4, c); // 부리
      for (let i = 0; i < 9; i++) {                          // 꼬리 깃: 몸 뒤에서 위·뒤로 부채처럼
        const th = 0.25 + i * 0.09, L = 2.6 + (i % 3) * 0.3, zz = (i - 4) * 0.06;
        b.boxRot(T, -0.4 - Math.cos(th) * L / 2, top + 0.7 + Math.sin(th) * L / 2, zz, L, 0.05, 0.1, 0, 0, -th, c);
      }
      return { top: H, half: 1.8 };
    }
    case 'bust': {   // 받침대 + 실물 크기 흉상 (얼굴 표현 없음)
      b.box(T, 0, 0.15, 0, 1.2, 0.3, 1.2, STONE);
      b.box(T, 0, 0.95, 0, 0.7, 1.3, 0.7, GRANITE);
      const y0 = 1.6;
      b.cylScaled(T, 0, y0, 0, 0.33, 0.24, 0.3, c, 1, 0.55);  // 가슴 (아래가 반듯이 잘린 흉상, 위로 어깨까지 넓어짐)
      b.ell(T, 0, y0 + 0.3, 0, 0.33, 0.13, 0.18, c);       // 둥근 어깨
      b.cyl(T, 0, y0 + 0.38, 0, 0.065, 0.075, 0.14, c, 10); // 목
      b.ell(T, 0, y0 + 0.64, 0.01, 0.105, 0.135, 0.12, c); // 머리
      return { top: y0 + 0.8, half: 0.7 };
    }
    case 'statue': { // 받침대 + 선 자세 인물 (사람 키, 얼굴 표현 없음)
      b.box(T, 0, 0.2, 0, 1.6, 0.4, 1.6, STONE);
      b.box(T, 0, 1.0, 0, 1.2, 1.2, 1.2, GRANITE);
      figure(b, T, 0, 1.6, 0, c);
      return { top: 3.4, half: 0.8 };
    }
    case 'group': {  // 원형 받침 + 인물 실루엣 여럿 (사람 키, 나란히 앞을 향해 걷는 자세 없이 곧게 섬)
      const r = (m.base?.d || 4) / 2, h = m.base?.h || 0.5;
      b.cyl(T, 0, -0.5, 0, r, r, h + 0.5, m.base?.color || STONE, 24);
      const n = m.figures || 3;
      for (let i = 0; i < n; i++) figure(b, T, (i - (n - 1) / 2) * 0.85, h, (i % 2) * 0.35 - 0.15, c);
      return { top: h + 1.8, half: r };
    }
    case 'stoneFigure': { // 석인(문인석 등): 둥근 몸돌 + 머리 + 납작한 관
      b.box(T, 0, 0.08, 0, 0.8, 0.16, 0.7, STONE);
      b.cylScaled(T, 0, 0.16, 0, 0.3, 0.38, 1.25, c, 1, 0.7);
      b.ell(T, 0, 1.6, 0, 0.2, 0.24, 0.19, c);
      b.cyl(T, 0, 1.8, 0, 0.21, 0.21, 0.12, c, 12);
      return { top: 1.95, half: 0.45 };
    }
    case 'jangseung': { // 석장승: 아래가 조금 굵은 돌기둥 + 둥근 머리 + 납작한 머리 위
      b.cyl(T, 0, -0.2, 0, 0.2, 0.25, 2.2, c, 10);
      b.ell(T, 0, 2.25, 0, 0.27, 0.34, 0.27, c);
      b.cyl(T, 0, 2.5, 0, 0.24, 0.26, 0.1, c, 10);
      return { top: 2.6, half: 0.3 };
    }
    case 'sculpture': { // 추상 조형물: 받침(있으면 정사영상 크기) + 둥근 돌 덩이 둘
      const r = m.base ? m.base.d / 2 : 0.7, h = m.base ? m.base.h : 0.4;
      if (m.base) b.cyl(T, 0, -0.5, 0, r, r, h + 0.5, m.base.color || STONE, 24);
      else b.box(T, 0, h / 2, 0, 1.4, h, 1.4, STONE);
      b.ell(T, 0, h + 0.8, 0, 0.5, 0.8, 0.38, c);
      b.ell(T, 0.15, h + 1.75, 0, 0.32, 0.4, 0.26, c);
      return { top: h + 2.2, half: r };
    }
    case 'installation': { // 피어나다: 정사영상의 색으로 낮은 꽃잎 모양 덩이를 둥글게
      const cols = m.pieceColors?.length ? m.pieceColors : ['#d8b04a', '#d77a3a', '#e8e4dc'];
      const R = (m.d || 3) / 2;
      for (let i = 0; i < 6; i++) {                          // 가운데에서 바깥으로 펼친 납작한 꽃잎
        const a = (i / 6) * Math.PI * 2, rr = R * 0.5;
        b.ellRot(T, Math.cos(a) * rr, 0.18, Math.sin(a) * rr, R * 0.5, 0.12, 0.32, -a, 0.25, cols[i % cols.length]);
      }
      b.ell(T, 0, 0.2, 0, 0.35, 0.2, 0.35, cols[0]);        // 가운데
      return { top: 0.5, half: 0 };
    }
    case 'mural': // 벽화 자리: 낮고 반듯한 벽 (그림은 근거 없음)
      b.box(T, 0, 1.2, 0, 6, 2.4, 0.35, '#cbbd9f');
      b.box(T, 0, 2.47, 0, 6.2, 0.14, 0.45, DARK_STONE);
      return { top: 2.6, half: 3.0 };
    case 'plaza': // 기념 공간: 바닥만 (buildPavement)
      return { top: 0, half: 0 };
    default: { // 비석: 받침돌 + 비 (정사영상에서 긴 돌이 보이면 그 크기로)
      if (m.length) {
        b.box(T, 0, 0.65, 0, m.length, 1.5, m.width || 1.2, c);
        return { top: 1.5, half: m.length / 2 };
      }
      b.box(T, 0, 0.2, 0, 1.8, 0.4, 0.9, STONE);
      b.box(T, 0, 1.2, 0, 1.2, 1.6, 0.26, c);
      b.box(T, 0, 2.06, 0, 1.32, 0.12, 0.34, DARK_STONE);
      return { top: 2.1, half: 0.9 };
    }
  }
}

// 서 있는 사람 실루엣 (키 약 1.75m): 다리·외투 몸통·팔·목·매끈한 머리. 과장 없는 실제 비례
function figure(b, T, x, y, z, c) {
  for (const s of [-1, 1]) b.cyl(T, x + s * 0.1, y, z, 0.075, 0.085, 0.85, c, 8);         // 다리
  b.cylScaled(T, x, y + 0.75, z, 0.2, 0.24, 0.72, c, 1, 0.62);                              // 몸통
  for (const s of [-1, 1]) b.cyl(T, x + s * 0.27, y + 0.85, z, 0.05, 0.06, 0.6, c, 8);      // 팔
  b.cyl(T, x, y + 1.47, z, 0.055, 0.06, 0.1, c, 8);                                         // 목
  b.ell(T, x, y + 1.64, z, 0.1, 0.125, 0.11, c);                                            // 머리
}

// 기념 공간 바닥 (OSM 외곽선 또는 동심원 포장): 땅 위에 얇게, 정사영상 색
function buildPavement(list) {
  const pos = [], col = [];
  const tri = (a, bb, cc, color) => {
    const k = new THREE.Color(color);
    for (const [px, pz] of [a, bb, cc]) { pos.push(px, heightAt(px, pz) + 0.08, pz); col.push(k.r, k.g, k.b); }
  };
  const poly = (o, color) => {
    const contour = o.map(([px, pz]) => new THREE.Vector2(px, pz));
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, [])) tri(o[i], o[j], o[k], color);
  };
  const circle = ([cx, cz], r, n = 32) => Array.from({ length: n }, (_, i) => [cx + Math.cos(i / n * Math.PI * 2) * r, cz + Math.sin(i / n * Math.PI * 2) * r]);
  for (const m of list) {
    const p = m.plaza;
    if (!p) continue;
    if (p.shape === 'osm' && p.outline?.length >= 3) {
      const o = p.outline[0][0] === p.outline.at(-1)[0] && p.outline[0][1] === p.outline.at(-1)[1] ? p.outline.slice(0, -1) : p.outline;
      if (p.color) poly(o, p.color);
      const cx = o.reduce((s, q) => s + q[0], 0) / o.length, cz = o.reduce((s, q) => s + q[1], 0) / o.length;
      const r = Math.min(...o.map(([px, pz]) => Math.hypot(px - cx, pz - cz))) * 0.6;
      if (p.innerColor && r > 0.5) poly(circle([cx, cz], r), p.innerColor);
    } else if (p.shape === 'rings') {
      poly(circle(m.p, p.d / 2), p.color || '#9a9a94');
      for (const r of p.rings || []) {
        const outer = circle(m.p, r + 0.2), inner = circle(m.p, r - 0.2);
        for (let i = 0; i < outer.length; i++) {
          const j = (i + 1) % outer.length;
          tri(outer[i], outer[j], inner[j], p.ringColor || '#8c7a72');
          tri(outer[i], inner[j], inner[i], p.ringColor || '#8c7a72');
        }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
    vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3, // 삼각형 방향이 섞여 양면
  }));
  mesh.receiveShadow = true;
  return mesh;
}

// ---------- 가로등 ----------

// 주요 차도(짧은 service 도로 제외) 양쪽에 약 30m 간격. 품질 "낮음"에서는 숨긴다
function buildLamps(campus, roads) {
  const rand = mulberry32(530);
  const spots = []; // [x, z, 도로 쪽 각도]
  const grid = new Map();
  const tooClose = (x, z) => {
    const gx = Math.floor(x / 10), gz = Math.floor(z / 10);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const [px, pz] of grid.get(`${gx + i},${gz + j}`) || []) if (Math.hypot(px - x, pz - z) < 8) return true;
    }
    return false;
  };
  const blocked = makeLampBlocker(campus);
  for (const r of campus.roads) {
    if (!r.car) continue;
    const len = polylineLength(r.points);
    if (r.type === 'service' && len < LAMP.minRoadLen) continue;
    const off = r.width / 2 + LAMP.gap;
    for (const side of [-1, 1]) {
      let t = rand() * LAMP.spacing;
      walk(r.points, (x, z, ux, uz, s) => {
        if (s < t) return;
        t += LAMP.spacing;
        const lx = x - uz * off * side, lz = z + ux * off * side;
        if (blocked(lx, lz) || roads.onRoad(lx, lz) || tooClose(lx, lz)) return;
        spots.push([lx, lz, Math.atan2(x - lx, z - lz)]);
        const k = `${Math.floor(lx / 10)},${Math.floor(lz / 10)}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push([lx, lz]);
      });
    }
  }

  // 기둥+팔은 한 도형, 등은 따로 (밝은 색)
  const H = LAMP.height;
  const pole = new THREE.CylinderGeometry(0.07, 0.11, H, 6).translate(0, H / 2, 0);
  const arm = new THREE.BoxGeometry(0.08, 0.08, 1.3).translate(0, H - 0.1, 0.6);
  const poleGeo = mergeSimple([pole, arm]);
  const headGeo = new THREE.BoxGeometry(0.3, 0.14, 0.6).translate(0, H - 0.2, 1.2);
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: '#5d636b' }), spots.length);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshLambertMaterial({ color: '#fff6d8', emissive: '#7a6f4e' }), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  spots.forEach(([x, z, a], i) => {
    m.compose(new THREE.Vector3(x, heightAt(x, z) - 0.1, z), q.setFromAxisAngle(up, a), one);
    poles.setMatrixAt(i, m);
    heads.setMatrixAt(i, m);
  });
  const group = new THREE.Group();
  group.add(poles, heads);
  group.userData.count = spots.length;
  return group;
}

function makeLampBlocker(campus) {
  const cell = 20, insides = new Map();
  for (const b of campus.buildings) {
    const xs = b.outline.map((p) => p[0]), zs = b.outline.map((p) => p[1]);
    for (let x = Math.floor((Math.min(...xs) - 2) / cell); x <= Math.floor((Math.max(...xs) + 2) / cell); x++) {
      for (let z = Math.floor((Math.min(...zs) - 2) / cell); z <= Math.floor((Math.max(...zs) + 2) / cell); z++) {
        const k = `${x},${z}`;
        if (!insides.has(k)) insides.set(k, []);
        insides.get(k).push(b.outline);
      }
    }
  }
  const waters = campus.greens.filter((g) => g.kind === 'water').map((g) => g.outline);
  return (x, z) => {
    for (const o of insides.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) || []) if (pointInPolygon(x, z, o)) return true;
    return waters.some((o) => pointInPolygon(x, z, o));
  };
}

// ---------- 도로 찾기 ----------

function makeRoadIndex(list) {
  const cell = 20, grid = new Map();
  for (const r of list) {
    for (let i = 0; i < r.points.length - 1; i++) {
      const [xa, za] = r.points[i], [xb, zb] = r.points[i + 1];
      const seg = [xa, za, xb, zb, r.width / 2, r.car];
      for (let x = Math.floor(Math.min(xa, xb) / cell) - 1; x <= Math.floor(Math.max(xa, xb) / cell) + 1; x++) {
        for (let z = Math.floor(Math.min(za, zb) / cell) - 1; z <= Math.floor(Math.max(za, zb) / cell) + 1; z++) {
          const k = `${x},${z}`;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(seg);
        }
      }
    }
  }
  const around = (x, z, R) => {
    const out = new Set();
    const n = Math.ceil(R / cell);
    const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (const s of grid.get(`${gx + i},${gz + j}`) || []) out.add(s);
    return out;
  };
  return {
    // R 안에서 가장 가까운 도로 위 점 {x, z}
    nearest(x, z, R, carOnly) {
      let best = null, bestD = R;
      for (const s of around(x, z, R)) {
        if (carOnly && !s[5]) continue;
        const d = distToSegment(x, z, s);
        if (d < bestD) {
          const [x1, z1, x2, z2] = s, dx = x2 - x1, dz = z2 - z1, L = dx * dx + dz * dz;
          const t = L ? Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / L)) : 0;
          const len = Math.sqrt(L) || 1;
          best = { x: x1 + dx * t, z: z1 + dz * t, ux: dx / len, uz: dz / len };
          bestD = d;
        }
      }
      return best;
    },
    // 차도 위(가장자리 0.4m 여유)인지
    onRoad(x, z) {
      for (const s of around(x, z, 0)) if (s[5] && distToSegment(x, z, s) < s[4] + 0.4) return true;
      return false;
    },
  };
}

// 선을 따라 1m마다 cb(x, z, 방향 ux, uz, 시작부터 거리)
function walk(points, cb) {
  let s = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, z1] = points[i], [x2, z2] = points[i + 1];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 1e-6) continue;
    const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
    for (let t = 0; t < len; t += 1) cb(x1 + ux * t, z1 + uz * t, ux, uz, s + t);
    s += len;
  }
}

function polylineLength(points) {
  let s = 0;
  for (let i = 0; i < points.length - 1; i++) s += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  return s;
}

// ---------- 도형 합치기 ----------

class PartBuilder {
  constructor() {
    this.pos = []; this.nor = []; this.col = [];
    this.m = new THREE.Matrix4();
  }

  // 소품 하나의 좌표계: (x, z)의 땅 위에 놓고 yaw만큼 돌림 (받침이 비탈에 뜨지 않게 살짝 묻음)
  frame(x, z, yaw) {
    return new THREE.Matrix4().makeRotationY(yaw).setPosition(x, heightAt(x, z) - 0.1, z);
  }

  add(geo, T, color) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.applyMatrix4(T);
    const c = new THREE.Color(color);
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i++) { this.pos.push(p[i]); this.nor.push(n[i]); }
    for (let i = 0; i < p.length / 3; i++) this.col.push(c.r, c.g, c.b);
  }

  box(T, x, y, z, sx, sy, sz, color) {
    this.add(new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z), T, color);
  }

  // 각진 기둥(sides=4면 사각, 45° 돌려 면이 앞을 보게): 바닥 반지름 r0, 위 r1, 높이 h
  prism(T, x, y, z, r0, r1, h, sides, color) {
    const g = new THREE.CylinderGeometry(r1, r0, h, sides).rotateY(Math.PI / sides).translate(x, y + h / 2, z);
    g.computeVertexNormals();
    this.add(g, T, color);
  }

  // 타원체 (반지름 rx·ry·rz)
  ell(T, x, y, z, rx, ry, rz, color) {
    this.add(new THREE.IcosahedronGeometry(1, 2).scale(rx, ry, rz).translate(x, y, z), T, color);
  }

  // 돌린 타원체 (바깥 끝을 tilt만큼 들고 yaw로 돌림)
  ellRot(T, x, y, z, rx, ry, rz, yaw, tilt, color) {
    const g = new THREE.IcosahedronGeometry(1, 2).scale(rx, ry, rz).rotateZ(tilt).rotateY(yaw);
    this.add(g.translate(x, y, z), T, color);
  }

  // 원기둥 (바닥 y에서 높이 h, 위 반지름 r1, 아래 r0)
  cyl(T, x, y, z, r1, r0, h, color, seg = 12) {
    this.add(new THREE.CylinderGeometry(r1, r0, h, seg).translate(x, y + h / 2, z), T, color);
  }

  // 옆으로 납작한 원기둥 (sx·sz 배율)
  cylScaled(T, x, y, z, r1, r0, h, color, sx, sz) {
    this.add(new THREE.CylinderGeometry(r1, r0, h, 14).scale(sx, 1, sz).translate(x, y + h / 2, z), T, color);
  }

  // 돌린 상자 (가운데 x·y·z, 크기, 회전 rx·ry·rz)
  boxRot(T, x, y, z, sx, sy, sz, rx, ry, rz, color) {
    const g = new THREE.BoxGeometry(sx, sy, sz).applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    this.add(g.translate(x, y, z), T, color);
  }

  ball(T, x, y, z, r, color) {
    this.add(new THREE.IcosahedronGeometry(r, 1).translate(x, y, z), T, color);
  }

  mesh() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.computeBoundingSphere();
    return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  }
}

function mergeSimple(geos) {
  const pos = [], nor = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return geo;
}

function square(x, z, h, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [[-h, -h], [h, -h], [h, h], [-h, h]].map(([a, b]) => [x + a * c + b * s, z - a * s + b * c]);
}

function hashAngle(x, z) {
  return ((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1) * Math.PI * 2;
}
