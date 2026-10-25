// 시작(첫 화면), 화면 구성, 입력, 소리, 게임 루프.
import * as THREE from 'three';
import { loadCampus, buildMap } from './map.js';
import { buildLandscape, removeReplacedBuildings } from './landscape.js';
import { loadTerrain } from './terrain.js';
import { Car, Collider } from './car.js';
import { CameraRig } from './camera.js';
import { Hud } from './hud.js';
import { unlockAudio, playBoost, playBoostEnd, playHit, playStep, EngineSound, isMuted, setMuted } from './voice.js';
import { LateMode } from './late-mode.js';
import { Walker } from './walker.js';

const SKY_TOP = new THREE.Color('#6fb4f0');
const SKY_HORIZON = new THREE.Color('#e4f3ff');
// 주소 뒤에 ?fps=1 을 붙이면 왼쪽 위 구석에 fps 표시 (기본은 숨김)
const SHOW_FPS = ['1', 'true', ''].includes(new URLSearchParams(location.search).get('fps'));
// 굴착기 색 (첫 화면에서 고름)
const CAR_COLORS = ['#f5b82e', '#e8503a', '#3a7be8', '#4cb15a', '#f08a24', '#e86fa8'];
// 기본 그래픽 품질 (정문 출발 화면에서 품질 높음 fps를 재서 정함)
const DEFAULT_QUALITY = 'high';
// 항상 이름표를 띄울 주요 건물: [OSM 이름, 화면에 보일 이름]
const LANDMARKS = [
  ['중앙도서관'], ['공과대 2호관'], ['농생대 1호관'], ['제1학생마루', '제1학생회관'],
  ['생활관 9C동 예향학사', '생활관 9호관'], ['대학본부'],
];

// ---------- 렌더러, 장면, 빛 ----------

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(SKY_HORIZON, 700, 3000);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 5000);

scene.add(new THREE.HemisphereLight('#dceeff', '#b8b2a2', 1.6));
const sun = new THREE.DirectionalLight('#fff6e8', 2.2);
const SUN_OFFSET = new THREE.Vector3(70, 120, 50);
sun.shadow.mapSize.set(2048, 2048);
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
    uniforms: { top: { value: SKY_TOP }, horizon: { value: SKY_HORIZON } },
    vertexShader: `varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vDir;
      void main() { float t = pow(clamp(vDir.y, 0.0, 1.0), 0.6); gl_FragColor = vec4(mix(horizon, top, t), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(3000, 24, 12), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------- 그래픽 품질 ----------

let quality = DEFAULT_QUALITY;
try { quality = localStorage.getItem('quality') || DEFAULT_QUALITY; } catch {}

function setQuality(q) {
  quality = q;
  const high = q === 'high';
  renderer.setPixelRatio(high ? Math.min(devicePixelRatio, 1.5) : 1);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = high;
  sun.castShadow = high;
  world.trees.setDensity(high ? 1 : 0.5);
  world.ground.setResolution(high ? 4096 : 2048); // 바닥 그림 해상도
  world.landscape.lamps.visible = high; // 가로등은 품질 높음에서만
  scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  hud.setQuality(q);
  try { localStorage.setItem('quality', q); } catch {}
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
  if (e.code === 'KeyC') hud.toast(`시점: ${walker?.active ? rig.nextWalkMode().label : rig.nextMode().label}`);
  if (e.code === 'KeyH') hud.showHelp();
  if (walker?.active) {
    if (onWalkKey(e.code)) return;
  } else {
    if (e.code === 'KeyG') car.driver.togglePeek(); // 운전사 학생이 왼쪽 창문으로 고개 내밀기 (게임 결과와 상관없음)
    if (e.code === 'KeyE' && !lateMode?.active) getOff();
  }
  lateMode?.onKey(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('pointerdown', () => {
  unlockAudio();
  lateMode?.advance(); // 연출 대사 넘기기
});
addEventListener('blur', () => { keys.clear(); dragging = false; });

// 걷는 중 마우스 시점: 누른 채 끌면 학생 주위로 돌리고, 휠로 거리 조절
let dragging = false;
const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', (e) => {
  if (!walker?.active) return;
  dragging = true;
  try { canvas.setPointerCapture(e.pointerId); } catch {} // 창 밖으로 끌어도 계속
});
canvas.addEventListener('pointermove', (e) => { if (dragging && walker?.active) rig.dragOrbit(e.movementX, e.movementY); });
for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, () => { dragging = false; });
canvas.addEventListener('wheel', (e) => {
  if (!walker?.active) return;
  e.preventDefault();
  rig.zoomOrbit(e.deltaY);
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

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

const hud = new Hud({ onQuality: setQuality, onSound: toggleSound });
// 설정 (브라우저에 기억): 걸을 때 카메라 자동으로 뒤로 (기본 꺼짐)
const settings = { walkCamAuto: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem('walkSettings') || '{}')); } catch {}
hud.bindSettings(settings, () => { try { localStorage.setItem('walkSettings', JSON.stringify(settings)); } catch {} });
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
let walker = null;

// ---------- 내려서 걷기 (자유 모드) ----------

// E: 굴착기 왼쪽 문으로 내린다 (멈춰 있을 때만)
function getOff() {
  if (car.speedKmh > 4) { hud.toast('굴착기를 멈추면 내릴 수 있어요'); return; }
  car.setCockpitView(false);
  walker.exit();
  rig.startWalk(car.heading, new THREE.Vector3(car.pos.x, car.object.position.y + 1.5, car.pos.y));
  hud.hideHelp();
}

// 걷는 중의 키. 처리했으면 true (지각 모드 키로 넘기지 않음)
function onWalkKey(code) {
  if (!walker.walking) return code === 'KeyE' || code === 'KeyL'; // 타고 내리는 중
  if (code === 'KeyE') {
    if (walker.nearCar()) walker.board();
    else hud.toast('굴착기 가까이 가면 탈 수 있어요');
    return true;
  }
  if (code === 'KeyR') {
    const r = walker.summon();
    hud.toast(r === 'ok' ? '굴착기를 불렀어요' : r === 'near' ? '굴착기가 가까이 있어요' : '여기는 굴착기를 세울 자리가 없어요');
    return true;
  }
  if (code === 'KeyV') { rig.resetOrbit(); return true; }
  if (code === 'KeyL') { walker.board(() => lateMode.start()); return true; } // 먼저 굴착기에 타고 지각 모드
  return false;
}

// 걷는 방향의 기준: 카메라가 보는 쪽 (땅 위 방향)
const camDirTmp = new THREE.Vector3();
function cameraGroundDir() {
  camera.getWorldDirection(camDirTmp);
  const v = new THREE.Vector2(camDirTmp.x, camDirTmp.z);
  return v.lengthSq() > 1e-6 ? v.normalize() : new THREE.Vector2(0, -1);
}

let walkingUi = false;
function setWalkingUi(on) {
  if (on === walkingUi) return;
  walkingUi = on;
  document.body.classList.toggle('walking', on);
}

async function start() {
  const [campus, lawns, widths] = await Promise.all([
    loadCampus('data/campus.json?v=8'), loadCampus('data/lawns.json?v=1'), loadCampus('data/road-widths.json?v=1'),
    loadTerrain('data/terrain.json?v=1'),
  ]);
  applyRoadWidths(campus, widths.roads); // 수치지도·정사영상으로 잰 실제 차도 폭 (scripts/ngii_roads.py)
  campus.lawns = lawns; // 정사영상에서 찾은 잔디밭 (scripts/ngii_lawn.py)
  removeReplacedBuildings(campus); // 진입로 차단기 지붕을 막던 건물 → 부스·차단기
  world = buildMap(scene, campus, {
    anisotropy: renderer.capabilities.getMaxAnisotropy(), // 비스듬히 보이는 바닥 그림이 번지지 않게 장치 최대값
    groundPx: quality === 'high' ? 4096 : 2048,
  });
  collider = new Collider(campus);
  world.landscape = buildLandscape(scene, campus);
  for (const o of world.gateObstacles) collider.addObstacle(o);
  for (const o of world.landscape.obstacles) collider.addObstacle(o);
  for (const l of world.landscape.labels) hud.addLabel(l.text, l.x, l.y, l.z, { maxDist: l.maxDist, small: true });
  for (const m of campus.monuments || []) world.trees.clearAround(m.p[0], m.p[1], m.shape === 'tower' ? 6 : 3);
  world.trees.clearAround(...world.landscape.barrier.center, 12); // 차단기 지붕·부스 자리
  for (const [x, z] of world.landscape.avenue.spots) world.trees.clearAround(x, z, 4); // 진입로 가로수 자리의 작은 나무
  for (const [osmName, label] of LANDMARKS) {
    const b = campus.buildings.find((x) => x.name === osmName);
    if (b) hud.addLabel(label || osmName, b.center[0], b.base + b.height + 5, b.center[1]);
    else console.warn('이름표 건물을 찾지 못함:', osmName);
  }

  const { position, dir } = campus.spawn;
  car.place(position[0], position[1], dir[0], dir[1]);
  lateMode = new LateMode({ scene, car, hud, campus, camera, rig, trees: world.trees });
  walker = new Walker(car, { campus, collider });
  walker.onStep = playStep;
  scene.add(walker.object);
  lateMode.onBeforeStart = () => walker.boardNow(); // 걷는 중에 지각 모드 버튼: 먼저 운전석으로
  hud.initMinimap(campus);
  setupTitle();

  setQuality(quality);
  updateTitleCamera(0);
  rig.update(0, car);
  document.getElementById('loading').remove();
  window.game = { car, rig, collider, campus, renderer, world, lateMode, walker }; // 콘솔에서 확인용
  window.__readyMs = performance.now(); // 페이지를 연 뒤 첫 화면까지 (측정용)
  renderer.setAnimationLoop(loop);
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

// 운전사 학생 표정: 자유 주행 웃음, 지각 모드 긴장, 결과 A+ 만세, F 울먹 (그 밖의 등급은 웃음)
function driverExpression() {
  if (!lateMode.active) return 'smile';
  if (lateMode.state === 'outro' || lateMode.state === 'result') {
    return lateMode.grade === 'A+' ? 'hooray' : lateMode.grade === 'F' ? 'cry' : 'smile';
  }
  return 'nervous';
}

// ---------- 루프 ----------

const clock = new THREE.Clock();
let nameTimer = 0;
let fpsFrames = 0, fpsTime = 0;

function loop() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const input = onTitle || lateMode.inputLocked ? NO_INPUT : readInput();
  if (onTitle) updateTitleCamera(clock.elapsedTime);

  const walking = walker.active; // 학생이 내려서 걷는 중 (굴착기는 시동만 걸린 채 서 있음)

  // 프레임이 길면 잘게 나눠서 벽을 뚫지 않게. 일시정지·결과 화면에서는 멈춤
  if (!lateMode.frozen) {
    const steps = Math.ceil(dt / (1 / 60));
    for (let i = 0; i < steps; i++) {
      car.update(dt / steps, walking ? NO_INPUT : input, collider);
      if (walking) walker.update(dt / steps, input, cameraGroundDir());
    }
  }
  if (!walking) walker.update(dt); // 타고 나서 문 닫기
  lateMode.update(dt);
  car.driver.setExpression(driverExpression());
  if (lateMode.frozen) car.driver.update(dt, 0); // 결과 화면 등 굴착기가 멈춘 동안에도 표정·만세 움직임
  const focus = walking ? walker.pos : car.pos; // 화면·소리·미니맵의 중심
  const focusY = walking ? walker.y : car.object.position.y;
  world.landscape.update(dt, focus.x, focus.y); // 주차 차단기

  if (walking) rig.updateWalk(dt, walker, { autoBehind: settings.walkCamAuto, dragging });
  else rig.update(dt, car);
  sky.position.copy(camera.position);
  sun.target.position.set(focus.x, focusY, focus.y);
  sun.position.copy(sun.target.position).add(SUN_OFFSET);

  engine.update(dt, {
    speed: walking ? 0 : Math.abs(car.forwardSpeed), throttle: !walking && car.throttle, boostFx: car.boostFx,
    active: !onTitle && !lateMode.frozen, quiet: walking,
  });

  setWalkingUi(walking);
  hud.setWalkHint(walking ? (walker.walking && walker.nearCar() ? 'near' : 'far') : null);
  hud.setSpeed(walking ? walker.speed * 3.6 : car.speedKmh);
  if (!onTitle) {
    const target = lateMode.active && lateMode.target ? lateMode.target : null;
    hud.drawMinimap(focus, walking ? walker.heading : car.heading, target, walking ? car.pos : null);
  }
  hud.setBoost(car.boost, car.boosting ? 'active' : car.boostReady ? 'ready' : '');
  hud.drawSpeedLines(car.boostFx);
  hud.updateLabels(camera);
  nameTimer -= dt;
  if (nameTimer <= 0) {
    nameTimer = 0.2;
    hud.setBuilding(collider.nearestNamed(focus.x, focus.y, 22));
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
