// 지각 모드 흐름:
// 연출(공대 2호관 입구로 날아감 → 교수님 등장·대사 → 천천히 위로 올라가 캠퍼스 전체 → 미션 장소 5곳이 차례로 떠오름
//      → 정문 굴착기로 천천히 내려옴 → 굴착기 앞·옆·뒤) → 3, 2, 1, GO
// → 미션들 → 공과대 2호관 도착 → 교수님 판정(A+ / F) → 결과.
// 시간이 0이 되면 그 자리에서 "시간 초과!"(약 1초) → 바로 교수님 F 연출 → 결과.
import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { MISSIONS, EXCUSES } from './missions-data.js';
import { DIALOGUE, SPEAKER, PHONE_LINES } from './dialogue-data.js';
import { RoadGraph } from './route.js';
import { Professor, SpeechBubble } from './professor.js';
import { PROFESSOR } from './professor-config.js';
import { playDing, playBeep, playMissionRise, playCharge, playWarn, speak } from './voice.js';

// 제한 시간(초). 참고: 차도 최단 경로는 3,861m라 부스터와 지름길이 필요하다
export const TIME_LIMIT = 180;

const MISSION_SECONDS = 2;  // E를 누른 뒤 진행 막대 시간
const STOP_KMH = 3;         // 이보다 느리면 멈춘 것으로 본다
const BOOST_REWARD = 0.5;   // 미션 완료 시 부스터 게이지 보충량
const GO_SHOW = 0.8;        // "GO!" 글자가 떠 있는 시간
const TIMEUP_SHOW = 1.0;    // "시간 초과!" 글자를 보여 주는 시간 (그동안 굴착기는 부드럽게 멈춤)
const WARN_FROM = 10;       // 남은 시간이 이 초 이하이면 1초마다 경고음
// 시간 안에 도착했을 때 남은 시간(초)별 등급. 시간 초과는 F
const GRADES = [[60, 'A+'], [45, 'A'], [30, 'B+'], [15, 'B'], [0, 'C']];
const BEST_KEY = 'jnu-late-race-best'; // 최고 기록 (브라우저에만 저장)
const DAILY_KEY = 'jnu-late-race-daily-'; // + 날짜(YYYYMMDD): 오늘의 도전 기록은 따로
const ARRIVE_SLOWMO = { seconds: 0.5, scale: 0.3 }; // 공대 2호관 도착 순간 슬로모션 (실제 0.5초, 물리 0.3배)
const ROUTE_EVERY = 0.5; // 미니맵 길 안내를 다시 찾는 간격 (초)

// 연출 길이(초). 대사 3줄(약 7초)과 카운트다운 3초를 더해 전체 25초 안쪽.
// 멀미 방지: 모든 이동은 ease-in-out, 카메라는 기울지 않고(수평선 유지) 시야각(FOV)도 그대로, 빠른 회전 없음
const CINE = {
  fly: 1.6,        // 공대 2호관 입구로 날아감
  walk: 1.8,       // 교수님이 걸어 나옴
  lineHold: 0.7,   // 대사 한 줄이 다 나온 뒤 기다림 (클릭·Space로 바로 넘김)
  rise: 3.6,       // 위로 올라가며 캠퍼스 전체를 내려다봄
  pinLead: 1.0,    // 올라가기가 끝나기 이만큼 전부터 미션 장소를 띄움
  pinGap: 0.45,    // 미션 장소 하나씩 떠오르는 간격
  pinHold: 0.9,    // 마지막 장소가 뜬 뒤 기다림
  descend: 3.0,    // 정문 굴착기로 천천히 내려옴
  orbit: 3.0,      // 앞 → 옆 → 뒤
  outroFly: 1.4,   // 도착 후 교수님에게 날아감
  outroHold: 1.6,  // 판정 대사 뒤 결과 창까지
};

export class LateMode {
  constructor({ scene, car, hud, campus, camera, rig, trees }) {
    Object.assign(this, { car, hud, campus, camera, rig });
    this.state = 'off'; // off | intro | countdown | playing | mission | timeup | paused | outro | result
    this.baseTargets = MISSIONS.map((m) => {
      const b = campus.buildings.find((x) => x.name === m.building);
      if (!b) console.warn('미션 건물을 찾지 못함:', m.building);
      const [x, z] = nearestCarRoad(campus, b ? b.center : [0, 0]);
      return { ...m, x, z };
    });
    this.targets = this.baseTargets;
    this.daily = false;
    this.graph = new RoadGraph(campus); // 길 안내 (차도 그래프)
    this.route = null;
    this.routeT = 0;
    this.calls = [];
    this.onResult = null; // 결과가 나올 때 (main: 결과 음악)
    this.marker = buildMarker();
    scene.add(this.marker.group);

    // 교수님 캐릭터는 만드는 데 0.5초쯤 걸려 첫 로딩에서 빼고, 첫 화면이 뜬 뒤(또는 지각 모드 시작 때) 만든다
    this.scene = scene;
    this.professor = null;
    this.bubble = new SpeechBubble(SPEAKER);
    this.stage = this.makeStage();
    // 교수님과 연출 카메라 사이의 나무를 치운다
    const S = this.stage;
    for (let k = 0; k <= 1; k += 0.25) {
      trees?.clearAround(S.from.x + (S.camPos.x - S.from.x) * k, S.from.z + (S.camPos.z - S.from.z) * k, 5);
    }

    hud.bindLate({
      start: () => this.start(),
      resume: () => this.resume(),
      retry: () => this.start({ daily: this.daily }),
      exit: () => this.exit(),
    });
  }

  // 교수님이 등장하는 자리: 마지막 목적지 건물(공과대 2호관) 입구 앞
  makeStage() {
    const fin = this.targets[this.targets.length - 1];
    const b = this.campus.buildings.find((x) => x.name === fin.building);
    let e = b && b.entrance;
    if (!e) { // 입구 정보가 없으면 건물 중심에서 목적지 쪽
      const [cx, cz] = b ? b.center : [fin.x, fin.z];
      const dx = fin.x - cx, dz = fin.z - cz, L = Math.hypot(dx, dz) || 1;
      e = { x: cx, z: cz, nx: dx / L, nz: dz / L };
    }
    const walk = PROFESSOR.walk.speed * PROFESSOR.scale * CINE.walk;
    const from = new THREE.Vector3(e.x + e.nx * 0.6, 0, e.z + e.nz * 0.6);
    const to = new THREE.Vector3(e.x + e.nx * (0.6 + walk), 0, e.z + e.nz * (0.6 + walk));
    from.y = heightAt(from.x, from.z);
    to.y = heightAt(to.x, to.z);
    const side = new THREE.Vector3(-e.nz, 0, e.nx);
    const camPos = to.clone().addScaledVector(new THREE.Vector3(e.nx, 0, e.nz), 6.5).addScaledVector(side, 1.4);
    camPos.y = Math.max(to.y, heightAt(camPos.x, camPos.z)) + 2.4;
    return { from, to, n: new THREE.Vector3(e.nx, 0, e.nz), camPos, lookY: to.y + 1.5 * PROFESSOR.scale };
  }

  ensureProfessor() {
    if (this.professor) return;
    this.professor = new Professor();
    this.professor.object.visible = false;
    this.scene.add(this.professor.object);
  }

  get active() { return this.state !== 'off'; }
  // 차 입력을 막는 상태
  get inputLocked() { return !['off', 'playing'].includes(this.state); }
  // 물리 시간 배율 (도착 순간 슬로모션)
  get timeScale() { return this.state === 'arrive' ? ARRIVE_SLOWMO.scale : 1; }
  // 게임 시각 (초, 자정부터): 8:57:00 → 9:00:00 (제한 시간을 3분에 맞춰 늘이고 줄임)
  get clockSeconds() { return 9 * 3600 - (TIME_LIMIT - Math.min(this.elapsed || 0, TIME_LIMIT)) * (180 / TIME_LIMIT); }
  // 차 물리까지 멈추는 상태
  get frozen() { return ['paused', 'outro', 'result'].includes(this.state); }

  // daily: 오늘의 도전 (날짜로 정한 미션 순서, 같은 날엔 모두 같은 순서, 기록 따로)
  start({ daily = false } = {}) {
    this.onBeforeStart?.(); // 학생이 내려서 걷는 중이면 먼저 운전석으로 (main.js)
    this.daily = daily;
    this.targets = daily ? dailyOrder(this.baseTargets) : this.baseTargets;
    this.route = null;
    this.routeT = 0;
    // 교수님 전화 1~2번: 이른 때 한 번(25~45초), 남은 시간 약 1분에 한 번(반반 확률)
    const pick = (l) => l[Math.floor(Math.random() * l.length)];
    this.calls = [{ at: 25 + Math.random() * 20, line: pick(PHONE_LINES.early) }];
    if (Math.random() < 0.5) this.calls.push({ at: TIME_LIMIT - 62 + Math.random() * 6, line: pick(PHONE_LINES.late) });
    const { position, dir } = this.campus.spawn;
    this.car.place(position[0], position[1], dir[0], dir[1]);
    this.index = 0;
    this.elapsed = 0;
    this.goTimer = 0;
    this.timedOut = false;
    this.lastWarn = null;
    this.hud.setLateMode(true);
    this.hud.setCinematic(true);
    this.hud.showPause(false);
    this.hud.showResult(null);
    this.hud.showProgress(null);
    this.hud.showCountdown(null);
    this.hud.updateTarget(this.camera, null);
    this.hud.setTimer(TIME_LIMIT, TIME_LIMIT);
    this.hud.setMissions(this.targets, 0, this.daily ? `오늘의 도전 ${todayLabel()}` : null);
    this.showTarget();

    const S = this.stage;
    this.ensureProfessor();
    this.professor.object.visible = true;
    this.professor.place(S.from.x, S.from.z, S.n.x, S.n.z);
    this.professor.pose = 'rest';
    this.professor.walking = false;
    this.bubble.hide();

    this.state = 'intro';
    this.phase = 'fly';
    this.phaseT = 0;
    this.flyFrom = { pos: this.camera.position.clone(), look: this.lookPoint() };
    this.cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 55 };
    this.rig.setCinematic(this.cam);
  }

  exit() {
    this.hud.clearPins();
    this.state = 'off';
    this.marker.group.visible = false;
    if (this.professor) this.professor.object.visible = false;
    this.bubble.hide();
    this.rig.setCinematic(null);
    this.hud.setCinematic(false);
    this.hud.setLateMode(false);
    this.hud.updateTarget(this.camera, null);
  }

  pause() {
    this.resumeState = this.state;
    this.state = 'paused';
    this.hud.showPause(true);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this.resumeState;
    this.hud.showPause(false);
  }

  onKey(code) {
    if (code === 'KeyL' && !this.active) this.start();
    else if (code === 'Escape' && this.active) {
      if (this.state === 'intro' || this.state === 'countdown') this.skipIntro();
      else if (this.state === 'paused') this.resume();
      else if (this.state === 'playing' || this.state === 'mission') this.pause();
    } else if (code === 'Space') this.advance();
    else if (code === 'KeyE' && this.state === 'playing') this.tryMission();
  }

  // 클릭·Space: 대사 넘기기
  advance() {
    const talking = (this.state === 'intro' && this.phase === 'talk') || (this.state === 'outro' && this.phase === 'talk');
    if (!talking) return;
    if (!this.bubble.skipTyping()) this.phaseT = 1e9; // 이미 다 나왔으면 바로 다음
  }

  // Esc: 연출을 통째로 건너뛰고 바로 출발
  skipIntro() {
    this.bubble.hide();
    const S = this.stage;
    this.professor.place(S.to.x, S.to.z, S.n.x, S.n.z);
    this.professor.walking = this.professor.talking = false;
    this.go();
  }

  go() {
    this.hud.clearPins();
    this.state = 'playing';
    this.rig.setCinematic(null);
    this.rig.snap = true;
    this.hud.setCinematic(false);
    this.goTimer = GO_SHOW;
    playBeep(true);
    this.hud.showCountdown('GO!');
  }

  get target() { return this.targets[this.index]; }

  distToTarget() {
    return Math.hypot(this.car.pos.x - this.target.x, this.car.pos.y - this.target.z);
  }

  tryMission() {
    const t = this.target;
    if (t.final || this.distToTarget() > t.radius || this.car.speedKmh > STOP_KMH) return;
    this.state = 'mission';
    this.progress = 0;
    this.hud.setHint(null);
    playMissionRise(MISSION_SECONDS); // 진행 막대 동안 "뚜루루루↗"
  }

  update(dt) {
    if (this.state === 'off') return;
    const time = performance.now() / 1000;
    this.marker.animate(time);
    this.professor.update(dt);
    this.bubble.update(dt);
    this.professor.gesture = this.bubble.gesture;
    if (this.bubble.active) {
      this.professor.talking = !this.bubble.done;
      tmp.copy(this.professor.headTop()).project(this.camera);
      this.bubble.place((tmp.x + 1) / 2 * innerWidth, (1 - tmp.y) / 2 * innerHeight);
    }

    this.hud.updatePins(this.camera);
    if (this.state === 'intro') this.updateIntro(dt);
    else if (this.state === 'countdown') this.updateCountdown(dt);
    else if (this.state === 'outro') this.updateOutro(dt);
    else if (this.goTimer > 0 && !this.frozen) {
      this.goTimer -= dt;
      if (this.goTimer <= 0) this.hud.showCountdown(null);
    }

    if (this.state === 'timeup') return this.updateTimeUp(dt);
    if (this.state === 'arrive') { // 도착 순간 슬로모션 뒤 판정
      this.arriveT += dt;
      if (this.arriveT >= ARRIVE_SLOWMO.seconds) this.finish();
      return;
    }
    if (this.state === 'playing' || this.state === 'mission') {
      this.elapsed += dt;
      const left = TIME_LIMIT - this.elapsed;
      this.hud.setTimer(left, TIME_LIMIT);
      // 교수님 전화
      while (this.calls.length && this.elapsed >= this.calls[0].at) {
        const { line } = this.calls.shift();
        this.hud.phone(line, speak(line));
      }
      // 길 안내: 다음 미션까지 도로를 따라가는 경로 (0.5초마다)
      if ((this.routeT -= dt) <= 0) {
        this.routeT = ROUTE_EVERY;
        this.route = this.graph.path(this.car.pos.x, this.car.pos.y, this.target.x, this.target.z);
      }
      if (left <= 0) return this.timeUp();
      const sec = Math.ceil(left);
      if (sec <= WARN_FROM && sec !== this.lastWarn) { this.lastWarn = sec; playWarn(); } // 마지막 10초: 1초마다 경고음
      const dist = this.distToTarget();
      const t = this.target;
      if (this.state === 'playing') {
        const inside = dist <= t.radius;
        if (t.final && inside) return this.arrive();
        if (inside && !t.final) this.hud.setHint(this.car.speedKmh > STOP_KMH ? '멈추세요!' : 'E 키를 눌러 미션');
        else this.hud.setHint(null);
      } else {
        this.progress += dt / MISSION_SECONDS;
        this.hud.showProgress(t, this.progress);
        if (this.progress >= 1) this.completeMission();
      }
      this.hud.updateTarget(this.camera, tmp.set(t.x, heightAt(t.x, t.z) + 6.5, t.z), dist);
    }
  }

  // ---------- 시작 연출 ----------

  updateIntro(dt) {
    this.phaseT += dt;
    const S = this.stage, P = this.professor, cam = this.cam;
    const owlLook = (v) => v.set(P.object.position.x, S.lookY, P.object.position.z);

    if (this.phase === 'fly') {
      const k = ease(this.phaseT / CINE.fly);
      flyBetween(cam, this.flyFrom, { pos: S.camPos, look: owlLook(tmp2) }, k, 12);
      if (this.phaseT >= CINE.fly) this.next('walk');
    } else if (this.phase === 'walk') {
      const k = Math.min(1, this.phaseT / CINE.walk);
      P.walking = k < 1;
      P.object.position.lerpVectors(S.from, S.to, k);
      cam.pos.copy(S.camPos);
      cam.look.lerp(owlLook(tmp2), Math.min(1, dt * 6));
      if (k >= 1) {
        P.face(S.camPos.x - S.to.x, S.camPos.z - S.to.z); // 카메라를 본다
        this.line = 0;
        this.sayIntroLine();
        this.next('talk');
      }
    } else if (this.phase === 'talk') {
      cam.look.lerp(owlLook(tmp2), Math.min(1, dt * 6));
      if (!this.bubble.done) this.phaseT = 0; // 다 나온 뒤부터 기다림 시간을 잰다
      if (this.phaseT >= CINE.lineHold) {
        this.line++;
        if (this.line < DIALOGUE.intro.length) { this.sayIntroLine(); this.phaseT = 0; } else {
          this.bubble.hide();
          P.talking = false;
          this.flyFrom = { pos: cam.pos.clone(), look: cam.look.clone() };
          this.hud.setPins(this.targets.map((t) => ({
            emoji: t.emoji, label: t.label, pos: new THREE.Vector3(t.x, heightAt(t.x, t.z) + 4, t.z),
          })));
          this.pinShown = 0;
          this.next('rise');
        }
      }
    } else if (this.phase === 'rise' || this.phase === 'overview') {
      // 높이를 먼저 올리고(수평 이동은 천천히 따라옴) → 근처 건물을 뚫고 지나가지 않게
      const k = Math.min(1, this.phaseT / CINE.rise);
      const over = this.overviewPose(tmpPose);
      cam.pos.x = THREE.MathUtils.lerp(this.flyFrom.pos.x, over.pos.x, ease(k * k));
      cam.pos.z = THREE.MathUtils.lerp(this.flyFrom.pos.z, over.pos.z, ease(k * k));
      cam.pos.y = THREE.MathUtils.lerp(this.flyFrom.pos.y, over.pos.y, ease(k));
      aimBetween(cam, this.flyFrom, over, ease(k));
      // 미션 장소가 하나씩 떠오름 (마지막은 공과대 2호관 🏫)
      const t = this.phaseT - (CINE.rise - CINE.pinLead);
      while (t >= this.pinShown * CINE.pinGap && this.pinShown < this.targets.length) this.hud.showPin(this.pinShown++);
      if (k >= 1) this.phase = 'overview';
      const done = CINE.rise - CINE.pinLead + (this.targets.length - 1) * CINE.pinGap + CINE.pinHold;
      if (this.phaseT >= Math.max(CINE.rise, done)) {
        this.flyFrom = { pos: cam.pos.clone(), look: cam.look.clone() };
        this.hud.clearPins();
        this.next('descend');
      }
    } else if (this.phase === 'descend') {
      // 수평 이동을 먼저 끝내고 마지막엔 위에서 내려앉듯 (낮은 높이로 비스듬히 지나가지 않게)
      const k = Math.min(1, this.phaseT / CINE.descend);
      const to = this.orbitPose(0, tmpPose);
      const kxz = ease(Math.min(1, k * 1.25));
      cam.pos.x = THREE.MathUtils.lerp(this.flyFrom.pos.x, to.pos.x, kxz);
      cam.pos.z = THREE.MathUtils.lerp(this.flyFrom.pos.z, to.pos.z, kxz);
      cam.pos.y = THREE.MathUtils.lerp(this.flyFrom.pos.y, to.pos.y, ease(k));
      aimBetween(cam, this.flyFrom, to, ease(k));
      if (k >= 1) this.next('orbit');
    } else if (this.phase === 'orbit') {
      const k = Math.min(1, this.phaseT / CINE.orbit);
      const pose = this.orbitPose(ease(k), tmpPose);
      cam.pos.copy(pose.pos);
      cam.look.copy(pose.look);
      if (k >= 1) {
        this.state = 'countdown';
        this.countdown = 3;
        this.lastCount = null;
      }
    }
  }

  next(phase) {
    this.phase = phase;
    this.phaseT = 0;
  }

  sayIntroLine() {
    this.bubble.say(DIALOGUE.intro[this.line]);
  }

  // 캠퍼스 전체를 내려다보는 자리: 미션 장소들의 가운데 남쪽 높은 곳에서 비스듬히 아래로
  overviewPose(out) {
    const xs = this.targets.map((t) => t.x), zs = this.targets.map((t) => t.z);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
    out.pos.set(cx, heightAt(cx, cz) + span * 1.0, cz + span * 0.42);
    out.look.set(cx, heightAt(cx, cz), cz - span * 0.02);
    return out;
  }

  // 굴착기 주위를 도는 카메라: k=0 앞면, 0.5 옆면, 1 뒷면(= 뒤 따라가기 시점과 같은 자리)
  orbitPose(k, out) {
    const c = this.car, f = c.forward();
    const a = k * Math.PI;
    const dx = f.x * Math.cos(a) + f.y * Math.sin(a);
    const dz = f.y * Math.cos(a) - f.x * Math.sin(a);
    const r = 6.5 + 2 * k;
    const gy = c.object.position.y; // 굴착기가 선 땅 높이
    out.pos.set(c.pos.x + dx * r, 0, c.pos.y + dz * r);
    out.pos.y = Math.max(gy + 2.0 + 2 * k, heightAt(out.pos.x, out.pos.z) + 1.5); // 언덕 속으로 들어가지 않게
    // 마지막엔 따라가기 카메라처럼 앞쪽을 보게
    const w = k * k;
    out.look.set(c.pos.x + f.x * 4 * w, gy + 1.3 + 0.3 * w, c.pos.y + f.y * 4 * w);
    return out;
  }

  updateCountdown(dt) {
    this.countdown -= dt;
    const n = Math.ceil(this.countdown);
    if (n !== this.lastCount && n > 0) { playBeep(); this.lastCount = n; }
    this.hud.showCountdown(String(n));
    if (this.countdown <= 0) this.go();
  }

  // ---------- 미션 ----------

  completeMission() {
    const t = this.target;
    playDing();
    playCharge(); // 부스터 게이지 충전 "슈웅↑"
    this.car.addBoost(BOOST_REWARD);
    this.hud.flashGauge();
    this.hud.toast(`${t.emoji} ${t.title} 완료! 부스터 +50%`, 2200);
    this.index++;
    this.hud.setMissions(this.targets, this.index);
    this.state = 'playing';
    this.showTarget();
    setTimeout(() => { if (this.state !== 'mission') this.hud.showProgress(null); }, 1200); // 대사를 잠깐 보여 주고 닫기
  }

  // 공대 2호관 도착: 0.5초 슬로모션 (시계는 멈춤) → 판정
  arrive() {
    this.state = 'arrive';
    this.arriveT = 0;
    this.route = null;
    this.hud.setHint(null);
    this.hud.showCountdown('도착!', 'arrive');
  }

  // ---------- 시간 초과 → 바로 실패 ----------

  timeUp() {
    this.elapsed = TIME_LIMIT;
    this.timedOut = true;
    this.state = 'timeup'; // 입력 막힘(굴착기는 멈춰 감), 미션 진행도 취소
    this.timeUpT = 0;
    this.hud.setTimer(0);
    this.hud.setHint(null);
    this.hud.showProgress(null);
    this.hud.updateTarget(this.camera, null);
    this.hud.showCountdown('시간 초과!', 'timeup');
    playBeep(true);
  }

  updateTimeUp(dt) {
    this.timeUpT += dt;
    this.car.vel.multiplyScalar(Math.exp(-dt * 3.5)); // 부드럽게 감속
    if (this.timeUpT >= TIMEUP_SHOW) this.finish();
  }

  // ---------- 도착 → 판정 ----------

  finish() {
    this.remaining = TIME_LIMIT - this.elapsed;
    this.success = !this.timedOut && this.remaining >= 0;
    this.grade = this.success ? GRADES.find(([sec]) => this.remaining >= sec)[1] : 'F';
    this.done = this.timedOut ? this.index : this.targets.length; // 완료한 미션 수 (마지막 도착 포함)
    this.state = 'outro';
    this.car.vel.set(0, 0);
    if (!this.timedOut) this.hud.setMissions(this.targets, this.targets.length); // 목록 전부 체크
    this.hud.setHint(null);
    this.hud.showCountdown(null);
    this.hud.updateTarget(this.camera, null);
    this.hud.setCinematic(true);

    const S = this.stage, P = this.professor;
    P.place(S.to.x, S.to.z, S.camPos.x - S.to.x, S.camPos.z - S.to.z);
    P.walking = false;
    P.pose = this.grade === 'A+' ? 'thumbsUp' : this.success ? 'rest' : 'stern'; // A+만 날개를 번쩍
    this.flyFrom = { pos: this.camera.position.clone(), look: this.lookPoint() };
    this.cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 55 };
    this.rig.setCinematic(this.cam);
    this.next('fly');
  }

  updateOutro(dt) {
    this.phaseT += dt;
    const S = this.stage, cam = this.cam;
    const look = tmp2.set(S.to.x, S.lookY, S.to.z);
    if (this.phase === 'fly') {
      flyBetween(cam, this.flyFrom, { pos: S.camPos, look }, ease(this.phaseT / CINE.outroFly), 10);
      if (this.phaseT >= CINE.outroFly) {
        const line = this.success ? DIALOGUE.grades[this.grade] : DIALOGUE.fail;
        this.bubble.say(line, { onBig: () => this.hud.shake() });
        this.next('talk');
      }
    } else if (this.phase === 'talk') {
      if (!this.bubble.done) this.phaseT = 0;
      if (this.phaseT >= CINE.outroHold) this.showResult();
    }
  }

  showResult() {
    this.state = 'result';
    this.professor.talking = false;
    if (this.success) playDing();
    this.onResult?.(this.grade);
    const { best, isNew } = this.saveBest();
    // 지각 사유서 (F): 멈춰 있던 미션과 엮은 사유(두 배로 자주) + 어디서나 쓰는 사유 중 하나
    let excuse = null;
    if (this.grade === 'F') {
      const here = this.targets[Math.min(this.index, this.targets.length - 1)];
      const pool = [...(EXCUSES[here.id] || []), ...(EXCUSES[here.id] || []), ...EXCUSES.any];
      excuse = pool[Math.floor(Math.random() * pool.length)];
    }
    this.excuse = excuse;
    this.hud.showResult({ grade: this.grade, elapsed: this.elapsed, remaining: this.remaining,
      done: this.done, total: this.targets.length, timedOut: this.timedOut, best, isNew, excuse,
      daily: this.daily ? todayLabel() : null });
  }

  // 최고 기록: 시간 안에 도착한 것 중 남은 시간이 가장 긴 기록. 저장이 막힌 브라우저에서도 게임은 그대로
  saveBest() {
    const key = this.daily ? DAILY_KEY + todayKey() : BEST_KEY;
    let best = null;
    try { best = JSON.parse(localStorage.getItem(key) || 'null'); } catch { best = null; }
    let isNew = false;
    if (this.success && (!best || this.remaining > best.remaining)) {
      best = { remaining: this.remaining, grade: this.grade };
      isNew = true;
      try { localStorage.setItem(key, JSON.stringify(best)); } catch { /* 저장 못 해도 계속 */ }
    }
    return { best, isNew };
  }

  // ---------- 도우미 ----------

  showTarget() {
    this.marker.place(this.target);
  }

  // 지금 카메라가 보고 있는 점 (연출 시작할 때 이어지게)
  lookPoint() {
    return this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(10).add(this.camera.position);
  }
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

// 오늘 날짜 (그 컴퓨터 시각 기준)
function todayKey(d = new Date()) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
function todayLabel(d = new Date()) { return `${d.getMonth() + 1}/${d.getDate()}`; }

// 오늘의 도전: 날짜를 씨앗으로 마지막(공대 2호관)을 뺀 미션 순서를 섞는다 (같은 날엔 누구나 같은 순서)
function dailyOrder(targets) {
  let seed = Number(todayKey()) >>> 0;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const list = targets.filter((t) => !t.final), fin = targets.filter((t) => t.final);
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return [...list, ...fin];
}
const tmpPose = { pos: new THREE.Vector3(), look: new THREE.Vector3() };

function ease(k) {
  k = Math.min(1, Math.max(0, k));
  return k * k * (3 - 2 * k);
}

// a → b로 날아가는 카메라. 중간에 arc만큼 위로 솟는다
function flyBetween(cam, a, b, k, arc) {
  cam.pos.lerpVectors(a.pos, b.pos, k);
  cam.pos.y += Math.sin(k * Math.PI) * arc;
  aimBetween(cam, a, b, k);
}

// 바라보는 방향을 각도(좌우 yaw, 위아래 pitch)로 a → b 사이를 잇는다.
// 바라보는 점을 직접 옮기면 가까운 점 ↔ 먼 점 사이에서 순간적으로 빨리 돌아가 멀미가 나서.
function aimBetween(cam, a, b, k) {
  const A = aimAngles(a), B = aimAngles(b);
  const dyaw = Math.atan2(Math.sin(B.yaw - A.yaw), Math.cos(B.yaw - A.yaw)); // 짧은 쪽으로
  const yaw = A.yaw + dyaw * k, pitch = A.pitch + (B.pitch - A.pitch) * k;
  cam.look.set(
    cam.pos.x + Math.sin(yaw) * Math.cos(pitch) * 10,
    cam.pos.y + Math.sin(pitch) * 10,
    cam.pos.z + Math.cos(yaw) * Math.cos(pitch) * 10,
  );
}

function aimAngles({ pos, look }) {
  const dx = look.x - pos.x, dy = look.y - pos.y, dz = look.z - pos.z;
  return { yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

// 바닥의 빛나는 원 + 빛 기둥 + 위아래로 떠다니는 이모지
function buildMarker() {
  const group = new THREE.Group();
  group.visible = false;

  const ringMat = new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2), ringMat);
  const discMat = new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.22, depthWrite: false });
  const disc = new THREE.Mesh(new THREE.RingGeometry(0, 0.86, 48, 6).rotateX(-Math.PI / 2), discMat);

  // 아래는 진하고 위로 갈수록 투명한 빛 기둥
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  const wallMat = new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.45, alphaMap: new THREE.CanvasTexture(c), depthWrite: false, side: THREE.DoubleSide });
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 3, 48, 1, true).translate(0, 1.5, 0), wallMat);
  // 원 크기 1의 원래 모양을 기억해 두고, 놓을 때마다 반지름을 곱하고 땅 높이를 따라 휜다
  const shapes = [ring, disc, wall].map((m) => [m, m.geometry.attributes.position.array.slice()]);

  for (const m of [ring, disc, wall]) m.renderOrder = 1;
  const circle = new THREE.Group();
  circle.add(ring, disc, wall);
  group.add(circle);

  const emojiCanvas = document.createElement('canvas');
  emojiCanvas.width = emojiCanvas.height = 128;
  const emojiTex = new THREE.CanvasTexture(emojiCanvas);
  emojiTex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTex, depthWrite: false }));
  sprite.scale.set(3.5, 3.5, 1);
  sprite.renderOrder = 2;
  group.add(sprite);

  return {
    group,
    place(t) {
      group.visible = true;
      const gy = heightAt(t.x, t.z);
      group.position.set(t.x, gy, t.z);
      for (const [m, src] of shapes) {
        const a = m.geometry.attributes.position;
        for (let i = 0; i < src.length; i += 3) {
          const x = src[i] * t.radius, z = src[i + 2] * t.radius;
          a.array[i] = x; a.array[i + 2] = z;
          a.array[i + 1] = src[i + 1] + heightAt(t.x + x, t.z + z) - gy + 0.12;
        }
        a.needsUpdate = true;
        m.geometry.computeBoundingSphere();
      }
      const color = t.final ? '#5fd3ff' : '#ffd23f';
      ringMat.color.set(color); discMat.color.set(color); wallMat.color.set(color);
      const ctx = emojiCanvas.getContext('2d');
      ctx.clearRect(0, 0, 128, 128);
      ctx.font = '96px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.emoji, 64, 70);
      emojiTex.needsUpdate = true;
    },
    animate(time) {
      sprite.position.y = 5 + Math.sin(time * 2.2) * 0.6;
      ringMat.opacity = 0.65 + Math.sin(time * 4) * 0.25;
      wallMat.opacity = 0.4 + Math.sin(time * 3) * 0.08;
    },
  };
}

// 점 p에서 가장 가까운 차도 위 점
function nearestCarRoad(campus, [px, pz]) {
  let best = Infinity, bx = px, bz = pz;
  for (const r of campus.roads) {
    if (!r.car) continue;
    for (let i = 0; i < r.points.length - 1; i++) {
      const [x1, z1] = r.points[i], [x2, z2] = r.points[i + 1];
      const dx = x2 - x1, dz = z2 - z1;
      const L = dx * dx + dz * dz;
      const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / L));
      const qx = x1 + t * dx, qz = z1 + t * dz;
      const d = Math.hypot(px - qx, pz - qz);
      if (d < best) { best = d; bx = qx; bz = qz; }
    }
  }
  return [bx, bz];
}
