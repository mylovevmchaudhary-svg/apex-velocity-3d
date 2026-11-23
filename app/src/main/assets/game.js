/**
 * APEX VELOCITY 3D - Car & Bike Racing Game Engine
 * Built with Three.js & Web Audio API
 * Fully optimized for both PC & Mobile
 */

(function () {
  'use strict';

  // ==========================================
  // 1. GAME STATE & CONSTANTS
  // ==========================================
  const VEHICLE_TYPES = { CAR: 'car', BIKE: 'bike' };
  let currentVehicleType = VEHICLE_TYPES.CAR;
  let isGameRunning = false;
  let audioEnabled = true;

  const CONFIG = {
    car: {
      maxSpeed: 72,       // ~260 km/h
      nitroMaxSpeed: 98,  // ~350 km/h
      accel: 30,
      nitroAccel: 60,
      brake: 48,
      drag: 0.985,
      steerSpeed: 2.8,
      driftFactor: 0.92,
      tiltAmount: 0.08
    },
    bike: {
      maxSpeed: 78,       // ~280 km/h
      nitroMaxSpeed: 105, // ~375 km/h
      accel: 38,
      nitroAccel: 70,
      brake: 52,
      drag: 0.982,
      steerSpeed: 3.4,
      driftFactor: 0.90,
      tiltAmount: 0.52    // Moto-GP leaning
    },
    road: {
      width: 24,
      chunkLength: 120,
      chunkCount: 10
    }
  };

  // State variables
  let speed = 0;
  let steering = 0;
  let heading = 0;
  let driftAngle = 0;
  let isDrifting = false;
  let isNitro = false;
  let nitroFuel = 100;
  let distance = 0;
  let score = 0;
  let activeCameraMode = 0; // 0: Chase, 1: Close/Hood

  // Input States
  const inputs = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    handbrake: false,
    nitro: false
  };

  // Three.js Core Objects
  let scene, camera, renderer;
  let playerContainer, carMesh, bikeMesh;
  let activeVehicleMesh;
  let carWheels = [];
  let bikeWheels = [];
  let bikeBodyGroup = null;
  let roadChunks = [];
  let collectibles = [];
  let particleGroup, exhaustParticles = [];

  // ==========================================
  // 2. WEB AUDIO SYNTHESIZER (NO EXTERNAL FILES)
  // ==========================================
  let audioCtx = null;
  let engineOsc1 = null, engineOsc2 = null, engineGain = null, engineFilter = null;
  let driftGain = null, driftNoiseNode = null;
  let nitroGain = null, nitroNoiseNode = null;

  function initAudio() {
    if (audioCtx) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContext();

      const masterComp = audioCtx.createDynamicsCompressor();
      masterComp.connect(audioCtx.destination);

      // --- Engine Synthesizer ---
      engineFilter = audioCtx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 600;

      engineGain = audioCtx.createGain();
      engineGain.gain.value = 0.12;

      engineOsc1 = audioCtx.createOscillator();
      engineOsc1.type = 'sawtooth';
      engineOsc1.frequency.value = 55;

      engineOsc2 = audioCtx.createOscillator();
      engineOsc2.type = 'triangle';
      engineOsc2.frequency.value = 110;

      engineOsc1.connect(engineFilter);
      engineOsc2.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(masterComp);

      engineOsc1.start();
      engineOsc2.start();

      // --- Drift Screech Noise ---
      const bufferSize = audioCtx.sampleRate * 2;
      const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      driftNoiseNode = audioCtx.createBufferSource();
      driftNoiseNode.buffer = noiseBuffer;
      driftNoiseNode.loop = true;

      const driftFilter = audioCtx.createBiquadFilter();
      driftFilter.type = 'bandpass';
      driftFilter.frequency.value = 2400;
      driftFilter.Q.value = 3.0;

      driftGain = audioCtx.createGain();
      driftGain.gain.value = 0.0;

      driftNoiseNode.connect(driftFilter);
      driftFilter.connect(driftGain);
      driftGain.connect(masterComp);
      driftNoiseNode.start();

      // --- Nitro Noise ---
      nitroNoiseNode = audioCtx.createBufferSource();
      nitroNoiseNode.buffer = noiseBuffer;
      nitroNoiseNode.loop = true;

      const nitroFilter = audioCtx.createBiquadFilter();
      nitroFilter.type = 'lowpass';
      nitroFilter.frequency.value = 1200;

      nitroGain = audioCtx.createGain();
      nitroGain.gain.value = 0.0;

      nitroNoiseNode.connect(nitroFilter);
      nitroFilter.connect(nitroGain);
      nitroGain.connect(masterComp);
      nitroNoiseNode.start();
    } catch (e) {
      console.warn('Audio notice:', e);
    }
  }

  function playTone(freq, duration, type = 'sine', volume = 0.2) {
    if (!audioCtx || !audioEnabled) return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(volume, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (err) {}
  }

  function playCoinSound() {
    playTone(784, 0.1, 'sine', 0.25);
    setTimeout(() => playTone(1046, 0.15, 'sine', 0.3), 80);
  }

  function playBoostSound() {
    playTone(440, 0.2, 'sawtooth', 0.3);
    setTimeout(() => playTone(880, 0.3, 'sawtooth', 0.35), 100);
  }

  function updateAudio(gear, rpmNormalized) {
    if (!audioCtx || !audioEnabled) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const baseFreq = currentVehicleType === VEHICLE_TYPES.CAR ? 45 : 65;
    const targetFreq = baseFreq + rpmNormalized * (currentVehicleType === VEHICLE_TYPES.CAR ? 140 : 210);
    engineOsc1.frequency.setTargetAtTime(targetFreq, audioCtx.currentTime, 0.05);
    engineOsc2.frequency.setTargetAtTime(targetFreq * 1.5, audioCtx.currentTime, 0.05);
    engineFilter.frequency.setTargetAtTime(400 + rpmNormalized * 1400, audioCtx.currentTime, 0.05);

    const targetVol = isGameRunning ? 0.12 + Math.abs(speed / 70) * 0.15 : 0.02;
    engineGain.gain.setTargetAtTime(targetVol, audioCtx.currentTime, 0.08);

    const driftVol = isDrifting && Math.abs(speed) > 15 ? 0.22 : 0.0;
    driftGain.gain.setTargetAtTime(driftVol, audioCtx.currentTime, 0.06);

    const nVol = isNitro ? 0.35 : 0.0;
    nitroGain.gain.setTargetAtTime(nVol, audioCtx.currentTime, 0.06);
  }

  // ==========================================
  // 3. 3D MODELS (INDEPENDENT STEERING & ROLLING)
  // ==========================================
  function createWheel(radius, width) {
    const steerPivot = new THREE.Group();
    const rollPivot = new THREE.Group();
    steerPivot.add(rollPivot);

    // Tire
    const tireGeo = new THREE.CylinderGeometry(radius, radius, width, 18);
    tireGeo.rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.9,
      metalness: 0.1
    });
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.castShadow = true;
    rollPivot.add(tire);

    // Rim
    const rimGeo = new THREE.CylinderGeometry(radius * 0.65, radius * 0.65, width * 1.05, 12);
    rimGeo.rotateZ(Math.PI / 2);
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x00f2fe,
      metalness: 0.9,
      roughness: 0.2,
      emissive: 0x003344,
      emissiveIntensity: 0.3
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rollPivot.add(rim);

    steerPivot.userData.rollPivot = rollPivot;
    return steerPivot;
  }

  function buildCarModel() {
    const car = new THREE.Group();
    carWheels = [];

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xe11d48, // Crimson Red Metallic
      metalness: 0.85,
      roughness: 0.22
    });

    const blackTrimMat = new THREE.MeshStandardMaterial({
      color: 0x09090b,
      roughness: 0.5,
      metalness: 0.7
    });

    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.1,
      metalness: 0.95,
      transparent: true,
      opacity: 0.85
    });

    const lightGlowMat = new THREE.MeshStandardMaterial({
      color: 0x00f2fe,
      emissive: 0x00f2fe,
      emissiveIntensity: 1.6
    });

    const tailLightMat = new THREE.MeshStandardMaterial({
      color: 0xff0044,
      emissive: 0xff0033,
      emissiveIntensity: 1.8
    });

    // 1. Lower Chassis
    const baseGeo = new THREE.BoxGeometry(2.1, 0.45, 4.4);
    const base = new THREE.Mesh(baseGeo, bodyMat);
    base.position.y = 0.5;
    base.castShadow = true;
    car.add(base);

    // 2. Cockpit / Roof
    const cabinGeo = new THREE.BoxGeometry(1.6, 0.55, 2.2);
    const cabin = new THREE.Mesh(cabinGeo, bodyMat);
    cabin.position.set(0, 0.95, -0.2);
    cabin.castShadow = true;
    car.add(cabin);

    // 3. Windshield Glass
    const glassGeo = new THREE.BoxGeometry(1.5, 0.45, 2.0);
    const glass = new THREE.Mesh(glassGeo, glassMat);
    glass.position.set(0, 0.98, -0.2);
    car.add(glass);

    // 4. Front Hood & Bumper
    const hoodGeo = new THREE.BoxGeometry(1.9, 0.3, 1.3);
    const hood = new THREE.Mesh(hoodGeo, bodyMat);
    hood.position.set(0, 0.65, 1.4);
    car.add(hood);

    // Splitter
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.6), blackTrimMat);
    splitter.position.set(0, 0.3, 2.15);
    car.add(splitter);

    // 5. Rear Spoiler Wing
    const wingSupportL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.4, 0.2), blackTrimMat);
    wingSupportL.position.set(-0.7, 0.9, -1.9);
    car.add(wingSupportL);

    const wingSupportR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.4, 0.2), blackTrimMat);
    wingSupportR.position.set(0.7, 0.9, -1.9);
    car.add(wingSupportR);

    const spoilerWing = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.4), blackTrimMat);
    spoilerWing.position.set(0, 1.1, -1.95);
    car.add(spoilerWing);

    // 6. Headlights & Taillights
    const headL = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.1), lightGlowMat);
    headL.position.set(-0.75, 0.6, 2.2);
    car.add(headL);

    const headR = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.1), lightGlowMat);
    headR.position.set(0.75, 0.6, 2.2);
    car.add(headR);

    const tailBar = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.1), tailLightMat);
    tailBar.position.set(0, 0.62, -2.21);
    car.add(tailBar);

    // 7. Four Wheels (with independent roll and steer pivots)
    const wheelRadius = 0.42;
    const wheelWidth = 0.32;
    const wheelX = 1.05;
    const wheelZFront = 1.35;
    const wheelZRear = -1.35;

    const wFL = createWheel(wheelRadius, wheelWidth);
    wFL.position.set(-wheelX, wheelRadius, wheelZFront);
    car.add(wFL);

    const wFR = createWheel(wheelRadius, wheelWidth);
    wFR.position.set(wheelX, wheelRadius, wheelZFront);
    car.add(wFR);

    const wRL = createWheel(wheelRadius, wheelWidth);
    wRL.position.set(-wheelX, wheelRadius, wheelZRear);
    car.add(wRL);

    const wRR = createWheel(wheelRadius, wheelWidth);
    wRR.position.set(wheelX, wheelRadius, wheelZRear);
    car.add(wRR);

    carWheels.push(wFL, wFR, wRL, wRR);

    return car;
  }

  function buildBikeModel() {
    const bike = new THREE.Group();
    bikeWheels = [];

    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x10b981, // Emerald Green Superbike
      metalness: 0.8,
      roughness: 0.2
    });

    const darkMetal = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      metalness: 0.9,
      roughness: 0.3
    });

    const neonLightMat = new THREE.MeshStandardMaterial({
      color: 0x34d399,
      emissive: 0x10b981,
      emissiveIntensity: 1.8
    });

    // Tiltable Body Group (leaned during turn)
    bikeBodyGroup = new THREE.Group();
    bike.add(bikeBodyGroup);

    // 1. Sleek Frame
    const tankGeo = new THREE.BoxGeometry(0.5, 0.45, 1.2);
    const tank = new THREE.Mesh(tankGeo, frameMat);
    tank.position.set(0, 0.85, 0.1);
    tank.castShadow = true;
    bikeBodyGroup.add(tank);

    // Front Fairing
    const fairingGeo = new THREE.ConeGeometry(0.35, 0.9, 4);
    fairingGeo.rotateX(-Math.PI / 2);
    const fairing = new THREE.Mesh(fairingGeo, frameMat);
    fairing.position.set(0, 0.8, 0.85);
    bikeBodyGroup.add(fairing);

    // Windscreen
    const screenGeo = new THREE.BoxGeometry(0.3, 0.3, 0.4);
    const screen = new THREE.Mesh(screenGeo, darkMetal);
    screen.position.set(0, 1.05, 0.7);
    bikeBodyGroup.add(screen);

    // Headlight
    const bLight = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.1, 0.1), neonLightMat);
    bLight.position.set(0, 0.75, 1.3);
    bikeBodyGroup.add(bLight);

    // Handlebars
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9), darkMetal);
    bar.rotateZ(Math.PI / 2);
    bar.position.set(0, 0.95, 0.65);
    bikeBodyGroup.add(bar);

    // Exhaust Pipe
    const bExhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.1), darkMetal);
    bExhaust.rotateX(Math.PI / 2 + 0.2);
    bExhaust.position.set(0.3, 0.45, -0.6);
    bikeBodyGroup.add(bExhaust);

    // 2. Rider Figure (Low-poly racing posture)
    const suitMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: 0x10b981, metalness: 0.8, roughness: 0.2 });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.7), suitMat);
    torso.position.set(0, 1.05, -0.15);
    torso.rotation.x = -0.4;
    bikeBodyGroup.add(torso);

    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), helmetMat);
    helmet.position.set(0, 1.32, 0.15);
    bikeBodyGroup.add(helmet);

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 0.15), darkMetal);
    visor.position.set(0, 1.33, 0.28);
    bikeBodyGroup.add(visor);

    // 3. Front & Rear Wheels
    const wheelRad = 0.44;
    const wheelThick = 0.18;

    const wFront = createWheel(wheelRad, wheelThick);
    wFront.position.set(0, wheelRad, 1.2);
    bike.add(wFront);

    const wRear = createWheel(wheelRad, wheelThick);
    wRear.position.set(0, wheelRad, -1.05);
    bike.add(wRear);

    bikeWheels.push(wFront, wRear);

    return bike;
  }

  // ==========================================
  // 4. ROAD, SCENERY & COLLECTIBLES GENERATOR
  // ==========================================
  function createRoadChunk(zPos) {
    const chunk = new THREE.Group();
    chunk.position.z = zPos;

    // Asphalt Main Highway
    const roadGeo = new THREE.PlaneGeometry(CONFIG.road.width, CONFIG.road.chunkLength);
    roadGeo.rotateX(-Math.PI / 2);
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.85,
      metalness: 0.1
    });
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.receiveShadow = true;
    chunk.add(road);

    // White Center Dashes
    const dashLength = 6;
    const dashCount = Math.floor(CONFIG.road.chunkLength / (dashLength * 2));
    for (let i = 0; i < dashCount; i++) {
      const dash = new THREE.Mesh(
        new THREE.PlaneGeometry(0.35, dashLength),
        new THREE.MeshBasicMaterial({ color: 0xf1f5f9 })
      );
      dash.rotateX(-Math.PI / 2);
      dash.position.set(0, 0.02, -CONFIG.road.chunkLength / 2 + i * dashLength * 2 + dashLength);
      chunk.add(dash);
    }

    // Curbs (Red & White Racing Kerbs)
    const curbGeo = new THREE.BoxGeometry(0.8, 0.2, CONFIG.road.chunkLength);
    const curbMatL = new THREE.MeshStandardMaterial({ color: 0xe11d48, roughness: 0.7 });
    const curbMatR = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.7 });

    const curbL = new THREE.Mesh(curbGeo, curbMatL);
    curbL.position.set(-CONFIG.road.width / 2 - 0.4, 0.1, 0);
    chunk.add(curbL);

    const curbR = new THREE.Mesh(curbGeo, curbMatR);
    curbR.position.set(CONFIG.road.width / 2 + 0.4, 0.1, 0);
    chunk.add(curbR);

    // Guard Rails (Metallic)
    const railGeo = new THREE.BoxGeometry(0.3, 0.8, CONFIG.road.chunkLength);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.3 });

    const railL = new THREE.Mesh(railGeo, railMat);
    railL.position.set(-CONFIG.road.width / 2 - 1.0, 0.4, 0);
    chunk.add(railL);

    const railR = new THREE.Mesh(railGeo, railMat);
    railR.position.set(CONFIG.road.width / 2 + 1.0, 0.4, 0);
    chunk.add(railR);

    // Side Neon Lamp Posts
    const postGeo = new THREE.CylinderGeometry(0.12, 0.12, 5.5);
    const lampArmGeo = new THREE.BoxGeometry(2.0, 0.12, 0.12);
    const lampGlowMat = new THREE.MeshBasicMaterial({ color: 0x00f2fe });

    for (let p = -CONFIG.road.chunkLength / 2 + 20; p < CONFIG.road.chunkLength / 2; p += 40) {
      const postL = new THREE.Mesh(postGeo, railMat);
      postL.position.set(-CONFIG.road.width / 2 - 2.5, 2.75, p);
      chunk.add(postL);

      const armL = new THREE.Mesh(lampArmGeo, railMat);
      armL.position.set(-CONFIG.road.width / 2 - 1.5, 5.4, p);
      chunk.add(armL);

      const bulbL = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.2, 0.4), lampGlowMat);
      bulbL.position.set(-CONFIG.road.width / 2 - 0.7, 5.3, p);
      chunk.add(bulbL);

      const postR = new THREE.Mesh(postGeo, railMat);
      postR.position.set(CONFIG.road.width / 2 + 2.5, 2.75, p);
      chunk.add(postR);

      const armR = new THREE.Mesh(lampArmGeo, railMat);
      armR.position.set(CONFIG.road.width / 2 + 1.5, 5.4, p);
      chunk.add(armR);

      const bulbR = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.2, 0.4), lampGlowMat);
      bulbR.position.set(CONFIG.road.width / 2 + 0.7, 5.3, p);
      chunk.add(bulbR);
    }

    // Buildings & City Scenery
    for (let b = 0; b < 4; b++) {
      const bHeight = 15 + Math.random() * 35;
      const bWidth = 10 + Math.random() * 15;
      const bDepth = 12 + Math.random() * 18;
      const bGeo = new THREE.BoxGeometry(bWidth, bHeight, bDepth);
      const bMat = new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        roughness: 0.9,
        metalness: 0.3
      });

      const buildingL = new THREE.Mesh(bGeo, bMat);
      buildingL.position.set(
        -CONFIG.road.width / 2 - 15 - Math.random() * 20,
        bHeight / 2,
        -CONFIG.road.chunkLength / 2 + b * 30 + 10
      );
      chunk.add(buildingL);

      const buildingR = new THREE.Mesh(bGeo, bMat);
      buildingR.position.set(
        CONFIG.road.width / 2 + 15 + Math.random() * 20,
        bHeight / 2,
        -CONFIG.road.chunkLength / 2 + b * 30 + 10
      );
      chunk.add(buildingR);
    }

    // Collectibles in this chunk
    spawnChunkItems(chunk);

    scene.add(chunk);
    return chunk;
  }

  function spawnChunkItems(chunk) {
    const coinMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0xd97706,
      emissiveIntensity: 0.8,
      metalness: 0.9,
      roughness: 0.1
    });

    const boostMat = new THREE.MeshStandardMaterial({
      color: 0x00f2fe,
      emissive: 0x00f2fe,
      emissiveIntensity: 1.6
    });

    // Gold Coins
    for (let i = 0; i < 3; i++) {
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.15, 16), coinMat);
      coin.rotateZ(Math.PI / 2);
      const laneX = (Math.random() - 0.5) * (CONFIG.road.width - 6);
      const zOffset = -CONFIG.road.chunkLength / 2 + i * 35 + 15;
      coin.position.set(laneX, 0.8, zOffset);
      coin.userData = { type: 'coin' };
      chunk.add(coin);
      collectibles.push(coin);
    }

    // Nitro Boost Pads
    if (Math.random() > 0.4) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.05, 5.0), boostMat);
      const laneX = (Math.random() - 0.5) * (CONFIG.road.width - 8);
      pad.position.set(laneX, 0.05, 0);
      pad.userData = { type: 'boost' };
      chunk.add(pad);
      collectibles.push(pad);
    }
  }

  // ==========================================
  // 5. PARTICLE EFFECTS (SMOKE & NITRO FLAME)
  // ==========================================
  function initParticles() {
    particleGroup = new THREE.Group();
    scene.add(particleGroup);

    const pGeo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
    const pMat = new THREE.MeshBasicMaterial({ color: 0x00f2fe, transparent: true, opacity: 0.8 });

    for (let i = 0; i < 40; i++) {
      const p = new THREE.Mesh(pGeo, pMat.clone());
      p.visible = false;
      p.userData = { life: 0, maxLife: 1, vel: new THREE.Vector3() };
      particleGroup.add(p);
      exhaustParticles.push(p);
    }
  }

  function emitExhaustParticle(pos, isNitroBoost) {
    for (let i = 0; i < exhaustParticles.length; i++) {
      const p = exhaustParticles[i];
      if (!p.visible) {
        p.visible = true;
        p.position.copy(pos);
        p.userData.life = 0;
        p.userData.maxLife = isNitroBoost ? 0.35 : 0.6;

        if (isNitroBoost) {
          p.material.color.setHex(Math.random() > 0.5 ? 0x00f2fe : 0xff0066);
          p.scale.setScalar(1.5);
          p.userData.vel.set((Math.random() - 0.5) * 0.8, Math.random() * 0.4, (Math.random() - 0.5) * 0.8);
        } else {
          p.material.color.setHex(0x71717a);
          p.scale.setScalar(0.9);
          p.userData.vel.set((Math.random() - 0.5) * 0.4, Math.random() * 0.3 + 0.2, (Math.random() - 0.5) * 0.4);
        }
        break;
      }
    }
  }

  function updateParticles(dt) {
    for (let i = 0; i < exhaustParticles.length; i++) {
      const p = exhaustParticles[i];
      if (p.visible) {
        p.userData.life += dt;
        if (p.userData.life >= p.userData.maxLife) {
          p.visible = false;
        } else {
          p.position.addScaledVector(p.userData.vel, dt * 10);
          p.material.opacity = 1 - p.userData.life / p.userData.maxLife;
        }
      }
    }
  }

  // ==========================================
  // 6. INITIALIZATION & SETUP
  // ==========================================
  function init() {
    const container = document.getElementById('game-container');

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0f1d);
    scene.fog = new THREE.FogExp2(0x0a0f1d, 0.0035);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 600);
    camera.position.set(0, 4, -8);

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);

    const hemiLight = new THREE.HemisphereLight(0x38bdf8, 0x0f172a, 0.8);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xffedd5, 1.4);
    sunLight.position.set(40, 60, 30);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 150;
    sunLight.shadow.camera.left = -25;
    sunLight.shadow.camera.right = 25;
    sunLight.shadow.camera.top = 25;
    sunLight.shadow.camera.bottom = -25;
    scene.add(sunLight);

    playerContainer = new THREE.Group();
    scene.add(playerContainer);

    carMesh = buildCarModel();
    bikeMesh = buildBikeModel();
    playerContainer.add(carMesh);
    playerContainer.add(bikeMesh);

    setVehicle(currentVehicleType);

    for (let i = 0; i < CONFIG.road.chunkCount; i++) {
      const z = i * CONFIG.road.chunkLength - CONFIG.road.chunkLength;
      roadChunks.push(createRoadChunk(z));
    }

    initParticles();
    setupInputListeners();
    setupUIListeners();
    window.addEventListener('resize', onWindowResize);

    lastTime = performance.now();
    requestAnimationFrame(animate);
  }

  function setVehicle(type) {
    currentVehicleType = type;
    if (type === VEHICLE_TYPES.CAR) {
      carMesh.visible = true;
      bikeMesh.visible = false;
      activeVehicleMesh = carMesh;
      document.getElementById('vehicle-name').innerText = 'CAR';
      document.getElementById('vehicle-icon').innerText = '🏎️';
    } else {
      carMesh.visible = false;
      bikeMesh.visible = true;
      activeVehicleMesh = bikeMesh;
      document.getElementById('vehicle-name').innerText = 'BIKE';
      document.getElementById('vehicle-icon').innerText = '🏍️';
    }
  }

  function switchVehicle() {
    const nextType = currentVehicleType === VEHICLE_TYPES.CAR ? VEHICLE_TYPES.BIKE : VEHICLE_TYPES.CAR;
    setVehicle(nextType);
    showAnnouncement(nextType === VEHICLE_TYPES.CAR ? '🏎️ APEX GT READY!' : '🏍️ VIPER RR READY!');
    playBoostSound();
  }

  // ==========================================
  // 7. INPUT HANDLING (PC KEYBOARD & MOBILE TOUCH)
  // ==========================================
  function setupInputListeners() {
    window.addEventListener('keydown', (e) => {
      initAudio();
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          inputs.forward = true;
          break;
        case 'KeyS':
        case 'ArrowDown':
          inputs.backward = true;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          inputs.left = true;
          break;
        case 'KeyD':
        case 'ArrowRight':
          inputs.right = true;
          break;
        case 'Space':
          inputs.handbrake = true;
          e.preventDefault();
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          inputs.nitro = true;
          break;
        case 'KeyV':
          switchVehicle();
          break;
        case 'KeyC':
          toggleCamera();
          break;
        case 'KeyR':
          resetVehicle();
          break;
      }
    });

    window.addEventListener('keyup', (e) => {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          inputs.forward = false;
          break;
        case 'KeyS':
        case 'ArrowDown':
          inputs.backward = false;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          inputs.left = false;
          break;
        case 'KeyD':
        case 'ArrowRight':
          inputs.right = false;
          break;
        case 'Space':
          inputs.handbrake = false;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          inputs.nitro = false;
          break;
      }
    });

    const bindTouch = (id, prop) => {
      const el = document.getElementById(id);
      if (!el) return;

      const activate = (e) => {
        e.preventDefault();
        initAudio();
        inputs[prop] = true;
        el.classList.add('pressed');
      };

      const deactivate = (e) => {
        e.preventDefault();
        inputs[prop] = false;
        el.classList.remove('pressed');
      };

      el.addEventListener('touchstart', activate, { passive: false });
      el.addEventListener('touchend', deactivate, { passive: false });
      el.addEventListener('touchcancel', deactivate, { passive: false });
      el.addEventListener('mousedown', activate);
      el.addEventListener('mouseup', deactivate);
      el.addEventListener('mouseleave', deactivate);
    };

    bindTouch('touch-left', 'left');
    bindTouch('touch-right', 'right');
    bindTouch('touch-gas', 'forward');
    bindTouch('touch-brake', 'backward');
    bindTouch('touch-drift', 'handbrake');
    bindTouch('touch-nitro', 'nitro');
  }

  function setupUIListeners() {
    document.getElementById('start-btn').addEventListener('click', () => {
      initAudio();
      document.getElementById('start-screen').classList.add('hidden');
      isGameRunning = true;
      showAnnouncement('GO! 🏁');
      playBoostSound();
    });

    const carPickBtn = document.getElementById('pick-car-btn');
    const bikePickBtn = document.getElementById('pick-bike-btn');

    carPickBtn.addEventListener('click', () => {
      carPickBtn.classList.add('active');
      bikePickBtn.classList.remove('active');
      setVehicle(VEHICLE_TYPES.CAR);
    });

    bikePickBtn.addEventListener('click', () => {
      bikePickBtn.classList.add('active');
      carPickBtn.classList.remove('active');
      setVehicle(VEHICLE_TYPES.BIKE);
    });

    document.getElementById('btn-switch-vehicle').addEventListener('click', () => {
      initAudio();
      switchVehicle();
    });

    document.getElementById('btn-toggle-cam').addEventListener('click', () => {
      toggleCamera();
    });

    const audioBtn = document.getElementById('btn-audio');
    audioBtn.addEventListener('click', () => {
      audioEnabled = !audioEnabled;
      audioBtn.innerText = audioEnabled ? '🔊' : '🔇';
      if (!audioEnabled && audioCtx) {
        audioCtx.suspend();
      } else if (audioEnabled && audioCtx) {
        audioCtx.resume();
      }
    });
  }

  function toggleCamera() {
    activeCameraMode = (activeCameraMode + 1) % 2;
    showAnnouncement(activeCameraMode === 0 ? '📷 CHASE CAM' : '📷 HOOD CAM');
  }

  function resetVehicle() {
    playerContainer.position.x = 0;
    speed = 0;
    steering = 0;
    heading = 0;
    driftAngle = 0;
    showAnnouncement('VEHICLE RESET 🔄');
  }

  function showAnnouncement(text) {
    const el = document.getElementById('announcement');
    el.innerText = text;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
      el.classList.remove('show');
    }, 1400);
  }

  function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ==========================================
  // 8. GAME LOOP & VEHICLE PHYSICS
  // ==========================================
  let lastTime = 0;

  function animate(now) {
    requestAnimationFrame(animate);
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    if (isGameRunning) {
      updatePhysics(dt);
      updateRoadAndCollectibles(dt);
      updateParticles(dt);
      updateHUD();
    }

    updateCamera(dt);
    renderer.render(scene, camera);
  }

  function updatePhysics(dt) {
    const cfg = currentVehicleType === VEHICLE_TYPES.CAR ? CONFIG.car : CONFIG.bike;

    // Nitro Logic
    isNitro = inputs.nitro && nitroFuel > 5 && speed > 5;
    if (isNitro) {
      nitroFuel = Math.max(0, nitroFuel - dt * 30);
    } else {
      nitroFuel = Math.min(100, nitroFuel + dt * 8);
    }

    // Acceleration & Braking
    const maxSpd = isNitro ? cfg.nitroMaxSpeed : cfg.maxSpeed;
    const accelRate = isNitro ? cfg.nitroAccel : cfg.accel;

    if (inputs.forward) {
      speed += accelRate * dt;
      if (speed > maxSpd) speed = maxSpd;
    } else if (inputs.backward) {
      if (speed > 0) {
        speed -= cfg.brake * dt;
        if (speed < 0) speed = 0;
      } else {
        speed -= cfg.accel * 0.4 * dt;
        if (speed < -15) speed = -15;
      }
    } else {
      speed *= Math.pow(cfg.drag, dt * 60);
      if (Math.abs(speed) < 0.2) speed = 0;
    }

    // Steering (Left = -1, Right = +1)
    isDrifting = inputs.handbrake && Math.abs(speed) > 12;

    let targetSteering = 0;
    if (inputs.left) targetSteering -= 1;
    if (inputs.right) targetSteering += 1;

    const steerSmoothing = targetSteering !== 0 ? cfg.steerSpeed : cfg.steerSpeed * 2.5;
    steering += (targetSteering - steering) * steerSmoothing * dt;

    // Heading update
    const speedFactor = Math.min(Math.abs(speed) / 25, 1.2);
    heading += steering * (isDrifting ? 1.6 : 1.0) * speedFactor * dt * 0.9;

    // Drift Angle
    if (isDrifting) {
      driftAngle += (steering * 0.45 - driftAngle) * dt * 4;
      score += Math.floor(Math.abs(speed) * dt * 10);
    } else {
      driftAngle += (0 - driftAngle) * dt * 6;
    }

    // Position Update (Along +Z forward)
    const forwardX = Math.sin(heading + driftAngle);
    const forwardZ = Math.cos(heading + driftAngle);

    playerContainer.position.x += forwardX * speed * dt;
    playerContainer.position.z += forwardZ * speed * dt;

    // Road Bounds Check
    const maxRoadX = CONFIG.road.width / 2 - 1.2;
    if (Math.abs(playerContainer.position.x) > maxRoadX) {
      playerContainer.position.x = Math.sign(playerContainer.position.x) * maxRoadX;
      speed *= 0.88;
      playTone(200, 0.08, 'square', 0.15);
    }

    // Vehicle Visual Orientations
    playerContainer.rotation.y = heading + driftAngle;

    // Tilt (Car rolls slightly, Bike leans deep into corner)
    if (currentVehicleType === VEHICLE_TYPES.CAR) {
      carMesh.rotation.z = -steering * cfg.tiltAmount;
    } else if (bikeBodyGroup) {
      bikeBodyGroup.rotation.z = -steering * cfg.tiltAmount;
    }

    // Wheel Rotations
    const wheelRotSpeed = (speed * dt) / 0.4;
    const activeWheels = currentVehicleType === VEHICLE_TYPES.CAR ? carWheels : bikeWheels;
    for (let i = 0; i < activeWheels.length; i++) {
      if (activeWheels[i].userData.rollPivot) {
        activeWheels[i].userData.rollPivot.rotation.x += wheelRotSpeed;
      }
    }

    // Front wheel steering turn
    if (currentVehicleType === VEHICLE_TYPES.CAR) {
      carWheels[0].rotation.y = steering * 0.4;
      carWheels[1].rotation.y = steering * 0.4;
    } else {
      bikeWheels[0].rotation.y = steering * 0.35;
    }

    // Exhaust Particle Emission
    if (speed > 5) {
      const exhaustZ = playerContainer.position.z - Math.cos(heading) * 2.2;
      const exhaustX = playerContainer.position.x - Math.sin(heading) * 2.2;
      emitExhaustParticle(new THREE.Vector3(exhaustX, 0.45, exhaustZ), isNitro);
    }

    // Distance & Score increment
    distance += (speed * dt) / 1000;
    score += Math.floor(speed * dt * 0.5);
  }

  function updateRoadAndCollectibles(dt) {
    const playerZ = playerContainer.position.z;

    // Recycle chunks behind player
    for (let i = 0; i < roadChunks.length; i++) {
      const chunk = roadChunks[i];
      if (chunk.position.z < playerZ - CONFIG.road.chunkLength * 1.5) {
        let maxZ = -Infinity;
        for (let j = 0; j < roadChunks.length; j++) {
          if (roadChunks[j].position.z > maxZ) maxZ = roadChunks[j].position.z;
        }
        chunk.position.z = maxZ + CONFIG.road.chunkLength;

        // Reset visibility of collectibles in recycled chunk
        for (let c = 0; c < chunk.children.length; c++) {
          const child = chunk.children[c];
          if (child.userData && (child.userData.type === 'coin' || child.userData.type === 'boost')) {
            child.visible = true;
          }
        }
      }
    }

    // Rotate and Check Collectibles
    for (let i = 0; i < collectibles.length; i++) {
      const item = collectibles[i];
      if (!item.visible) continue;

      if (item.userData.type === 'coin') {
        item.rotation.y += dt * 3.5;
      }

      const itemWorldPos = new THREE.Vector3();
      item.getWorldPosition(itemWorldPos);

      const dist = itemWorldPos.distanceTo(playerContainer.position);
      if (dist < 2.5) {
        item.visible = false;
        if (item.userData.type === 'coin') {
          score += 150;
          playCoinSound();
          showAnnouncement('+150 GOLD COIN! 🪙');
        } else if (item.userData.type === 'boost') {
          speed = Math.min(speed + 35, 110);
          nitroFuel = 100;
          playBoostSound();
          showAnnouncement('⚡ MEGA BOOST! ⚡');
        }
      }
    }
  }

  function updateCamera(dt) {
    const target = playerContainer.position;
    const fovTarget = isNitro ? 72 : 60;
    camera.fov += (fovTarget - camera.fov) * dt * 4;
    camera.updateProjectionMatrix();

    if (activeCameraMode === 0) {
      // Dynamic Chase Cam
      const camDist = currentVehicleType === VEHICLE_TYPES.CAR ? 7.5 : 6.0;
      const camHeight = currentVehicleType === VEHICLE_TYPES.CAR ? 3.4 : 2.8;

      const idealOffset = new THREE.Vector3(
        -Math.sin(heading) * camDist,
        camHeight,
        -Math.cos(heading) * camDist
      );

      const targetCamPos = target.clone().add(idealOffset);
      camera.position.lerp(targetCamPos, dt * 8);

      const lookTarget = target.clone().add(new THREE.Vector3(Math.sin(heading) * 8, 1.2, Math.cos(heading) * 8));
      camera.lookAt(lookTarget);
    } else {
      // Hood Cam
      const hoodOffset = new THREE.Vector3(Math.sin(heading) * 0.8, 1.1, Math.cos(heading) * 0.8);
      camera.position.copy(target).add(hoodOffset);

      const lookTarget = target.clone().add(new THREE.Vector3(Math.sin(heading) * 30, 0.8, Math.cos(heading) * 30));
      camera.lookAt(lookTarget);
    }
  }

  // ==========================================
  // 9. HUD & GAUGES
  // ==========================================
  function updateHUD() {
    const kmh = Math.max(0, Math.floor(speed * 3.6));
    document.getElementById('speed-display').innerText = kmh;
    document.getElementById('score-display').innerText = score;
    document.getElementById('dist-display').innerText = distance.toFixed(1) + ' km';

    let gear = 1;
    let rpmNorm = 0.2;

    if (kmh > 0) {
      if (kmh < 45) { gear = 1; rpmNorm = kmh / 45; }
      else if (kmh < 90) { gear = 2; rpmNorm = (kmh - 45) / 45; }
      else if (kmh < 150) { gear = 3; rpmNorm = (kmh - 90) / 60; }
      else if (kmh < 220) { gear = 4; rpmNorm = (kmh - 150) / 70; }
      else if (kmh < 290) { gear = 5; rpmNorm = (kmh - 220) / 70; }
      else { gear = 6; rpmNorm = Math.min((kmh - 290) / 80, 1.0); }
    }

    document.getElementById('gear-display').innerText = speed < -0.5 ? 'R' : gear;
    document.getElementById('rpm-bar').style.width = Math.min(Math.max(rpmNorm * 100, 8), 100) + '%';
    document.getElementById('nitro-bar').style.width = nitroFuel + '%';

    updateAudio(gear, rpmNorm);
  }

  window.addEventListener('DOMContentLoaded', init);
})();
