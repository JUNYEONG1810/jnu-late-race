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
  }

  nextMode() {
    this.mode = (this.mode + 1) % CAMERA_MODES.length;
    this.snap = CAMERA_MODES[this.mode].id === 'driver';
    return CAMERA_MODES[this.mode];
  }

  update(dt, car) {
    const id = CAMERA_MODES[this.mode].id;
    const cx = car.pos.x, cz = car.pos.y;

    // 카메라 방향은 차 방향을 천천히 따라가서 드리프트할 때 옆모습이 보이게
    if (this.snap) this.camHeading = car.heading;
    else this.camHeading += angleDiff(car.heading, this.camHeading) * Math.min(1, dt * 4);
    const fx = Math.sin(this.camHeading), fz = Math.cos(this.camHeading);

    const pos = new THREE.Vector3();
    const look = new THREE.Vector3();
    let fov = 60;

    if (id === 'chase') {
      const speed01 = Math.min(1, car.speedKmh / 85);
      const back = 8 + speed01 * 2;
      pos.set(cx - fx * back, 3.6 + speed01 * 0.8, cz - fz * back);
      look.set(cx + fx * 4, 1.2, cz + fz * 4);
      fov = 60 + speed01 * 10 + (car.boosting ? 4 : 0);
    } else if (id === 'top') {
      pos.set(cx, 110, cz + 45);
      look.set(cx, 0, cz);
      fov = 50;
    } else {
      // 운전석 (왼쪽 좌석) — 흔들리지 않게 바로 따라감
      const hx = Math.sin(car.heading), hz = Math.cos(car.heading);
      const sx = 0.38; // 차 기준 왼쪽 = 로컬 +x
      pos.set(cx + hz * sx + hx * 0.3, 1.45, cz - hx * sx + hz * 0.3);
      look.set(pos.x + hx * 10, 1.2, pos.z + hz * 10);
      fov = 65;
    }
    car.setCockpitView(id === 'driver');

    if (this.snap || id === 'driver') {
      this.pos.copy(pos);
      this.look.copy(look);
      this.snap = false;
    } else {
      const k = 1 - Math.exp(-dt * 6);
      this.pos.lerp(pos, k);
      this.look.lerp(look, k);
    }
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 4);
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}

function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
