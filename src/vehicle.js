// Driving physics: a rigid body chassis with four ray-cast wheels (Rapier).
import RAPIER from '@dimforge/rapier3d-compat';
import { RIDE_HEIGHT } from './buggy.js';
import { getHeight } from './terrain.js';
import { trackAt } from './heightfield.js';
import { swashAt } from './ocean.js';
import { BOOST } from './boost.js';

// Tune the handling here!
export const TUNING = {
  mass: 520,                 // kg
  engineForce: 5600,         // N, total
  frontDrive: 0.3,           // share of power sent to the front wheels (0 = rear-wheel drive)
  maxSpeed: 39,              // m/s (~140 km/h)
  reverseForce: 2400,
  brake: 9,                  // per wheel
  handbrake: 1.5,
  maxSteer: 0.62,            // radians
  steerSpeed: 9,
  frontGrip: 1.3,            // extra grip on the front tyres so the buggy turns in instead of pushing wide
  suspensionRest: 0.75,
  suspensionStiffness: 15,       // soft, long-travel buggy springs: wheels stay on the sand over bumps
  suspensionCompression: 5.5,
  suspensionRelaxation: 3.6,
  maxTravel: 0.62,
  groundClearance: 0.4,     // m between the sand and the bottom of the body
  gripDrySand: 1.1,         // soft dry sand: about 0.8 g in corners
  gripWetSand: 1.4,         // firm wet sand near the water grips better
  gripTrack: 1.5,           // the packed dirt track
  gripDrift: 0.6,           // rear grip with the handbrake pulled (fraction of normal grip)
  gripSliding: 0.8,         // rear grip while you hold a drift (fraction; keeps slides going instead of snapping back)
  antiRoll: 6000,
  steerReturn: 11,          // how fast the wheels straighten when you let go
  countersteer: 0.75,       // automatic countersteer in slides (Forza-style steering assist)
  yawDamping: 2.2,          // keeps the buggy straight when you are not steering
  downforce: 0.8,           // N per (m/s)^2: presses the buggy onto bumps at speed
  maxDriftAngle: 0.75,      // radians (~40°): drift assist stops slides going further than this
  driftAssist: 60,          // how hard it pulls back (rad/s² per radian over the limit)
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
      .setFriction(0.05) // the belly slides over sand instead of grabbing it
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
      // the rear lets go a little earlier than the front, so the buggy can be steered with the throttle
      this.controller.setWheelSideFrictionStiffness(i, w.front ? 0.85 : 0.7);
    });

    this.steer = 0;
    this.speed = 0;
    this.grip = WHEELS.map(() => T.gripDrySand);
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

    // sideways speed (positive = sliding to the left) and the slip angle between heading and travel
    const left = rotateByQuat({ x: 1, y: 0, z: 0 }, body.rotation());
    const lateral = lv.x * left.x + lv.y * left.y + lv.z * left.z;
    const flatSpeed = Math.hypot(lateral, speed);
    const slipAngle = flatSpeed > 4 && speed > -1 ? Math.atan2(lateral, Math.max(speed, 0.1)) : 0;
    this.prevSlip = this.slipAngle;
    this.slipAngle = slipAngle;
    // holding a drift = throttle on and steering against the slide (countersteer has the same sign as the slip)
    // holding a drift = throttle on and some steering (either way) while already sliding;
    // let go of the steering or the throttle and the buggy straightens out
    const driftHeld = input.throttle > 0.3 && Math.abs(input.steer) > 0.1 && Math.abs(slipAngle) > 0.15;
    // in a drift, a full keyboard countersteer is far too much: treat it as a gentle one
    const counter = input.steer * slipAngle > 0;
    const steerIn = driftHeld && counter ? input.steer * 0.35 : input.steer;

    // --- steering (less at high speed so it stays controllable), plus automatic countersteer:
    // the front wheels lean towards where the buggy is actually going, like Forza's steering assist
    // less lock at high speed, so full lock on a keyboard carves instead of spinning
    // full lock is about the wheel angle the tyres can actually use at this speed (plus a little slip),
    // so the whole range of the stick/keys matters instead of saturating at a third of the way
    const gripAngle = Math.atan((2.2 * (this.surfaceGrip || 1) * 9.81) / Math.max(speed * speed, 1)) + 0.09;
    const steerLimit = Math.min(T.maxSteer / (1 + (speed * speed) / 900 + Math.max(0, speed - 26) * 0.05), gripAngle);
    let target = steerIn * steerLimit;
    // only help when the player isn't steering into the turn themselves
    const steeringIntoSlide = steerIn * slipAngle < 0;
    if (speed > 4) target += T.countersteer * slipAngle * (driftHeld ? 0.4 : steeringIntoSlide ? 1 - 0.8 * Math.abs(steerIn) : 1);
    target = Math.max(-T.maxSteer, Math.min(T.maxSteer, target));
    const rate = Math.abs(target) < Math.abs(this.steer) ? T.steerReturn : T.steerSpeed;
    this.steer += (target - this.steer) * Math.min(1, dt * rate);

    // --- throttle and brakes
    const pos = body.translation();
    const groundH = getHeight(pos.x, pos.z);
    // how deep the buggy is in the water (measured from its wheels, not just the sea floor below)
    const waterLevel = swashAt(pos.x, this.time);
    const waterDepth = Math.max(0, Math.min(waterLevel - groundH, waterLevel - (pos.y - 0.9)));
    const waterFactor = 1 / (1 + waterDepth * 0.5);

    let drive = 0;
    let brake = 0;
    const pedal = input.throttle - input.brake;
    if (pedal > 0.05) {
      if (speed < -1) brake = T.brake * pedal;
      else {
        const s = Math.max(0, speed) / T.maxSpeed;
        // flat torque most of the way, fading out near top speed
        // flat torque most of the way, fading out near top speed; above it (after a boost) a little
        // push remains so the buggy coasts down gently instead of slamming into a wall of drag
        drive = T.engineForce * pedal * Math.max(0.1, 1 - Math.pow(s, 4));
      }
    } else if (pedal < -0.05) {
      if (speed > 1) brake = T.brake * -pedal;
      else drive = -T.reverseForce * -pedal * Math.max(0, 1 - Math.abs(speed) / 12);
    } else {
      brake = 0.35; // engine braking / rolling
    }
    drive *= waterFactor;

    // --- boost: a push straight out of the exhaust, on the ground and in the air
    if (input.boost > 0) {
      // fades out towards ~175 km/h instead of a hard cap, so downhill and a clean line still gain speed
      const fade = Math.max(0, 1 - Math.pow(Math.max(0, speed) / BOOST.maxSpeed, 3));
      const f = T.mass * BOOST.accel * input.boost * fade * dt * (0.5 + 0.5 * waterFactor);
      body.applyImpulse({ x: fwd.x * f, y: fwd.y * f, z: fwd.z * f }, true);
    }

    let surfaceSum = 0;
    for (let i = 0; i < 4; i++) {
      const w = WHEELS[i];
      c.setWheelSteering(i, w.front ? this.steer : 0);
      const share = w.front ? T.frontDrive : 1 - T.frontDrive;
      // handbrake locks the rear wheels (Rapier ignores the brake while a wheel has engine force)
      const locked = input.handbrake && !w.front;
      c.setWheelEngineForce(i, locked ? 0 : (drive * share) / 2);
      let b = brake;
      if (locked) b = Math.max(b, T.handbrake);
      c.setWheelBrake(i, b);

      // grip depends on the surface: firm wet sand grips better than soft dry sand (blended smoothly,
      // so wheels don't flip between two grip levels along the waterline)
      const cp = this.state.contactPoint[i];
      const h = getHeight(cp.x, cp.z);
      const wet = Math.min(1, Math.max(0, (1.5 - h) / 1.0));
      let grip = T.gripDrySand + (T.gripWetSand - T.gripDrySand) * wet;
      grip += (T.gripTrack - grip) * trackAt(cp.x, cp.z); // packed dirt on the track grips best
      const under = swashAt(cp.x, this.time) - Math.max(h, cp.y);
      if (under > 0) grip *= 1 - 0.2 * Math.min(1, under * 3);
      if (!w.front) {
        // power oversteer: full throttle while cornering hard uses up some of the rear tyres' grip
        const cornering = Math.min(1, Math.abs(input.steer)) * Math.min(1, Math.max(0, (speed - 12) / 6)) * Math.max(0, Math.min(1, (30 - speed) / 8));
        grip *= 1 - 0.38 * input.throttle * cornering;
        // the handbrake bites harder at speed, so a quick flick works at 100+ km/h too
        if (input.handbrake) grip *= T.gripDrift * (1 - 0.35 * Math.min(1, Math.max(0, (speed - 15) / 15)));
        else if (driftHeld) {
          // throttle + countersteer keep the rear loose once a slide has started (power-over drifting)
          const k = Math.min(1, (Math.abs(slipAngle) - 0.15) / 0.2) * input.throttle;
          grip *= 1 - (1 - T.gripSliding) * k;
        }
      }
      // ease grip changes in over ~0.2 s so pulling the handbrake starts a slide instead of a snap spin
      this.grip[i] += (grip - this.grip[i]) * Math.min(1, dt * 5);
      c.setWheelFrictionSlip(i, this.grip[i] * (w.front ? T.frontGrip : 1));
      surfaceSum += 0.95 + (grip - T.gripDrySand) * 0.5;
    }

    // how grippy the ground is overall (about 0.95 g dry sand, 1.1 wet, 1.15 track)
    this.surfaceGrip = Math.min(1.25, Math.max(0.9, surfaceSum / 4));

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
      const soft = (groundH > 0.9 ? 1.5 : 1.0) * (1 - 0.4 * trackAt(pos.x, pos.z)); // less drag on the track
      const rolling = contacts > 0 ? 0.035 * T.mass * 9.81 * soft : 0;
      const aero = 0.45 * vlen * vlen;
      const water = waterDepth > 0.05 ? T.mass * 0.7 * Math.min(waterDepth, 1.2) * vlen : 0;
      const f = Math.min((rolling + aero + water) * dt, T.mass * vlen * 0.9);
      body.applyImpulse({ x: (-vel.x / vlen) * f, y: (-vel.y / vlen) * f * 0.3, z: (-vel.z / vlen) * f }, true);
    }

    // --- stability: damp spinning when the player isn't asking for it, and downforce at speed
    if (contacts > 0) {
      const av = body.angvel();
      const up = rotateByQuat({ x: 0, y: 1, z: 0 }, body.rotation());
      const yawRate = av.x * up.x + av.y * up.y + av.z * up.z;
      // countersteering (steering against the slide) shouldn't be fought by the damping either
      const asked = Math.abs(input.steer) > 0.1 || input.handbrake || Math.abs(slipAngle) > 0.2;
      // when a slide is snapping back (rotating towards straight), damp hard so it doesn't swing
      // through to the other side like a pendulum
      const snapping = !driftHeld && Math.abs(slipAngle) > 0.05 && yawRate * slipAngle > 0;
      const k = (snapping ? 4 : asked ? 0.25 : 1) * T.yawDamping * Math.min(1, Math.abs(speed) / 8);
      const inertia = 600;
      const imp = -yawRate * inertia * k * dt;
      body.applyTorqueImpulse({ x: up.x * imp, y: up.y * imp, z: up.z * imp }, true);
      // drift assist: if the slide gets too wide, gently rotate the buggy back towards its direction of travel
      const excess = Math.abs(slipAngle) - T.maxDriftAngle;
      if (excess > 0) {
        const a = Math.sign(slipAngle) * Math.min(excess, 0.6) * T.driftAssist * (1 + Math.max(0, speed - 25) / 10) * inertia * dt;
        body.applyTorqueImpulse({ x: up.x * a, y: up.y * a, z: up.z * a }, true);
      }
      // a drift only lasts while you hold it (throttle + countersteer); otherwise the buggy
      // straightens out towards where it's going
      if (driftHeld) {
        // drift controller: steer into the turn for a wider angle, countersteer for a narrower one
        // full countersteer ~15°, full steer into the turn ~40°
        const want = 0.42 + (counter ? -0.16 : 0.28) * Math.abs(input.steer);
        const err = want - Math.abs(slipAngle);
        // plus damping on how fast the angle changes, so it settles instead of wobbling
        const slipRate = (slipAngle - (this.prevSlip ?? slipAngle)) / dt;
        const yawErr = -Math.sign(slipAngle) * err * 14 + slipRate * 5;
        const hold = yawErr * input.throttle * inertia * dt;
        body.applyTorqueImpulse({ x: up.x * hold, y: up.y * hold, z: up.z * hold }, true);
      } else if (!driftHeld && !input.handbrake && Math.abs(slipAngle) > 0.03) {
        const a = Math.sign(slipAngle) * Math.min(Math.abs(slipAngle), 0.6) * 6 * inertia * dt;
        body.applyTorqueImpulse({ x: up.x * a, y: up.y * a, z: up.z * a }, true);
      }
      // grip limit: outside a drift, don't let the buggy rotate faster than its tyres could turn it
      // (so full lock at top speed carves a curve instead of spinning)
      if (!driftHeld && !input.handbrake && Math.abs(speed) > 8) {
        // the turn rate follows the steering input all the way to full lock, and the surface sets the limit:
        // soft dry sand < wet sand < the packed track
        const mu = this.surfaceGrip;
        const maxYaw = ((mu * 9.81) / Math.abs(speed)) * (0.15 + 0.85 * Math.pow(Math.min(1, Math.abs(input.steer)), 0.9));
        const over = Math.abs(yawRate) - maxYaw;
        if (over > 0) {
          const a = -Math.sign(yawRate) * over * inertia * Math.min(1, dt * 30);
          body.applyTorqueImpulse({ x: up.x * a, y: up.y * a, z: up.z * a }, true);
        }
      }
      // while drifting, the throttle keeps the speed up (less scrub)
      if (Math.abs(slipAngle) > 0.2 && (input.throttle > 0.3 || input.handbrake)) {
        const push = T.mass * 6.5 * Math.max(input.throttle, input.handbrake ? 0.6 : 0) * dt;
        const vx = lv.x, vz = lv.z, vl = Math.hypot(vx, vz) || 1;
        body.applyImpulse({ x: (vx / vl) * push, y: 0, z: (vz / vl) * push }, true);
      }
      const down = T.downforce * speed * speed * dt * (contacts / 4);
      body.applyImpulse({ x: -up.x * down, y: -up.y * down, z: -up.z * down }, true);
    }

    // --- stick to the ground over crests: shortly after the wheels leave the sand (not off a ramp),
    // pull the buggy back down, like Forza's gravity assist
    this.airTime = contacts === 0 ? (this.airTime || 0) + dt : 0;
    if (contacts > 0) {
      // touching something above the sand (a ramp or rock)? then a jump is intended
      this.onRamp = false;
      for (let i = 0; i < 4; i++) {
        const cp = this.state.contactPoint[i];
        if (this.state.contact[i] && cp.y - getHeight(cp.x, cp.z) > 0.3) this.onRamp = true;
      }
    }
    // off a crest (not a ramp), the buggy falls a bit faster so small bumps don't turn into long flights
    if (contacts === 0 && !this.onRamp) body.applyImpulse({ x: 0, y: -T.mass * 9.81 * 0.45 * dt, z: 0 }, true);
    if (contacts === 0 && this.airTime < 0.5 && !this.onRamp) {
      const v = body.linvel();
      const gap = pos.y - getHeight(pos.x, pos.z);
      if (v.y > 0 && gap < 2.2) body.applyImpulse({ x: 0, y: -Math.min(v.y, 9.81 * 2.2 * dt) * T.mass, z: 0 }, true);
    }

    // --- air assist: calm down tumbling and slowly level the buggy so it lands on its wheels
    if (contacts === 0) {
      const av = body.angvel();
      const q = body.rotation();
      const up = rotateByQuat({ x: 0, y: 1, z: 0 }, q);
      const yawPart = av.x * up.x + av.y * up.y + av.z * up.z;
      // angular velocity that isn't yaw = pitch and roll
      const px = av.x - up.x * yawPart, py = av.y - up.y * yawPart, pz = av.z - up.z * yawPart;
      const damp = Math.min(1, dt * 1.5);
      // level: turn "up" towards the sky, around the axis cross(up, worldUp) = (-up.z, 0, up.x)
      const lev = 2.5 * dt;
      body.setAngvel({ x: av.x - px * damp - up.z * lev, y: av.y - py * damp, z: av.z - pz * damp + up.x * lev }, true);
    }

    // --- tumbling limit: crashes shouldn't turn into ragdoll cartwheels
    {
      const av = body.angvel();
      const m = Math.hypot(av.x, av.z);
      if (m > 3.2) body.setAngvel({ x: (av.x / m) * 3.2, y: av.y, z: (av.z / m) * 3.2 }, true);
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

    // --- landing assist: touching down shouldn't scrub off most of your speed
    const flat = body.linvel();
    const hs = Math.hypot(flat.x, flat.z);
    if (contacts === 0) this.airSpeed = hs;
    else if (this.airSpeed > 5) {
      const keep = this.airSpeed * 0.88;
      if (hs < keep && hs > 0.5) {
        const k = keep / hs;
        body.setLinvel({ x: flat.x * k, y: flat.y, z: flat.z * k }, true);
      }
      this.airSpeed = 0;
    }

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
