// 차를 따라가는 카메라. C 키로 뒤 / 위에서 / 운전석 시점을 바꾼다.
import * as THREE from 'three';

export const CAMERA_MODES = [
  { id: 'chase', label: '뒤에서 따라가기' },
  { id: 'top', label: '위에서 내려다보기' },
  { id: 'driver', label: '운전석' },
];

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
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

  update(dt, car) {
    if (this.cine) {
      const { pos, look, fov } = this.cine;
      this.pos.copy(pos);
      this.look.copy(look);
      this.camHeading = car.heading;
      this.camera.position.copy(pos);
      this.camera.lookAt(look);
      if (fov && this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
      car.setCockpitView(false);
      return;
    }
    const id = CAMERA_MODES[this.mode].id;
    const cx = car.pos.x, cz = car.pos.y;

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
      pos.set(cx - fx * back, 4 + speed01 * 0.6, cz - fz * back);
      look.set(cx + fx * 4, 1.6, cz + fz * 4);
      fov = 60 + speed01 * 8 + boost * 16;
    } else if (id === 'top') {
      pos.set(cx, 110, cz + 45);
      look.set(cx, 0, cz);
      fov = 50 + boost * 10;
    } else {
      // 운전석 캐빈 (왼쪽 좌석) — 흔들리지 않게 바로 따라감
      const hx = Math.sin(car.heading), hz = Math.cos(car.heading);
      const sx = 0.34; // 차량 기준 왼쪽 = 로컬 +x
      pos.set(cx + hz * sx + hx * 0.35, 2.05, cz - hx * sx + hz * 0.35);
      look.set(pos.x + hx * 10, 1.5, pos.z + hz * 10);
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
