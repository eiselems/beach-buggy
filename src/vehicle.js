// Driving physics: a rigid body chassis with four ray-cast wheels (Rapier).
import RAPIER from '@dimforge/rapier3d-compat';
import { RIDE_HEIGHT } from './buggy.js';
import { getHeight } from './terrain.js';
import { swashAt } from './ocean.js';
import { BOOST } from './boost.js';

// Tune the handling here!
export const TUNING = {
  mass: 520,                 // kg
  engineForce: 5200,         // N, total
  frontDrive: 0.3,           // share of power sent to the front wheels (0 = rear-wheel drive)
  maxSpeed: 32,              // m/s (~115 km/h)
  reverseForce: 2400,
  brake: 9,                  // per wheel
  handbrake: 20,
  maxSteer: 0.62,            // radians
  steerSpeed: 6,
  suspensionRest: 0.5,
  suspensionStiffness: 21,
  suspensionCompression: 3.4,
  suspensionRelaxation: 2.6,
  maxTravel: 0.42,
  groundClearance: 0.4,     // m between the sand and the bottom of the body
  gripDrySand: 1.9,
  gripWetSand: 2.6,
  gripDrift: 1.05,
  antiRoll: 7000,
};

const UP = { x: 0, y: -1, z: 0 };
const AXLE = { x: -1, y: 0, z: 0 };

function rotateByQuat(v, q) {
  // v' = q * v * q^-1
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

export class Vehicle {
  // buggy: the loaded model, which tells us where its wheels are and how big its body is
  constructor(world, x, z, yaw, buggy) {
    this.world = world;
    const T = TUNING;
    const WHEELS = (this.wheels = buggy.wheels);
    // where each wheel's suspension is mounted, relative to the physics body's centre:
    // chosen so that at rest (spring squashed by the buggy's weight) the wheels sit where the model has them
    const restSquash = 9.81 / (4 * T.suspensionStiffness);
    for (const w of WHEELS) w.connY = w.y - RIDE_HEIGHT + (T.suspensionRest - restSquash);
    const box = buggy.bodyBox;
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    const hx = (box.max.x - box.min.x) / 2, hz = (box.max.z - box.min.z) / 2;
    // bottom of the body's collision shape, in body space (the model has a few parts that hang
    // lower, but using them would make the buggy scrape and get stuck on every bump)
    const floor = T.groundClearance - RIDE_HEIGHT;
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, getHeight(x, z) + 1.2, z)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      .setLinearDamping(0.02)
      .setAngularDamping(0.5)
      .setCcdEnabled(true);
    this.body = world.createRigidBody(bodyDesc);

    // main chassis box; centre of mass kept low so it does not tip over too easily
    // rounded boxes slide over edges instead of catching on them
    const round = 0.14;
    const lowH = 0.24;
    const m = T.mass, w = hx * 1.4, l = hz * 1.6, h = 1.0;
    const lowY = floor + round + lowH;
    const chassis = RAPIER.ColliderDesc.roundCuboid(hx * 0.68, lowH, hz * 0.78, round)
      .setTranslation(cx, lowY, cz)
      .setFriction(0.4)
      .setRestitution(0.1)
      .setMassProperties(
        m,
        { x: 0, y: floor + 0.25 - lowY, z: 0 }, // centre of mass low down, ~0.25 m above the floor
        { x: (m / 12) * (h * h + l * l), y: (m / 12) * (w * w + l * l), z: (m / 12) * (w * w + h * h) * 1.4 },
        { x: 0, y: 0, z: 0, w: 1 }
      );
    world.createCollider(chassis, this.body);
    // roll cage, so the buggy can land on its roof
    const cageBottom = lowY + lowH + round;
    const cageH = Math.max(0.2, (box.max.y - RIDE_HEIGHT - cageBottom) / 2 - round);
    world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(hx * 0.55, cageH, hz * 0.42, round).setTranslation(cx, cageBottom + cageH + round, cz).setDensity(0).setFriction(0.5),
      this.body
    );

    this.controller = world.createVehicleController(this.body);
    WHEELS.forEach((w, i) => {
      this.controller.addWheel({ x: w.x, y: w.connY, z: w.z }, UP, AXLE, T.suspensionRest, w.radius);
      this.controller.setWheelSuspensionStiffness(i, T.suspensionStiffness);
      this.controller.setWheelSuspensionCompression(i, T.suspensionCompression);
      this.controller.setWheelSuspensionRelaxation(i, T.suspensionRelaxation);
      this.controller.setWheelMaxSuspensionTravel(i, T.maxTravel);
      this.controller.setWheelMaxSuspensionForce(i, 30000);
      this.controller.setWheelFrictionSlip(i, T.gripDrySand);
      this.controller.setWheelSideFrictionStiffness(i, 1.0);
    });

    this.steer = 0;
    this.speed = 0;
    this.time = 0;
    this.state = {
      suspension: WHEELS.map(() => T.suspensionRest),
      rotation: WHEELS.map(() => 0),
      steering: WHEELS.map(() => 0),
      contact: WHEELS.map(() => false),
      contactPoint: WHEELS.map(() => ({ x: 0, y: 0, z: 0 })),
      slip: WHEELS.map(() => 0),
      inWater: 0,
      airborne: false,
      upsideDown: false,
    };
  }

  // input: { throttle 0..1, brake 0..1, steer -1..1 (positive = left), handbrake bool }
  step(dt, input) {
    const T = TUNING;
    const WHEELS = this.wheels;
    const c = this.controller;
    const body = this.body;
    this.time += dt;
    // forward speed in m/s (negative when reversing)
    const lv = body.linvel();
    const fwd = rotateByQuat({ x: 0, y: 0, z: 1 }, body.rotation());
    const speed = lv.x * fwd.x + lv.y * fwd.y + lv.z * fwd.z;
    this.speed = speed;

    // --- steering (less at high speed so it stays controllable)
    const steerLimit = T.maxSteer / (1 + (speed * speed) / 500);
    const target = input.steer * steerLimit;
    this.steer += (target - this.steer) * Math.min(1, dt * T.steerSpeed);

    // --- throttle and brakes
    const pos = body.translation();
    const groundH = getHeight(pos.x, pos.z);
    const waterDepth = Math.max(0, swashAt(pos.x, this.time) - groundH);
    const waterFactor = 1 / (1 + waterDepth * 1.2);

    let drive = 0;
    let brake = 0;
    const pedal = input.throttle - input.brake;
    if (pedal > 0.05) {
      if (speed < -1) brake = T.brake * pedal;
      else {
        const s = Math.max(0, speed) / T.maxSpeed;
        drive = T.engineForce * pedal * Math.max(0, 1 - s * s);
      }
    } else if (pedal < -0.05) {
      if (speed > 1) brake = T.brake * -pedal;
      else drive = -T.reverseForce * -pedal * Math.max(0, 1 - Math.abs(speed) / 12);
    } else {
      brake = 0.35; // engine braking / rolling
    }
    drive *= waterFactor;

    // --- boost: a push straight out of the exhaust, on the ground and in the air
    if (input.boost > 0 && speed < BOOST.maxSpeed) {
      const f = T.mass * BOOST.accel * input.boost * dt * (0.5 + 0.5 * waterFactor);
      body.applyImpulse({ x: fwd.x * f, y: fwd.y * f, z: fwd.z * f }, true);
    }

    for (let i = 0; i < 4; i++) {
      const w = WHEELS[i];
      c.setWheelSteering(i, w.front ? this.steer : 0);
      const share = w.front ? T.frontDrive : 1 - T.frontDrive;
      c.setWheelEngineForce(i, (drive * share) / 2);
      let b = brake;
      if (input.handbrake && !w.front) b = Math.max(b, T.handbrake);
      c.setWheelBrake(i, b);

      // grip depends on the surface: firm wet sand grips better than soft dry sand
      const cp = this.state.contactPoint[i];
      const h = getHeight(cp.x, cp.z);
      let grip = h < 0.9 ? T.gripWetSand : T.gripDrySand;
      if (input.handbrake && !w.front) grip = T.gripDrift;
      if (h < swashAt(cp.x, this.time) - 0.1) grip *= 0.8;
      c.setWheelFrictionSlip(i, grip);
    }

    // --- anti-roll bars
    for (const [l, r] of [[0, 1], [2, 3]]) {
      if (!c.wheelIsInContact(l) || !c.wheelIsInContact(r)) continue;
      const compL = T.suspensionRest - c.wheelSuspensionLength(l);
      const compR = T.suspensionRest - c.wheelSuspensionLength(r);
      const f = (compL - compR) * T.antiRoll * dt;
      const q = body.rotation();
      const up = rotateByQuat({ x: 0, y: 1, z: 0 }, q);
      const pl = c.wheelHardPoint(l), pr = c.wheelHardPoint(r);
      body.applyImpulseAtPoint({ x: up.x * f, y: up.y * f, z: up.z * f }, pl, true);
      body.applyImpulseAtPoint({ x: -up.x * f, y: -up.y * f, z: -up.z * f }, pr, true);
    }

    // --- sand rolling resistance, air drag and water drag
    const vel = body.linvel();
    const vlen = Math.hypot(vel.x, vel.y, vel.z);
    let contacts = 0;
    for (let i = 0; i < 4; i++) if (c.wheelIsInContact(i)) contacts++;
    if (vlen > 0.01) {
      const soft = groundH > 0.9 ? 1.5 : 1.0;
      const rolling = contacts > 0 ? 0.035 * T.mass * 9.81 * soft : 0;
      const aero = 0.45 * vlen * vlen;
      const water = waterDepth > 0.05 ? T.mass * 1.8 * Math.min(waterDepth, 1.2) * vlen : 0;
      const f = Math.min((rolling + aero + water) * dt, T.mass * vlen * 0.9);
      body.applyImpulse({ x: (-vel.x / vlen) * f, y: (-vel.y / vlen) * f * 0.3, z: (-vel.z / vlen) * f }, true);
    }

    // --- a little air control for jumps
    if (contacts === 0) {
      const q = body.rotation();
      const right = rotateByQuat({ x: -1, y: 0, z: 0 }, q);
      const up = rotateByQuat({ x: 0, y: 1, z: 0 }, q);
      const pitch = (input.throttle - input.brake) * 180 * dt;
      const yaw = input.steer * 120 * dt;
      body.applyTorqueImpulse({ x: right.x * pitch + up.x * yaw, y: right.y * pitch + up.y * yaw, z: right.z * pitch + up.z * yaw }, true);
    }

    c.updateVehicle(dt);

    // --- copy state out for the visuals and effects
    const st = this.state;
    for (let i = 0; i < 4; i++) {
      st.suspension[i] = c.wheelSuspensionLength(i) ?? T.suspensionRest;
      st.rotation[i] = c.wheelRotation(i) ?? 0;
      st.steering[i] = c.wheelSteering(i) ?? 0;
      st.contact[i] = c.wheelIsInContact(i);
      if (st.contact[i]) {
        const p = c.wheelContactPoint(i);
        st.contactPoint[i].x = p.x;
        st.contactPoint[i].y = p.y;
        st.contactPoint[i].z = p.z;
      } else {
        const p = c.wheelHardPoint(i);
        st.contactPoint[i].x = p.x;
        st.contactPoint[i].y = p.y - 0.8;
        st.contactPoint[i].z = p.z;
      }
      st.slip[i] = Math.abs(c.wheelSideImpulse(i) ?? 0) + Math.abs(c.wheelForwardImpulse(i) ?? 0);
    }
    st.inWater = waterDepth;
    st.airborne = contacts === 0;
    const up = rotateByQuat({ x: 0, y: 1, z: 0 }, body.rotation());
    st.upsideDown = up.y < 0.25;
  }

  reset() {
    const p = this.body.translation();
    const q = this.body.rotation();
    // keep the heading, drop it the right way up
    const fwd = rotateByQuat({ x: 0, y: 0, z: 1 }, q);
    const yaw = Math.atan2(fwd.x, fwd.z);
    this.place(p.x, p.z, yaw);
  }

  place(x, z, yaw) {
    this.body.setTranslation({ x, y: Math.max(getHeight(x, z), 0) + 1.4, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steer = 0;
  }
}
