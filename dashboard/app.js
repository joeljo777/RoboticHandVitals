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
const FEED_HR        = 'heart-rate';
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
  MEASURE:  'CALCULATING — reading live vitals...',
  PUBLISH:  'PUBLISH — sending to Adafruit IO',
  HOLD:     'HOLD — vitals recorded',
  UNFOLD:   'UNFOLD — opening fingers',
  COOLDOWN: 'COOLDOWN — preparing for next hand placement',
};

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------
let cfg = {
  username: '', key: '',
  source: 'mqtt', pollInterval: 5, fsmFeed: 'fsm-state',
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
const elRadioSerial  = $('radio-serial');
const elRadioMqtt    = $('radio-mqtt');
const elRadioRest    = $('radio-rest');

// ---------------------------------------------------------------------------
// CHARTS
// ---------------------------------------------------------------------------
let vitalsChart;
let vitalsHistoryChart;

function initChart() {
  const chartConfig = {
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
          ticks: { color: '#9a9a9a', maxTicksLimit: 10, maxRotation: 0, font: { family: 'JetBrains Mono', size: 9 } },
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
  };

  const ctx1 = $('vitals-chart').getContext('2d');
  vitalsChart = new Chart(ctx1, chartConfig);

  const ctx2 = $('vitals-chart-full')?.getContext('2d');
  if (ctx2) {
    vitalsHistoryChart = new Chart(ctx2, JSON.parse(JSON.stringify(chartConfig)));
    vitalsHistoryChart.data.labels = historyTs;
    vitalsHistoryChart.data.datasets[0].data = historyHR;
    vitalsHistoryChart.data.datasets[1].data = historySPO2;
    vitalsHistoryChart.data.datasets[2].data = historyTemp;
  }
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

  const servoPageFsm = $('servo-page-fsm-text');
  const servoPageStatus = $('servo-page-status');
  if (servoPageFsm) servoPageFsm.textContent = `FSM Mode: ${state} (${FSM_SERVO[state] ?? 0}°)`;
  if (servoPageStatus) servoPageStatus.textContent = FSM_STATUS[state] || state;

  // Servo target
  animateServo(FSM_SERVO[state] ?? 0);

  // Photorealistic Render Toggle (Closed vs Open) - both Overview and Servo Page
  const isClosed = ['FOLD','MEASURE','PUBLISH','HOLD'].includes(state);
  const imgOpen   = $('img-hand-open');
  const imgClosed = $('img-hand-closed');
  if (imgOpen && imgClosed) {
    imgOpen.classList.toggle('active', !isClosed);
    imgClosed.classList.toggle('active', isClosed);
  }

  const imgOpenServo   = $('img-hand-open-servo');
  const imgClosedServo = $('img-hand-closed-servo');
  if (imgOpenServo && imgClosedServo) {
    imgOpenServo.classList.toggle('active', !isClosed);
    imgClosedServo.classList.toggle('active', isClosed);
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
  const rounded = Math.round(angle);

  // Overview Arc
  const arcLen   = 196;
  const fraction = Math.max(0, Math.min(angle / 180, 1));
  if (elServoArcFill) elServoArcFill.style.strokeDashoffset = (arcLen * (1 - fraction)).toFixed(2);
  if (elServoVal) elServoVal.textContent = rounded;
  if (elQsServo) elQsServo.textContent = rounded;

  const rad = Math.PI * fraction;
  const kx  = (70 - 58 * Math.cos(rad)).toFixed(1);
  const ky  = (76 - 62 * Math.sin(rad)).toFixed(1);
  if (elServoKnob) {
    elServoKnob.setAttribute('cx', kx);
    elServoKnob.setAttribute('cy', ky);
  }

  // Servo Page Large Arc
  const elServoPageArcFill = $('servo-page-arc-fill');
  const elServoPageKnob    = $('servo-page-knob');
  const elServoPageAngleVal = $('servo-page-angle-val');
  const elServoSpecTarget  = $('servo-spec-target');

  if (elServoPageArcFill) elServoPageArcFill.style.strokeDashoffset = (204 * (1 - fraction)).toFixed(2);
  if (elServoPageAngleVal) elServoPageAngleVal.textContent = rounded;
  if (elServoSpecTarget) elServoSpecTarget.textContent = `${rounded}°`;

  if (elServoPageKnob) {
    const pkx = (80 - 65 * Math.cos(rad)).toFixed(1);
    const pky = (82 - 65 * Math.sin(rad)).toFixed(1);
    elServoPageKnob.setAttribute('cx', pkx);
    elServoPageKnob.setAttribute('cy', pky);
  }
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

    // Vitals Page Sync
    const elVpHr = $('vitals-page-hr-val');
    const elVpHrBadge = $('vitals-page-hr-badge');
    if (elVpHr) elVpHr.textContent = v.toFixed(0);
    if (elVpHrBadge) setBadge(elVpHrBadge, cls);
  }

  // SpO₂
  if (vitals.spo2 !== null) {
    const v = vitals.spo2, cls = classify('spo2', v);
    elSpo2Val.textContent = v.toFixed(1);
    if (elQsSpo2) elQsSpo2.textContent = v.toFixed(1);
    setBadge(elSpo2Badge, cls);
    const arcPct = pctClamp((v - 80) / 20);
    elSpo2Arc.style.strokeDashoffset = (113 * (1 - arcPct)).toFixed(1);
    elSpo2BarFill.style.width = pctClamp((v - 80) / 20 * 100) + '%';
    flash(elSpo2Val);

    // Vitals Page Sync
    const elVpSpo2 = $('vitals-page-spo2-val');
    const elVpSpo2Badge = $('vitals-page-spo2-badge');
    if (elVpSpo2) elVpSpo2.textContent = v.toFixed(1);
    if (elVpSpo2Badge) setBadge(elVpSpo2Badge, cls);
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

    // Vitals Page Sync
    const elVpTemp = $('vitals-page-temp-val');
    const elVpTempBadge = $('vitals-page-temp-badge');
    if (elVpTemp) elVpTemp.textContent = v.toFixed(1);
    if (elVpTempBadge) setBadge(elVpTempBadge, cls);
  }

  updateVitalsStats();
  deriveFSM();
}

function updateVitalsStats() {
  if (historyHR.length === 0) return;

  const hrMin = Math.min(...historyHR);
  const hrMax = Math.max(...historyHR);
  const hrAvg = historyHR.reduce((a,b)=>a+b, 0) / historyHR.length;

  const spo2Min = Math.min(...historySPO2);
  const spo2Max = Math.max(...historySPO2);
  const spo2Avg = historySPO2.reduce((a,b)=>a+b, 0) / historySPO2.length;

  const tempMin = Math.min(...historyTemp);
  const tempMax = Math.max(...historyTemp);
  const tempAvg = historyTemp.reduce((a,b)=>a+b, 0) / historyTemp.length;

  if ($('hr-stat-min')) $('hr-stat-min').textContent = hrMin.toFixed(0);
  if ($('hr-stat-max')) $('hr-stat-max').textContent = hrMax.toFixed(0);
  if ($('vitals-avg-hr')) $('vitals-avg-hr').textContent = hrAvg.toFixed(0);

  if ($('spo2-stat-min')) $('spo2-stat-min').textContent = spo2Min.toFixed(1);
  if ($('spo2-stat-max')) $('spo2-stat-max').textContent = spo2Max.toFixed(1);
  if ($('vitals-avg-spo2')) $('vitals-avg-spo2').textContent = spo2Avg.toFixed(1);

  if ($('temp-stat-min')) $('temp-stat-min').textContent = tempMin.toFixed(1);
  if ($('temp-stat-max')) $('temp-stat-max').textContent = tempMax.toFixed(1);
  if ($('vitals-avg-temp')) $('vitals-avg-temp').textContent = tempAvg.toFixed(1);
}

function setBadge(el, cls) {
  if (!cls || !el) return;
  el.textContent = cls.toUpperCase();
  el.className = `vc-badge ${cls}`;
}

function flash(el) {
  if (!el) return;
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
// CHART PUSH & HISTORY STREAM
// ---------------------------------------------------------------------------
function pushChart(hr, spo2, temp) {
  const label = formatTime(new Date());
  historyTs.push(label); historyHR.push(hr);
  historySPO2.push(spo2); historyTemp.push(temp);
  if (historyTs.length > CHART_MAX_PTS) {
    historyTs.shift(); historyHR.shift(); historySPO2.shift(); historyTemp.shift();
  }
  vitalsChart.update();
  if (vitalsHistoryChart) vitalsHistoryChart.update();

  // Add row to History Page table
  addHistoryTableRow(label, hr, spo2, temp);
}

function addHistoryTableRow(time, hr, spo2, temp) {
  const tbody = $('history-table-body');
  if (!tbody) return;

  const emptyRow = tbody.querySelector('.table-empty')?.parentNode;
  if (emptyRow) emptyRow.remove();

  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${time}</td>
    <td><strong>${hr.toFixed(0)}</strong> bpm</td>
    <td><strong>${spo2.toFixed(1)}</strong>%</td>
    <td><strong>${temp.toFixed(1)}</strong> °C</td>
    <td><span class="vc-badge ok">VALID</span></td>
  `;
  tbody.insertBefore(tr, tbody.firstChild);

  const totalCount = tbody.querySelectorAll('tr').length;
  if ($('history-total-count')) $('history-total-count').textContent = `${totalCount} readings recorded`;
}

// ---------------------------------------------------------------------------
// LOG
// ---------------------------------------------------------------------------
function log(msg, type = 'info') {
  logCount++;
  const formattedTime = formatTime(new Date());

  if (elLogEmpty) elLogEmpty.style.display = 'none';
  if (elLogCount) elLogCount.textContent = `${logCount} event${logCount !== 1 ? 's' : ''}`;

  // Overview Log
  const entry1 = document.createElement('div');
  entry1.className = `log-entry ${type}`;
  entry1.innerHTML = `<span class="log-time">${formattedTime}</span><span class="log-msg">${msg}</span>`;
  elLogScroll.appendChild(entry1);
  elLogScroll.scrollTop = elLogScroll.scrollHeight;

  const all1 = elLogScroll.querySelectorAll('.log-entry');
  if (all1.length > 200) all1[0].remove();

  // Log Page Scroll
  const logPageScroll = $('log-page-scroll');
  const logPageEmpty = $('log-page-empty');
  const logPageCount = $('log-page-count');
  if (logPageEmpty) logPageEmpty.style.display = 'none';
  if (logPageCount) logPageCount.textContent = `${logCount} events recorded`;

  if (logPageScroll) {
    const entry2 = document.createElement('div');
    entry2.className = `log-entry ${type}`;
    entry2.innerHTML = `<span class="log-time">${formattedTime}</span><span class="log-msg">${msg}</span>`;
    logPageScroll.appendChild(entry2);
    logPageScroll.scrollTop = logPageScroll.scrollHeight;

    const all2 = logPageScroll.querySelectorAll('.log-entry');
    if (all2.length > 500) all2[0].remove();
  }
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

  const feeds = ['heart-rate', 'heart_rate', 'spo2', 'temperature', 'fsm-state', 'fsm_state'];
  if (cfg.fsmFeed && !feeds.includes(cfg.fsmFeed)) feeds.push(cfg.fsmFeed);

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
      });
      log(`Subscribed to feeds (vitals & state)`, 'info');
    },
    onFailure: err => {
      setConn('error', 'MQTT failed');
      log(`❌ MQTT error: ${err.errorMessage}`, 'error');
      setTimeout(startREST, 3000);
    },
  });
}

function handleMQTT(topic, payload) {
  const feedKey = topic.split('/').pop().toLowerCase();
  const value   = parseFloat(payload);

  if ((feedKey === 'heart-rate' || feedKey === 'heart_rate') && !isNaN(value)) {
    vitals.hr = value;
    log(`❤️ Live HR: <strong>${value.toFixed(0)} bpm</strong>`, 'success');
  } else if (feedKey === 'spo2' && !isNaN(value)) {
    vitals.spo2 = value;
    log(`🩸 Live SpO₂: <strong>${value.toFixed(1)}%</strong>`, 'success');
  } else if ((feedKey === 'temperature' || feedKey === 'temp') && !isNaN(value)) {
    vitals.temp = value;
    log(`🌡 Live Temp: <strong>${value.toFixed(1)} °C</strong>`, 'success');
  } else if (feedKey === 'fsm-state' || feedKey === 'fsm_state' || (cfg.fsmFeed && feedKey === cfg.fsmFeed.toLowerCase())) {
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
    { key: FEED_HR, altKey: 'heart_rate', prop: 'hr' },
    { key: FEED_SPO2, prop: 'spo2' },
    { key: FEED_TEMP, prop: 'temp' },
    { key: 'fsm-state', altKey: 'fsm_state', prop: 'fsm' }
  ];

  let any = false;
  let authError = false;
  let notFoundError = false;

  await Promise.all(defs.map(async ({ key, altKey, prop }) => {
    try {
      let r = await fetch(`${AIO_REST_BASE}/${cfg.username}/feeds/${key}/data/last`, { headers });
      if (r.status === 404 && altKey) {
        r = await fetch(`${AIO_REST_BASE}/${cfg.username}/feeds/${altKey}/data/last`, { headers });
      }
      if (r.status === 401) { authError = true; throw new Error('401 Unauthorized (Invalid AIO Key)'); }
      if (r.status === 404) { notFoundError = true; throw new Error(`404 Feed '${key}' not found`); }
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
      if (prop !== 'fsm') log(`⚠️ Feed <strong>${key}</strong>: ${e.message}`, 'warning');
    }
  }));

  if (any) {
    setConn('connected', `REST (${cfg.pollInterval}s)`);
    onData();
  } else if (authError) {
    setConn('error', 'Auth Error (Invalid AIO Key)');
    log('❌ <strong>Adafruit IO Auth Failed</strong>: Check that your Active IO Key (aio_...) is correct.', 'error');
  } else if (notFoundError) {
    setConn('error', 'Feeds Not Found');
    log('⚠️ <strong>Feeds missing on Adafruit IO</strong>: Ensure feeds <em>heart_rate</em>, <em>spo2</em>, <em>temperature</em> are created.', 'warning');
  } else {
    setConn('error', 'No Data / Fetch Error');
  }
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
    log(`Live Stream #${totalReadings} — HR: <strong>${vitals.hr.toFixed(0)}</strong> | SpO₂: <strong>${vitals.spo2.toFixed(1)}%</strong> | Temp: <strong>${vitals.temp.toFixed(1)} °C</strong>`, 'success');
    clearTimeout(staleTimer);
    staleTimer = setTimeout(() => {
      if (currentFSM !== 'MEASURE') {
        setFSMState('IDLE');
        log('No new data — returned to IDLE', 'info');
      }
    }, STALE_MS);
  }
}

// ---------------------------------------------------------------------------
// DEMO MODE
// ---------------------------------------------------------------------------
let demoTimer = null;
let demoMeasureInterval = null;

function startDemo() {
  stopDemo();
  log('🎮 <strong>Demo Mode</strong> — simulated live data streaming & steady calculating stage', 'warning');
  if (elSbSource) elSbSource.textContent = 'Demo';
  setConn('connecting', 'Demo Mode');

  let step = 0;

  function demoStepLoop() {
    if (step === 0) {
      setFSMState('IDLE');
      demoTimer = setTimeout(demoStepLoop, 3000);
    } else if (step === 1) {
      setFSMState('FOLD');
      demoTimer = setTimeout(demoStepLoop, 1500);
    } else if (step === 2) {
      setFSMState('MEASURE');
      log('⚡ <strong>Calculating stage active</strong> — holding position & streaming live vitals...', 'info');
      
      let count = 0;
      demoMeasureInterval = setInterval(() => {
        count++;
        vitals.hr   = Math.round(68 + Math.random() * 15);
        vitals.spo2 = parseFloat((96.5 + Math.random() * 3.0).toFixed(1));
        vitals.temp = parseFloat((36.5 + Math.random() * 0.8).toFixed(1));
        onData();
        if (count >= 8) {
          clearInterval(demoMeasureInterval);
          demoMeasureInterval = null;
          demoTimer = setTimeout(demoStepLoop, 500);
        }
      }, 1000);
    } else if (step === 3) {
      setFSMState('HOLD');
      demoTimer = setTimeout(demoStepLoop, 3000);
    } else if (step === 4) {
      setFSMState('UNFOLD');
      demoTimer = setTimeout(demoStepLoop, 1500);
    } else if (step === 5) {
      setFSMState('COOLDOWN');
      demoTimer = setTimeout(demoStepLoop, 3000);
    }

    step = (step + 1) % 6;
  }

  demoStepLoop();
}

function stopDemo() {
  if (demoTimer) { clearTimeout(demoTimer); demoTimer = null; }
  if (demoMeasureInterval) { clearInterval(demoMeasureInterval); demoMeasureInterval = null; }
}

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
  cfg.username     = localStorage.getItem('aio_username')  || '';
  cfg.key          = localStorage.getItem('aio_key')       || '';
  cfg.source       = localStorage.getItem('datasource')    || 'mqtt';
  cfg.pollInterval = parseInt(localStorage.getItem('poll_interval') || '5', 10);
  cfg.fsmFeed      = localStorage.getItem('fsm_feed')      || 'fsm-state';
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
  if (elRadioSerial) elRadioSerial.checked = cfg.source === 'serial';
  elRadioMqtt.checked = cfg.source === 'mqtt';
  elRadioRest.checked = cfg.source === 'rest';
  elPollGroup.style.display = cfg.source === 'rest' ? 'flex' : 'none';
  elModalOverlay.classList.remove('hidden');
}

function closeSettingsModal() { elModalOverlay.classList.add('hidden'); }

// ---------------------------------------------------------------------------
// WEB SERIAL (USB DIRECT)
// ---------------------------------------------------------------------------
let serialPort = null;
let serialReader = null;

async function connectWebSerial() {
  if (!('serial' in navigator)) {
    setConn('error', 'WebSerial Not Supported');
    log('❌ Web Serial is not supported in this browser. Use Chrome or Edge.', 'error');
    return;
  }
  try {
    setConn('connecting', 'Selecting COM port…');
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: 115200 });
    setConn('connected', 'Connected (USB Serial)');
    log('✅ Web Serial Connected (115200 baud)', 'success');
    if (elSbSource) elSbSource.textContent = 'USB Serial (115200)';
    readSerialLoop();
  } catch (err) {
    setConn('error', 'Serial Failed');
    log(`❌ Serial connection cancelled or failed: ${err.message}`, 'error');
  }
}

async function readSerialLoop() {
  const textDecoder = new TextDecoderStream();
  const readableStreamClosed = serialPort.readable.pipeTo(textDecoder.writable);
  const reader = textDecoder.readable.getReader();
  serialReader = reader;

  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let lines = buffer.split('\n');
      buffer = lines.pop();
      for (let line of lines) {
        line = line.trim();
        if (line.startsWith('{') && line.endsWith('}')) {
          try {
            const msg = JSON.parse(line);
            if (msg.type === 'fsm' && msg.state) {
              setFSMState(msg.state.toUpperCase());
            } else if (msg.type === 'vitals') {
              if (msg.hr !== undefined) vitals.hr = parseFloat(msg.hr);
              if (msg.spo2 !== undefined) vitals.spo2 = parseFloat(msg.spo2);
              if (msg.temp !== undefined) vitals.temp = parseFloat(msg.temp);
              onData();
            }
          } catch(e) {}
        }
      }
    }
  } catch (err) {
    log(`Serial read stream ended: ${err.message}`, 'warning');
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// CONNECT
// ---------------------------------------------------------------------------
function connect() {
  stopDemo();
  stopREST();
  if (mqttClient && mqttClient.isConnected()) try { mqttClient.disconnect(); } catch(_) {}
  if (elNoCreds) elNoCreds.classList.add('hidden');

  if (cfg.source === 'serial') {
    connectWebSerial();
  } else {
    if (!cfg.username || !cfg.key) { showNoCreds(); return; }
    if (cfg.source === 'mqtt') connectMQTT();
    else startREST();
  }
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

// Clear chart data
function clearChartData() {
  historyTs.length = historyHR.length = historySPO2.length = historyTemp.length = 0;
  vitalsChart.update();
  if (vitalsHistoryChart) vitalsHistoryChart.update();

  const tbody = $('history-table-body');
  if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No telemetry readings recorded yet.</td></tr>';
  if ($('history-total-count')) $('history-total-count').textContent = '0 readings recorded';
  log('Chart and history cleared', 'info');
}

if ($('btn-clear-chart')) $('btn-clear-chart').addEventListener('click', clearChartData);
if ($('btn-clear-history-page')) $('btn-clear-history-page').addEventListener('click', clearChartData);

// Clear logs
function clearLogData() {
  elLogScroll.querySelectorAll('.log-entry').forEach(e => e.remove());
  if (elLogEmpty) elLogEmpty.style.display = '';
  logCount = 0;
  if (elLogCount) elLogCount.textContent = '0 events';

  const logPageScroll = $('log-page-scroll');
  const logPageEmpty = $('log-page-empty');
  if (logPageScroll) logPageScroll.querySelectorAll('.log-entry').forEach(e => e.remove());
  if (logPageEmpty) logPageEmpty.style.display = '';
  if ($('log-page-count')) $('log-page-count').textContent = '0 events recorded';
}

if ($('btn-clear-log')) $('btn-clear-log').addEventListener('click', clearLogData);
if ($('btn-clear-log-page')) $('btn-clear-log-page').addEventListener('click', clearLogData);

// Export CSV
if ($('btn-export-csv')) {
  $('btn-export-csv').addEventListener('click', () => {
    if (historyTs.length === 0) {
      alert('No vitals data recorded yet to export.');
      return;
    }
    let csv = 'Timestamp,HeartRate_BPM,SpO2_Percent,Temperature_C\n';
    for (let i = 0; i < historyTs.length; i++) {
      csv += `"${historyTs[i]}",${historyHR[i]},${historySPO2[i]},${historyTemp[i]}\n`;
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `vitals_telemetry_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    log('📥 Exported vitals telemetry to CSV', 'success');
  });
}

// Export Log
if ($('btn-export-log')) {
  $('btn-export-log').addEventListener('click', () => {
    const entries = document.querySelectorAll('#log-page-scroll .log-entry');
    if (entries.length === 0) {
      alert('No log events to export.');
      return;
    }
    let text = '=== ROBOTIC ARM VITALS MONITOR LOG ===\n';
    entries.forEach(e => {
      text += `${e.textContent}\n`;
    });
    const blob = new Blob([text], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `session_log_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    log('📋 Exported session log', 'success');
  });
}

// Log Search Filter
if ($('inp-log-search')) {
  $('inp-log-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    document.querySelectorAll('#log-page-scroll .log-entry').forEach(entry => {
      const match = entry.textContent.toLowerCase().includes(q);
      entry.style.display = match ? '' : 'none';
    });
  });
}

// ---------------------------------------------------------------------------
// CONTROL COMMANDS (Fold, Unfold, Measure, Servo Direct Angle)
// ---------------------------------------------------------------------------
async function sendControlCommand(cmd, arg = null) {
  log(`🎮 Command triggered: <strong>${cmd}</strong>${arg !== null ? ` (${arg}°)` : ''}`, 'info');

  if (cmd === 'fold') setFSMState('FOLD');
  else if (cmd === 'unfold') setFSMState('UNFOLD');
  else if (cmd === 'measure') setFSMState('MEASURE');
  else if (cmd === 'servo' && arg !== null) {
    animateServo(arg);
    if ($('inp-servo-manual')) $('inp-servo-manual').value = arg;
    if ($('servo-manual-val')) $('servo-manual-val').textContent = `${arg}°`;
  }

  // WebSerial transmission over USB if connected
  if (serialPort && serialPort.writable) {
    try {
      const writer = serialPort.writable.getWriter();
      const payload = arg !== null ? `{"cmd":"${cmd}","angle":${arg}}\n` : `{"cmd":"${cmd}"}\n`;
      await writer.write(new TextEncoder().encode(payload));
      writer.releaseLock();
      log(`📡 Sent USB Serial command: <code>${payload.trim()}</code>`, 'success');
    } catch(err) {
      log(`⚠️ USB Serial transmit error: ${err.message}`, 'warning');
    }
  }
}

// Action Bar Buttons
['btn-action-fold', 'btn-servo-page-fold'].forEach(id => {
  if ($(id)) $(id).addEventListener('click', () => sendControlCommand('fold'));
});
['btn-action-unfold', 'btn-servo-page-unfold'].forEach(id => {
  if ($(id)) $(id).addEventListener('click', () => sendControlCommand('unfold'));
});
['btn-action-measure', 'btn-servo-page-measure'].forEach(id => {
  if ($(id)) $(id).addEventListener('click', () => sendControlCommand('measure'));
});

// Servo Preset Buttons
document.querySelectorAll('.sp-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const angle = parseInt(btn.dataset.angle, 10);
    sendControlCommand('servo', angle);
  });
});

// Servo Manual Slider
if ($('inp-servo-manual')) {
  $('inp-servo-manual').addEventListener('input', e => {
    const angle = parseInt(e.target.value, 10);
    if ($('servo-manual-val')) $('servo-manual-val').textContent = `${angle}°`;
    renderServo(angle);
  });
  $('inp-servo-manual').addEventListener('change', e => {
    const angle = parseInt(e.target.value, 10);
    sendControlCommand('servo', angle);
  });
}

// Interactive Legend Dataset Toggles (History Page)
function toggleHistoryDataset(dsIndex, btnId) {
  if (!vitalsHistoryChart) return;
  const isVisible = vitalsHistoryChart.isDatasetVisible(dsIndex);
  if (isVisible) {
    vitalsHistoryChart.hide(dsIndex);
    if ($(btnId)) $(btnId).classList.remove('active');
  } else {
    vitalsHistoryChart.show(dsIndex);
    if ($(btnId)) $(btnId).classList.add('active');
  }
}

if ($('toggle-ds-hr')) $('toggle-ds-hr').addEventListener('click', () => toggleHistoryDataset(0, 'toggle-ds-hr'));
if ($('toggle-ds-spo2')) $('toggle-ds-spo2').addEventListener('click', () => toggleHistoryDataset(1, 'toggle-ds-spo2'));
if ($('toggle-ds-temp')) $('toggle-ds-temp').addEventListener('click', () => toggleHistoryDataset(2, 'toggle-ds-temp'));

// Log Category Filter Pills (Log Page)
document.querySelectorAll('.log-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.log-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    const filter = pill.dataset.filter;
    document.querySelectorAll('#log-page-scroll .log-entry').forEach(entry => {
      if (filter === 'all' || entry.classList.contains(filter)) {
        entry.style.display = '';
      } else {
        entry.style.display = 'none';
      }
    });
  });
});

// Nav tab switching (Main overview vs Vitals vs Servo vs History vs Log)
function switchPage(tabId) {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabId);
  });
  document.querySelectorAll('.view-page').forEach(page => {
    page.classList.toggle('active-page', page.id === `page-${tabId}`);
  });
  if (tabId === 'history' && vitalsHistoryChart) {
    vitalsHistoryChart.update();
  }
}

document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    switchPage(tab.dataset.tab);
  });
});

// ---------------------------------------------------------------------------
// INITIAL HISTORY DATA SEED
// ---------------------------------------------------------------------------
function seedInitialHistoryData() {
  const now = new Date();
  for (let i = 6; i >= 1; i--) {
    const t = new Date(now.getTime() - i * 5000);
    const timeStr = formatTime(t);
    const hr = Math.round(72 + (Math.random() * 6 - 3));
    const spo2 = parseFloat((97.8 + (Math.random() * 1.0 - 0.5)).toFixed(1));
    const temp = parseFloat((36.6 + (Math.random() * 0.4 - 0.2)).toFixed(1));
    historyTs.push(timeStr);
    historyHR.push(hr);
    historySPO2.push(spo2);
    historyTemp.push(temp);
    addHistoryTableRow(timeStr, hr, spo2, temp);
  }
  vitals.hr   = historyHR[historyHR.length - 1];
  vitals.spo2 = historySPO2[historySPO2.length - 1];
  vitals.temp = historyTemp[historyTemp.length - 1];
  updateVitalsUI();
  if (vitalsChart) vitalsChart.update();
  if (vitalsHistoryChart) vitalsHistoryChart.update();
}

// ---------------------------------------------------------------------------
// INIT
// ---------------------------------------------------------------------------
function init() {
  loadSettings();
  initChart();
  seedInitialHistoryData();
  renderServo(0);
  setFSMState('IDLE');
  startUptime();
  log('Dashboard initialised — ESP32 Robotic Hand Vitals Monitor', 'info');
  connect();
}

document.addEventListener('DOMContentLoaded', init);
