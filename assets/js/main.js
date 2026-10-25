// 시작(첫 화면), 화면 구성, 입력, 소리, 게임 루프.
import * as THREE from 'three';
import { loadCampus, buildMap, placeSpawnAtGate } from './map.js';
import { buildLandscape, removeReplacedBuildings } from './landscape.js';
import { loadTerrain, heightAt, flattenWater } from './terrain.js';
import { Car, Collider } from './car.js';
import { CameraRig } from './camera.js';
import { Hud } from './hud.js';
import { unlockAudio, playBoost, playBoostEnd, playHit, playStep, playMoo, playBonk, playMeow, playSplash, playStamp, speak, EngineSound, isMuted, setMuted } from './voice.js';
import { LateMode, TIME_LIMIT } from './late-mode.js';
import { Walker } from './walker.js';
import { STUDENT_LINES } from './dialogue-data.js';
import { buildFarTerrain } from './surroundings.js';
import { buildRoadMarks } from './roadmarks.js';
import { buildShuttles } from './life.js';
import { Music } from './music.js';
import { buildSurface } from './surface.js';
import { buildPlay } from './play.js';
import { buildCampusLife } from './campus-life.js';
import { Records, Ghost, Ending, RunEvents } from './records.js';

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
  world.shuttle.setCount(high ? 2 : 1); // 셔틀버스 수
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
  if (ending?.active) { // 엔딩: Esc·Space·Enter로 건너뛰기
    if (['Escape', 'Space', 'Enter'].includes(e.code)) ending.skip();
    return;
  }
  if (photo.on) { // 사진 모드: P·Esc 나가기, Enter 촬영 (나머지 키는 카메라 이동)
    if (e.code === 'KeyP' || e.code === 'Escape') setPhoto(false);
    else if (e.code === 'Enter') takePhoto();
    return;
  }
  if (onTitle) {
    if (e.code === 'KeyL') startLate();
    else if (e.code === 'Enter') startFree();
    return;
  }
  if (e.code === 'KeyC') hud.toast(`시점: ${walker?.active ? rig.nextWalkMode().label : rig.nextMode().label}`);
  if (e.code === 'KeyP' && (!lateMode?.active || lateMode.state === 'result')) { setPhoto(true); return; }
  if (walker?.active) {
    walker.poke(); // 졸던 학생은 아무 키에나 화들짝 깸
    if (onWalkKey(e.code)) return;
  } else {
    if (e.code === 'KeyH') hud.showHelp();
    if (e.code === 'KeyG') drive.manualPeek = !drive.manualPeek; // 운전사 학생이 왼쪽 창문으로 고개 내밀기 (게임 결과와 상관없음)
    if (e.code === 'KeyE' && !lateMode?.active) getOff();
    if (e.code === 'KeyQ' && !lateMode?.inputLocked) car.scoop(); // 버킷 퍼 올리기
  }
  lateMode?.onKey(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('pointerdown', () => {
  unlockAudio();
  if (ending?.active) { ending.skip(); return; }
  lateMode?.advance(); // 연출 대사 넘기기
});
addEventListener('blur', () => { keys.clear(); dragging = false; });

// 걷는 중 마우스 시점: 누른 채 끌면 학생 주위로 돌리고, 휠로 거리 조절
let dragging = false;
const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', (e) => {
  if (!walker?.active && !photo.on) return;
  dragging = true;
  try { canvas.setPointerCapture(e.pointerId); } catch {} // 창 밖으로 끌어도 계속
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  if (photo.on) {
    photo.yaw -= e.movementX * 0.004;
    photo.pitch = THREE.MathUtils.clamp(photo.pitch - e.movementY * 0.004, -1.45, 1.45);
  } else if (walker?.active) rig.dragOrbit(e.movementX, e.movementY);
});
for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, () => { dragging = false; });
canvas.addEventListener('wheel', (e) => {
  if (photo.on) { // 사진 모드: 휠로 확대·축소 (시야각)
    e.preventDefault();
    camera.fov = THREE.MathUtils.clamp(camera.fov + Math.sign(e.deltaY) * 3, 20, 90);
    camera.updateProjectionMatrix();
    return;
  }
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

const hud = new Hud({ onQuality: (q) => setQuality(q, true), onSound: toggleSound, onBgm: toggleBgm });
const music = new Music(); // 배경음악 (자유 주행 / 지각 모드 / 결과), 따로 끌 수 있음
hud.setBgm(!music.off);
function toggleBgm() {
  music.setOff(!music.off);
  hud.setBgm(!music.off);
  hud.toast(music.off ? '배경음악 끔' : '배경음악 켬');
}
// 설정 (브라우저에 기억): 걸을 때 카메라 자동으로 뒤로 (기본 꺼짐), 학생 혼잣말 (기본 켬),
// 가벼운 모드 (기본 꺼짐: 켜면 장식 요소를 한꺼번에 끔)
const settings = { walkCamAuto: false, chatter: true, light: false, faceWindow: true, ghost: true, events: true };
try { Object.assign(settings, JSON.parse(localStorage.getItem('walkSettings') || '{}')); } catch {}
hud.bindSettings(settings, () => {
  try { localStorage.setItem('walkSettings', JSON.stringify(settings)); } catch {}
  applyLight();
});

// 가벼운 모드: 장식(먼 산, 나무 다양화, 도로 표시, 셔틀버스 …)을 끈다. 게임 진행에 필요한 것은 그대로
function applyLight() {
  if (!world) return;
  const on = !settings.light;
  world.far.mesh.visible = on;
  world.trees.setVariety(on);
  for (const m of world.roadMarks.meshes) m.visible = on;
  world.shuttle.group.visible = on;
  life?.setEnabled(on); // 오리·고양이·동물 학생·산책하는 교수님
}
const rig = new CameraRig(camera);
const car = new Car();
car.onBoostStart = () => { playBoost(); drive.boostT = DRIVE_FACE.boost; }; // 부스터: 깜짝
car.onBoostEnd = playBoostEnd;
car.onHit = (s) => { // 쾅: 세게 부딪히면 어질어질 + 머리 위 별
  playHit(s);
  if (s > DRIVE_FACE.crashHit) { drive.crashT = DRIVE_FACE.crash; car.driver.dizzy(DRIVE_FACE.crash); }
};
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
  document.getElementById('btn-daily').addEventListener('click', () => { leaveTitle(); lateMode.start({ daily: true }); });
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
let play = null; // 놀거리 (play.js)
let life = null; // 캠퍼스 산책 (campus-life.js)
let records = null, ghost = null, ending = null, events = null; // 기록과 도전 (records.js)
let pendingEvent = null; // 이번 판 무작위 사건 (출발하면 알림)

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
    else if (!life.interact()) hud.toast('굴착기 가까이 가면 탈 수 있어요 (고양이·벤치 가까이에서는 E)');
    return true;
  }
  if (code === 'KeyG') { life.greet(); return true; } // 동물 학생과 서로 손 흔들기 (없으면 혼자 흔듦)
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

// 배경음악 고르기 + 용봉관 시계탑 바늘 (지각 모드는 게임 시각 8:57 → 9:00, 그 밖에는 실제 지금 시각)
let clockT = 0;
function updateMusicAndClock(dt) {
  const L = lateMode;
  if (onTitle || !L.active) music.play('free');
  else if (['countdown', 'playing', 'mission', 'paused'].includes(L.state)) music.play('late');
  else if (L.state === 'intro') music.play(null);
  music.rush = L.active && L.state !== 'result' ? Math.max(0, Math.min(1, 1 - (TIME_LEFT() / 30))) : 0;
  if ((clockT -= dt) > 0 || !world.clock) return;
  clockT = 0.5;
  if (L.active && L.state !== 'result') {
    const t = L.clockSeconds;
    world.clock.setTime(Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60);
  } else {
    const d = new Date();
    world.clock.setTime(d.getHours(), d.getMinutes(), d.getSeconds());
  }
}
const TIME_LEFT = () => TIME_LIMIT - (lateMode.elapsed || 0);

// ---------- 사진 모드 (P): 화면 안내를 숨기고 자유 카메라, 촬영하면 PNG 저장 ----------
const PHOTO = { speed: 14, minAbove: 1.2 }; // 이동 m/s, 땅 위 최소 높이
const photo = { on: false, yaw: 0, pitch: 0, pos: new THREE.Vector3() };
function setPhoto(on) {
  if (on === photo.on) return;
  photo.on = on;
  document.body.classList.toggle('photo', on);
  keys.clear();
  if (on) {
    photo.pos.copy(camera.position);
    const d = new THREE.Vector3();
    camera.getWorldDirection(d);
    photo.yaw = Math.atan2(d.x, d.z);
    photo.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
    hud.toast('사진 모드', 1200);
  } else {
    camera.fov = 60;
    camera.updateProjectionMatrix();
    dragging = false;
  }
}
function updatePhotoCamera(dt) {
  const f = new THREE.Vector3(Math.sin(photo.yaw), 0, Math.cos(photo.yaw)), r = new THREE.Vector3(-f.z, 0, f.x);
  const v = PHOTO.speed * dt;
  if (keys.has('KeyW') || keys.has('ArrowUp')) photo.pos.addScaledVector(f, v);
  if (keys.has('KeyS') || keys.has('ArrowDown')) photo.pos.addScaledVector(f, -v);
  if (keys.has('KeyA') || keys.has('ArrowLeft')) photo.pos.addScaledVector(r, -v);
  if (keys.has('KeyD') || keys.has('ArrowRight')) photo.pos.addScaledVector(r, v);
  if (keys.has('Space')) photo.pos.y += v;
  if (keys.has('ShiftLeft') || keys.has('ShiftRight')) photo.pos.y -= v;
  photo.pos.y = Math.max(photo.pos.y, heightAt(photo.pos.x, photo.pos.z) + PHOTO.minAbove);
  camera.position.copy(photo.pos);
  const cp = Math.cos(photo.pitch);
  camera.lookAt(photo.pos.x + Math.sin(photo.yaw) * cp, photo.pos.y + Math.sin(photo.pitch), photo.pos.z + Math.cos(photo.yaw) * cp);
}
// 지금 화면을 2D 캔버스로 (그린 직후에 읽어야 해서 한 번 더 그림)
function frameCanvas() {
  renderer.render(scene, camera);
  const c = document.createElement('canvas');
  c.width = renderer.domElement.width;
  c.height = renderer.domElement.height;
  c.getContext('2d').drawImage(renderer.domElement, 0, 0);
  return c;
}
function downloadCanvas(c, name) {
  const a = document.createElement('a');
  a.download = name;
  a.href = c.toDataURL('image/png');
  a.click();
}
const stamp = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
function takePhoto() {
  const c = frameCanvas();
  const g = c.getContext('2d'), s = c.height / 720;
  g.font = `700 ${14 * s}px sans-serif`;
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.textAlign = 'right';
  g.fillText('포크레이트 · 지도 데이터 © OpenStreetMap 기여자', c.width - 14 * s, c.height - 14 * s);
  downloadCanvas(c, `포크레이트-${stamp()}.png`);
  window.__lastPhoto = { w: c.width, h: c.height }; // 확인용
  hud.toast('📷 찰칵! 사진을 저장했어요', 1800);
}
document.getElementById('photo-shot').addEventListener('click', (e) => { e.currentTarget.blur(); takePhoto(); });
document.getElementById('photo-exit').addEventListener('click', (e) => { e.currentTarget.blur(); setPhoto(false); });

// 결과 화면 "이미지로 저장": 게임 화면 + 등급 + 시간 + 제목 (+ F면 지각 사유서)
function saveResultImage() {
  const r = hud.lastResult;
  if (!r) return;
  const c = frameCanvas();
  const g = c.getContext('2d'), s = c.height / 720, W = c.width, H = c.height;
  const ok = r.grade !== 'F';
  const fmt = (t) => `${Math.floor(Math.abs(t) / 60)}분 ${String(Math.floor(Math.abs(t) % 60)).padStart(2, '0')}초`;
  g.fillStyle = 'rgba(15,20,30,0.35)';
  g.fillRect(0, 0, W, H);
  // 오른쪽 카드
  const cw = 420 * s, ch = (r.excuse ? 470 : 340) * s, cx = W - cw - 40 * s, cy = (H - ch) / 2, mid = cx + cw / 2;
  g.fillStyle = 'rgba(255,253,246,0.96)';
  g.beginPath(); g.roundRect(cx, cy, cw, ch, 22 * s); g.fill();
  g.textAlign = 'center';
  g.fillStyle = '#2b3240';
  g.font = `900 ${34 * s}px sans-serif`; g.fillText('포크레이트', mid, cy + 56 * s);
  g.font = `700 ${16 * s}px sans-serif`; g.fillStyle = '#6b7280'; g.fillText('9시까지 공대 2호관으로!', mid, cy + 84 * s);
  g.font = `900 ${120 * s}px sans-serif`; g.fillStyle = ok ? '#2f8cff' : '#e8412c'; g.fillText(r.grade, mid, cy + 210 * s);
  g.font = `800 ${22 * s}px sans-serif`; g.fillStyle = '#2b3240';
  g.fillText(r.title || (ok ? '늦지 않았다!' : '지각…'), mid, cy + 250 * s);
  g.font = `600 ${17 * s}px sans-serif`;
  g.fillText(`미션 ${r.done}/${r.total} · 걸린 시간 ${fmt(r.elapsed)}${ok ? ` · 남은 ${fmt(r.remaining)}` : ''}`, mid, cy + 284 * s);
  if (r.daily) { g.fillStyle = '#2f8cff'; g.fillText(`오늘의 도전 ${r.daily}`, mid, cy + 312 * s); }
  if (r.excuse) { // 지각 사유서
    const ey = cy + 330 * s;
    g.fillStyle = '#fffdf3'; g.strokeStyle = '#b49a6a'; g.setLineDash([6 * s, 4 * s]); g.lineWidth = 1.5 * s;
    g.beginPath(); g.roundRect(cx + 24 * s, ey, cw - 48 * s, 120 * s, 8 * s); g.fill(); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#8a5a35'; g.font = `900 ${15 * s}px sans-serif`; g.fillText('지각 사유서', mid, ey + 26 * s);
    g.fillStyle = '#2b3240'; g.font = `700 ${15 * s}px sans-serif`;
    wrapText(g, r.excuse, mid, ey + 52 * s, cw - 80 * s, 21 * s);
  }
  g.textAlign = 'left'; g.font = `700 ${13 * s}px sans-serif`; g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillText('지도 데이터 © OpenStreetMap 기여자', 14 * s, H - 14 * s);
  downloadCanvas(c, `포크레이트-${r.grade}-${stamp()}.png`);
  window.__lastResultImage = { w: W, h: H, grade: r.grade }; // 확인용
  hud.toast('결과 이미지를 저장했어요', 1800);
}
function wrapText(g, text, x, y, maxW, lh) {
  let line = '';
  for (const ch of text) {
    if (g.measureText(line + ch).width > maxW && line) { g.fillText(line, x, y); y += lh; line = ch.trim() ? ch : ''; }
    else line += ch;
  }
  if (line) g.fillText(line, x, y);
}
document.getElementById('res-save').addEventListener('click', (e) => { e.currentTarget.blur(); saveResultImage(); });

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
  const [campus, lawns, widths, styles, monuments, , farTerrain, roadMarks] = await Promise.all([
    count(loadCampus('data/campus.json?v=9')), count(loadCampus('data/lawns.json?v=1')), count(loadCampus('data/road-widths.json?v=1')),
    count(loadCampus('data/building-styles.json?v=9')), count(loadCampus('data/monuments.json?v=4')),
    count(loadTerrain('data/terrain.json?v=4')), count(loadCampus('data/far-terrain.json?v=1')), count(loadCampus('data/road-marks.json?v=1')),
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
  const waterGreens = campus.greens.filter((g) => g.kind === 'water');
  flattenWater(waterGreens.map((g) => g.outline)).forEach((lv, i) => { waterGreens[i].level = lv; }); // 용지 수면을 평평하게
  world = buildMap(scene, campus, {
    anisotropy: renderer.capabilities.getMaxAnisotropy(), // 비스듬히 보이는 바닥 그림이 번지지 않게 장치 최대값
    groundPx: GROUND_PX[quality],
    terrainFar: 1, // 지형 격자 바깥은 먼 지형(바깥 풍경)이 채운다
    // 차도 메시 간격: 5m (지형이 급히 꺾이는 곳 2.5m, 둥근 이음 3m). 차도 위 땅은 scripts/smooth_road_terrain.py로 미리 부드럽게
  });
  world.campus = campus;
  world.far = buildFarTerrain(scene, farTerrain); // 먼 산 능선 (300m 격자, 충돌 없음). 둘레 건물은 넣지 않음
  world.roadMarks = buildRoadMarks(campus, roadMarks); // 횡단보도·정지선·화살표·과속방지턱을 흰색·노란색 두 메시로 (scripts/build_road_marks.py)
  world.group.add(...world.roadMarks.meshes);
  world.shuttle = buildShuttles(scene, campus); // 순환로 셔틀버스 1~2대 (주차 차량·걷는 학생은 넣지 않음)
  // 지붕만 있는 차양은 지나갈 수 있게 충돌에서 뺀다
  collider = new Collider({ ...campus, buildings: campus.buildings.filter((b) => !b.style?.canopy) });
  car.surface = buildSurface(campus); // 잔디·흙·운동장 위는 느리게 (부스터 중엔 그대로)
  records = new Records(hud); // 칭호 (이 브라우저에만 저장)
  const onEvent = (name, v) => records.event(name, v);
  play = buildPlay(scene, campus, collider, hud, onEvent); // 축구·타임어택·드리프트 (자유 모드)
  // 용지 물가: 굴착기만 막음 (걷는 황소는 빠질 수 있음)
  const waterSeen = new Set();
  for (const g of campus.greens) {
    if (g.kind !== 'water') continue;
    const k = g.outline.slice(0, 3).join();
    if (waterSeen.has(k)) continue;
    waterSeen.add(k);
    collider.addObstacle(g.outline, null, { minRadius: 1 });
  }
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
  // 기록과 도전: 고스트(최고 기록), 무작위 사건, 칭호, 첫 A+ 엔딩
  ghost = new Ghost(scene, car);
  events = new RunEvents(scene, campus, collider);
  ending = new Ending(rig, camera, campus, lateMode.stage);
  lateMode.onRunStart = () => {
    ghost.start(lateMode.targets.map((t) => t.id).join(','));
    const ev = settings.events ? events.pick(lateMode.graph, { x: campus.spawn.position[0], z: campus.spawn.position[1] }, lateMode.targets) : (events.clear(lateMode.graph), null);
    pendingEvent = ev;
  };
  lateMode.onRunEnd = () => { events.clear(lateMode.graph); ghost.stop(); pendingEvent = null; };
  lateMode.onResult = (grade, info) => {
    music.result(grade); // 등급별 짧은 결과 음악
    ghost.finish(grade === 'A+' && info.isNew && !info.daily);
    const { fresh } = records.run({ grade, ...info });
    // 첫 A+: 결과가 뜨고 조금 뒤 엔딩 (한 번만, 칭호 화면에서 다시 보기)
    if (grade === 'A+' && !records.endingSeen) {
      setTimeout(() => {
        if (lateMode.state !== 'result' || ending.active) return; // 그사이 다시하기·나가기를 눌렀으면 다음 A+ 때
        records.endingSeen = true;
        records.save();
        ending.start();
      }, 2500);
    }
    return { title: records.title, newTitles: fresh };
  };
  hud.bindTitles(records, () => {
    if (!records.endingSeen) return;
    document.getElementById('titles').classList.add('hidden');
    ending.start();
  });

  lateMode.onMissionDone = () => { drive.relievedT = DRIVE_FACE.relieved; car.driver.waveHoof(); }; // 휴~ + 창밖으로 발굽 흔들기
  life = buildCampusLife(scene, { campus, collider, hud, lateMode, walker, car, speak,
    sounds: { meow: playMeow, splash: playSplash, stamp: playStamp }, onEvent });
  walker.onSplash = (x, z) => life.splashAt(x, z); // 풍덩: 물보라·소리, 오리가 흩어짐
  hud.initMinimap(campus);
  setupTitle();

  setQuality(quality);
  applyLight();
  updateTitleCamera(0);
  rig.update(0, car);
  loadingUi.set(1, '다 됐어요!');
  loadingUi.done();
  window.game = { car, rig, collider, campus, renderer, world, lateMode, walker, play, life, records, ghost, ending, events }; // 콘솔에서 확인용
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
// ---------- 운전 중 표정·몸짓 ----------
// 우선순위: 결과(만세·울먹) > 쾅(어질) > 미션 완료(휴~) > 부스터(깜짝) > 마지막 30초(울먹) > 지각 모드(긴장) > 웃음
const DRIVE_FACE = {
  crash: 1.6, crashHit: 0.25, boost: 1.0, relieved: 2.4, tearful: 30,
  idlePeek: 6,          // 자유 주행에서 이만큼 서 있으면 창밖으로 고개를 내밀어 둘러봄
  glance: [6, 11],      // 지각 모드에서 가끔 뒤를 힐끔 (간격, 초)
  wind: [25, 60],       // 고개를 내밀었을 때 볼이 눌리기 시작하는 속도 ~ 가장 눌리는 속도 (km/h)
};
const drive = { crashT: 0, boostT: 0, relievedT: 0, idleT: 0, glanceT: 8, manualPeek: false };
function driverExpression() {
  const L = lateMode;
  if (L.active && (L.state === 'outro' || L.state === 'result')) {
    return L.grade === 'A+' ? 'hooray' : L.grade === 'F' ? 'cry' : 'smile';
  }
  if (drive.crashT > 0) return 'dizzy';
  if (drive.relievedT > 0) return 'relieved';
  if (drive.boostT > 0) return 'surprised';
  if (!L.active) return 'smile';
  if ((L.state === 'playing' || L.state === 'mission') && TIME_LIMIT - (L.elapsed || 0) <= DRIVE_FACE.tearful) return 'cry';
  return 'nervous';
}
// 고개 내밀기(G·서 있을 때·미션 완료), 뒤돌아보기, 바람에 눌린 볼
function updateDriverGesture(dt, walking) {
  for (const k of ['crashT', 'boostT', 'relievedT']) drive[k] = Math.max(0, drive[k] - dt);
  const D = car.driver, L = lateMode;
  if (walking) { drive.idleT = 0; return; }
  const still = Math.abs(car.forwardSpeed) < 0.5 && !L.active && !onTitle;
  drive.idleT = still ? drive.idleT + dt : 0;
  D.setPeek(drive.manualPeek || drive.relievedT > 0 || drive.idleT > DRIVE_FACE.idlePeek);
  if (L.active && L.state === 'playing' && (drive.glanceT -= dt) <= 0) {
    drive.glanceT = DRIVE_FACE.glance[0] + Math.random() * (DRIVE_FACE.glance[1] - DRIVE_FACE.glance[0]);
    if (drive.relievedT === 0) D.glanceBack();
  }
  const [w0, w1] = DRIVE_FACE.wind;
  D.setWind(Math.max(0, Math.min(1, (car.speedKmh - w0) / (w1 - w0))));
}

// ---------- 루프 ----------

const clock = new THREE.Clock();
const headTmp = new THREE.Vector3();
let nameTimer = 0;
let fpsFrames = 0, fpsTime = 0;

function loop() {
  const dt = Math.min(clock.getDelta(), 0.1);
  checkAutoQuality();
  const input = onTitle || photo.on || lateMode.inputLocked ? NO_INPUT : readInput();
  if (onTitle) updateTitleCamera(clock.elapsedTime);

  const walking = walker.active; // 학생이 내려서 걷는 중 (굴착기는 시동만 걸린 채 서 있음)

  // 프레임이 길면 잘게 나눠서 벽을 뚫지 않게. 일시정지·결과 화면에서는 멈춤
  if (!lateMode.frozen) {
    const pdt = dt * lateMode.timeScale; // 도착 순간 슬로모션
    const steps = Math.ceil(pdt / (1 / 60));
    for (let i = 0; i < steps; i++) {
      car.update(pdt / steps, walking ? NO_INPUT : input, collider);
      if (walking) walker.update(pdt / steps, input, cameraGroundDir());
    }
  }
  if (!walking) walker.update(dt); // 타고 나서 문 닫기
  lateMode.update(dt);
  updateDriverGesture(dt, walking);
  car.driver.setExpression(walking ? walker.face() : driverExpression());
  hud.setFace(car.driver.expression, settings.faceWindow && !settings.light && !onTitle);
  if (lateMode.frozen) car.driver.update(dt, 0); // 결과 화면 등 굴착기가 멈춘 동안에도 표정·만세 움직임
  const focus = walking ? walker.pos : car.pos; // 화면·소리·미니맵의 중심
  const focusY = walking ? walker.y : car.object.position.y;
  world.landscape.update(dt, focus.x, focus.y); // 주차 차단기
  // 셔틀버스: 굴착기·걷는 황소가 다가오면 멈춤. 연출 중에는 교수님·굴착기 둘레에서 숨김
  const cineHide = lateMode.active && lateMode.inputLocked && lateMode.state !== 'mission' && lateMode.state !== 'paused';
  world.shuttle.update(lateMode.frozen ? 0 : dt, car, walking ? walker : null,
    cineHide ? [[lateMode.stage.to.x, lateMode.stage.to.z], [car.pos.x, car.pos.y]] : []);

  if (photo.on) updatePhotoCamera(dt);
  else if (walking) rig.updateWalk(dt, walker, { autoBehind: settings.walkCamAuto, dragging });
  else rig.update(dt, car);
  play.update(lateMode.frozen ? 0 : dt, car, walking ? walker : null, !onTitle && !lateMode.active && !photo.on);
  life.update(lateMode.frozen ? 0 : dt, camera, focus, !lateMode.active);
  // 기록과 도전: 부스터 시간, 고스트, 엔딩
  if (car.boosting && !walking) records.boost(dt);
  const racing = lateMode.active && ['playing', 'mission', 'arrive'].includes(lateMode.state);
  ghost.update(lateMode.frozen ? 0 : dt, lateMode.elapsed || 0, racing, settings.ghost && !settings.light);
  ending.update(dt);
  if (pendingEvent && lateMode.state === 'playing') { // 출발하자마자 오늘의 사건 알림
    const E = pendingEvent;
    pendingEvent = null;
    hud.toast(E.kind === 'bus' ? `🚌 ${E.near ? `${E.near} 근처에서 ` : ''}셔틀버스가 고장 나 길을 막았어요! 미니맵 길을 따라 돌아가요`
      : `🚧 ${E.near ? `${E.near} 근처 ` : ''}공사 중! 미니맵 길을 따라 돌아가요`, 4200);
  }
  hud.updateNpc(camera);
  sky.position.copy(camera.position);
  sun.target.position.set(focus.x, focusY, focus.y);
  sun.position.copy(sun.target.position).add(SUN_OFFSET);

  engine.update(dt, {
    speed: walking ? 0 : Math.abs(car.forwardSpeed), throttle: !walking && car.throttle, boostFx: car.boostFx,
    active: !onTitle && !lateMode.frozen, quiet: walking,
  });

  setWalkingUi(walking);
  updateMusicAndClock(dt);
  hud.updatePhone();
  hud.setWalkHint(walking ? (walker.walking && walker.nearCar() ? 'near' : 'far') : null);
  hud.setSpeed(walking ? walker.speed * 3.6 : car.speedKmh);
  if (!onTitle) {
    const target = lateMode.active && lateMode.target ? lateMode.target : null;
    hud.drawMinimap(focus, walking ? walker.heading : car.heading, target, walking ? car.pos : null,
      lateMode.active && (lateMode.state === 'playing' || lateMode.state === 'mission') ? lateMode.route : play.route());
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
