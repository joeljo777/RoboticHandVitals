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

  // Photorealistic Render Toggle (Closed vs Open)
  const isClosed = ['FOLD','MEASURE','PUBLISH','HOLD'].includes(state);
  const imgOpen   = $('img-hand-open');
  const imgClosed = $('img-hand-closed');
  if (imgOpen && imgClosed) {
    imgOpen.classList.toggle('active', !isClosed);
    imgClosed.classList.toggle('active', isClosed);
  }

  // Sensor glow & status LEDs
  const measuring = state === 'MEASURE';
  const activeAct = ['FOLD','UNFOLD'].includes(state);
  if (elSensorGlow) {
    elSensorGlow.classList.toggle('sensor-active', measuring);
  }

  const ledAct = $('led-actuator');
  const ledSnr = $('led-sensor');
  if (ledAct) ledAct.classList.toggle('active', activeAct);
  if (ledSnr) ledSnr.classList.toggle('active', measuring);

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
  renderServo(0);
  setFSMState('IDLE');
  startUptime();
  log('Dashboard initialised — ESP32 Robotic Hand Vitals Monitor', 'info');
  connect();
}

document.addEventListener('DOMContentLoaded', init);
