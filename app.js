/* =====================================================================
   ANONYMOUS — SURVIVAL
   app.js — application state, UI navigation, settings, timer, audio
   ===================================================================== */

(function () {
  'use strict';

  /* -------------------------------------------------------------------
     STORAGE
     ------------------------------------------------------------------- */
  var STORAGE_KEYS = {
    username: 'anon_survival_username',
    settings: 'anon_survival_settings'
  };

  var DEFAULT_SETTINGS = {
    masterVolume: 70,
    music: true,
    sfx: true,
    sensitivity: 55,
    shadows: true
  };

  function storageGet(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw === null || raw === undefined ? fallback : raw;
    } catch (e) {
      return fallback;
    }
  }
  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) {}
  }
  function storageGetJSON(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (e) { return fallback; }
  }
  function storageSetJSON(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  /* -------------------------------------------------------------------
     STATE
     ------------------------------------------------------------------- */
  var state = {
    player: { username: storageGet(STORAGE_KEYS.username, '') },
    settings: Object.assign({}, DEFAULT_SETTINGS, storageGetJSON(STORAGE_KEYS.settings, {})),
    modalMode: 'create',
    timer: { remaining: 120, intervalId: null, running: false },
    gameStarted: false
  };

  var ROUND_SECONDS = 120;
 /* -------------------------------------------------------------------
     ICONS
     ------------------------------------------------------------------- */
  var ICONS = {
    play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 4.5 L19 12 L6 19.5 Z" stroke-linejoin="round"/></svg>',
    profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8.2" r="3.6"/><path d="M4.5 20c1.4-4 4-6 7.5-6s6.1 2 7.5 6"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="2.8"/><path d="M12 3.5v2.4M12 18.1v2.4M20.5 12h-2.4M5.9 12H3.5M17.8 6.2l-1.7 1.7M7.9 16.1l-1.7 1.7M17.8 17.8l-1.7-1.7M7.9 7.9 6.2 6.2"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5.5" y="10.5" width="13" height="9" rx="1"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 5 7 12l7.5 7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    jump: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5" stroke-linecap="round"/><path d="M6 10l6-6 6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  function renderIcons(root) {
    var nodes = (root || document).querySelectorAll('[data-icon]');
    nodes.forEach(function (node) {
      var name = node.getAttribute('data-icon');
      if (ICONS[name] && !node.dataset.iconRendered) {
        node.innerHTML = ICONS[name];
        node.dataset.iconRendered = 'true';
      }
    });
  }

  /* -------------------------------------------------------------------
     PROCEDURAL WEB AUDIO — horror drone + sfx
     ------------------------------------------------------------------- */
  var Audio = {
    ctx: null,
    master: null,
    droneNodes: null,
    droneRunning: false,

    ensureContext: function () {
      if (this.ctx) return;
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = state.settings.masterVolume / 100;
      this.master.connect(this.ctx.destination);
    },

    resume: function () {
      this.ensureContext();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(function () {});
      }
    },

    setMasterVolume: function (percent) {
      if (!this.master) return;
      var vol = Math.min(100, Math.max(0, percent)) / 100;
      try {
        this.master.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.05);
      } catch (e) { this.master.gain.value = vol; }
    },

    startDrone: function () {
      this.ensureContext();
      if (!this.ctx || this.droneRunning) return;
      var ctx = this.ctx;

      var droneGain = ctx.createGain();
      droneGain.gain.value = 0.0001;
      droneGain.connect(this.master);
      droneGain.gain.setTargetAtTime(0.5, ctx.currentTime, 1.2);

      var osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.value = 46;

      var osc2 = ctx.createOscillator();
      osc2.type = 'sawtooth';
      osc2.frequency.value = 46.7;

      var filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 220;
      filter.Q.value = 0.7;

      var lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.06;
      var lfoGain = ctx.createGain();
      lfoGain.gain.value = 80;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(droneGain);

      osc1.start();
      osc2.start();
      lfo.start();

      this.droneNodes = { osc1: osc1, osc2: osc2, lfo: lfo, filter: filter, gain: droneGain };
      this.droneRunning = true;
    },

    stopDrone: function () {
      if (!this.droneRunning || !this.droneNodes) return;
      var ctx = this.ctx;
      var nodes = this.droneNodes;
      try {
        nodes.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
        window.setTimeout(function () {
          try { nodes.osc1.stop(); nodes.osc2.stop(); nodes.lfo.stop(); } catch (e) {}
        }, 900);
      } catch (e) {}
      this.droneNodes = null;
      this.droneRunning = false;
    },

    playClick: function () {
      if (!state.settings.sfx) return;
      this.ensureContext();
      if (!this.ctx) return;
      var ctx = this.ctx;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 720;
      gain.gain.value = 0.001;
      osc.connect(gain);
      gain.connect(this.master);
      var t = ctx.currentTime;
      gain.gain.setValueAtTime(0.09, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      osc.start(t);
      osc.stop(t + 0.09);
    },

    playJump: function () {
      if (!state.settings.sfx) return;
      this.ensureContext();
      if (!this.ctx) return;
      var ctx = this.ctx;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'triangle';
      var t = ctx.currentTime;
      osc.frequency.setValueAtTime(180, t);
      osc.frequency.exponentialRampToValueAtTime(420, t + 0.18);
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t);
      osc.stop(t + 0.24);
    },

    playFootstep: function () {
      if (!state.settings.sfx) return;
      this.ensureContext();
      if (!this.ctx) return;
      var ctx = this.ctx;
      var bufferSize = Math.floor(ctx.sampleRate * 0.08);
      var buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      }
      var noise = ctx.createBufferSource();
      noise.buffer = buffer;
      var filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 300;
      var gain = ctx.createGain();
      gain.gain.value = 0.14;
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      noise.start();
    },

    playAlarm: function () {
      if (!state.settings.sfx) return;
      this.ensureContext();
      if (!this.ctx) return;
      var ctx = this.ctx;
      var t = ctx.currentTime;
      for (var i = 0; i < 3; i++) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sawtooth';
        var start = t + i * 0.4;
        osc.frequency.setValueAtTime(260, start);
        osc.frequency.exponentialRampToValueAtTime(520, start + 0.3);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(0.16, start + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
        osc.connect(gain);
        gain.connect(this.master);
        osc.start(start);
        osc.stop(start + 0.4);
      }
    }
  };

  /* -------------------------------------------------------------------
     DOM REFERENCES
     ------------------------------------------------------------------- */
  var els = {};
  function cacheEls() {
    els.screens = document.querySelectorAll('.screen');
    els.modalOverlay = document.getElementById('modal-overlay');
    els.modalTitle = document.getElementById('modal-title');
    els.usernameInput = document.getElementById('username-input');
    els.modalError = document.getElementById('modal-error');
    els.modalCreateBtn = document.getElementById('modal-create');

    els.stripUsername = document.getElementById('strip-username');
    els.playerNavLabel = document.getElementById('player-nav-label');

    els.masterVolume = document.getElementById('master-volume');
    els.masterVolumeValue = document.getElementById('master-volume-value');
    els.toggleMusic = document.getElementById('toggle-music');
    els.toggleSfx = document.getElementById('toggle-sfx');
    els.sensitivity = document.getElementById('sensitivity');
    els.sensitivityValue = document.getElementById('sensitivity-value');
    els.toggleShadows = document.getElementById('toggle-shadows');

    els.hudTimer = document.getElementById('hud-timer');
    els.gameCanvas = document.getElementById('game-canvas');
    els.joystick = document.getElementById('joystick');
    els.joystickThumb = document.getElementById('joystick-thumb');
    els.jumpBtn = document.getElementById('jump-btn');
    els.lookZone = document.getElementById('hud-look-zone');
  }

  /* -------------------------------------------------------------------
     SCREEN NAVIGATION
     ------------------------------------------------------------------- */
  function showScreen(name) {
    els.screens.forEach(function (screen) {
      screen.classList.toggle('is-active', screen.getAttribute('data-screen') === name);
    });
  }

  /* -------------------------------------------------------------------
     PLAYER
     ------------------------------------------------------------------- */
  function hasPlayer() {
    return !!(state.player.username && state.player.username.trim().length > 0);
  }
  function refreshPlayerUI() {
    if (hasPlayer()) {
      els.stripUsername.textContent = state.player.username.toUpperCase();
      els.playerNavLabel.textContent = 'EDIT CALLSIGN';
    } else {
      els.stripUsername.textContent = 'NO CALLSIGN';
      els.playerNavLabel.textContent = 'SET CALLSIGN';
    }
  }
  function sanitizeUsername(raw) {
    return raw.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 16);
  }
  function savePlayer(username) {
    state.player.username = username;
    storageSet(STORAGE_KEYS.username, username);
    refreshPlayerUI();
  }

  function openModal() {
    state.modalMode = hasPlayer() ? 'edit' : 'create';
    els.modalTitle.textContent = state.modalMode === 'edit' ? 'EDIT CALLSIGN' : 'SET CALLSIGN';
    els.usernameInput.value = state.modalMode === 'edit' ? state.player.username : '';
    els.modalError.textContent = '';
    els.modalOverlay.hidden = false;
    requestAnimationFrame(function () {
      els.modalOverlay.classList.add('is-visible');
      els.usernameInput.focus();
    });
  }
  function closeModal() {
    els.modalOverlay.classList.remove('is-visible');
    window.setTimeout(function () { els.modalOverlay.hidden = true; }, 220);
  }
  function submitPlayer() {
    var value = sanitizeUsername(els.usernameInput.value.trim());
    if (value.length === 0) { els.modalError.textContent = 'CALLSIGN CANNOT BE EMPTY'; return; }
    if (value.length < 2) { els.modalError.textContent = 'CALLSIGN TOO SHORT'; return; }
    savePlayer(value);
    Audio.playClick();
    closeModal();
  }

  /* -------------------------------------------------------------------
     SETTINGS
     ------------------------------------------------------------------- */
  function persistSettings() { storageSetJSON(STORAGE_KEYS.settings, state.settings); }

  function applySettingsToUI() {
    els.masterVolume.value = state.settings.masterVolume;
    els.masterVolumeValue.textContent = state.settings.masterVolume + '%';
    setToggleState(els.toggleMusic, state.settings.music);
    setToggleState(els.toggleSfx, state.settings.sfx);
    els.sensitivity.value = state.settings.sensitivity;
    els.sensitivityValue.textContent = state.settings.sensitivity + '%';
    setToggleState(els.toggleShadows, state.settings.shadows);
  }
  function setToggleState(toggleEl, isOn) {
    toggleEl.setAttribute('data-state', isOn ? 'on' : 'off');
    toggleEl.setAttribute('aria-pressed', isOn ? 'true' : 'false');
    toggleEl.querySelector('.toggle__text').textContent = isOn ? 'ON' : 'OFF';
  }
  function pushSettingsToGame() {
    if (window.GAME && window.GAME.applySettings) {
      window.GAME.applySettings({
        sensitivity: state.settings.sensitivity,
        shadows: state.settings.shadows
      });
    }
  }

  /* -------------------------------------------------------------------
     TIMER
     ------------------------------------------------------------------- */
  function formatTime(totalSeconds) {
    var m = Math.floor(totalSeconds / 60);
    var s = totalSeconds % 60;
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
  }

  function startTimer() {
    stopTimer();
    state.timer.remaining = ROUND_SECONDS;
    state.timer.running = true;
    els.hudTimer.textContent = formatTime(state.timer.remaining);
    els.hudTimer.classList.remove('is-critical');
    state.timer.intervalId = window.setInterval(function () {
      state.timer.remaining -= 1;
      if (state.timer.remaining <= 0) {
        state.timer.remaining = 0;
        els.hudTimer.textContent = formatTime(0);
        onTimerExpired();
        return;
      }
      els.hudTimer.textContent = formatTime(state.timer.remaining);
      if (state.timer.remaining <= 10) {
        els.hudTimer.classList.add('is-critical');
      }
    }, 1000);
  }

  function stopTimer() {
    if (state.timer.intervalId) {
      window.clearInterval(state.timer.intervalId);
      state.timer.intervalId = null;
    }
    state.timer.running = false;
  }

  function onTimerExpired() {
    stopTimer();
    Audio.playAlarm();
    Audio.stopDrone();
    if (window.GAME && window.GAME.stop) window.GAME.stop();
    state.gameStarted = false;
    showScreen('lobby');
  }

  /* -------------------------------------------------------------------
     GAMEPLAY LIFECYCLE
     ------------------------------------------------------------------- */
  var gameInitialized = false;

  function enterGameplay() {
    Audio.resume();
    showScreen('gameplay');

    if (window.GAME) {
      if (!gameInitialized) {
        window.GAME.init(els.gameCanvas);
        gameInitialized = true;
        pushSettingsToGame();
      }
      window.GAME.start();
    }

    Audio.startDrone();
    startTimer();
    state.gameStarted = true;
  }

  function exitGameplay() {
    stopTimer();
    Audio.stopDrone();
    if (window.GAME && window.GAME.stop) window.GAME.stop();
    state.gameStarted = false;
    showScreen('main');
  }

  /* -------------------------------------------------------------------
     JOYSTICK + LOOK + JUMP INPUT
     ------------------------------------------------------------------- */
  function setupJoystick() {
    var base = els.joystick;
    var thumb = els.joystickThumb;
    var radius = 40;
    var activeId = null;
    var center = { x: 0, y: 0 };

    function getRect() { return base.getBoundingClientRect(); }

    function onStart(e) {
      var t = e.changedTouches ? e.changedTouches[0] : e;
      activeId = e.changedTouches ? t.identifier : 'mouse';
      var r = getRect();
      center.x = r.left + r.width / 2;
      center.y = r.top + r.height / 2;
      onMove(e);
      e.preventDefault();
    }
    function onMove(e) {
      if (activeId === null) return;
      var t = null;
      if (e.changedTouches) {
        for (var i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === activeId) { t = e.changedTouches[i]; break; }
        }
        if (!t) return;
      } else {
        t = e;
      }
      var dx = t.clientX - center.x;
      var dy = t.clientY - center.y;
      var dist = Math.min(radius, Math.sqrt(dx * dx + dy * dy));
      var angle = Math.atan2(dy, dx);
      var clampedX = Math.cos(angle) * dist;
      var clampedY = Math.sin(angle) * dist;
      thumb.style.transform = 'translate(' + (clampedX - 23) + 'px,' + (clampedY - 23) + 'px)';
      var nx = clampedX / radius;
      var ny = clampedY / radius;
      if (window.GAME && window.GAME.setMove) window.GAME.setMove(nx, ny);
      e.preventDefault();
    }
    function onEnd(e) {
      if (activeId === null) return;
      if (e.changedTouches) {
        var stillActive = false;
        for (var i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === activeId) stillActive = true;
        }
        if (!stillActive) return;
      }
      activeId = null;
      thumb.style.transform = 'translate(-50%,-50%)';
      if (window.GAME && window.GAME.setMove) window.GAME.setMove(0, 0);
    }

    base.addEventListener('touchstart', onStart, { passive: false });
    base.addEventListener('touchmove', onMove, { passive: false });
    base.addEventListener('touchend', onEnd, { passive: false });
    base.addEventListener('touchcancel', onEnd, { passive: false });
    base.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', function (e) { if (activeId === 'mouse') onMove(e); });
    window.addEventListener('mouseup', function (e) { if (activeId === 'mouse') onEnd(e); });
  }

  function setupLookZone() {
    var zone = els.lookZone;
    var activeId = null;
    var lastX = 0;

    function onStart(e) {
      var t = e.changedTouches ? e.changedTouches[0] : e;
      activeId = e.changedTouches ? t.identifier : 'mouse';
      lastX = t.clientX;
      e.preventDefault();
    }
    function onMove(e) {
      if (activeId === null) return;
      var t = null;
      if (e.changedTouches) {
        for (var i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === activeId) { t = e.changedTouches[i]; break; }
        }
        if (!t) return;
      } else { t = e; }
      var deltaX = t.clientX - lastX;
      lastX = t.clientX;
      if (window.GAME && window.GAME.setLook) window.GAME.setLook(deltaX);
      e.preventDefault();
    }
    function onEnd(e) {
      if (e.changedTouches) {
        for (var i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === activeId) activeId = null;
        }
      } else {
        activeId = null;
      }
    }

    zone.addEventListener('touchstart', onStart, { passive: false });
    zone.addEventListener('touchmove', onMove, { passive: false });
    zone.addEventListener('touchend', onEnd, { passive: false });
    zone.addEventListener('touchcancel', onEnd, { passive: false });
    zone.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', function (e) { if (activeId === 'mouse') onMove(e); });
    window.addEventListener('mouseup', onEnd);
  }

  /* -------------------------------------------------------------------
     ORIENTATION
     ------------------------------------------------------------------- */
  function checkOrientation() {
    var isPortrait = window.innerHeight > window.innerWidth;
    document.documentElement.classList.toggle('is-portrait', isPortrait);
    if (window.GAME && window.GAME.onResize) window.GAME.onResize();
  }

  /* -------------------------------------------------------------------
     EVENT WIRING
     ------------------------------------------------------------------- */
  function wireEvents() {
    document.body.addEventListener('click', function (e) {
      var actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      var action = actionEl.getAttribute('data-action');

      switch (action) {
        case 'go-play':
          Audio.playClick();
          enterGameplay();
          break;
        case 'go-settings':
          Audio.playClick();
          showScreen('settings');
          break;
        case 'back-to-main':
          Audio.playClick();
          showScreen('main');
          break;
        case 'exit-game':
          Audio.playClick();
          showScreen('main');
          break;
        case 'exit-gameplay':
          Audio.playClick();
          exitGameplay();
          break;
        case 'open-create-player':
          Audio.resume();
          openModal();
          break;
        case 'close-modal':
          closeModal();
          break;
        case 'submit-player':
          submitPlayer();
          break;
        default:
          break;
      }
    });

    els.masterVolume.addEventListener('input', function () {
      var val = parseInt(els.masterVolume.value, 10);
      state.settings.masterVolume = val;
      els.masterVolumeValue.textContent = val + '%';
      Audio.setMasterVolume(val);
      persistSettings();
    });
    els.toggleMusic.addEventListener('click', function () {
      state.settings.music = !state.settings.music;
      setToggleState(els.toggleMusic, state.settings.music);
      if (!state.settings.music) Audio.stopDrone();
      else if (state.gameStarted) Audio.startDrone();
      persistSettings();
      Audio.playClick();
    });
    els.toggleSfx.addEventListener('click', function () {
      state.settings.sfx = !state.settings.sfx;
      setToggleState(els.toggleSfx, state.settings.sfx);
      persistSettings();
      Audio.playClick();
    });
    els.sensitivity.addEventListener('input', function () {
      var val = parseInt(els.sensitivity.value, 10);
      state.settings.sensitivity = val;
      els.sensitivityValue.textContent = val + '%';
      persistSettings();
      pushSettingsToGame();
    });
    els.toggleShadows.addEventListener('click', function () {
      state.settings.shadows = !state.settings.shadows;
      setToggleState(els.toggleShadows, state.settings.shadows);
      persistSettings();
      pushSettingsToGame();
      Audio.playClick();
    });

    els.usernameInput.addEventListener('input', function () {
      var cleaned = sanitizeUsername(els.usernameInput.value);
      if (cleaned !== els.usernameInput.value) els.usernameInput.value = cleaned;
      els.modalError.textContent = '';
    });
    els.usernameInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submitPlayer();
      if (e.key === 'Escape') closeModal();
    });
    els.modalOverlay.addEventListener('click', function (e) {
      if (e.target === els.modalOverlay) closeModal();
    });

    els.jumpBtn.addEventListener('touchstart', function (e) {
      e.preventDefault();
      Audio.playJump();
      if (window.GAME && window.GAME.jump) window.GAME.jump();
    }, { passive: false });
    els.jumpBtn.addEventListener('mousedown', function () {
      Audio.playJump();
      if (window.GAME && window.GAME.jump) window.GAME.jump();
    });

    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);
  }

  /* -------------------------------------------------------------------
     PUBLIC HOOK for game.js to trigger footstep sfx during walk cycle
     ------------------------------------------------------------------- */
  window.ANONYMOUS_AUDIO = {
    footstep: function () { Audio.playFootstep(); }
  };

  /* -------------------------------------------------------------------
     INIT
     ------------------------------------------------------------------- */
  function init() {
    cacheEls();
    renderIcons(document);
    checkOrientation();
    refreshPlayerUI();
    applySettingsToUI();
    setupJoystick();
    setupLookZone();
    wireEvents();
    showScreen('main');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

