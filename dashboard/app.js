// =============================================================================
// app.js — Robotic Hand Vitals Monitor Dashboard
// =============================================================================
// Data: Adafruit IO — MQTT WebSocket (primary) + REST polling (fallback)
// FSM:  Derived from data freshness + optional "fsm_state" feed
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------
const AIO_REST_BASE  = 'https://io.adafruit.com/api/v2';
const FEED_HR        = 'heart_rate';
const FEED_SPO2      = 'spo2';
const FEED_TEMP      = 'temperature';
const CHART_MAX_PTS  = 30;
const STALE_MS       = 15_000;

const RANGES = {
  hr:   { low: 60,   high: 100  },
  spo2: { low: 95,   high: 100  },
  temp: { low: 36.0, high: 37.5 },
};

const FSM_SERVO = {
  IDLE: 0, FOLD: 90, MEASURE: 180,
  PUBLISH: 180, HOLD: 180, UNFOLD: 90, COOLDOWN: 0,
};

const FSM_STATUS = {
  IDLE:     'IDLE — fingers open',
  FOLD:     'FOLD — closing fingers',
  MEASURE:  'MEASURE — reading vitals',
  PUBLISH:  'PUBLISH — sending to Adafruit IO',
  HOLD:     'HOLD — fingers closed',
  UNFOLD:   'UNFOLD — opening fingers',
  COOLDOWN: 'COOLDOWN — waiting for next cycle',
};

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------
let cfg = {
  username: '', key: '',
  source: 'mqtt', pollInterval: 5, fsmFeed: '',
};

let mqttClient       = null;
let pollTimer        = null;
let staleTimer       = null;
let servoAnimFrame   = null;
let sessionStart     = Date.now();
let totalReadings    = 0;
let currentFSM       = 'IDLE';
let currentServoAngle = 0;
let lastReadingTime  = null;
let logCount         = 0;

let vitals = { hr: null, spo2: null, temp: null };

const historyTs   = [];
const historyHR   = [];
const historySPO2 = [];
const historyTemp = [];

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const $ = id => document.getElementById(id);

// Quick stat values
const elQsHr    = $('qs-hr');
const elQsSpo2  = $('qs-spo2');
const elQsTemp  = $('qs-temp');
const elQsServo = $('qs-servo');

// FSM
const elFsmBadge  = $('fsm-badge');
const elFsmLabel  = $('fsm-label');
const elFsmDot    = $('fsm-dot');
const elHandStatus = $('hand-status-label');

// Cards
const elHrVal     = $('hr-value');
const elSpo2Val   = $('spo2-value');
const elTempVal   = $('temp-value');
const elHrBadge   = $('hr-badge');
const elSpo2Badge = $('spo2-badge');
const elTempBadge = $('temp-badge');
const elHrBarFill   = $('hr-bar-fill');
const elSpo2BarFill = $('spo2-bar-fill');
const elTempBarFill = $('temp-bar-fill');
const elPulseRing   = $('pulse-ring');
const elSpo2Arc     = $('spo2-arc');
const elThermFill   = $('therm-fill');

// Servo
const elServoArcFill = $('servo-arc-fill');
const elServoKnob    = $('servo-knob');
const elServoVal     = $('servo-angle-val');

// Hand
const elSensorGlow = $('sensor-glow');

// Status bar
const elConnDot    = $('conn-dot');
const elConnText   = $('conn-text');
const elSbConnDot  = $('sb-conn-dot');
const elSbConnLabel = $('sb-conn-label');
const elSbReadings = $('sb-readings');
const elSbSource   = $('sb-source');
const elSbUptime   = $('sb-uptime');
const elLastUpdate = $('last-update-time');

// Log
const elLogScroll = $('log-scroll');
const elLogEmpty  = $('log-empty');
const elLogCount  = $('log-count');

// No-creds banner
const elNoCreds = $('no-creds-banner');

// Settings modal
const elModalOverlay = $('modal-overlay');
const elInpUser      = $('inp-aio-username');
const elInpKey       = $('inp-aio-key');
const elInpFsmFeed   = $('inp-fsm-feed');
const elInpPoll      = $('inp-poll-interval');
const elPollVal      = $('poll-interval-val');
const elPollGroup    = $('polling-interval-group');
const elRadioMqtt    = $('radio-mqtt');
const elRadioRest    = $('radio-rest');

// ---------------------------------------------------------------------------
// CHART
// ---------------------------------------------------------------------------
let vitalsChart;

function initChart() {
  const ctx = $('vitals-chart').getContext('2d');
  vitalsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: historyTs,
      datasets: [
        {
          label: 'Heart Rate (BPM)',
          data: historyHR,
          borderColor: '#e8533a',
          backgroundColor: 'rgba(232,83,58,.07)',
          tension: 0.45, fill: true,
          pointRadius: 3, pointHoverRadius: 5,
          pointBackgroundColor: '#e8533a',
          borderWidth: 2,
        },
        {
          label: 'SpO₂ (%)',
          data: historySPO2,
          borderColor: '#3a7bd5',
          backgroundColor: 'rgba(58,123,213,.05)',
          tension: 0.45, fill: true,
          pointRadius: 3, pointHoverRadius: 5,
          pointBackgroundColor: '#3a7bd5',
          borderWidth: 2, yAxisID: 'y2',
        },
        {
          label: 'Temperature (°C)',
          data: historyTemp,
          borderColor: '#f5a623',
          backgroundColor: 'rgba(245,166,35,.04)',
          tension: 0.45, fill: false,
          pointRadius: 3, pointHoverRadius: 5,
          pointBackgroundColor: '#f5a623',
          borderWidth: 2, yAxisID: 'y3',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 350 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#fff',
          borderColor: 'rgba(0,0,0,.1)',
          borderWidth: 1,
          titleColor: '#1a1a1a',
          bodyColor: '#5a5a5a',
          padding: 10, cornerRadius: 8,
          boxShadow: '0 4px 12px rgba(0,0,0,.1)',
        },
      },
      scales: {
        x: {
          ticks: { color: '#9a9a9a', maxTicksLimit: 7, maxRotation: 0, font: { family: 'JetBrains Mono', size: 9 } },
          grid: { color: 'rgba(0,0,0,.04)' },
          border: { color: 'rgba(0,0,0,.06)' },
        },
        y: {
          position: 'left',
          title: { display: true, text: 'HR', color: '#e8533a', font: { size: 9 } },
          ticks: { color: '#9a9a9a', font: { size: 9 } },
          grid: { color: 'rgba(0,0,0,.04)' },
          border: { color: 'rgba(0,0,0,.06)' },
        },
        y2: {
          position: 'right',
          title: { display: true, text: 'SpO₂', color: '#3a7bd5', font: { size: 9 } },
          ticks: { color: '#9a9a9a', font: { size: 9 } },
          grid: { display: false },
          border: { color: 'rgba(0,0,0,.06)' },
          min: 80, max: 105,
        },
        y3: { display: false, min: 30, max: 42 },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// FSM STATE
// ---------------------------------------------------------------------------
function setFSMState(state) {
  if (state === currentFSM) return;
  const prev = currentFSM;
  currentFSM = state;

  elFsmBadge.className = `fsm-pill fsm-${state}`;
  elFsmLabel.textContent = state;
  if (elHandStatus) elHandStatus.textContent = FSM_STATUS[state] || state;

  // Servo target
  animateServo(FSM_SERVO[state] ?? 0);

  log(`FSM: <strong>${prev}</strong> → <strong>${state}</strong>`, 'state');
}

// ---------------------------------------------------------------------------
// SERVO ANIMATION
// ---------------------------------------------------------------------------
function animateServo(target) {
  if (servoAnimFrame) cancelAnimationFrame(servoAnimFrame);
  const start = currentServoAngle;
  const diff  = target - start;
  const dur   = Math.max(300, Math.abs(diff) * 15);
  const t0    = performance.now();

  function step(now) {
    const p = Math.min((now - t0) / dur, 1);
    const e = p < .5 ? 2*p*p : -1+(4-2*p)*p;
    const angle = start + diff * e;
    currentServoAngle = angle;
    renderServo(angle);
    if (p < 1) servoAnimFrame = requestAnimationFrame(step);
  }

  if (Math.abs(diff) < 0.5) { renderServo(target); return; }
  servoAnimFrame = requestAnimationFrame(step);
}

function renderServo(angle) {
  // Arc: strokeDasharray=196 for full 180° sweep
  const arcLen   = 196;
  const fraction = Math.max(0, Math.min(angle / 180, 1));
  elServoArcFill.style.strokeDashoffset = (arcLen * (1 - fraction)).toFixed(2);
  elServoVal.textContent = Math.round(angle);
  if (elQsServo) elQsServo.textContent = Math.round(angle);

  // Update 3D Hand Model finger curl
  updateHandCanvasCurl(angle);

  // Knob: travels along arc from (12,76) at 0° to (128,76) at 180°
  // semicircle: x = 70 - 58*cos(π*f), y = 76 - 62*sin(π*f)
  const rad = Math.PI * fraction;
  const kx  = (70 - 58 * Math.cos(rad)).toFixed(1);
  const ky  = (76 - 62 * Math.sin(rad)).toFixed(1);
  elServoKnob.setAttribute('cx', kx);
  elServoKnob.setAttribute('cy', ky);
}

// ---------------------------------------------------------------------------
// VITALS UI
// ---------------------------------------------------------------------------
function classify(key, value) {
  if (value === null) return null;
  const r = RANGES[key];
  if (value < r.low) return 'danger';
  if (value > r.high) return 'warning';
  return 'ok';
}

function updateVitalsUI() {
  // Heart Rate
  if (vitals.hr !== null) {
    const v = vitals.hr, cls = classify('hr', v);
    elHrVal.textContent = v.toFixed(0);
    if (elQsHr) elQsHr.textContent = v.toFixed(0);
    setBadge(elHrBadge, cls);
    elPulseRing.classList.toggle('active', true);
    const pct = pctClamp((v - 40) / 140 * 100);
    elHrBarFill.style.width = pct + '%';
    flash(elHrVal);
  }

  // SpO₂
  if (vitals.spo2 !== null) {
    const v = vitals.spo2, cls = classify('spo2', v);
    elSpo2Val.textContent = v.toFixed(1);
    if (elQsSpo2) elQsSpo2.textContent = v.toFixed(1);
    setBadge(elSpo2Badge, cls);
    // Arc: 113 = full length; map 80–100% → 0–113
    const arcPct = pctClamp((v - 80) / 20);
    elSpo2Arc.style.strokeDashoffset = (113 * (1 - arcPct)).toFixed(1);
    elSpo2BarFill.style.width = pctClamp((v - 80) / 20 * 100) + '%';
    flash(elSpo2Val);
  }

  // Temperature
  if (vitals.temp !== null) {
    const v = vitals.temp, cls = classify('temp', v);
    elTempVal.textContent = v.toFixed(1);
    if (elQsTemp) elQsTemp.textContent = v.toFixed(1);
    setBadge(elTempBadge, cls);
    const pct = pctClamp((v - 32) / 10 * 100);
    elThermFill.style.height = pct + '%';
    elTempBarFill.style.width = pct + '%';
    flash(elTempVal);
  }

  deriveFSM();
}

function setBadge(el, cls) {
  if (!cls) return;
  el.textContent = cls.toUpperCase();
  el.className = `vc-badge ${cls}`;
}

function flash(el) {
  el.classList.remove('value-updated');
  void el.offsetWidth;
  el.classList.add('value-updated');
}

function pctClamp(v) { return Math.max(0, Math.min(v, 100)); }

function deriveFSM() {
  if (!lastReadingTime) return;
  const age = Date.now() - lastReadingTime;
  if (age < STALE_MS && currentFSM === 'IDLE') setFSMState('MEASURE');
}

// ---------------------------------------------------------------------------
// CHART PUSH
// ---------------------------------------------------------------------------
function pushChart(hr, spo2, temp) {
  const label = formatTime(new Date());
  historyTs.push(label); historyHR.push(hr);
  historySPO2.push(spo2); historyTemp.push(temp);
  if (historyTs.length > CHART_MAX_PTS) {
    historyTs.shift(); historyHR.shift(); historySPO2.shift(); historyTemp.shift();
  }
  vitalsChart.update();
}

// ---------------------------------------------------------------------------
// LOG
// ---------------------------------------------------------------------------
function log(msg, type = 'info') {
  logCount++;
  if (elLogEmpty) elLogEmpty.style.display = 'none';
  if (elLogCount) elLogCount.textContent = `${logCount} event${logCount !== 1 ? 's' : ''}`;

  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `<span class="log-time">${formatTime(new Date())}</span><span class="log-msg">${msg}</span>`;
  elLogScroll.appendChild(entry);
  elLogScroll.scrollTop = elLogScroll.scrollHeight;

  const all = elLogScroll.querySelectorAll('.log-entry');
  if (all.length > 200) all[0].remove();
}

// ---------------------------------------------------------------------------
// CONNECTION STATUS
// ---------------------------------------------------------------------------
function setConn(status, label) {
  elConnDot.className  = `conn-dot ${status}`;
  elConnText.textContent = label;
  if (elSbConnLabel) elSbConnLabel.textContent = label;
  if (elSbConnDot) {
    elSbConnDot.style.background = status === 'connected' ? '#4caf50'
      : status === 'connecting' ? '#ff9800' : '#ccc';
  }
}

// ---------------------------------------------------------------------------
// MQTT
// ---------------------------------------------------------------------------
function connectMQTT() {
  if (!cfg.username || !cfg.key) { showNoCreds(); return; }
  if (mqttClient && mqttClient.isConnected()) try { mqttClient.disconnect(); } catch(_){}

  setConn('connecting', 'Connecting…');
  log('Connecting to Adafruit IO via MQTT WebSocket…', 'info');
  if (elSbSource) elSbSource.textContent = 'MQTT';

  const clientId = `robodash_${Math.random().toString(36).substr(2,8)}`;
  mqttClient = new Paho.Client('io.adafruit.com', 443, '/mqtt', clientId);

  mqttClient.onConnectionLost = resp => {
    setConn('error', 'Disconnected');
    log(`MQTT lost: ${resp.errorMessage || 'unknown'}`, 'error');
    setTimeout(connectMQTT, 5000);
  };

  mqttClient.onMessageArrived = msg => handleMQTT(msg.destinationName, msg.payloadString);

  const feeds = [FEED_HR, FEED_SPO2, FEED_TEMP];
  if (cfg.fsmFeed) feeds.push(cfg.fsmFeed);

  mqttClient.connect({
    useSSL: true,
    userName: cfg.username,
    password: cfg.key,
    keepAliveInterval: 30,
    cleanSession: true,
    onSuccess: () => {
      setConn('connected', 'Connected (MQTT)');
      log('✅ MQTT connected', 'success');
      feeds.forEach(f => {
        mqttClient.subscribe(`${cfg.username}/feeds/${f}`);
        log(`Subscribed → <strong>${f}</strong>`, 'info');
      });
    },
    onFailure: err => {
      setConn('error', 'MQTT failed');
      log(`❌ MQTT error: ${err.errorMessage}`, 'error');
      setTimeout(startREST, 3000);
    },
  });
}

function handleMQTT(topic, payload) {
  const feedKey = topic.split('/').pop();
  const value   = parseFloat(payload);

  if (feedKey === FEED_HR   && !isNaN(value)) { vitals.hr   = value; log(`❤️ HR: <strong>${value.toFixed(0)} bpm</strong>`, 'success'); }
  else if (feedKey === FEED_SPO2 && !isNaN(value)) { vitals.spo2 = value; log(`🩸 SpO₂: <strong>${value.toFixed(1)}%</strong>`, 'success'); }
  else if (feedKey === FEED_TEMP && !isNaN(value)) { vitals.temp = value; log(`🌡 Temp: <strong>${value.toFixed(1)} °C</strong>`, 'success'); }
  else if (cfg.fsmFeed && feedKey === cfg.fsmFeed) {
    const s = payload.trim().toUpperCase();
    if (FSM_SERVO[s] !== undefined) setFSMState(s);
    return;
  }
  onData();
}

// ---------------------------------------------------------------------------
// REST POLLING
// ---------------------------------------------------------------------------
function startREST() {
  if (!cfg.username || !cfg.key) { showNoCreds(); return; }
  stopREST();
  setConn('connecting', 'Polling…');
  log(`REST polling every ${cfg.pollInterval}s`, 'info');
  if (elSbSource) elSbSource.textContent = `REST (${cfg.pollInterval}s)`;
  fetchFeeds();
  pollTimer = setInterval(fetchFeeds, cfg.pollInterval * 1000);
}

function stopREST() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

async function fetchFeeds() {
  const headers = { 'X-AIO-Key': cfg.key };
  const defs = [
    { key: FEED_HR, prop: 'hr' },
    { key: FEED_SPO2, prop: 'spo2' },
    { key: FEED_TEMP, prop: 'temp' },
  ];
  if (cfg.fsmFeed) defs.push({ key: cfg.fsmFeed, prop: 'fsm' });

  let any = false;
  await Promise.all(defs.map(async ({ key, prop }) => {
    try {
      const r = await fetch(`${AIO_REST_BASE}/${cfg.username}/feeds/${key}/data/last`, { headers });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const v = parseFloat(d.value);
      if (prop === 'fsm') {
        const s = String(d.value).trim().toUpperCase();
        if (FSM_SERVO[s] !== undefined) setFSMState(s);
      } else if (!isNaN(v)) {
        vitals[prop] = v; any = true;
      }
    } catch (e) {
      log(`⚠️ Feed <strong>${key}</strong>: ${e.message}`, 'warning');
    }
  }));

  if (any) { setConn('connected', `REST (${cfg.pollInterval}s)`); onData(); }
  else setConn('error', 'Fetch error');
}

// ---------------------------------------------------------------------------
// ON DATA RECEIVED
// ---------------------------------------------------------------------------
function onData() {
  lastReadingTime = Date.now();
  totalReadings++;
  const now = new Date();
  if (elLastUpdate) elLastUpdate.textContent = formatTime(now);
  if (elSbReadings) elSbReadings.textContent = totalReadings;

  updateVitalsUI();

  if (vitals.hr !== null && vitals.spo2 !== null && vitals.temp !== null) {
    pushChart(vitals.hr, vitals.spo2, vitals.temp);
    log(`Reading #${totalReadings} — HR: <strong>${vitals.hr.toFixed(0)}</strong> | SpO₂: <strong>${vitals.spo2.toFixed(1)}%</strong> | Temp: <strong>${vitals.temp.toFixed(1)} °C</strong>`, 'success');
    clearTimeout(staleTimer);
    staleTimer = setTimeout(() => {
      setFSMState('IDLE');
      log('No new data — returned to IDLE', 'info');
    }, STALE_MS);
  }
}

// ---------------------------------------------------------------------------
// DEMO MODE
// ---------------------------------------------------------------------------
let demoTimer = null;
let demoStep  = 0;
const demoStates = ['IDLE','FOLD','MEASURE','MEASURE','HOLD','UNFOLD','COOLDOWN'];

function startDemo() {
  log('🎮 <strong>Demo Mode</strong> — simulated data (no credentials set)', 'warning');
  if (elSbSource) elSbSource.textContent = 'Demo';
  setConn('connecting', 'Demo Mode');
  demoTimer = setInterval(() => {
    demoStep = (demoStep + 1) % demoStates.length;
    const s = demoStates[demoStep];
    setFSMState(s);
    if (s === 'MEASURE') {
      vitals.hr   = 60 + Math.random() * 40;
      vitals.spo2 = 95 + Math.random() * 5;
      vitals.temp = 36 + Math.random() * 2;
      onData();
    }
  }, 2200);
}

function stopDemo() { clearInterval(demoTimer); demoTimer = null; }

// ---------------------------------------------------------------------------
// NO CREDS BANNER
// ---------------------------------------------------------------------------
function showNoCreds() {
  if (elNoCreds) elNoCreds.classList.remove('hidden');
  startDemo();
}

// ---------------------------------------------------------------------------
// SETTINGS
// ---------------------------------------------------------------------------
function loadSettings() {
  cfg.username    = localStorage.getItem('aio_username') || '';
  cfg.key         = localStorage.getItem('aio_key')     || '';
  cfg.source      = localStorage.getItem('datasource')  || 'mqtt';
  cfg.pollInterval = parseInt(localStorage.getItem('poll_interval') || '5', 10);
  cfg.fsmFeed     = localStorage.getItem('fsm_feed')    || '';
}

function saveSettings() {
  cfg.username    = elInpUser.value.trim();
  cfg.key         = elInpKey.value.trim();
  cfg.source      = document.querySelector('input[name="datasource"]:checked')?.value || 'mqtt';
  cfg.pollInterval = parseInt(elInpPoll.value, 10);
  cfg.fsmFeed     = elInpFsmFeed.value.trim();
  localStorage.setItem('aio_username',  cfg.username);
  localStorage.setItem('aio_key',       cfg.key);
  localStorage.setItem('datasource',    cfg.source);
  localStorage.setItem('poll_interval', cfg.pollInterval);
  localStorage.setItem('fsm_feed',      cfg.fsmFeed);
}

function openSettingsModal() {
  elInpUser.value    = cfg.username;
  elInpKey.value     = cfg.key;
  elInpFsmFeed.value = cfg.fsmFeed;
  elInpPoll.value    = cfg.pollInterval;
  elPollVal.textContent = cfg.pollInterval;
  elRadioMqtt.checked = cfg.source === 'mqtt';
  elRadioRest.checked = cfg.source === 'rest';
  elPollGroup.style.display = cfg.source === 'rest' ? 'flex' : 'none';
  elModalOverlay.classList.remove('hidden');
}

function closeSettingsModal() { elModalOverlay.classList.add('hidden'); }

// ---------------------------------------------------------------------------
// CONNECT
// ---------------------------------------------------------------------------
function connect() {
  stopDemo();
  stopREST();
  if (mqttClient && mqttClient.isConnected()) try { mqttClient.disconnect(); } catch(_) {}
  if (elNoCreds) elNoCreds.classList.add('hidden');

  if (!cfg.username || !cfg.key) { showNoCreds(); return; }
  if (cfg.source === 'mqtt') connectMQTT();
  else startREST();
}

// ---------------------------------------------------------------------------
// UPTIME
// ---------------------------------------------------------------------------
function startUptime() {
  setInterval(() => {
    const e = Date.now() - sessionStart;
    const h = Math.floor(e / 3600000);
    const m = Math.floor((e % 3600000) / 60000);
    const s = Math.floor((e % 60000) / 1000);
    if (elSbUptime)
      elSbUptime.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }, 1000);
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
function formatTime(d) {
  return d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

// ---------------------------------------------------------------------------
// EVENTS
// ---------------------------------------------------------------------------
$('btn-open-settings').addEventListener('click', openSettingsModal);
$('btn-modal-close').addEventListener('click', closeSettingsModal);
$('btn-settings-cancel').addEventListener('click', closeSettingsModal);
$('btn-settings-save').addEventListener('click', () => { saveSettings(); closeSettingsModal(); connect(); });
elModalOverlay.addEventListener('click', e => { if (e.target === elModalOverlay) closeSettingsModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSettingsModal(); });

elInpPoll.addEventListener('input', () => { elPollVal.textContent = elInpPoll.value; });
document.querySelectorAll('input[name="datasource"]').forEach(r => {
  r.addEventListener('change', () => {
    elPollGroup.style.display = r.value === 'rest' ? 'flex' : 'none';
  });
});

$('btn-clear-chart').addEventListener('click', () => {
  historyTs.length = historyHR.length = historySPO2.length = historyTemp.length = 0;
  vitalsChart.update();
  log('Chart cleared', 'info');
});

$('btn-clear-log').addEventListener('click', () => {
  elLogScroll.querySelectorAll('.log-entry').forEach(e => e.remove());
  if (elLogEmpty) elLogEmpty.style.display = '';
  logCount = 0;
  if (elLogCount) elLogCount.textContent = '0 events';
});

// Nav tabs (visual only for now — could switch panels)
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
  });
});

// ---------------------------------------------------------------------------
// INIT
// ---------------------------------------------------------------------------
function init() {
  loadSettings();
  initChart();
  initHandCanvas();
  renderServo(0);
  setFSMState('IDLE');
  startUptime();
  log('Dashboard initialised — ESP32 Robotic Hand Vitals Monitor', 'info');
  connect();
}

document.addEventListener('DOMContentLoaded', init);

// ---------------------------------------------------------------------------
// 3D-PROJECTED VECTOR ROBOTIC HAND CANVAS ENGINE
// ---------------------------------------------------------------------------
let canvasHand, ctxHand;
let targetHandCurl = 0;
let currentHandCurl = 0;
let rotX = 0.15, rotY = -0.25;
let isDraggingHand = false;
let lastMouseX = 0, lastMouseY = 0;

function initHandCanvas() {
  canvasHand = document.getElementById('hand-canvas');
  if (!canvasHand) return;
  ctxHand = canvasHand.getContext('2d');

  const wrap = document.getElementById('hand-canvas-wrap');
  if (wrap) {
    wrap.addEventListener('mousedown', e => {
      isDraggingHand = true;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    });

    window.addEventListener('mousemove', e => {
      if (!isDraggingHand) return;
      const dx = e.clientX - lastMouseX;
      const dy = e.clientY - lastMouseY;
      rotY += dx * 0.01;
      rotX += dy * 0.008;
      rotX = Math.max(-0.4, Math.min(0.5, rotX));
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    });

    window.addEventListener('mouseup', () => { isDraggingHand = false; });
  }

  // Animation Loop
  let time = 0;
  function renderLoop() {
    requestAnimationFrame(renderLoop);
    time += 0.03;

    // Smooth curl interpolation
    currentHandCurl += (targetHandCurl - currentHandCurl) * 0.08;

    // Subtle idle float
    if (!isDraggingHand) {
      rotY += (Math.sin(time * 0.4) * 0.08 - rotY) * 0.02;
    }

    drawHand3D(time);
  }

  renderLoop();
}

function updateHandCanvasCurl(angleDegrees) {
  targetHandCurl = Math.max(0, Math.min(angleDegrees / 180, 1));
}

function drawHand3D(time) {
  const w = canvasHand.width;
  const h = canvasHand.height;
  ctxHand.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2 + 15;
  const focalLength = 350;

  // 3D Point Projection Function
  function project(x, y, z) {
    // Rotate Y
    const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
    let x1 = x * cosY + z * sinY;
    let z1 = -x * sinY + z * cosY;

    // Rotate X
    const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
    let y2 = y * cosX - z1 * sinX;
    let z2 = y * sinX + z1 * cosX;

    const scale = focalLength / (focalLength + z2 + 250);
    return {
      x: cx + x1 * scale,
      y: cy - y2 * scale,
      scale: scale,
      z: z2
    };
  }

  // Helper to draw projected box
  function drawBox(bx, by, bz, bw, bh, bd, colorFill, colorStroke) {
    const hw = bw / 2, hh = bh / 2, hd = bd / 2;
    const vertices = [
      project(bx - hw, by - hh, bz - hd),
      project(bx + hw, by - hh, bz - hd),
      project(bx + hw, by + hh, bz - hd),
      project(bx - hw, by + hh, bz - hd),
      project(bx - hw, by - hh, bz + hd),
      project(bx + hw, by - hh, bz + hd),
      project(bx + hw, by + hh, bz + hd),
      project(bx - hw, by + hh, bz + hd)
    ];

    const faces = [
      [0, 1, 2, 3], // Front
      [5, 4, 7, 6], // Back
      [4, 0, 3, 7], // Left
      [1, 5, 6, 2], // Right
      [4, 5, 1, 0], // Bottom
      [3, 2, 6, 7]  // Top
    ];

    faces.forEach(face => {
      ctxHand.beginPath();
      ctxHand.moveTo(vertices[face[0]].x, vertices[face[0]].y);
      for (let i = 1; i < face.length; i++) {
        ctxHand.lineTo(vertices[face[i]].x, vertices[face[i]].y);
      }
      ctxHand.closePath();
      ctxHand.fillStyle = colorFill;
      ctxHand.fill();
      if (colorStroke) {
        ctxHand.strokeStyle = colorStroke;
        ctxHand.lineWidth = 1;
        ctxHand.stroke();
      }
    });
  }

  // Helper to draw joint sphere
  function drawSphere(sx, sy, sz, radius, color) {
    const p = project(sx, sy, sz);
    const r = radius * p.scale;
    ctxHand.beginPath();
    ctxHand.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctxHand.fillStyle = color;
    ctxHand.fill();
    ctxHand.strokeStyle = 'rgba(0,0,0,0.15)';
    ctxHand.lineWidth = 1;
    ctxHand.stroke();
  }

  // --- 1. WRIST BLOCK ---
  drawBox(0, -65, 0, 52, 32, 36, '#3a3a3a', '#262626');
  drawBox(0, -46, 0, 56, 6, 38, '#D4F53C', '#b8d930');

  // --- 2. PALM ---
  drawBox(0, 0, 0, 68, 72, 28, '#dedad4', '#c2beb8');

  // --- 3. MAX30102 SENSOR MODULE ---
  const sensorP = project(0, -5, 15);
  ctxHand.beginPath();
  ctxHand.arc(sensorP.x, sensorP.y, 14 * sensorP.scale, 0, Math.PI * 2);
  ctxHand.fillStyle = '#222';
  ctxHand.fill();

  // Sensor LED Glow
  const isMeasuring = currentFSM === 'MEASURE';
  const glowOpacity = isMeasuring ? 0.6 + 0.4 * Math.sin(time * 6) : (currentFSM === 'HOLD' ? 0.4 : 0);
  if (glowOpacity > 0) {
    ctxHand.beginPath();
    ctxHand.arc(sensorP.x, sensorP.y, 22 * sensorP.scale, 0, Math.PI * 2);
    ctxHand.fillStyle = `rgba(212, 245, 60, ${glowOpacity * 0.45})`;
    ctxHand.fill();
  }

  ctxHand.beginPath();
  ctxHand.arc(sensorP.x, sensorP.y, 6 * sensorP.scale, 0, Math.PI * 2);
  ctxHand.fillStyle = glowOpacity > 0 ? '#D4F53C' : '#555';
  ctxHand.fill();

  // --- 4. 5 ARTICULATED FINGERS ---
  const fingers = [
    { name: 'thumb',  x: -38, y: -15, length: 32, isThumb: true },
    { name: 'index',  x: -24, y:  36, length: 42 },
    { name: 'middle', x: -8,  y:  38, length: 48 },
    { name: 'ring',   x:  8,  y:  36, length: 44 },
    { name: 'pinky',  x:  22, y:  30, length: 34 }
  ];

  fingers.forEach(f => {
    let curl1 = currentHandCurl * 1.3; // MCP angle
    let curl2 = currentHandCurl * 1.1; // PIP angle
    let curl3 = currentHandCurl * 0.8; // DIP angle

    if (f.isThumb) {
      curl1 = currentHandCurl * 0.7;
      curl2 = currentHandCurl * 0.9;
      curl3 = currentHandCurl * 0.5;
    }

    // Joint 1: MCP Knuckle
    const p1 = { x: f.x, y: f.y, z: 0 };
    drawSphere(p1.x, p1.y, p1.z, 7, '#3a3a3a');

    // Joint 2: PIP Joint
    const proxLen = f.length * 0.45;
    let p2;
    if (f.isThumb) {
      p2 = {
        x: p1.x - Math.sin(0.6 - curl1) * proxLen,
        y: p1.y + Math.cos(0.6 - curl1) * proxLen * 0.5,
        z: p1.z + Math.sin(curl1) * proxLen
      };
    } else {
      p2 = {
        x: p1.x,
        y: p1.y + Math.cos(curl1) * proxLen,
        z: p1.z + Math.sin(curl1) * proxLen
      };
    }

    // Segment 1 (Proximal)
    const p1Proj = project(p1.x, p1.y, p1.z);
    const p2Proj = project(p2.x, p2.y, p2.z);
    ctxHand.beginPath();
    ctxHand.moveTo(p1Proj.x, p1Proj.y);
    ctxHand.lineTo(p2Proj.x, p2Proj.y);
    ctxHand.strokeStyle = '#dedad4';
    ctxHand.lineWidth = 10 * p1Proj.scale;
    ctxHand.lineCap = 'round';
    ctxHand.stroke();
    drawSphere(p2.x, p2.y, p2.z, 6, '#3a3a3a');

    // Joint 3: DIP Joint
    const midLen = f.length * 0.35;
    const totalCurl2 = curl1 + curl2;
    let p3;
    if (f.isThumb) {
      p3 = {
        x: p2.x - Math.sin(0.6 - totalCurl2) * midLen,
        y: p2.y + Math.cos(0.6 - totalCurl2) * midLen * 0.5,
        z: p2.z + Math.sin(totalCurl2) * midLen
      };
    } else {
      p3 = {
        x: p2.x,
        y: p2.y + Math.cos(totalCurl2) * midLen,
        z: p2.z + Math.sin(totalCurl2) * midLen
      };
    }

    // Segment 2 (Middle)
    const p3Proj = project(p3.x, p3.y, p3.z);
    ctxHand.beginPath();
    ctxHand.moveTo(p2Proj.x, p2Proj.y);
    ctxHand.lineTo(p3Proj.x, p3Proj.y);
    ctxHand.strokeStyle = '#d5d1cb';
    ctxHand.lineWidth = 8.5 * p2Proj.scale;
    ctxHand.lineCap = 'round';
    ctxHand.stroke();
    drawSphere(p3.x, p3.y, p3.z, 5, '#3a3a3a');

    // Fingertip
    const distLen = f.length * 0.25;
    const totalCurl3 = totalCurl2 + curl3;
    let p4;
    if (f.isThumb) {
      p4 = {
        x: p3.x - Math.sin(0.6 - totalCurl3) * distLen,
        y: p3.y + Math.cos(0.6 - totalCurl3) * distLen * 0.5,
        z: p3.z + Math.sin(totalCurl3) * distLen
      };
    } else {
      p4 = {
        x: p3.x,
        y: p3.y + Math.cos(totalCurl3) * distLen,
        z: p3.z + Math.sin(totalCurl3) * distLen
      };
    }

    // Segment 3 (Distal)
    const p4Proj = project(p4.x, p4.y, p4.z);
    ctxHand.beginPath();
    ctxHand.moveTo(p3Proj.x, p3Proj.y);
    ctxHand.lineTo(p4Proj.x, p4Proj.y);
    ctxHand.strokeStyle = '#c8c4be';
    ctxHand.lineWidth = 7 * p3Proj.scale;
    ctxHand.lineCap = 'round';
    ctxHand.stroke();
    drawSphere(p4.x, p4.y, p4.z, 4, '#bab6b0');
  });
}
