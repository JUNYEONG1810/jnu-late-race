// 시작(첫 화면), 화면 구성, 입력, 소리, 게임 루프.
import * as THREE from 'three';
import { loadCampus, buildMap, placeSpawnAtGate } from './map.js';
import { buildLandscape, removeReplacedBuildings } from './landscape.js';
import { loadTerrain } from './terrain.js';
import { Car, Collider } from './car.js';
import { CameraRig } from './camera.js';
import { Hud } from './hud.js';
import { unlockAudio, playBoost, playBoostEnd, playHit, EngineSound, isMuted, setMuted } from './voice.js';
import { LateMode } from './late-mode.js';
import { buildFarTerrain, buildOutsideBuildings } from './surroundings.js';
import { buildRoadMarks } from './roadmarks.js';
import { buildLife } from './life.js';

const SKY_TOP = new THREE.Color('#5ea8ec');
const SKY_HORIZON = new THREE.Color('#e6f1fb');
// 햇빛: 오전 9시쯤(수업 시작) 동남동 하늘 약 35° (방위 125°). 실제 날짜·시각 계산이 아니라 그 무렵의 방향으로 정한 값(추정)
const SUN_DIR = new THREE.Vector3(0.67, 0.57, 0.47).normalize();
const SUN_COLOR = '#ffeccf';
// 주소 뒤에 ?fps=1 을 붙이면 왼쪽 위 구석에 fps 표시 (기본은 숨김)
const SHOW_FPS = ['1', 'true', ''].includes(new URLSearchParams(location.search).get('fps'));
// 굴착기 색 (첫 화면에서 고름)
const CAR_COLORS = ['#f5b82e', '#e8503a', '#3a7be8', '#4cb15a', '#f08a24', '#e86fa8'];
// 시작 품질: 램 8GB·내장 그래픽 노트북에서도 버티도록 늘 "낮음"으로 시작 (왼쪽 위에서 "높음"으로 바꿀 수 있음)
const START_QUALITY = 'low';
const DPR_MAX = 1.25; // 품질 높음의 화면 해상도 배율 상한 (낮음은 1)
// 항상 이름표를 띄울 주요 건물: [OSM 이름, 화면에 보일 이름]
const LANDMARKS = [
  ['중앙도서관'], ['공과대 2호관'], ['농생대 1호관'], ['제1학생마루', '제1학생회관'],
  ['생활관 9C동 예향학사', '생활관 9호관'], ['대학본부'],
];

// ---------- 렌더러, 장면, 빛 ----------

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.type = THREE.PCFSoftShadowMap; // 부드러운 그림자 가장자리 (품질 높음에서만 그림자)
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// 지수 안개: 캠퍼스(1km 안)는 거의 맑고, 먼 산(무등산 약 10km)은 옅게 보이다가 지평선에서 하늘색으로
scene.fog = new THREE.FogExp2(SKY_HORIZON, 0.000105);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 22000);

scene.add(new THREE.HemisphereLight('#d9ebff', '#b3ab98', 1.55)); // 하늘빛(위) · 땅에서 튀는 빛(아래)
const sun = new THREE.DirectionalLight(SUN_COLOR, 2.35);
const SUN_OFFSET = SUN_DIR.clone().multiplyScalar(170);
sun.shadow.mapSize.set(1024, 1024); // 2048 → 1024: 그림자 맵 메모리 1/4 (부드러운 그림자라 계단이 덜 보임)
Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 10, far: 400 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);

const sky = makeSky();
scene.add(sky);

function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { top: { value: SKY_TOP }, horizon: { value: SKY_HORIZON }, sunDir: { value: SUN_DIR }, sunColor: { value: new THREE.Color('#fff1d6') } },
    vertexShader: `varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    // 위는 진한 하늘색 → 지평선은 옅은 안개색, 해 쪽은 따뜻하게 밝음(해 둘레 빛 + 그 방향 지평선 노을기)
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float t = pow(clamp(d.y, 0.0, 1.0), 0.55);
        vec3 c = mix(horizon, top, t);
        float s = max(dot(d, sunDir), 0.0);
        c += sunColor * (pow(s, 600.0) * 1.2 + pow(s, 40.0) * 0.28 + pow(s, 6.0) * 0.08 * (1.0 - t));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(3000, 24, 12), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------- 그래픽 품질 ----------

let quality = START_QUALITY;

function setQuality(q) {
  quality = q;
  const high = q === 'high';
  renderer.setPixelRatio(high ? Math.min(devicePixelRatio, DPR_MAX) : 1);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = high;
  sun.castShadow = high;
  world.trees.setDensity(high ? 1 : 0.5);
  world.ground.setResolution(high ? 3072 : 2048); // 바닥 그림 해상도 (높음 4096 → 3072: GPU 76MB → 43MB)
  world.landscape.lamps.visible = high; // 가로등은 품질 높음에서만
  world.life?.setQuality(high); // 학생·셔틀버스 수
  scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  hud.setQuality(q);
}

// ---------- 설정: 무거운 것은 기본 꺼짐, 켤 때 늦게 불러옴 ----------

const options = { outside: false, life: false }; // 바깥 건물(둘레 OSM 건물), 사람·차(주차 차량·셔틀버스·학생)
let loadingOption = false;

async function setOption(name, on) {
  if (loadingOption) return;
  options[name] = on;
  hud.setOption(name, on);
  if (name === 'outside') {
    if (on && !world.outside) {
      loadingOption = true;
      hud.toast('바깥 건물 불러오는 중…');
      const data = await loadCampus('data/surroundings.json?v=2');
      world.outside = buildOutsideBuildings(scene, data, world.far.far);
      loadingOption = false;
    }
    if (world.outside) world.outside.mesh.visible = on;
  } else if (name === 'life') {
    if (on && !world.life) {
      // 주차 차량·셔틀버스·학생 (미션 장소·출발점·교수님 등장 자리 둘레는 비움)
      world.life = buildLife(scene, world.campus, collider, {
        avoidPoints: [...lateMode.targets.map((t) => [t.x, t.z]), world.campus.spawn.position, [lateMode.stage.to.x, lateMode.stage.to.z]],
      });
      world.life.setQuality(quality === 'high');
    }
    world.life?.setVisible(on);
  }
}

// ---------- 입력 ----------

const keys = new Set();
const GAME_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
addEventListener('keydown', (e) => {
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  unlockAudio();
  keys.add(e.code);
  if (e.code === 'KeyM') toggleSound();
  if (onTitle) {
    if (e.code === 'KeyL') startLate();
    else if (e.code === 'Enter') startFree();
    return;
  }
  if (e.code === 'KeyC') hud.toast(`시점: ${rig.nextMode().label}`);
  if (e.code === 'KeyH') hud.showHelp();
  lateMode?.onKey(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('pointerdown', () => {
  unlockAudio();
  lateMode?.advance(); // 연출 대사 넘기기
});
addEventListener('blur', () => keys.clear());

function readInput() {
  return {
    up: keys.has('ArrowUp') || keys.has('KeyW'),
    down: keys.has('ArrowDown') || keys.has('KeyS'),
    left: keys.has('ArrowLeft') || keys.has('KeyA'),
    right: keys.has('ArrowRight') || keys.has('KeyD'),
    drift: keys.has('Space'),
    boost: keys.has('ShiftLeft') || keys.has('ShiftRight'),
  };
}
const NO_INPUT = { up: false, down: false, left: false, right: false, drift: false, boost: false };

// ---------- 시작 ----------

const hud = new Hud({ onQuality: setQuality, onSound: toggleSound, onOption: (name) => setOption(name, !options[name]) });
const rig = new CameraRig(camera);
const car = new Car();
car.onBoostStart = playBoost;
car.onBoostEnd = playBoostEnd;
car.onHit = playHit;
scene.add(car.object, car.exhaust.group);
const engine = new EngineSound();
hud.setSound(!isMuted());

function toggleSound() {
  setMuted(!isMuted());
  hud.setSound(!isMuted());
  hud.toast(isMuted() ? '소리 끔' : '소리 켬');
}

// ---------- 첫 화면 ----------

let onTitle = true;
const titleCam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50 };

function setupTitle() {
  let color = CAR_COLORS[0];
  try { color = localStorage.getItem('carColor') || color; } catch {}
  car.setColor(color);
  const box = document.querySelector('.title-colors');
  for (const c of CAR_COLORS) {
    const b = document.createElement('button');
    b.style.background = c;
    b.title = '굴착기 색';
    b.classList.toggle('on', c === color);
    b.addEventListener('click', () => {
      car.setColor(c);
      try { localStorage.setItem('carColor', c); } catch {}
      box.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    });
    box.appendChild(b);
  }
  document.getElementById('btn-free').addEventListener('click', startFree);
  document.getElementById('btn-late').addEventListener('click', startLate);
  const credits = document.getElementById('credits');
  document.getElementById('btn-credits').addEventListener('click', () => credits.classList.remove('hidden'));
  credits.querySelector('[data-act=close]').addEventListener('click', () => credits.classList.add('hidden'));
  document.body.classList.add('title');
  rig.setCinematic(titleCam);
}

function leaveTitle() {
  onTitle = false;
  document.getElementById('title').classList.add('hidden');
  document.getElementById('credits').classList.add('hidden');
  document.body.classList.remove('title');
}

function startFree() {
  leaveTitle();
  rig.setCinematic(null);
  rig.snap = true;
  hud.showHelp(7000);
}

function startLate() {
  leaveTitle();
  lateMode.start();
}

// 배경: 캠퍼스 위를 천천히 도는 카메라
function updateTitleCamera(time) {
  const a = time * 0.05;
  titleCam.pos.set(Math.sin(a) * 430, 230, Math.cos(a) * 430);
  titleCam.look.set(0, 0, 0);
}
let collider = null;
let world = null;
let lateMode = null;

// 불러오기 단계별 시간 (ms, 콘솔에서 window.game.loadTimes로 확인)
const loadTimes = {};
let lastMark = performance.now();
const mark = (k) => { const t = performance.now(); loadTimes[k] = Math.round(t - lastMark); lastMark = t; };

async function start() {
  mark('시작 전(모듈)');
  const [campus, lawns, widths, styles, monuments, , farTerrain, roadMarks] = await Promise.all([
    loadCampus('data/campus.json?v=6'), loadCampus('data/lawns.json?v=1'), loadCampus('data/road-widths.json?v=1'),
    loadCampus('data/building-styles.json?v=7'), loadCampus('data/monuments.json?v=4'),
    loadTerrain('data/terrain.json?v=4'), loadCampus('data/far-terrain.json?v=1'), loadCampus('data/road-marks.json?v=1'),
  ]);
  mark('데이터 받기');
  applyRoadWidths(campus, widths.roads); // 수치지도·정사영상으로 잰 실제 차도 폭 (scripts/ngii_roads.py)
  placeSpawnAtGate(campus); // 실제 정문 자리(OSM 정문 점보다 약 60m 북쪽)로 정문·출발 위치를 옮김
  campus.monumentsData = monuments.monuments; // 기념물 형태·크기·근거 (scripts/build_monuments.py)
  // 건물 외관 지정 (data/building-styles.json, 가장 우선). 층수도 근거가 있으면 여기서 바꾼다 (높이 = 층수 × 4m + 난간 1m)
  for (const b of campus.buildings) {
    const st = styles[b.id];
    if (!st) continue;
    b.style = st;
    if (st.floors) { b.floors = st.floors; b.height = st.floors * 4 + 1; }
  }
  campus.lawns = lawns; // 정사영상에서 찾은 잔디밭 (scripts/ngii_lawn.py)
  removeReplacedBuildings(campus); // 진입로 차단기 지붕을 막던 건물 → 부스·차단기
  world = buildMap(scene, campus, {
    anisotropy: renderer.capabilities.getMaxAnisotropy(), // 비스듬히 보이는 바닥 그림이 번지지 않게 장치 최대값
    groundPx: quality === 'high' ? 3072 : 2048, // 시작은 늘 낮음 → 2048
    terrainFar: 1, // 지형 격자 바깥은 먼 지형(바깥 풍경)이 채운다
  });
  mark('지도(바닥·건물·나무)');
  world.campus = campus;
  world.far = buildFarTerrain(scene, farTerrain); // 먼 산 (300m 격자, 충돌 없음). 둘레 건물은 설정에서 켤 때 불러옴
  mark('바깥 풍경');
  world.roadMarks = buildRoadMarks(campus, roadMarks); // 횡단보도·정지선·화살표·과속방지턱 (scripts/build_road_marks.py)
  world.group.add(...world.roadMarks.meshes);
  // 지붕만 있는 차양은 지나갈 수 있게 충돌에서 뺀다
  mark('노면 표시');
  collider = new Collider({ ...campus, buildings: campus.buildings.filter((b) => !b.style?.canopy) });
  mark('충돌');
  world.landscape = buildLandscape(scene, campus);
  mark('조경·기념물');
  for (const o of world.gateObstacles) collider.addObstacle(o);
  for (const o of world.landscape.obstacles) collider.addObstacle(o);
  for (const o of world.landscape.quietObstacles) collider.addObstacle(o, '', { quiet: true }); // 기념물: 조용히 멈춤
  for (const l of world.landscape.labels) hud.addLabel(l.text, l.x, l.y, l.z, { maxDist: l.maxDist, small: true });
  for (const m of campus.monumentsData) world.trees.clearAround(m.p[0], m.p[1], m.form === 'tower' ? 6 : m.base ? m.base.d / 2 + 1.5 : 3);
  world.trees.clearAround(...world.landscape.barrier.center, 12); // 차단기 지붕·부스 자리
  for (const [x, z] of world.landscape.avenue.spots) world.trees.clearAround(x, z, 4); // 진입로 가로수 자리의 작은 나무
  for (const [osmName, label] of LANDMARKS) {
    const b = campus.buildings.find((x) => x.name === osmName);
    if (b) hud.addLabel(label || osmName, b.center[0], b.base + b.height + 5, b.center[1]);
    else console.warn('이름표 건물을 찾지 못함:', osmName);
  }

  const { position, dir } = campus.spawn;
  car.place(position[0], position[1], dir[0], dir[1]);
  mark('나무 정리·이름표');
  lateMode = new LateMode({ scene, car, hud, campus, camera, rig, trees: world.trees });
  mark('지각 모드');
  hud.initMinimap(campus);
  setupTitle();
  mark('미니맵·첫 화면');

  setQuality(quality);
  mark('품질 적용');
  updateTitleCamera(0);
  rig.update(0, car);
  document.getElementById('loading').remove();
  window.game = { car, rig, collider, campus, renderer, world, lateMode, loadTimes }; // 콘솔에서 확인용
  window.__readyMs = performance.now(); // 페이지를 연 뒤 첫 화면까지 (측정용)
  renderer.setAnimationLoop(loop);
  setTimeout(() => lateMode.ensureProfessor(), 1500); // 첫 화면이 뜬 뒤 교수님 캐릭터를 미리 만들어 둠
}

// 잰 차도 폭·차로 수·분리대를 OSM 도로에 덮어쓴다. 정문을 지나는 도로가 넓어지면 정문 기둥 사이도 넓힌다
function applyRoadWidths(campus, list) {
  const [gx, gz] = campus.spawn.gate;
  for (const r of campus.roads) {
    const w = list[r.id];
    if (!w) continue;
    Object.assign(r, { width: w.width, lanes: w.lanes, median: w.median || 0 });
    if (r.points.some(([x, z]) => Math.hypot(x - gx, z - gz) < 1)) {
      campus.spawn.gateRoadWidth = Math.max(campus.spawn.gateRoadWidth || 0, w.width);
    }
  }
}

// ---------- 루프 ----------

const clock = new THREE.Clock();
let nameTimer = 0;
let fpsFrames = 0, fpsTime = 0;

function loop() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const input = onTitle || lateMode.inputLocked ? NO_INPUT : readInput();
  if (onTitle) updateTitleCamera(clock.elapsedTime);

  // 프레임이 길면 잘게 나눠서 벽을 뚫지 않게. 일시정지·결과 화면에서는 멈춤
  if (!lateMode.frozen) {
    const steps = Math.ceil(dt / (1 / 60));
    for (let i = 0; i < steps; i++) car.update(dt / steps, input, collider);
  }
  lateMode.update(dt);
  // 연출 중에는 교수님·굴착기 둘레의 학생·버스를 숨김
  if (options.life && world.life) {
    const cine = lateMode.active && lateMode.inputLocked && lateMode.state !== 'mission' && lateMode.state !== 'paused';
    world.life.update(dt, car, cine ? [[lateMode.stage.to.x, lateMode.stage.to.z], [car.pos.x, car.pos.y]] : []);
  }
  world.landscape.update(dt, car.pos.x, car.pos.y); // 주차 차단기

  rig.update(dt, car);
  sky.position.copy(camera.position);
  sun.target.position.set(car.pos.x, car.object.position.y, car.pos.y);
  sun.position.copy(sun.target.position).add(SUN_OFFSET);

  engine.update(dt, {
    speed: Math.abs(car.forwardSpeed), throttle: car.throttle, boostFx: car.boostFx,
    active: !onTitle && !lateMode.frozen,
  });

  hud.setSpeed(car.speedKmh);
  if (!onTitle) {
    const target = lateMode.active && lateMode.target ? lateMode.target : null;
    hud.drawMinimap(car.pos, car.heading, target);
  }
  hud.setBoost(car.boost, car.boosting ? 'active' : car.boostReady ? 'ready' : '');
  hud.drawSpeedLines(car.boostFx);
  hud.updateLabels(camera);
  nameTimer -= dt;
  if (nameTimer <= 0) {
    nameTimer = 0.2;
    hud.setBuilding(collider.nearestNamed(car.pos.x, car.pos.y, 22));
  }

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 1) {
    window.fps = Math.round(fpsFrames / fpsTime);
    if (SHOW_FPS) hud.setFps(window.fps);
    fpsFrames = 0;
    fpsTime = 0;
  }

  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

start().catch((err) => {
  console.error(err);
  document.getElementById('loading').textContent = `불러오기 실패: ${err.message} (python -m http.server 8000으로 열었는지 확인)`;
});
