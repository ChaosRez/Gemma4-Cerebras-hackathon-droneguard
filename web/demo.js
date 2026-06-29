const MISSION_DURATION_MS = 6200;

const state = {
  scenarios: [],
  selectedId: null,
  scenario: null,
  result: null,
  missionProgress: 0,
  animationFrame: null,
  agentStage: -1,
  map: null,
  mapReady: false,
  mapScenarioId: null,
  waypointMarkers: [],
  obstacleMarker: null,
  droneMarker: null,
  mapStatusNode: null,
  mapUnavailable: false,
  activeProvider: "cerebras", // "cerebras" or "slow_gpu"
  breachOccurred: false,
  chart: null,
};

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("fallback") === "true") {
  state.mapUnavailable = true;
}

const els = {
  scenarioSelect: document.querySelector("#scenarioSelect"),
  modeCerebras: document.querySelector("#modeCerebras"),
  modeSlow: document.querySelector("#modeSlow"),
  runButton: document.querySelector("#runButton"),
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
  clockVal: document.querySelector("#clockVal"),
  
  // Gauges
  batteryFill: document.querySelector("#batteryFill"),
  batteryVal: document.querySelector("#batteryVal"),
  altitudeVal: document.querySelector("#altitudeVal"),
  altitudeBar: document.querySelector("#altitudeBar"),
  speedVal: document.querySelector("#speedVal"),
  speedBar: document.querySelector("#speedBar"),
  linkVal: document.querySelector("#linkVal"),
  
  // Progress Timeline
  progressPctVal: document.querySelector("#progressPctVal"),
  phaseText: document.querySelector("#phaseText"),
  progressBarFill: document.querySelector("#progressBarFill"),
  
  mapCanvas: document.querySelector("#mapCanvas"),
  frameStrip: document.querySelector("#frameStrip"),
  
  // Commander Panel
  decisionConfidence: document.querySelector("#decisionConfidence"),
  decisionAction: document.querySelector("#decisionAction"),
  decisionMessage: document.querySelector("#decisionMessage"),
  decisionReasons: document.querySelector("#decisionReasons"),
  
  // Agent Timeline & Latency
  agentTimeline: document.querySelector("#agentTimeline"),
  totalLatency: document.querySelector("#totalLatency"),
  
  // Observability
  traceSummary: document.querySelector("#traceSummary"),
  traceEvents: document.querySelector("#traceEvents"),
};

init();

async function init() {
  renderEmptyAgents();
  initProviderControls();
  
  try {
    const payload = await getJson("/api/scenarios");
    state.scenarios = payload.scenarios;
    populateScenarioSelect();
    
    state.selectedId = state.scenarios[0]?.scenario_id ?? null;
    if (state.selectedId) {
      await selectScenario(state.selectedId);
    }
  } catch (error) {
    console.error("Initialization failed:", error);
  }
  
  els.scenarioSelect.addEventListener("change", (e) => {
    selectScenario(e.target.value);
  });
  
  els.runButton.addEventListener("click", runAgents);
}

function initProviderControls() {
  els.modeCerebras.addEventListener("click", () => {
    els.modeCerebras.classList.add("active");
    els.modeSlow.classList.remove("active");
    state.activeProvider = "cerebras";
  });
  
  els.modeSlow.addEventListener("click", () => {
    els.modeSlow.classList.add("active");
    els.modeCerebras.classList.remove("active");
    state.activeProvider = "slow_gpu";
  });
}

function populateScenarioSelect() {
  els.scenarioSelect.innerHTML = "";
  for (const s of state.scenarios) {
    const option = document.createElement("option");
    option.value = s.scenario_id;
    option.textContent = s.label;
    els.scenarioSelect.append(option);
  }
}

async function selectScenario(scenarioId) {
  if (els.runButton.disabled) return;
  cancelMissionAnimation();
  state.selectedId = scenarioId;
  state.result = null;
  state.missionProgress = 0;
  state.agentStage = -1;
  state.breachOccurred = false;
  
  state.scenario = await getJson(`/api/scenarios/${encodeURIComponent(scenarioId)}`);
  
  setMissionStatus("STANDBY", "green");
  setMissionHud(0, "Ready");
  resetDecision();
  renderEmptyAgents();
  renderTrace([]);
  renderFrames();
  renderMission();
  initChart();
  
  // Remove breach overlay if any
  const overlay = els.mapCanvas.querySelector(".breach-overlay");
  if (overlay) overlay.remove();
}

function initChart() {
  if (state.chart) {
    state.chart.destroy();
  }
  const ctx = document.getElementById("telemetryChart").getContext("2d");
  
  // Chart theme for flight monitor
  state.chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Battery %",
          data: [],
          borderColor: "#34d399",
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          tension: 0.1,
          yAxisID: "y"
        },
        {
          label: "Link Quality %",
          data: [],
          borderColor: "#fbbf24",
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          tension: 0.1,
          yAxisID: "y"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: { color: "#8b92a8", font: { family: "DM Sans", size: 9 } }
        },
        y: {
          min: 0,
          max: 100,
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: { color: "#8b92a8", font: { family: "DM Sans", size: 9 } }
        }
      }
    }
  });
}

function updateChart(elapsedSeconds, batteryPct, linkQualityPct) {
  if (!state.chart) return;
  const label = `${elapsedSeconds.toFixed(1)}s`;
  
  state.chart.data.labels.push(label);
  state.chart.data.datasets[0].data.push(batteryPct);
  state.chart.data.datasets[1].data.push(linkQualityPct);
  
  if (state.chart.data.labels.length > 20) {
    state.chart.data.labels.shift();
    state.chart.data.datasets[0].data.shift();
    state.chart.data.datasets[1].data.shift();
  }
  
  state.chart.update("none");
}

function setMissionStatus(text, colorClass) {
  els.statusText.textContent = text;
  els.statusDot.className = `status-dot ${colorClass}`;
}

async function runAgents() {
  if (!state.selectedId) return;
  cancelMissionAnimation();
  state.result = null;
  state.missionProgress = 0;
  state.agentStage = -1;
  state.breachOccurred = false;
  
  // Clear any existing breach overlay
  const overlay = els.mapCanvas.querySelector(".breach-overlay");
  if (overlay) overlay.remove();
  
  els.runButton.disabled = true;
  els.runButton.innerHTML = `<i data-lucide="loader" class="spin"></i><span>SCANNING</span>`;
  typeof lucide !== 'undefined' && lucide.createIcons();
  
  setMissionStatus("ANALYZING", "blue");
  
  els.decisionConfidence.textContent = "--";
  els.decisionAction.textContent = "ASSESSING";
  els.decisionAction.className = "action-banner uppercase";
  els.decisionMessage.textContent = "Multimodal agents are active. Streaming telemetry, keyframes, and rules...";
  els.decisionReasons.innerHTML = "";
  
  renderRunningAgents(0);
  renderMission();
  renderFrames();
  renderTrace([]);
  initChart();
  
  const started = performance.now();
  const provider = state.activeProvider;
  
  // Backend request always runs in replay mode for consistency and speed safety in hackathon
  const apiPromise = postJson("/api/runs", {
    scenario_id: state.selectedId,
    mode: "replay",
  });
  
  const animationPromise = runMissionAnimation(MISSION_DURATION_MS);
  
  try {
    let result = await apiPromise;
    
    if (provider === "slow_gpu") {
      // Simulate standard GPU provider delay (5.5 seconds out of 6.2s total animation)
      await new Promise(resolve => setTimeout(resolve, 5500));
      
      // Override details for Slow GPU view
      result = JSON.parse(JSON.stringify(result));
      result.mode = "slow_gpu";
      result.agents[0].response_time_ms = 2200;
      result.agents[0].mode = "slow_gpu";
      result.agents[1].response_time_ms = 1800;
      result.agents[1].mode = "slow_gpu";
      result.agents[2].response_time_ms = 2400;
      result.agents[2].mode = "slow_gpu";
      result.total_run_time_ms = 6400;
      
      result.run_health = {
        label: "Standard GPU",
        tone: "danger",
        summary: "Safety agent responses arrived too late to prevent wildlife sanctuary buffer entry."
      };
    } else {
      // Cerebras mode: Set state immediately as it returns (~0.8s) so drone can reroute in real-time
      state.result = result;
      renderDecision(result.decision);
      renderAgents(result.agents);
      renderTrace(result.trace_events, result);
      setMissionStatus("SAFE RETURN", "green");
    }
    
    await animationPromise;
    
    // In Slow GPU mode, set the result only after animation completes
    if (provider === "slow_gpu") {
      state.result = result;
      renderDecision(result.decision);
      renderAgents(result.agents);
      renderTrace(result.trace_events, result);
      setMissionStatus("BUFFER BREACH", "red");
    }
    
    state.missionProgress = 1;
    renderMission();
    renderFrames();
    setMissionHud(1, "Decision ready");
    
    if (provider === "slow_gpu") {
      triggerBreachOverlay();
    }
    
    const elapsed = provider === "slow_gpu" ? 6400 : (performance.now() - started);
    els.totalLatency.textContent = `${Math.round(elapsed)} ms`;
  } catch (error) {
    await animationPromise.catch(() => undefined);
    setMissionStatus("SYSTEM ERROR", "red");
    els.decisionAction.textContent = "ERROR";
    els.decisionMessage.textContent = error.message;
  } finally {
    els.runButton.disabled = false;
    els.runButton.innerHTML = `<i data-lucide="play"></i><span>Start Flight</span>`;
    typeof lucide !== 'undefined' && lucide.createIcons();
  }
}

function triggerBreachOverlay() {
  state.breachOccurred = true;
  const overlay = document.createElement("div");
  overlay.className = "breach-overlay";
  overlay.innerHTML = `<div class="breach-banner">SAFETY ALERT: SANCTUARY ZONE ENTERED</div>`;
  els.mapCanvas.appendChild(overlay);
}

function renderMission() {
  const scenario = state.scenario;
  if (!scenario) return;
  
  updateBatteryHUD(state.missionProgress);
  updateTelemetryHUD(state.missionProgress);
  
  if (canUseMapLibre()) {
    ensureMissionMap(scenario);
    updateMissionMap(scenario, state.result?.decision, state.missionProgress);
  } else {
    els.mapCanvas.innerHTML = buildMapSvg(scenario, state.result?.decision, state.missionProgress);
  }
}

function canUseMapLibre() {
  return Boolean(window.maplibregl?.Map && !state.mapUnavailable);
}

function ensureMissionMap(scenario) {
  if (!state.map) {
    els.mapCanvas.innerHTML = `
      <div id="missionMap" class="mission-map" style="width:100%; height:100%;"></div>
      <div id="mapStatus" class="map-status"></div>
    `;
    state.mapStatusNode = document.querySelector("#mapStatus");
    
    let mapTimeout = null;
    
    try {
      state.map = new window.maplibregl.Map({
        container: "missionMap",
        style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
        center: [scenario.start.lon, scenario.start.lat],
        zoom: 16.2,
        pitch: 20,
        bearing: -10,
        attributionControl: false,
        interactive: true,
      });
      
      state.map.addControl(new window.maplibregl.NavigationControl({ showCompass: true }), "top-right");
      
      // Setup timeout to fallback if style fails to load (e.g. offline)
      mapTimeout = setTimeout(() => {
        if (!state.mapReady) {
          console.warn("MapLibre GL style load timed out, falling back to SVG");
          state.mapUnavailable = true;
          if (state.map) {
            try { state.map.remove(); } catch(e) {}
            state.map = null;
          }
          // Re-render immediately to show SVG map
          renderMission();
        }
      }, 2500);
      
      state.map.on("load", () => {
        if (mapTimeout) clearTimeout(mapTimeout);
        state.mapReady = true;
        installMissionMapLayers(state.map);
        refreshMissionMapScenario(scenario);
        updateMissionMap(scenario, state.result?.decision, state.missionProgress);
      });
      
      state.map.on("error", (e) => {
        console.warn("MapLibre GL error, fallback to SVG", e);
        if (!state.mapReady) {
          if (mapTimeout) clearTimeout(mapTimeout);
          state.mapUnavailable = true;
          if (state.map) {
            try { state.map.remove(); } catch(err) {}
            state.map = null;
          }
          renderMission();
        }
      });
      
    } catch (error) {
      if (mapTimeout) clearTimeout(mapTimeout);
      console.warn("MapLibre GL initialization failed, falling back to SVG", error);
      state.mapUnavailable = true;
      state.map = null;
      els.mapCanvas.innerHTML = buildMapSvg(scenario, state.result?.decision, state.missionProgress);
    }
  } else if (state.mapScenarioId !== scenario.scenario_id && state.mapReady) {
    refreshMissionMapScenario(scenario);
  }
}

function installMissionMapLayers(map) {
  const sources = [
    "facility-zones",
    "service-road",
    "route-line",
    "progress-line",
    "detour-line",
    "return-line",
    "scan-line",
    "obstacle-zone",
  ];
  for (const source of sources) {
    if (!map.getSource(source)) {
      map.addSource(source, emptyGeoJsonSource());
    }
  }
  
  // Custom styled visual styling layers for MapLibre
  map.addLayer({
    id: "facility-zones-layer",
    type: "fill",
    source: "facility-zones",
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": ["get", "opacity"],
    },
  });
  
  map.addLayer({
    id: "service-road-layer",
    type: "line",
    source: "service-road",
    paint: {
      "line-color": "#2a394a",
      "line-width": 30,
      "line-opacity": 0.5,
    },
  });
  map.addLayer({
    id: "service-road-center",
    type: "line",
    source: "service-road",
    paint: {
      "line-color": "#43586c",
      "line-width": 2,
      "line-dasharray": [4, 4],
    },
  });
  
  map.addLayer({
    id: "route-line-layer",
    type: "line",
    source: "route-line",
    paint: {
      "line-color": "#8b7aff",
      "line-width": 4,
      "line-opacity": 0.35,
    },
  });
  
  map.addLayer({
    id: "progress-line-layer",
    type: "line",
    source: "progress-line",
    paint: {
      "line-color": "#34d399",
      "line-width": 5,
    },
  });
  
  map.addLayer({
    id: "detour-line-layer",
    type: "line",
    source: "detour-line",
    paint: {
      "line-color": "#ffb700",
      "line-width": 4,
      "line-dasharray": [3, 2],
    },
  });
  
  map.addLayer({
    id: "return-line-layer",
    type: "line",
    source: "return-line",
    paint: {
      "line-color": "#ff3838",
      "line-width": 4,
      "line-dasharray": [3, 3],
    },
  });
  
  map.addLayer({
    id: "scan-line-layer",
    type: "line",
    source: "scan-line",
    paint: {
      "line-color": "#ffffff",
      "line-width": 2,
      "line-opacity": 0.8,
    },
  });
  
  map.addLayer({
    id: "obstacle-zone-layer",
    type: "fill",
    source: "obstacle-zone",
    paint: {
      "fill-color": "#ff3838",
      "fill-opacity": 0.25,
    },
  });
  map.addLayer({
    id: "obstacle-zone-outline",
    type: "line",
    source: "obstacle-zone",
    paint: {
      "line-color": "#ff3838",
      "line-width": 2,
      "line-dasharray": [2, 2],
    },
  });
}

function refreshMissionMapScenario(scenario) {
  state.mapScenarioId = scenario.scenario_id;
  clearMissionMarkers();
  
  // Set geographic data for flight path layers
  setSourceData("facility-zones", featureCollection(buildFacilityFeatures(scenario)));
  setSourceData("service-road", lineFeature(serviceRoadCoordinates(scenario)));
  setSourceData("route-line", lineFeature(routeCoordinates(scenario)));
  setSourceData("detour-line", lineFeature(detourCoordinates(scenario)));
  
  // Restricted Obstacle Zone
  const obstacles = [];
  for (const obs of scenario.obstacles) {
    obstacles.push(polygonFeature(rectAround(obs.location, 0, 0, obs.requires_detour_m, obs.requires_detour_m)));
    
    // Add realistic CSS danger marker
    const obsEl = createObstacleElement();
    state.obstacleMarker = new window.maplibregl.Marker({ element: obsEl })
      .setLngLat([obs.location.lon, obs.location.lat])
      .addTo(state.map);
  }
  setSourceData("obstacle-zone", featureCollection(obstacles));
  
  // Waypoint labels markers
  scenario.waypoints.forEach((wp, index) => {
    const el = createWaypointElement(`WP${index + 1}`, wp.label);
    const marker = new window.maplibregl.Marker({ element: el })
      .setLngLat([wp.lon, wp.lat])
      .addTo(state.map);
    state.waypointMarkers.push(marker);
  });
  
  // Add a Home marker
  const homeEl = createWaypointElement("H", "Home Station");
  const homeMarker = new window.maplibregl.Marker({ element: homeEl })
    .setLngLat([scenario.start.lon, scenario.start.lat])
    .addTo(state.map);
  state.waypointMarkers.push(homeMarker);
  
  // Add custom spinning quadcopter marker
  const droneEl = createDroneMarkerElement();
  state.droneMarker = new window.maplibregl.Marker({ element: droneEl })
    .setLngLat([scenario.start.lon, scenario.start.lat])
    .addTo(state.map);
    
  fitMissionBounds(scenario);
}

function createDroneMarkerElement() {
  const el = document.createElement("div");
  el.className = "drone-map-avatar";
  el.innerHTML = `
    <svg class="drone-body-svg" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- Quadcopter frame arms -->
      <line x1="20" y1="20" x2="80" y2="80" stroke="#8b7aff" stroke-width="6" stroke-linecap="round"/>
      <line x1="80" y1="20" x2="20" y2="80" stroke="#8b7aff" stroke-width="6" stroke-linecap="round"/>
      
      <!-- Rotors (Background rings) -->
      <circle cx="20" cy="20" r="10" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
      <circle cx="80" cy="20" r="10" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
      <circle cx="20" cy="80" r="10" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
      <circle cx="80" cy="80" r="10" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
      
      <!-- Propellers (spinning elements) -->
      <g class="spinning-rotor" style="transform-origin: 20px 20px;">
        <line x1="12" y1="20" x2="28" y2="20" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
      </g>
      <g class="spinning-rotor" style="transform-origin: 80px 20px;">
        <line x1="72" y1="20" x2="88" y2="20" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
      </g>
      <g class="spinning-rotor" style="transform-origin: 20px 80px;">
        <line x1="12" y1="80" x2="28" y2="80" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
      </g>
      <g class="spinning-rotor" style="transform-origin: 80px 80px;">
        <line x1="72" y1="80" x2="88" y2="80" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
      </g>
      
      <!-- Drone center pod -->
      <circle cx="50" cy="50" r="14" fill="#13151f" stroke="#8b7aff" stroke-width="3"/>
      <circle cx="50" cy="50" r="6" fill="#34d399"/>
      <!-- Direction pointer -->
      <path d="M 50 30 L 46 36 L 54 36 Z" fill="#8b7aff"/>
    </svg>
  `;
  return el;
}

function clearMissionMarkers() {
  for (const m of state.waypointMarkers) m.remove();
  state.waypointMarkers = [];
  if (state.obstacleMarker) state.obstacleMarker.remove();
  state.obstacleMarker = null;
  if (state.droneMarker) state.droneMarker.remove();
  state.droneMarker = null;
}

function createWaypointElement(code, label) {
  const el = document.createElement("div");
  el.className = "waypoint-map-marker";
  el.innerHTML = `<strong>${escapeHtml(code)}</strong><span>${escapeHtml(label)}</span>`;
  return el;
}

function createObstacleElement() {
  const el = document.createElement("div");
  el.className = "obstacle-map-marker";
  el.textContent = "RESTRICTED AIRSPACE";
  return el;
}

function updateMissionMap(scenario, decision, progress) {
  if (!state.mapReady || state.mapScenarioId !== scenario.scenario_id) return;
  
  const animation = animationCoordinates(scenario);
  const current = pointAlongGeoPath(animation, progress);
  
  // Calculate bearing angle to point the drone in direction of movement
  let heading = 0;
  if (progress > 0 && progress < 1) {
    const nextProgress = Math.min(1, progress + 0.01);
    const next = pointAlongGeoPath(animation, nextProgress);
    const dy = next[1] - current[1];
    const dx = next[0] - current[0];
    heading = (Math.atan2(dx, dy) * 180) / Math.PI;
  }
  
  if (state.droneMarker) {
    state.droneMarker.setLngLat(current);
    state.droneMarker.setRotation(heading);
  }
  
  setSourceData("progress-line", lineFeature(partialGeoPath(animation, progress)));
  
  // Draw red return path from drone back to start if returning
  if (decision && decision.recommended_action === "return_to_start") {
    setSourceData("return-line", lineFeature([current, [scenario.start.lon, scenario.start.lat]]));
  } else {
    setSourceData("return-line", lineFeature([]));
  }
  
  setSourceData("scan-line", lineFeature(scanLineCoordinates(scenario, progress)));
  
  if (state.mapStatusNode) {
    const action = decision?.recommended_action ?? (progress > 0 && progress < 1 ? "assessing_route" : scenario.expected_action);
    state.mapStatusNode.innerHTML = `
      <span>Route update</span>
      <strong>${escapeHtml(formatAction(action))}</strong>
    `;
  }
}

function updateBatteryHUD(progress) {
  const scenario = state.scenario;
  if (!scenario) return;
  
  const startBattery = Number(scenario.starting_battery_pct ?? scenario.latest_battery_pct ?? 100);
  const latestBattery = Number(scenario.latest_battery_pct ?? startBattery);
  const currentPct = startBattery + (latestBattery - startBattery) * clamp(progress, 0, 1);
  
  els.batteryVal.textContent = `${Math.round(currentPct)}%`;
  
  // Radial stroke dash offset circle fill computation
  const radius = 40;
  const circumference = 2 * Math.PI * radius; // 251.2
  const offset = circumference - (currentPct / 100) * circumference;
  els.batteryFill.style.strokeDashoffset = offset;
  
  // Color code battery ring based on battery status
  if (currentPct < 25) {
    els.batteryFill.style.stroke = "var(--neon-red)";
    els.batteryVal.className = "gauge-val lcd-font text-red";
  } else if (currentPct < 55) {
    els.batteryFill.style.stroke = "var(--neon-amber)";
    els.batteryVal.className = "gauge-val lcd-font text-amber";
  } else {
    els.batteryFill.style.stroke = "var(--neon-green)";
    els.batteryVal.className = "gauge-val lcd-font text-green";
  }
}

function updateTelemetryHUD(progress) {
  const scenario = state.scenario;
  if (!scenario || !scenario.telemetry || !scenario.telemetry.length) return;
  
  const rows = scenario.telemetry;
  const index = Math.min(rows.length - 1, Math.floor(progress * rows.length));
  const row = rows[index];
  
  // LCD gauges
  els.altitudeVal.textContent = row.altitude_m.toFixed(1);
  els.altitudeBar.style.width = `${clamp((row.altitude_m / 40) * 100, 0, 100)}%`;
  
  els.speedVal.textContent = row.speed_mps.toFixed(1);
  els.speedBar.style.width = `${clamp((row.speed_mps / 15) * 100, 0, 100)}%`;
  
  els.linkVal.textContent = Math.round(row.link_quality_pct);
  
  // Link signal bars indicators active state
  const activeBars = Math.ceil(row.link_quality_pct / 20); // 0 to 5 bars
  for (let i = 1; i <= 5; i++) {
    const bar = document.querySelector(`#sig-${i}`);
    if (bar) {
      if (i <= activeBars) {
        bar.classList.add("active");
        if (row.link_quality_pct < 40) {
          bar.style.backgroundColor = "var(--neon-red)";
        } else if (row.link_quality_pct < 70) {
          bar.style.backgroundColor = "var(--neon-amber)";
        } else {
          bar.style.backgroundColor = "var(--neon-green)";
        }
      } else {
        bar.classList.remove("active");
        bar.style.backgroundColor = "";
      }
    }
  }
  
  // Update moving line chart
  const elapsedSec = progress * (MISSION_DURATION_MS / 1000);
  updateChart(elapsedSec, row.battery_pct, row.link_quality_pct);
}

function animationCoordinates(scenario) {
  const route = routeCoordinates(scenario);
  const restrictedArea = scenario.obstacles[0];
  
  if (restrictedArea && route.length >= 3) {
    // If a decision returns return_to_start AND we are in fast Cerebras mode, turn back safely early!
    if (state.result && state.result.decision?.recommended_action === "return_to_start") {
      const isSlow = state.result.mode === "slow_gpu" || state.result.total_run_time_ms > 3000;
      if (!isSlow) {
        // Cerebras mode path: Start -> WP1 -> WP2 -> return back to Home Start
        return [...route.slice(0, 3), route[0]];
      }
    }
    // Standard GPU slow mode or no decision yet: go straight to the restricted area (crashes/breaches!)
    return [...route.slice(0, 3), lngLat(restrictedArea.location)];
  }
  return route;
}

function detourCoordinates(scenario) {
  const obstacle = scenario.obstacles[0];
  if (!obstacle || scenario.waypoints.length < 3) return [];
  const wp2 = scenario.waypoints[1];
  const wp3 = scenario.waypoints[2];
  return [
    lngLat(wp2),
    offsetCoord(obstacle.location, 72, -42),
    offsetCoord(obstacle.location, 126, 18),
    lngLat(wp3),
  ];
}

function serviceRoadCoordinates(scenario) {
  const route = routeCoordinates(scenario);
  return route.map(([lon, lat], index) => offsetCoord({ lon, lat }, 18 + index * 7, -32 + index * 5));
}

function scanLineCoordinates(scenario, progress) {
  if (progress <= 0 || progress >= 1) return [];
  const route = routeCoordinates(scenario);
  const start = route[0];
  const end = route[route.length - 1];
  const lon = start[0] + (end[0] - start[0]) * progress;
  const lat = start[1] + (end[1] - start[1]) * progress;
  return [offsetCoord({ lon, lat }, -38, -88), offsetCoord({ lon, lat }, 38, 88)];
}

function routeCoordinates(scenario) {
  return [scenario.start, ...scenario.waypoints].map(lngLat);
}

function rectAround(center, eastM, northM, widthM, heightM) {
  const point = offsetCoord(center, eastM, northM);
  return [
    offsetCoord({ lon: point[0], lat: point[1] }, -widthM / 2, -heightM / 2),
    offsetCoord({ lon: point[0], lat: point[1] }, widthM / 2, -heightM / 2),
    offsetCoord({ lon: point[0], lat: point[1] }, widthM / 2, heightM / 2),
    offsetCoord({ lon: point[0], lat: point[1] }, -widthM / 2, heightM / 2),
    offsetCoord({ lon: point[0], lat: point[1] }, -widthM / 2, -heightM / 2),
  ];
}

function offsetCoord(point, eastM, northM) {
  const lat = point.lat + northM / 111_320;
  const lon = point.lon + eastM / (111_320 * Math.cos((point.lat * Math.PI) / 180));
  return [lon, lat];
}

function lngLat(point) {
  return [point.lon, point.lat];
}

function featureCollection(features) {
  return { type: "FeatureCollection", features };
}

function lineFeature(coordinates, properties = {}) {
  if (coordinates.length < 2) return featureCollection([]);
  return {
    type: "Feature",
    properties,
    geometry: { type: "LineString", coordinates },
  };
}

function pointFeature(coordinates, properties = {}) {
  return {
    type: "Feature",
    properties,
    geometry: { type: "Point", coordinates },
  };
}

function polygonFeature(coordinates, properties = {}) {
  return {
    type: "Feature",
    properties,
    geometry: { type: "Polygon", coordinates: [coordinates] },
  };
}

function buildFacilityFeatures(scenario) {
  const center = scenario.waypoints[1] ?? scenario.start;
  return [
    polygonFeature(rectAround(center, -190, 125, 122, 70), { color: "rgba(0, 229, 255, 0.08)", opacity: 0.8 }),
    polygonFeature(rectAround(center, 72, -132, 140, 64), { color: "rgba(0, 255, 102, 0.05)", opacity: 0.8 }),
  ];
}

function setSourceData(id, data) {
  const source = state.map?.getSource(id);
  if (source) source.setData(data);
}

function emptyGeoJsonSource() {
  return {
    type: "geojson",
    data: featureCollection([]),
  };
}

function cancelMissionAnimation() {
  if (state.animationFrame) {
    cancelAnimationFrame(state.animationFrame);
    state.animationFrame = null;
  }
}

function fitMissionBounds(scenario) {
  const bounds = new window.maplibregl.LngLatBounds();
  for (const coord of [...routeCoordinates(scenario), ...animationCoordinates(scenario), ...detourCoordinates(scenario)]) {
    bounds.extend(coord);
  }
  state.map.fitBounds(bounds, {
    padding: { top: 52, right: 62, bottom: 52, left: 62 },
    duration: 0,
    bearing: -10,
    pitch: 20,
  });
}

function runMissionAnimation(durationMs) {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = (now) => {
      const elapsed = now - start;
      const progress = clamp(elapsed / durationMs, 0, 1);
      state.missionProgress = progress;
      updateMission(progress, elapsed);
      if (progress < 1) {
        state.animationFrame = requestAnimationFrame(tick);
      } else {
        state.animationFrame = null;
        resolve();
      }
    };
    state.animationFrame = requestAnimationFrame(tick);
  });
}

function updateMission(progress, elapsedMs) {
  renderMission();
  
  // Real-time signals graph update
  setMissionHud(progress, missionPhase(progress, state.scenario));
  
  const stage = Math.floor(progress * 6);
  if (stage !== state.agentStage && !state.result) {
    state.agentStage = stage;
    renderRunningAgents(progress);
  }
}

function setMissionHud(progress, phase) {
  const seconds = progress * (MISSION_DURATION_MS / 1000);
  
  // Clock pad formatting MM:SS.S
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  els.clockVal.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${ms}`;
  
  els.phaseText.textContent = phase;
  els.progressPctVal.textContent = `${Math.round(progress * 100)}%`;
  els.progressBarFill.style.width = `${Math.round(progress * 100)}%`;
}

function missionPhase(progress, scenario) {
  if (progress <= 0) return "READY";
  if (progress < 0.18) return "DEPARTING START";
  if (progress < 0.42) return "WAYPOINT 1";
  if (progress < 0.66) return "WAYPOINT 2";
  if (progress < 0.82) return scenario?.obstacles?.length ? "RESTRICTED CORRIDOR SCAN" : "FINAL SEGMENT";
  if (progress < 0.96) return "BATTERY RESERVE CHECK";
  return "DECISION CONFIRMED";
}

function resetDecision() {
  els.decisionConfidence.textContent = "--";
  els.decisionAction.textContent = "WAITING";
  els.decisionAction.className = "action-banner uppercase";
  els.decisionMessage.textContent = "Starting safety analysis pipeline...";
  els.decisionReasons.innerHTML = "";
}

function renderDecision(decision) {
  els.decisionConfidence.textContent = `${Math.round(decision.confidence * 100)}%`;
  els.decisionAction.textContent = formatAction(decision.recommended_action);
  els.decisionAction.className = `action-banner uppercase ${decision.recommended_action}`;
  els.decisionMessage.textContent = displayCopy(decision.operator_message);
  
  els.decisionReasons.innerHTML = "";
  for (const why of decision.why) {
    const p = document.createElement("p");
    p.textContent = displayCopy(why);
    els.decisionReasons.append(p);
  }
}

function renderEmptyAgents() {
  els.agentTimeline.innerHTML = ["vision", "telemetry", "commander"]
    .map((name) => agentCard({ agent: name, status: "pending", mode: "--", response_time_ms: "--" }))
    .join("");
}

function renderRunningAgents(progress) {
  const agents = [
    runningAgentState("vision", progress, 0.08, 0.36),
    runningAgentState("telemetry", progress, 0.22, 0.58),
    runningAgentState("commander", progress, 0.58, 0.94),
  ];
  els.agentTimeline.innerHTML = agents.map(agentCard).join("");
}

function runningAgentState(agent, progress, start, finish) {
  let status = "queued";
  if (progress >= start && progress < finish) status = "running";
  if (progress >= finish) status = "waiting";
  return {
    agent,
    status,
    mode: state.activeProvider,
    response_time_ms: status === "running" ? "..." : "--",
  };
}

function renderAgents(agents) {
  els.agentTimeline.innerHTML = agents.map(agentCard).join("");
  const total = agents.reduce((sum, agent) => sum + Number(agent.response_time_ms || 0), 0);
  els.totalLatency.textContent = `${total} ms`;
}

function agentCard(agent) {
  const output = agent.normalized_output ? pretty(agent.normalized_output) : "";
  const raw = agent.response ? pretty(agent.response) : "";
  const modeLabel = agentModeLabel(agent);
  return `
    <article class="agent-card ${escapeHtml(agentStatusClass(agent))}">
      <header>
        <h3>${titleCase(agent.agent)}</h3>
        <div class="agent-badges">
          ${agentBadge(agentStatusLabel(agent), statusTone(agent))}
          ${modeLabel !== "--" ? agentBadge(modeLabel, modeTone(agent)) : ""}
          ${agent.cache_hit === true ? agentBadge("Cache hit", "neutral") : ""}
        </div>
      </header>
      <div class="agent-meta">
        <span>${escapeHtml(formatLatency(agent.response_time_ms))}</span>
        ${agent.error ? `<strong>${escapeHtml(agent.error)}</strong>` : ""}
      </div>
      ${output ? `<pre>${escapeHtml(output)}</pre>` : ""}
      ${
        raw
          ? `<details><summary>System Payloads</summary><pre>${escapeHtml(pretty({ request: agent.request, response: agent.response, cache_key: agent.cache_key, error: agent.error }))}</pre></details>`
          : ""
      }
    </article>
  `;
}

function agentBadge(label, tone) {
  return `<span class="agent-badge ${escapeHtml(tone)}">${escapeHtml(label)}</span>`;
}

function agentStatusClass(agent) {
  return `agent-${agent.status ?? "pending"}`;
}

function agentStatusLabel(agent) {
  if (agent.status === "complete") return "Complete";
  if (agent.status === "fallback") return "Fallback";
  if (agent.status === "running") return "Running";
  if (agent.status === "queued") return "Queued";
  if (agent.status === "waiting") return "Waiting";
  return titleCase(agent.status ?? "Pending");
}

function statusTone(agent) {
  if (agent.status === "complete") return "success";
  if (agent.status === "fallback") return "warning";
  if (agent.status === "running") return "active";
  if (agent.status === "error") return "danger";
  return "neutral";
}

function agentModeLabel(agent) {
  if (agent.status === "fallback") return "Replay fallback";
  if (agent.mode === "live") return "Live Cerebras";
  if (agent.mode === "refresh") return "Refresh";
  if (agent.mode === "replay") return "Replay";
  if (agent.mode === "slow_gpu") return "Standard GPU (Slow)";
  return String(agent.mode ?? "--");
}

function modeTone(agent) {
  if (agent.status === "fallback") return "warning";
  if (agent.mode === "live" || agent.mode === "cerebras") return "success";
  if (agent.mode === "slow_gpu") return "danger";
  return "neutral";
}

function formatLatency(value) {
  if (value === "..." || value === "--") return `${value} ms`;
  const number = Number(value);
  return Number.isFinite(number) ? `${number} ms` : "-- ms";
}

function renderFrames() {
  const scenario = state.scenario;
  if (!scenario) return;
  els.frameStrip.innerHTML = "";
  
  const frameMetadata = scenario.frame_metadata ?? [];
  for (const frame of frameMetadata) {
    const card = document.createElement("div");
    card.className = "frame-card";
    
    const url = `/samples/${scenario.scenario_id}/frames/${frame.frame_id}.jpg`;
    card.innerHTML = `
      <img src="${url}" alt="Frame ${frame.frame_id}" onerror="this.src='/samples/dangerous/frames/frame_001.png'" />
      <span>${escapeHtml(frame.frame_id)}</span>
    `;
    els.frameStrip.append(card);
  }
}

function renderTrace(events, result = state.result) {
  els.traceSummary.textContent = events.length ? `${events.length} EVENTS` : "NO RUN ACTIVE";
  if (!events.length) {
    els.traceEvents.innerHTML = `<p style="color:var(--text-muted);font-size:0.75rem;margin:0;">Initialize mission run to inspect system execution traces.</p>`;
    return;
  }
  
  const metadata = events[0]?.metadata ?? {};
  const langsmith = metadata.langsmith ?? {};
  
  const items = [
    ["Run ID", result?.run_id?.slice(0, 16) ?? "--"],
    ["Mode", result?.mode === "slow_gpu" ? "Standard GPU (Slow)" : "Cerebras Fast"],
    ["Health", result?.run_health?.label ?? "OK"],
    ["LangSmith", langsmith.enabled ? "Enabled" : "Disabled"],
  ];
  
  els.traceEvents.innerHTML = `
    <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:12px; margin-bottom:12px; padding-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.05);">
      ${items.map(([lbl, val]) => `
        <div>
          <div style="font-size:0.55rem; color:var(--text-muted); text-transform:uppercase;">${escapeHtml(lbl)}</div>
          <div style="font-family:var(--font-lcd); font-size:0.75rem; color:#fff; margin-top:2px;">${escapeHtml(val)}</div>
        </div>
      `).join("")}
    </div>
    <div class="trace-feed">
      ${events.map(ev => `
        <div class="trace-row">
          <span class="time">[${formatTime(ev.timestamp)}]</span>
          <span class="event">${escapeHtml(ev.event_type)}</span>
          <span class="msg">${escapeHtml(ev.message)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function formatTime(timestamp) {
  if (!timestamp) return "00:00:00";
  try {
    const date = new Date(timestamp);
    return date.toTimeString().split(" ")[0];
  } catch (e) {
    return "00:00:00";
  }
}

async function getJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? response.statusText);
  return payload;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? response.statusText);
  return payload;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function titleCase(value) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatAction(value) {
  if (!value) return "--";
  if (value === "detour_obstacle") return "Detour Restricted Area";
  return titleCase(value);
}

function displayCopy(value) {
  return String(value)
    .replaceAll(/\bobstacles\b/g, "restricted areas")
    .replaceAll(/\bObstacles\b/g, "Restricted Areas")
    .replaceAll(/\bobstacle\b/g, "restricted area")
    .replaceAll(/\bObstacle\b/g, "Restricted Area");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Fallback SVG Map renderer in dark theme style
function buildMapSvg(scenario, decision, progress) {
  const model = buildMapModel(scenario, progress);
  const routePath = pathFromPoints(model.route);
  const progressPath = pathFromPoints(model.progressPoints);
  const returnPath = `M ${model.current.x} ${model.current.y} L ${model.route[0].x} ${model.route[0].y}`;
  const detourPath = model.obstacle
    ? `M ${model.route[2].x} ${model.route[2].y} C ${model.obstacle.x + 64} ${model.obstacle.y + 76}, ${model.route[3].x - 70} ${model.route[3].y + 84}, ${model.route[3].x} ${model.route[3].y}`
    : "";
  const action = decision?.recommended_action ?? (progress > 0 && progress < 1 ? "assessing_route" : scenario.expected_action);
  const scanX = 42 + progress * 540;
  
  // Dynamic rotate angle for drone SVG marker
  let heading = 0;
  if (model.progressPoints.length >= 2) {
    const p1 = model.progressPoints.at(-2);
    const p2 = model.progressPoints.at(-1);
    heading = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
  }
  
  return `
    <svg class="map-svg" viewBox="0 0 640 430" preserveAspectRatio="xMidYMid meet" style="width:100%; height:100%;" role="img" aria-label="Mission route">
      <defs>
        <pattern id="mapGrid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M 32 0 L 0 0 0 32" fill="none" stroke="rgba(139, 122, 255, 0.08)" stroke-width="1" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="640" height="430" fill="#0f1117"></rect>
      <rect x="0" y="0" width="640" height="430" fill="url(#mapGrid)"></rect>
      
      <!-- Facility boundaries -->
      <polygon points="0,112 160,82 292,132 640,72 640,0 0,0" fill="#0d141b" opacity="0.8"></polygon>
      <polygon points="0,430 0,342 180,310 310,356 640,286 640,430" fill="#080e14"></polygon>
      
      <!-- Service corridor path background -->
      <path d="M 20 310 C 158 252, 252 248, 384 180 C 464 139, 548 116, 640 88" fill="none" stroke="rgba(255,255,255,0.02)" stroke-width="30"></path>
      
      <!-- Planned path -->
      <path d="${routePath}" fill="none" stroke="#8b7aff" stroke-width="3" opacity="0.3" stroke-linecap="round" stroke-linejoin="round"></path>
      
      <!-- Progress path -->
      <path d="${progressPath}" fill="none" stroke="#34d399" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>
      
      ${detourPath ? `<path d="${detourPath}" fill="none" stroke="#fbbf24" stroke-width="4" stroke-dasharray="8 6" stroke-linecap="round"></path>` : ""}
      ${decision && decision.recommended_action === "return_to_start" ? `<path d="${returnPath}" fill="none" stroke="#f87171" stroke-width="4" stroke-dasharray="6 6" stroke-linecap="round"></path>` : ""}
      
      <!-- Radar line scanning effect -->
      <line x1="${scanX}" y1="50" x2="${scanX + 30}" y2="380" stroke="#8b7aff" stroke-width="2" opacity="${progress > 0 && progress < 1 ? "0.6" : "0"}"></line>
      
      <!-- Waypoint elements -->
      ${model.route.map((p, index) => `
        <g>
          <circle cx="${p.x}" cy="${p.y}" r="10" fill="#0f1117" stroke="${index === 0 ? "var(--neon-green)" : "var(--neon-blue)"}" stroke-width="2"></circle>
          <text x="${p.x + 12}" y="${p.y + 4}" font-size="10" font-family="var(--font-lcd)" font-weight="700" fill="#fff">${index === 0 ? "START" : `WP${index}`}</text>
        </g>
      `).join("")}
      
      <!-- Protected Sanctuary Zone -->
      ${model.obstacle ? `
        <g>
          <circle cx="${model.obstacle.x}" cy="${model.obstacle.y}" r="40" fill="rgba(255, 56, 56, 0.15)" stroke="var(--neon-red)" stroke-width="1.5" stroke-dasharray="4 3"></circle>
          <rect x="${model.obstacle.x - 45}" y="${model.obstacle.y - 12}" width="90" height="24" rx="6" fill="#0f1117" stroke="var(--neon-red)" stroke-width="1"></rect>
          <text x="${model.obstacle.x}" y="${model.obstacle.y + 5}" font-size="9" font-family="var(--font-lcd)" font-weight="900" fill="var(--neon-red)" text-anchor="middle">SANCTUARY</text>
        </g>
      ` : ""}
      
      <!-- Drone Icon element -->
      <g transform="translate(${model.current.x} ${model.current.y}) rotate(${heading})">
        <circle r="12" fill="rgba(0, 229, 255, 0.1)" stroke="var(--neon-blue)" stroke-width="1.5"></circle>
        <!-- Direction head -->
        <path d="M 0 -16 L -5 -10 L 5 -10 Z" fill="var(--neon-blue)"></path>
        <line x1="-12" y1="-12" x2="12" y2="12" stroke="#fff" stroke-width="2" opacity="0.7"></line>
        <line x1="12" y1="-12" x2="-12" y2="12" stroke="#fff" stroke-width="2" opacity="0.7"></line>
        <circle r="4" fill="var(--neon-green)"></circle>
      </g>
    </svg>
  `;
}

function buildMapModel(scenario, progress) {
  const geoPoints = [scenario.start, ...scenario.waypoints];
  for (const obstacle of scenario.obstacles) geoPoints.push(obstacle.location);
  for (const row of scenario.telemetry ?? []) geoPoints.push(row);
  
  const projected = projector(geoPoints);
  const route = [scenario.start, ...scenario.waypoints].map(projected);
  const animationGeo = animationCoordinates(scenario).map(([lon, lat]) => ({ lon, lat }));
  const animationPoints = animationGeo.map(projected);
  const current = pointAlongPath(animationPoints, progress);
  
  return {
    route,
    obstacle: scenario.obstacles[0] ? projected(scenario.obstacles[0].location) : null,
    current,
    progressPoints: partialPathPoints(animationPoints, progress),
  };
}

function projector(points) {
  const lats = points.map((point) => point.lat);
  const lons = points.map((point) => point.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const pad = 60;
  return (point) => ({
    x: pad + ((point.lon - minLon) / Math.max(0.00001, maxLon - minLon)) * (640 - pad * 2),
    y: 360 - (pad + ((point.lat - minLat) / Math.max(0.00001, maxLat - minLat)) * (330 - pad)),
  });
}

function pathFromPoints(points) {
  if (!points.length) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

function partialPathPoints(points, progress) {
  if (points.length < 2) return points;
  const total = pathLength(points);
  const target = total * clamp(progress, 0, 1);
  const partial = [points[0]];
  let walked = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const segment = Math.hypot(end.x - start.x, end.y - start.y);
    if (walked + segment >= target) {
      const ratio = segment ? (target - walked) / segment : 0;
      partial.push({
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
      });
      return partial;
    }
    partial.push(end);
    walked += segment;
  }
  return partial;
}

function pointAlongPath(points, progress) {
  return partialPathPoints(points, progress).at(-1) ?? points[0];
}

function pathLength(points) {
  return points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);
}

function pointAlongGeoPath(points, progress) {
  return partialGeoPath(points, progress).at(-1) ?? points[0];
}

function partialGeoPath(points, progress) {
  if (points.length < 2) return points;
  const total = geoPathLength(points);
  const target = total * clamp(progress, 0, 1);
  const partial = [points[0]];
  let walked = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const segment = geoDistance(start, end);
    if (walked + segment >= target) {
      const ratio = segment ? (target - walked) / segment : 0;
      partial.push(lerpCoord(start, end, ratio));
      return partial;
    }
    partial.push(end);
    walked += segment;
  }
  return partial;
}

function geoPathLength(points) {
  return points.slice(1).reduce((sum, point, index) => sum + geoDistance(points[index], point), 0);
}

function geoDistance(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function lerpCoord(a, b, ratio) {
  return [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
}
