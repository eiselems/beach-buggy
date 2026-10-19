// Camera modes: chase, far chase, helmet cam and "TV" trackside cameras.
import * as THREE from 'three';
import { getHeight, shoreZ } from './terrain.js';

export const CAMERA_MODES = ['Chase', 'Far chase', 'Helmet', 'TV camera'];

export class CameraRig {
  constructor(camera, dom, physics = null) {
    this.camera = camera;
    this.physics = physics; // { world, RAPIER, body }: lets the camera avoid poking through things
    this.dip = 0;           // landing bump
    this.dipVel = 0;
    this.wasAir = false;
    this.mode = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.yaw = 0; // smoothed heading of the buggy
    this.orbit = { yaw: 0, pitch: 0, dragging: false, lastMove: -10 };
    this.tvSpot = null;
    this.first = true;

    dom.addEventListener('pointerdown', (e) => {
      this.orbit.dragging = true;
      this.orbit.x = e.clientX;
      this.orbit.y = e.clientY;
    });
    window.addEventListener('pointerup', () => (this.orbit.dragging = false));
    window.addEventListener('pointermove', (e) => {
      if (!this.orbit.dragging) return;
      this.orbit.yaw -= (e.clientX - this.orbit.x) * 0.006;
      this.orbit.pitch = THREE.MathUtils.clamp(this.orbit.pitch + (e.clientY - this.orbit.y) * 0.004, -0.3, 0.9);
      this.orbit.x = e.clientX;
      this.orbit.y = e.clientY;
      this.orbit.lastMove = performance.now() / 1000;
    });
  }

  next() {
    this.mode = (this.mode + 1) % CAMERA_MODES.length;
    this.first = true;
    this.tvSpot = null;
    return CAMERA_MODES[this.mode];
  }

  update(dt, target, quaternion, velocity, speed, boost = 0, airborne = false) {
    this.boost = (this.boost || 0) + (boost - (this.boost || 0)) * Math.min(1, dt * 5);
    const cam = this.camera;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
    // heading follows the direction of travel, so reversing does not spin the camera
    let heading = Math.atan2(fwd.x, fwd.z);
    let diff = heading - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += diff * Math.min(1, dt * 3.5);

    // let the mouse-orbit drift back after a couple of seconds
    const now = performance.now() / 1000;
    if (!this.orbit.dragging && now - this.orbit.lastMove > 2) {
      this.orbit.yaw *= Math.exp(-dt * 2);
      this.orbit.pitch *= Math.exp(-dt * 2);
    }

    let desired = new THREE.Vector3();
    let lookAt = new THREE.Vector3();
    let fov = 62;
    let snap = false;

    if (this.mode === 0 || this.mode === 1) {
      const far = this.mode === 1;
      const dist = (far ? 10.5 : 6.2) + Math.min(speed, 30) * 0.04;
      const height = far ? 3.8 : 2.0;
      const a = this.yaw + Math.PI + this.orbit.yaw;
      const pitch = this.orbit.pitch;
      desired.set(
        target.x + Math.sin(a) * dist * Math.cos(pitch),
        target.y + height + Math.sin(pitch) * dist,
        target.z + Math.cos(a) * dist * Math.cos(pitch)
      );
      lookAt.set(target.x + Math.sin(this.yaw) * 2, target.y + (far ? 1.0 : 1.1), target.z + Math.cos(this.yaw) * 2);
      fov = 60 + Math.min(speed, 46) * 0.4 + this.boost * 10;
    } else if (this.mode === 2) {
      // helmet cam, slightly behind the driver's eyes
      const eye = new THREE.Vector3(0.3, 0.5, 0.15).applyQuaternion(quaternion).add(target);
      desired.copy(eye);
      lookAt.copy(new THREE.Vector3(0.3, 0.35, 8).applyQuaternion(quaternion).add(target));
      fov = 75;
      snap = true;
    } else {
      // TV camera: parked beside the track, then jumps ahead when the buggy is far away
      if (!this.tvSpot || this.tvSpot.distanceTo(target) > 70) {
        const ahead = new THREE.Vector3(velocity.x, 0, velocity.z);
        if (ahead.lengthSq() < 1) ahead.copy(fwd).setY(0);
        ahead.normalize().multiplyScalar(35);
        const side = new THREE.Vector3(-ahead.z, 0, ahead.x).normalize().multiplyScalar(Math.random() < 0.5 ? 14 : -14);
        const spot = target.clone().add(ahead).add(side);
        // keep the camera above the sand and out of the sea
        if (spot.z > shoreZ(spot.x) + 15) spot.z = shoreZ(spot.x) + 15;
        spot.y = Math.max(getHeight(spot.x, spot.z), 0) + 1.6 + Math.random() * 3;
        this.tvSpot = spot;
        this.first = true;
      }
      desired.copy(this.tvSpot);
      lookAt.copy(target).add(new THREE.Vector3(0, 0.8, 0));
      const d = this.tvSpot.distanceTo(target);
      fov = THREE.MathUtils.clamp(900 / d, 12, 55);
      snap = true;
    }

    // landing: the camera dips and springs back
    if (this.wasAir && !airborne && velocity.y < -2) this.dipVel -= Math.min(6, -velocity.y * 0.6);
    this.wasAir = airborne;
    this.dipVel += (-this.dip * 60 - this.dipVel * 9) * dt;
    this.dip += this.dipVel * dt;
    if (this.mode < 2) desired.y += this.dip * 0.5;

    // don't let palms, rocks or the tower get between the camera and the buggy
    if (this.physics && this.mode < 2) {
      const { world, RAPIER, body } = this.physics;
      const from = { x: target.x, y: target.y + 1.0, z: target.z };
      const dir = { x: desired.x - from.x, y: desired.y - from.y, z: desired.z - from.z };
      const len = Math.hypot(dir.x, dir.y, dir.z);
      if (len > 0.5) {
        const ray = new RAPIER.Ray(from, { x: dir.x / len, y: dir.y / len, z: dir.z / len });
        const hit = world.castRay(ray, len, true, undefined, undefined, undefined, body);
        if (hit && hit.timeOfImpact < len) {
          const t = Math.max(1.5, hit.timeOfImpact - 0.3) / len;
          desired.set(from.x + dir.x * t, from.y + dir.y * t, from.z + dir.z * t);
        }
      }
    }

    // never go below the ground or the water
    const minY = Math.max(getHeight(desired.x, desired.z), 0.3) + (this.mode === 2 ? 0 : 0.6);
    if (desired.y < minY) desired.y = minY;

    if (this.first || snap) {
      this.pos.copy(desired);
      this.look.copy(lookAt);
      this.offset = desired.clone().sub(target);
      this.first = false;
    } else {
      // smooth the camera's offset from the buggy (not its absolute position), so the camera
      // doesn't fall further behind the faster you go: the buggy stays the same size on screen
      const k = 1 - Math.exp(-dt * 6);
      this.offset.lerp(desired.clone().sub(target), k);
      this.pos.copy(target).add(this.offset);
      this.look.lerp(lookAt, 1 - Math.exp(-dt * 12));
      const y = Math.max(getHeight(this.pos.x, this.pos.z), 0.3) + 0.5;
      if (this.pos.y < y) this.pos.y = y;
    }
    cam.position.copy(this.pos);
    cam.lookAt(this.look);
    // a little rumble while boosting
    this.shake = Math.max(0, (this.shake || 0) - dt * 1.5);
    if ((this.boost > 0.05 || speed > 25 || this.shake > 0) && this.mode < 2) {
      const a = this.boost * 0.004 + Math.max(0, speed - 25) * 0.00012 + (this.shake || 0) * 0.03;
      cam.rotation.x += (Math.random() - 0.5) * a;
      cam.rotation.y += (Math.random() - 0.5) * a;
    }
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * (this.mode === 3 ? 2 : 4));
      cam.updateProjectionMatrix();
    }
  }
}
