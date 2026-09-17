/* =====================================================================
   ANONYMOUS — SURVIVAL
   game.js — Three.js world engine: lighting, terrain, house, player,
   third-person camera, and touch controls hookup.

   Exposes window.GAME = { init, start, stop, setMove, setLook, jump,
   applySettings, onResize }

   Degrades gracefully (no-op API) if THREE failed to load, e.g. the
   player is offline and the CDN script did not arrive — the rest of
   the UI (menus, settings, timer) keeps working either way.
   ===================================================================== */

(function () {
  'use strict';

  if (typeof THREE === 'undefined') {
    window.GAME = {
      init: function () {},
      start: function () {},
      stop: function () {},
      setMove: function () {},
      setLook: function () {},
      jump: function () {},
      applySettings: function () {},
      onResize: function () {}
    };
    return;
  }

  /* -------------------------------------------------------------------
     CONSTANTS
     ------------------------------------------------------------------- */
  var TERRAIN_SIZE = 220;
  var TERRAIN_SEGMENTS = 50;
  var TERRAIN_HALF = TERRAIN_SIZE / 2 - 2;
  var GRAVITY = 16;
  var JUMP_SPEED = 6.2;
  var MOVE_SPEED = 4.2;
  var CAM_DISTANCE = 5.5;
  var CAM_HEIGHT = 2.6;
  var HOUSE_POS = { x: 14, z: -18 };
  var HOUSE_HALF = { x: 4.6, z: 3.6 };

  /* -------------------------------------------------------------------
     SHARED TERRAIN HEIGHT FUNCTION
     ------------------------------------------------------------------- */
  function heightAt(x, z) {
    return (
      Math.sin(x * 0.08) * 0.6 +
      Math.cos(z * 0.1) * 0.5 +
      Math.sin((x + z) * 0.05) * 0.4
    );
  }

  /* -------------------------------------------------------------------
     PROCEDURAL TEXTURES (grayscale only)
     ------------------------------------------------------------------- */
  function makeGrassTexture() {
    var size = 128;
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#5c5f58';
    ctx.fillRect(0, 0, size, size);
    for (var i = 0; i < 2200; i++) {
      var shade = 60 + Math.floor(Math.random() * 60);
      ctx.fillStyle = 'rgb(' + shade + ',' + (shade + 6) + ',' + shade + ')';
      var x = Math.random() * size;
      var y = Math.random() * size;
      var w = 1 + Math.random() * 2;
      var h = 2 + Math.random() * 4;
      ctx.fillRect(x, y, w, h);
    }
    var tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(26, 26);
    return tex;
  }

  function makeWoodTexture(darkness) {
    var w = 128, h = 128;
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    var base = darkness ? 55 : 95;
    ctx.fillStyle = 'rgb(' + base + ',' + base + ',' + base + ')';
    ctx.fillRect(0, 0, w, h);
    var plankHeight = h / 6;
    for (var p = 0; p < 6; p++) {
      var y = p * plankHeight;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, y, w, 2);
      for (var g = 0; g < 40; g++) {
        var shade = base + Math.floor(Math.random() * 18 - 9);
        ctx.fillStyle = 'rgba(' + shade + ',' + shade + ',' + shade + ',0.5)';
        var gx = Math.random() * w;
        var gh = plankHeight * 0.8;
        ctx.fillRect(gx, y + plankHeight * 0.1, 1, gh);
      }
    }
    var tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 2);
    return tex;
  }

  /* -------------------------------------------------------------------
     ENGINE STATE
     ------------------------------------------------------------------- */
  var renderer, scene, camera, clock;
  var terrainMesh;
  var player, leftShoulder, rightShoulder, leftHip, rightHip;
  var directionalLight;
  var canvasEl;

  var running = false;
  var rafId = null;

  var input = {
    moveX: 0, /* strafe, -1..1 */
    moveY: 0, /* forward(-1)/back(1) */
    lookDeltaAccum: 0
  };

  var camYaw = 0;
  var sensitivity = 0.0035; /* radians per pixel, scaled by settings */

  var playerState = {
    x: 0,
    z: 6,
    velY: 0,
    grounded: true,
    facing: 0,
    walkPhase: 0,
    lastFootstepSign: 1
  };

  /* -------------------------------------------------------------------
     SCENE SETUP
     ------------------------------------------------------------------- */
  function buildScene() {
    scene = new THREE.Scene();
    var fogColor = 0x07070a;
    scene.background = new THREE.Color(fogColor);
    scene.fog = new THREE.FogExp2(fogColor, 0.025);

    var ambient = new THREE.AmbientLight(0xffffff, 0.38);
    scene.add(ambient);

    directionalLight = new THREE.DirectionalLight(0xffffff, 0.65);
    directionalLight.position.set(-30, 40, 20);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.set(1024, 1024);
    directionalLight.shadow.camera.near = 1;
    directionalLight.shadow.camera.far = 120;
    directionalLight.shadow.camera.left = -40;
    directionalLight.shadow.camera.right = 40;
    directionalLight.shadow.camera.top = 40;
    directionalLight.shadow.camera.bottom = -40;
    scene.add(directionalLight);

    buildTerrain();
    buildHouse();
    buildPlayer();
  }

  function buildTerrain() {
    var geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    var pos = geo.attributes.position;
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i);
      var z = pos.getZ(i);
      pos.setY(i, heightAt(x, z));
    }
    geo.computeVertexNormals();

    var mat = new THREE.MeshStandardMaterial({
      map: makeGrassTexture(),
      roughness: 1,
      metalness: 0
    });
    terrainMesh = new THREE.Mesh(geo, mat);
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);
  }

  function buildHouse() {
    var group = new THREE.Group();
    var baseY = heightAt(HOUSE_POS.x, HOUSE_POS.z);

    var wallTex = makeWoodTexture(false);
    var wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95 });
    var wallsGeo = new THREE.BoxGeometry(HOUSE_HALF.x * 2, 4, HOUSE_HALF.z * 2);
    var walls = new THREE.Mesh(wallsGeo, wallMat);
    walls.position.y = baseY + 2;
    walls.castShadow = true;
    walls.receiveShadow = true;
    group.add(walls);

    var roofTex = makeWoodTexture(true);
    var roofMat = new THREE.MeshStandardMaterial({ map: roofTex, roughness: 1 });
    var slopeWidth = Math.sqrt(HOUSE_HALF.x * HOUSE_HALF.x + 1.6 * 1.6) + 0.4;
    var roofGeoA = new THREE.BoxGeometry(slopeWidth, 0.2, HOUSE_HALF.z * 2 + 0.6);
    var roofA = new THREE.Mesh(roofGeoA, roofMat);
    var roofAngle = Math.atan2(1.6, HOUSE_HALF.x);
    roofA.rotation.z = roofAngle;
    roofA.position.set(-HOUSE_HALF.x / 2 + 0.2, baseY + 4 + 0.8, 0);
    roofA.castShadow = true;
    group.add(roofA);

    var roofB = new THREE.Mesh(roofGeoA, roofMat);
    roofB.rotation.z = -roofAngle;
    roofB.position.set(HOUSE_HALF.x / 2 - 0.2, baseY + 4 + 0.8, 0);
    roofB.castShadow = true;
    group.add(roofB);

    var doorMat = new THREE.MeshStandardMaterial({ color: 0x101012, roughness: 0.9 });
    var door = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.1), doorMat);
    door.position.set(0, baseY + 1.05, HOUSE_HALF.z + 0.01);
    group.add(door);

    var glassMat = new THREE.MeshStandardMaterial({ color: 0xd8d8da, roughness: 0.3 });
    var winGeo = new THREE.PlaneGeometry(0.9, 0.9);
    var win1 = new THREE.Mesh(winGeo, glassMat);
    win1.position.set(-1.8, baseY + 2.2, HOUSE_HALF.z + 0.01);
    group.add(win1);
    var win2 = new THREE.Mesh(winGeo, glassMat);
    win2.position.set(1.8, baseY + 2.2, HOUSE_HALF.z + 0.01);
    group.add(win2);

    group.position.set(HOUSE_POS.x, 0, HOUSE_POS.z);
    scene.add(group);
  }

  function buildPlayer() {
    player = new THREE.Group();

    var darkMat = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.8 });
    var midMat = new THREE.MeshStandardMaterial({ color: 0x2c2c2f, roughness: 0.8 });
    var lightMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.6 });

    var legHeight = 1.0;
    var torsoHeight = 1.1;
    var headSize = 0.6;
    var armLength = 0.9;

    var torso = new THREE.Mesh(new THREE.BoxGeometry(0.9, torsoHeight, 0.5), darkMat);
    torso.position.y = legHeight + torsoHeight / 2;
    torso.castShadow = true;
    player.add(torso);

    var head = new THREE.Mesh(new THREE.BoxGeometry(headSize, headSize, headSize), lightMat);
    head.position.y = legHeight + torsoHeight + headSize / 2;
    head.castShadow = true;
    player.add(head);

    leftShoulder = new THREE.Group();
    leftShoulder.position.set(-0.58, legHeight + torsoHeight, 0);
    var leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.25, armLength, 0.25), midMat);
    leftArm.position.y = -armLength / 2;
    leftArm.castShadow = true;
    leftShoulder.add(leftArm);
    player.add(leftShoulder);

    rightShoulder = new THREE.Group();
    rightShoulder.position.set(0.58, legHeight + torsoHeight, 0);
    var rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.25, armLength, 0.25), midMat);
    rightArm.position.y = -armLength / 2;
    rightArm.castShadow = true;
    rightShoulder.add(rightArm);
    player.add(rightShoulder);

    leftHip = new THREE.Group();
    leftHip.position.set(-0.24, legHeight, 0);
    var leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.3, legHeight, 0.3), darkMat);
    leftLeg.position.y = -legHeight / 2;
    leftLeg.castShadow = true;
    leftHip.add(leftLeg);
    player.add(leftHip);

    rightHip = new THREE.Group();
    rightHip.position.set(0.24, legHeight, 0);
    var rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.3, legHeight, 0.3), darkMat);
    rightLeg.position.y = -legHeight / 2;
    rightLeg.castShadow = true;
    rightHip.add(rightLeg);
    player.add(rightHip);

    scene.add(player);
  }

  /* -------------------------------------------------------------------
     COLLISION HELPERS
     ------------------------------------------------------------------- */
  function collidesWithHouse(x, z) {
    var margin = 0.4;
    return (
      x > HOUSE_POS.x - HOUSE_HALF.x - margin &&
      x < HOUSE_POS.x + HOUSE_HALF.x + margin &&
      z > HOUSE_POS.z - HOUSE_HALF.z - margin &&
      z < HOUSE_POS.z + HOUSE_HALF.z + margin
    );
  }

  function clampToTerrain(v) {
    return Math.max(-TERRAIN_HALF, Math.min(TERRAIN_HALF, v));
  }

  /* -------------------------------------------------------------------
     UPDATE LOOP
     ------------------------------------------------------------------- */
  function update(delta) {
    camYaw += input.lookDeltaAccum * sensitivity;
    input.lookDeltaAccum = 0;

    var forwardAmount = -input.moveY;
    var strafeAmount = input.moveX;
    var moving = Math.abs(forwardAmount) > 0.05 || Math.abs(strafeAmount) > 0.05;

    if (moving) {
      var forwardX = Math.sin(camYaw);
      var forwardZ = Math.cos(camYaw);
      var rightX = Math.sin(camYaw + Math.PI / 2);
      var rightZ = Math.cos(camYaw + Math.PI / 2);

      var dirX = forwardX * forwardAmount + rightX * strafeAmount;
      var dirZ = forwardZ * forwardAmount + rightZ * strafeAmount;
      var len = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
      dirX /= len;
      dirZ /= len;

      var speedScale = Math.min(1, Math.sqrt(forwardAmount * forwardAmount + strafeAmount * strafeAmount));
      var step = MOVE_SPEED * speedScale * delta;

      var nextX = clampToTerrain(playerState.x + dirX * step);
      var nextZ = clampToTerrain(playerState.z + dirZ * step);

      if (!collidesWithHouse(nextX, playerState.z)) playerState.x = nextX;
      if (!collidesWithHouse(playerState.x, nextZ)) playerState.z = nextZ;

      playerState.facing = Math.atan2(dirX, dirZ);
      playerState.walkPhase += delta * 9 * speedScale;

      var legAngle = Math.sin(playerState.walkPhase) * 0.6;
      leftHip.rotation.x = legAngle;
      rightHip.rotation.x = -legAngle;
      leftShoulder.rotation.x = -legAngle * 0.8;
      rightShoulder.rotation.x = legAngle * 0.8;

      var sign = legAngle >= 0 ? 1 : -1;
      if (sign !== playerState.lastFootstepSign) {
        playerState.lastFootstepSign = sign;
        if (window.ANONYMOUS_AUDIO) window.ANONYMOUS_AUDIO.footstep();
      }
    } else {
      leftHip.rotation.x *= 0.8;
      rightHip.rotation.x *= 0.8;
      leftShoulder.rotation.x *= 0.8;
      rightShoulder.rotation.x *= 0.8;
    }

    /* gravity + ground snap */
    playerState.velY -= GRAVITY * delta;
    var groundY = heightAt(playerState.x, playerState.z);
    var nextY = (player.position.y || groundY) + playerState.velY * delta;
    if (nextY <= groundY) {
      nextY = groundY;
      playerState.velY = 0;
      playerState.grounded = true;
    } else {
      playerState.grounded = false;
    }

    player.position.set(playerState.x, nextY, playerState.z);
    player.rotation.y = playerState.facing;

    /* third-person camera orbit */
    var camX = playerState.x - Math.sin(camYaw) * CAM_DISTANCE;
    var camZ = playerState.z - Math.cos(camYaw) * CAM_DISTANCE;
    var camY = nextY + CAM_HEIGHT;
    camera.position.set(camX, camY, camZ);
    camera.lookAt(playerState.x, nextY + 1.4, playerState.z);
  }

  function animate() {
    if (!running) return;
    rafId = requestAnimationFrame(animate);
    var delta = Math.min(0.1, clock.getDelta());
    update(delta);
    renderer.render(scene, camera);
  }

  /* -------------------------------------------------------------------
     PUBLIC API
     ------------------------------------------------------------------- */
  function init(canvas) {
    canvasEl = canvas;
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    var w = canvas.clientWidth || window.innerWidth;
    var h = canvas.clientHeight || window.innerHeight;
    camera = new THREE.PerspectiveCamera(62, w / Math.max(1, h), 0.1, 200);

    clock = new THREE.Clock();

    buildScene();
    resize();
  }

  function resize() {
    if (!renderer || !camera || !canvasEl) return;
    var w = canvasEl.clientWidth || window.innerWidth;
    var h = canvasEl.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }

  function start() {
    if (!scene) return;
    playerState.x = 0;
    playerState.z = 6;
    playerState.velY = 0;
    playerState.facing = 0;
    playerState.walkPhase = 0;
    camYaw = 0;
    input.moveX = 0;
    input.moveY = 0;
    input.lookDeltaAccum = 0;
    resize();
    if (!running) {
      running = true;
      clock.getDelta();
      animate();
    }
  }

  function stop() {
    running = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function setMove(x, y) {
    input.moveX = x;
    input.moveY = y;
  }

  function setLook(deltaX) {
    input.lookDeltaAccum += deltaX;
  }

  function jump() {
    if (playerState.grounded) {
      playerState.velY = JUMP_SPEED;
      playerState.grounded = false;
    }
  }

  function applySettings(settings) {
    if (!settings) return;
    if (typeof settings.sensitivity === 'number') {
      sensitivity = 0.0018 + (settings.sensitivity / 100) * 0.0055;
    }
    if (typeof settings.shadows === 'boolean' && renderer) {
      renderer.shadowMap.enabled = settings.shadows;
    }
  }

  window.GAME = {
    init: init,
    start: start,
    stop: stop,
    setMove: setMove,
    setLook: setLook,
    jump: jump,
    applySettings: applySettings,
    onResize: resize
  };
})();