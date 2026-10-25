// 시작(첫 화면), 화면 구성, 입력, 소리, 게임 루프.
import * as THREE from 'three';
import { loadCampus, buildMap, placeSpawnAtGate } from './map.js';
import { buildLandscape, removeReplacedBuildings } from './landscape.js';
import { loadTerrain } from './terrain.js';
import { Car, Collider } from './car.js';
import { CameraRig } from './camera.js';
import { Hud } from './hud.js';
import { unlockAudio, playBoost, playBoostEnd, playHit, playStep, playMoo, playBonk, speak, EngineSound, isMuted, setMuted } from './voice.js';
import { LateMode } from './late-mode.js';
import { Walker } from './walker.js';
import { STUDENT_LINES } from './dialogue-data.js';
import { buildFarTerrain } from './surroundings.js';

const SKY_TOP = new THREE.Color('#5ea8ec');
const SKY_HORIZON = new THREE.Color('#e6f1fb');
// 햇빛: 오전 9시쯤(수업 시작) 동남동 하늘 약 35° (방위 125°). 실제 날짜·시각 계산이 아니라 그 무렵의 방향으로 정한 값(추정)
const SUN_DIR = new THREE.Vector3(0.67, 0.57, 0.47).normalize();
const SUN_COLOR = '#ffeccf';
// 주소 뒤에 ?fps=1 을 붙이면 왼쪽 위 구석에 fps 표시 (기본은 숨김)
const SHOW_FPS = ['1', 'true', ''].includes(new URLSearchParams(location.search).get('fps'));
// 굴착기 색 (첫 화면에서 고름)
const CAR_COLORS = ['#f5b82e', '#e8503a', '#3a7be8', '#4cb15a', '#f08a24', '#e86fa8'];
// 시작 품질: 램 8GB·내장 그래픽 노트북에서도 버티도록 처음엔 "낮음" (사용자가 고른 품질은 브라우저에 기억해 다음에도 씀)
const START_QUALITY = 'low';
const DPR_MAX = 1.25; // 품질 높음의 화면 해상도 배율 상한 (낮음은 1)
const GROUND_PX = { high: 3072, low: 2048 }; // 바닥 그림 해상도 (높음 4096 → 3072: GPU 약 76MB → 43MB)
// 저사양 자동 품질: 첫 화면이 뜬 뒤 약 3초 동안 fps가 이보다 낮으면 한 단계 가볍게 (사용자가 고른 품질은 그대로)
const AUTO_FPS = 45;
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
// 지수 안개: 캠퍼스(1km 안)는 거의 맑고, 먼 산(무등산 약 10km)은 옅게 보이다가 지평선에서 하늘색으로
scene.fog = new THREE.FogExp2(SKY_HORIZON, 0.000105);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 22000);

scene.add(new THREE.HemisphereLight('#d9ebff', '#b3ab98', 1.55)); // 하늘빛(위) · 땅에서 튀는 빛(아래)
const sun = new THREE.DirectionalLight(SUN_COLOR, 2.35);
const SUN_OFFSET = SUN_DIR.clone().multiplyScalar(170);
sun.shadow.mapSize.set(1024, 1024); // 2048 → 1024: 그림자 맵 메모리 1/4 (품질 높음에서만 그림자)
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
    // 위는 진한 하늘색 → 지평선은 옅은 안개색, 해 쪽은 따뜻하게 밝음(해 둘레 빛 + 그 방향 지평선 노을기). 빛 번짐 후처리 없음
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
let userQuality = false; // 사용자가 직접 고른 품질이 있으면 자동으로 바꾸지 않음
try {
  const saved = localStorage.getItem('quality');
  if (saved === 'low' || saved === 'high') { quality = saved; userQuality = true; }
} catch {}
let renderScale = 1; // 자동 품질이 "낮음"에서도 느릴 때만 0.8

// byUser: 왼쪽 위 버튼으로 고름 → 기억하고, 자동 품질은 손대지 않음
function setQuality(q, byUser = false) {
  quality = q;
  const high = q === 'high';
  if (byUser) {
    userQuality = true;
    renderScale = 1;
    try { localStorage.setItem('quality', q); } catch {}
  }
  renderer.setPixelRatio(high ? Math.min(devicePixelRatio, DPR_MAX) : renderScale);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = high;
  sun.castShadow = high;
  world.trees.setDensity(high ? 1 : 0.5);
  world.ground.setResolution(GROUND_PX[q]); // 바닥 그림 해상도
  world.landscape.lamps.visible = high; // 가로등은 품질 높음에서만
  scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  hud.setQuality(q);
}

// 첫 화면이 뜬 뒤 0.5~3.5초의 평균 fps가 낮으면 한 단계 가볍게: 높음 → 낮음, 낮음 → 해상도 배율 0.8
const autoQ = { start: 0, frames: 0, done: false };
function checkAutoQuality() {
  if (autoQ.done) return;
  const now = performance.now();
  if (!autoQ.start) autoQ.start = now + 500;
  if (now < autoQ.start) return;
  autoQ.frames++;
  if (now < autoQ.start + 3000) return;
  autoQ.done = true;
  const fps = (autoQ.frames * 1000) / (now - autoQ.start);
  window.__autoFps = Math.round(fps); // 확인용
  if (fps >= AUTO_FPS || userQuality) return;
  if (quality === 'high') {
    setQuality('low');
    hud.toast('화면이 느려서 그래픽을 "낮음"으로 바꿨어요', 3500);
  } else if (renderScale > 0.8) {
    renderScale = 0.8;
    renderer.setPixelRatio(renderScale);
    renderer.setSize(innerWidth, innerHeight);
    hud.toast('화면이 느려서 해상도를 조금 낮췄어요 (왼쪽 위 "낮음"을 누르면 원래대로)', 4000);
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
  if (e.code === 'KeyC') hud.toast(`시점: ${walker?.active ? rig.nextWalkMode().label : rig.nextMode().label}`);
  if (walker?.active) {
    walker.poke(); // 졸던 학생은 아무 키에나 화들짝 깸
    if (onWalkKey(e.code)) return;
  } else {
    if (e.code === 'KeyH') hud.showHelp();
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

const hud = new Hud({ onQuality: (q) => setQuality(q, true), onSound: toggleSound });
// 설정 (브라우저에 기억): 걸을 때 카메라 자동으로 뒤로 (기본 꺼짐), 학생 혼잣말 (기본 켬)
const settings = { walkCamAuto: false, chatter: true };
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
  if (code === 'KeyH') { if (walker.moo()) playMoo(); return true; } // 걷는 중의 H는 음메
  const emote = { Digit1: 1, Digit2: 2, Digit3: 3, Numpad1: 1, Numpad2: 2, Numpad3: 3 }[code];
  if (emote) { walker.setEmote(emote); return true; }
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

// 걷는 중 가끔 혼잣말: 머리 위 말풍선 + 교수님보다 높고 귀여운 꿍싯꿍싯 목소리 (설정에서 끔)
let lastLine = -1;
function studentChatter() {
  if (!settings.chatter) return;
  let i = Math.floor(Math.random() * STUDENT_LINES.length);
  if (i === lastLine) i = (i + 1) % STUDENT_LINES.length;
  lastLine = i;
  hud.sayStudent(STUDENT_LINES[i], speak(STUDENT_LINES[i], { pitch: 1.9 }));
}

let walkingUi = false;
function setWalkingUi(on) {
  if (on === walkingUi) return;
  walkingUi = on;
  document.body.classList.toggle('walking', on);
}

// ---------- 로딩 화면: 진행률 막대 + 조작 팁 ----------

const LOADING_TIPS = [
  '방향키나 WASD로 운전, Space로 드리프트!',
  'Shift를 누르고 있으면 부스터. 게이지는 저절로 차요.',
  '지각 모드는 L. 3분 안에 미션 4곳을 들르고 공대 2호관으로!',
  '미션 장소의 원 안에 멈춘 뒤 E를 누르세요.',
  '자유 주행에서 멈춘 채 E를 누르면 학생이 내려서 걸어요.',
  '걷는 중 H는 음메~, 1·2·3은 감정 표현.',
  'C로 시점을 바꿀 수 있어요. M은 소리 켜기/끄기.',
  '화면이 느리면 왼쪽 위 그래픽 "낮음"을 눌러 보세요.',
];
const loadingUi = (() => {
  const el = document.getElementById('loading');
  const fill = el.querySelector('.ld-fill'), text = el.querySelector('.ld-text'), tip = el.querySelector('.ld-tip');
  let i = Math.floor(Math.random() * LOADING_TIPS.length);
  const showTip = () => { tip.textContent = `팁: ${LOADING_TIPS[i++ % LOADING_TIPS.length]}`; };
  showTip();
  const timer = setInterval(showTip, 3200);
  let failed = false;
  return {
    set(p, label) {
      if (failed) return; // 실패한 뒤 늦게 끝난 다운로드가 안내를 덮지 않게
      fill.style.width = `${Math.round(p * 100)}%`;
      text.textContent = `${label} ${Math.round(p * 100)}%`;
    },
    fail(msg) {
      failed = true;
      clearInterval(timer);
      el.classList.add('failed');
      text.textContent = '불러오지 못했어요. 새로고침해 주세요.';
      tip.textContent = msg;
    },
    done() { clearInterval(timer); el.remove(); },
  };
})();
// 무거운 단계 사이에 화면을 한 번 그릴 틈 (진행률 막대가 움직이게)
const breathe = () => new Promise((r) => setTimeout(r, 0));

async function start() {
  let got = 0;
  const count = (p) => p.then((v) => { got++; loadingUi.set(got * 0.07, '캠퍼스 지도 받는 중…'); return v; });
  loadingUi.set(0, '캠퍼스 지도 받는 중…');
  const [campus, lawns, widths, styles, monuments, , farTerrain] = await Promise.all([
    count(loadCampus('data/campus.json?v=9')), count(loadCampus('data/lawns.json?v=1')), count(loadCampus('data/road-widths.json?v=1')),
    count(loadCampus('data/building-styles.json?v=8')), count(loadCampus('data/monuments.json?v=4')),
    count(loadTerrain('data/terrain.json?v=1')), count(loadCampus('data/far-terrain.json?v=1')),
  ]);
  loadingUi.set(0.5, '땅과 건물 만드는 중…');
  await breathe();
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
    groundPx: GROUND_PX[quality],
    terrainFar: 1, // 지형 격자 바깥은 먼 지형(바깥 풍경)이 채운다
    drape: [2.5, 2.5, 2.5], // 차도 메시 간격: 지금 지형(AWS, 부드러움)에서는 v7과 같은 2.5m 한 가지 (정밀 지형은 3단계)
    treeKinds: false, wallShade: false, // 나무 다양화·벽 아래 음영은 4단계
  });
  world.campus = campus;
  world.far = buildFarTerrain(scene, farTerrain); // 먼 산 능선 (300m 격자, 충돌 없음). 둘레 건물은 넣지 않음
  // 지붕만 있는 차양은 지나갈 수 있게 충돌에서 뺀다
  collider = new Collider({ ...campus, buildings: campus.buildings.filter((b) => !b.style?.canopy) });
  loadingUi.set(0.72, '나무와 조형물 놓는 중…');
  await breathe();
  world.landscape = buildLandscape(scene, campus);
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
  loadingUi.set(0.88, '굴착기에 시동 거는 중…');
  await breathe();
  lateMode = new LateMode({ scene, car, hud, campus, camera, rig, trees: world.trees });
  walker = new Walker(car, { campus, collider });
  walker.onStep = playStep;
  walker.onBonk = playBonk;
  walker.onChatter = studentChatter;
  scene.add(walker.object);
  lateMode.onBeforeStart = () => walker.boardNow(); // 걷는 중에 지각 모드 버튼: 먼저 운전석으로
  hud.initMinimap(campus);
  setupTitle();

  setQuality(quality);
  updateTitleCamera(0);
  rig.update(0, car);
  loadingUi.set(1, '다 됐어요!');
  loadingUi.done();
  window.game = { car, rig, collider, campus, renderer, world, lateMode, walker }; // 콘솔에서 확인용
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
const headTmp = new THREE.Vector3();
let nameTimer = 0;
let fpsFrames = 0, fpsTime = 0;

function loop() {
  const dt = Math.min(clock.getDelta(), 0.1);
  checkAutoQuality();
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
  car.driver.setExpression(walking ? walker.face() : driverExpression());
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
  hud.updateStudent(camera, walking ? walker.headTop(headTmp) : null, walking && walker.napping);
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
  loadingUi.fail(`(${err.message}) 내 컴퓨터에서 열었다면 python -m http.server 8000으로 열었는지 확인해 주세요.`);
});
