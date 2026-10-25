// 시작(첫 화면), 화면 구성, 입력, 소리, 게임 루프.
import * as THREE from 'three';
import { loadCampus, buildMap } from './map.js';
import { Car, Collider } from './car.js';
import { CameraRig } from './camera.js';
import { Hud } from './hud.js';
import { unlockAudio, playBoost, playBoostEnd, playHit, EngineSound, isMuted, setMuted } from './voice.js';
import { LateMode } from './late-mode.js';

const SKY_TOP = new THREE.Color('#6fb4f0');
const SKY_HORIZON = new THREE.Color('#e4f3ff');
const SHOW_FPS = new URLSearchParams(location.search).has('fps');
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

const hud = new Hud({ onQuality: setQuality, onSound: toggleSound });
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

async function start() {
  const campus = await loadCampus('data/campus.json?v=2');
  world = buildMap(scene, campus, { anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()) });
  collider = new Collider(campus);
  for (const o of world.gateObstacles) collider.addObstacle(o);
  for (const [osmName, label] of LANDMARKS) {
    const b = campus.buildings.find((x) => x.name === osmName);
    if (b) hud.addLabel(label || osmName, b.center[0], b.height + 5, b.center[1]);
    else console.warn('이름표 건물을 찾지 못함:', osmName);
  }

  const { position, dir } = campus.spawn;
  car.place(position[0], position[1], dir[0], dir[1]);
  lateMode = new LateMode({ scene, car, hud, campus, camera, rig, trees: world.trees });
  hud.initMinimap(campus);
  setupTitle();

  setQuality(quality);
  updateTitleCamera(0);
  rig.update(0, car);
  document.getElementById('loading').remove();
  window.game = { car, rig, collider, campus, renderer, world, lateMode }; // 콘솔에서 확인용
  renderer.setAnimationLoop(loop);
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

  rig.update(dt, car);
  sky.position.copy(camera.position);
  sun.target.position.set(car.pos.x, 0, car.pos.y);
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
