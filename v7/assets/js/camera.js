// 차를 따라가는 카메라. C 키로 뒤 / 위에서 / 운전석 시점을 바꾼다.
import * as THREE from 'three';
import { heightAt } from './terrain.js';

const MIN_CLEARANCE = 1.2; // 카메라가 땅에서 떨어져 있어야 하는 최소 높이 (m)

export const CAMERA_MODES = [
  { id: 'chase', label: '뒤에서 따라가기' },
  { id: 'top', label: '위에서 내려다보기' },
  { id: 'driver', label: '운전석' },
];

// 학생이 내려서 걸을 때의 시점 (C 키). 굴착기보다 가깝고 조금 높게
export const WALK_CAMERA_MODES = [
  { id: 'follow', label: '따라가기', dist: 3.8, pitch: 0.45 },
  { id: 'far', label: '멀리서 따라가기', dist: 9, pitch: 0.55 },
  { id: 'top', label: '위에서 내려다보기' },
];
// 걷는 중 마우스 시점: 위아래 각도(rad)와 거리(m) 한도
export const ORBIT = { pitchMin: 0.05, pitchMax: 1.2, distMin: 2.2, distMax: 12, dragYaw: 0.006, dragPitch: 0.005, lookY: 0.75 };

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
    this.walkMode = 0;
    this.orbit = { yaw: 0, pitch: 0.45, dist: 3.8 }; // 걷기 시점: 카메라가 보는 방향(yaw), 내려다보는 각, 거리
    this.orbitReset = false; // V: 학생 머리 뒤로 부드럽게 돌아가는 중
    this.walkTarget = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.camHeading = 0;
    this.snap = true;
    this.cine = null; // 연출 카메라: { pos, look, fov }를 넣으면 그대로 따른다
  }

  // 연출이 끝나면 null. 지금 연출 위치에서 부드럽게 원래 시점으로 돌아간다
  setCinematic(pose) {
    this.cine = pose;
  }

  nextMode() {
    this.mode = (this.mode + 1) % CAMERA_MODES.length;
    this.snap = CAMERA_MODES[this.mode].id === 'driver';
    return CAMERA_MODES[this.mode];
  }

  // ---------- 걷기 시점 ----------

  // 내릴 때: 지금 보던 방향(굴착기 뒤)에서 시작
  startWalk(heading, target) {
    const m = WALK_CAMERA_MODES[this.walkMode];
    Object.assign(this.orbit, { yaw: heading, pitch: m.pitch ?? 0.42, dist: m.dist ?? 4.5 });
    this.walkTarget.copy(target);
    this.orbitReset = false;
  }

  nextWalkMode() {
    this.walkMode = (this.walkMode + 1) % WALK_CAMERA_MODES.length;
    const m = WALK_CAMERA_MODES[this.walkMode];
    if (m.dist) Object.assign(this.orbit, { dist: m.dist, pitch: m.pitch });
    return m;
  }

  // 마우스로 끌기: 학생 주위로 돌리기 (위아래는 한도 안에서)
  dragOrbit(dx, dy) {
    this.orbit.yaw -= dx * ORBIT.dragYaw;
    this.orbit.pitch = THREE.MathUtils.clamp(this.orbit.pitch + dy * ORBIT.dragPitch, ORBIT.pitchMin, ORBIT.pitchMax);
    this.orbitReset = false;
  }

  // 마우스 휠: 거리 (가까이·멀리 한도)
  zoomOrbit(delta) {
    this.orbit.dist = THREE.MathUtils.clamp(this.orbit.dist * Math.exp(delta * 0.001), ORBIT.distMin, ORBIT.distMax);
  }

  // V: 학생 머리 뒤로 부드럽게 돌아가기
  resetOrbit() { this.orbitReset = true; }

  // walker: { pos(Vector2), y, heading, moving }, autoBehind: 설정 "걸을 때 카메라 자동으로 뒤로"
  updateWalk(dt, walker, { autoBehind = false, dragging = false } = {}) {
    const m = WALK_CAMERA_MODES[this.walkMode], O = this.orbit;
    const goal = new THREE.Vector3(walker.pos.x, walker.y + ORBIT.lookY, walker.pos.y);
    this.walkTarget.lerp(goal, 1 - Math.exp(-dt * 12));
    if (this.orbitReset) {
      const k = Math.min(1, dt * 5);
      O.yaw += angleDiff(walker.heading, O.yaw) * k;
      O.pitch += ((m.pitch ?? 0.42) - O.pitch) * k;
      O.dist += ((m.dist ?? 4.5) - O.dist) * k;
      if (Math.abs(angleDiff(walker.heading, O.yaw)) < 0.01 && Math.abs(O.pitch - (m.pitch ?? 0.42)) < 0.01
        && Math.abs(O.dist - (m.dist ?? 4.5)) < 0.02) this.orbitReset = false;
    } else if (autoBehind && walker.moving && !dragging) {
      O.yaw += angleDiff(walker.heading, O.yaw) * Math.min(1, dt * 1.5);
    }
    const T = this.walkTarget, pos = new THREE.Vector3(), look = T.clone();
    if (m.id === 'top') {
      pos.set(T.x, T.y + 28, T.z + 11);
    } else {
      const h = Math.cos(O.pitch) * O.dist;
      pos.set(T.x - Math.sin(O.yaw) * h, T.y + Math.sin(O.pitch) * O.dist, T.z - Math.cos(O.yaw) * h);
    }
    // 굴착기에서 내릴 때 따라가기 카메라에서 부드럽게 넘어옴
    if (this.snap) { this.pos.copy(pos); this.look.copy(look); this.snap = false; }
    else {
      const k = 1 - Math.exp(-dt * 10);
      this.pos.lerp(pos, k);
      this.look.lerp(look, k);
    }
    this.pos.y = Math.max(this.pos.y, heightAt(this.pos.x, this.pos.z) + MIN_CLEARANCE);
    this.camHeading = O.yaw;
    if (Math.abs(this.camera.fov - 55) > 0.05) {
      this.camera.fov += (55 - this.camera.fov) * Math.min(1, dt * 4);
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  update(dt, car) {
    if (this.cine) {
      const { pos, look, fov } = this.cine;
      this.pos.copy(pos);
      this.look.copy(look);
      this.camHeading = car.heading;
      this.camera.position.copy(pos);
      this.camera.position.y = Math.max(pos.y, heightAt(pos.x, pos.z) + MIN_CLEARANCE);
      this.camera.lookAt(look);
      if (fov && this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
      car.setCockpitView(false);
      return;
    }
    const id = CAMERA_MODES[this.mode].id;
    const cx = car.pos.x, cz = car.pos.y;
    const cy = car.object.position.y; // 굴착기가 선 땅 높이

    // 카메라 방향은 차 방향을 천천히 따라가서 드리프트할 때 옆모습이 보이게
    if (this.snap) this.camHeading = car.heading;
    else this.camHeading += angleDiff(car.heading, this.camHeading) * Math.min(1, dt * 4);
    const fx = Math.sin(this.camHeading), fz = Math.cos(this.camHeading);

    const pos = new THREE.Vector3();
    const look = new THREE.Vector3();
    let fov = 60;
    const boost = car.boostFx; // 부스터 효과 세기 0~1

    if (id === 'chase') {
      const speed01 = Math.min(1, car.speedKmh / 60);
      const back = 8.5 + speed01 * 1.5;
      pos.set(cx - fx * back, cy + 4 + speed01 * 0.6, cz - fz * back);
      look.set(cx + fx * 4, cy + 1.6, cz + fz * 4);
      fov = 60 + speed01 * 8 + boost * 16;
    } else if (id === 'top') {
      pos.set(cx, cy + 110, cz + 45);
      look.set(cx, cy, cz);
      fov = 50 + boost * 10;
    } else {
      // 운전석 캐빈 (왼쪽 좌석, 차량 기준 왼쪽 = 로컬 +x) — 비탈 기울기까지 그대로 따라감
      car.object.updateMatrixWorld();
      pos.set(0.34, 2.05, 0.35).applyMatrix4(car.object.matrixWorld);
      look.set(0.34, 1.5, 10.35).applyMatrix4(car.object.matrixWorld);
      fov = 65 + boost * 20;
    }
    car.setCockpitView(id === 'driver');

    if (this.snap || id === 'driver') {
      this.pos.copy(pos);
      this.look.copy(look);
      this.snap = false;
    } else {
      const k = 1 - Math.exp(-dt * (6 + boost * 10)); // 부스터 때는 더 바짝 따라감
      this.pos.lerp(pos, k);
      this.look.lerp(look, k);
    }
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 4);
      this.camera.updateProjectionMatrix();
    }
    // 언덕 속으로 들어가지 않게 (따라가기 카메라가 뒤쪽 오르막에 묻힐 때)
    if (id !== 'driver') this.pos.y = Math.max(this.pos.y, heightAt(this.pos.x, this.pos.z) + MIN_CLEARANCE);
    this.camera.position.copy(this.pos);
    // 부스터 중 카메라 미세 흔들림
    if (boost > 0.02) {
      const a = 0.07 * boost;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
      this.camera.position.z += (Math.random() - 0.5) * a;
    }
    this.camera.lookAt(this.look);
  }
}

function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
