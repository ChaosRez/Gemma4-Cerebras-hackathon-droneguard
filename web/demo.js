const AGENT_DISPLAY_NAMES = {
  vision: "Vision Agent",
  telemetry: "Waypoint Agent",
  commander: "Commander",
};

const ORDER_PROFILES = {
  dangerous_detour_low_battery: {
    order_id: "QD-BER-2901",
    restaurant: "Mustafa's Gemüse Kebap",
    restaurant_emoji: "🥙",
    items: ["Döner Box × 2", "Lahmacun × 1", "Ayran × 2"],
    customer: "Lena Hoffmann",
    address: "Kastanienallee 82, Prenzlauer Berg",
    eta_minutes: 11,
    price: "€18.00",
    courier: "Drone QD-3",
  },
  alexanderplatz_restricted: {
    order_id: "QD-BER-2918",
    restaurant: "Mustafa's Gemüse Kebap",
    restaurant_emoji: "🥙",
    items: ["Gemüse Döner × 1", "Ayran × 1"],
    customer: "Lena Hoffmann",
    address: "Kastanienallee 82, Prenzlauer Berg",
    eta_minutes: 10,
    price: "€12.50",
    courier: "Drone QD-3",
  },
};

const SCENARIO_PROFILES = {
  alexanderplatz_restricted: {
    zone_short: "Alexanderplatz",
    zone_marker: "⛔ Alexanderplatz No-Fly",
    breach_message:
      "NO-FLY BREACH — Autopilot entered Alexanderplatz restricted airspace before Standard inference could reroute",
    approach_phase: "Approaching Alexanderplatz",
    detour_phase: "Detouring around Alexanderplatz",
    detour_action: "Rerouting around Alexanderplatz",
    cerebras_summary: (tps) =>
      `Agents responded at ${tps.toLocaleString()} tok/s — detour issued before Alexanderplatz breach.`,
    standard_summary: (tps) =>
      `Standard inference at ${tps} tok/s arrived after the drone entered Alexanderplatz restricted airspace.`,
    standard_message: (tps) =>
      `Standard inference is still running at ${tps} tok/s — autopilot is drifting toward Alexanderplatz before Commander can reroute…`,
  },
  dangerous_detour_low_battery: {
    zone_short: "Mauerpark",
    zone_marker: "🎪 Mauerpark No-Fly",
    breach_message:
      "DELIVERY PAUSED — Mauerpark blocks the route and Standard inference arrived too late to reroute safely",
    approach_phase: "Approaching Mauerpark",
    detour_phase: "Checking alternate route",
    detour_action: "Rerouting around Mauerpark",
    cerebras_summary: () => "Agents responded in time — returning to kitchen before battery runs out.",
    standard_summary: (tps) =>
      `Waypoint hold lasted longer at ${tps} tok/s — the return decision is safe, but total mission time increases.`,
    standard_message: (tps) =>
      `Drone holding near Mauerpark while Standard inference runs at ${tps} tok/s…`,
  },
};

function scenarioProfile(scenario) {
  return (
    SCENARIO_PROFILES[scenario?.scenario_id] ?? {
      zone_short: "restricted area",
      zone_marker: "⛔ No-Fly Zone",
      breach_message:
        "NO-FLY BREACH — Autopilot entered restricted airspace before Standard inference could reroute",
      approach_phase: "Approaching restricted zone",
      detour_phase: "Detouring around restricted zone",
      detour_action: "Rerouting around restricted area",
      cerebras_summary: (tps) => `Agents responded at ${tps.toLocaleString()} tok/s.`,
      standard_summary: (tps) => `Autopilot held too long at ${tps} tok/s.`,
      standard_message: (tps) => `Standard inference at ${tps} tok/s is too slow…`,
    }
  );
}

function shouldUseDetourPath(scenario) {
  return scenario?.expected_action === "detour_obstacle";
}

function shouldReturnToStart(scenario) {
  if (scenario?.expected_action === "return_to_start") return true;
  return state.result?.decision?.recommended_action === "return_to_start";
}

function isBreachDemoScenario(scenario) {
  return shouldUseDetourPath(scenario);
}

const MISSION_DURATION_MS = 6200;
const FLIGHT_SEGMENT_MS = 2500;
const DETOUR_FLIGHT_SEGMENT_MS = 5200;
const RETURN_FLIGHT_SEGMENT_MS = 5600;
const CHECKPOINT_SETTLE_MS = 180;
const CHECKPOINT_AGENT_GAP_MS = 180;
const STANDARD_FAILURE_HOLD_MS = 900;
const STANDARD_FAILURE_DRIFT_MS = 3600;
const CEREBRAS_TPS = 2150;
const STANDARD_TPS = 200;

const INFERENCE_MODE_LABELS = {
  replay: { badge: "Cached replay", hint: "Replay uses cached live Cerebras responses." },
  live: { badge: "Live API", hint: "Calls Cerebras directly — slower, requires API key." },
  refresh: { badge: "Refresh cache", hint: "Re-runs live calls and overwrites the replay cache." },
};

const state = {
  scenarios: [],
  selectedId: null,
  scenario: null,
  result: null,
  activeDecision: null,
  activeCheckpoint: null,
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
  activeProvider: "cerebras",
  runMode: "replay",
  breachOccurred: false,
  standardFailure: false,
  chart: null,
  flightPaths: null,
  rerouteActivated: false,
  rerouteAtProgress: 0.38,
};

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("fallback") === "true") {
  state.mapUnavailable = true;
}

const els = {
  scenarioSelect: document.querySelector("#scenarioSelect"),
  modeCerebras: document.querySelector("#modeCerebras"),
  modeStandard: document.querySelector("#modeStandard"),
  inferenceModeSelect: document.querySelector("#inferenceModeSelect"),
  inferenceModeBadge: document.querySelector("#inferenceModeBadge"),
  runButton: document.querySelector("#runButton"),
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
  clockVal: document.querySelector("#clockVal"),
  
  batteryVal: document.querySelector("#batteryVal"),
  altitudeVal: document.querySelector("#altitudeVal"),
  speedVal: document.querySelector("#speedVal"),
  linkVal: document.querySelector("#linkVal"),

  restaurantEmoji: document.querySelector("#restaurantEmoji"),
  restaurantName: document.querySelector("#restaurantName"),
  orderId: document.querySelector("#orderId"),
  orderPrice: document.querySelector("#orderPrice"),
  orderItems: document.querySelector("#orderItems"),
  customerAddress: document.querySelector("#customerAddress"),
  customerName: document.querySelector("#customerName"),
  etaVal: document.querySelector("#etaVal"),
  courierName: document.querySelector("#courierName"),
  deliveryStepper: document.querySelector("#deliveryStepper"),
  
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
  initInferenceModeControls();
  
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
    els.modeStandard.classList.remove("active");
    state.activeProvider = "cerebras";
    updateTPSHighlight("cerebras");
    if (state.scenario) renderMission();
  });
  
  els.modeStandard.addEventListener("click", () => {
    els.modeStandard.classList.add("active");
    els.modeCerebras.classList.remove("active");
    state.activeProvider = "slow_gpu";
    updateTPSHighlight("slow_gpu");
    if (state.scenario) renderMission();
  });
  
  updateTPSHighlight("cerebras");
}

function initInferenceModeControls() {
  if (!els.inferenceModeSelect) return;
  state.runMode = els.inferenceModeSelect.value || "replay";
  updateInferenceModeBadge(state.runMode);
  els.inferenceModeSelect.addEventListener("change", (event) => {
    state.runMode = event.target.value;
    updateInferenceModeBadge(state.runMode);
  });
}

function updateInferenceModeBadge(mode) {
  if (!els.inferenceModeBadge) return;
  const meta = INFERENCE_MODE_LABELS[mode] ?? INFERENCE_MODE_LABELS.replay;
  els.inferenceModeBadge.textContent = meta.badge;
  els.inferenceModeBadge.className = `inference-badge ${mode === "live" ? "live" : mode === "refresh" ? "refresh" : ""}`;
  els.inferenceModeBadge.title = meta.hint;
}

function isStandardProvider() {
  return state.activeProvider === "slow_gpu";
}

function computeDecisionDelayMs(result, provider) {
  const baseLatency = Number(result.total_run_time_ms || agentCriticalPathMs(result.agents) || 800);
  if (provider !== "slow_gpu") return 0;
  const targetStandardLatency = MISSION_DURATION_MS + 900;
  return Math.max(0, targetStandardLatency - baseLatency);
}

function decorateProviderResult(result, provider) {
  const decorated = JSON.parse(JSON.stringify(result));
  const profile = scenarioProfile(state.scenario);
  if (provider !== "slow_gpu") {
    decorated.provider = "cerebras";
    if (state.scenario?.obstacles?.length) {
      decorated.run_health = {
        ...decorated.run_health,
        label: "Cerebras",
        tone: "success",
        summary: profile.cerebras_summary(CEREBRAS_TPS),
      };
    }
    return decorated;
  }

  const delay = computeDecisionDelayMs(decorated, provider);
  const scale = (CEREBRAS_TPS / STANDARD_TPS);
  decorated.provider = "standard";
  decorated.agents = decorated.agents.map((agent) => ({
    ...agent,
    mode: "standard_replay",
    response_time_ms: Math.round(Number(agent.response_time_ms || 0) * scale),
  }));
  decorated.total_run_time_ms = Math.round(Number(decorated.total_run_time_ms || 0) * scale);
  decorated.run_health = {
    label: "Standard",
    tone: "danger",
    summary: profile.standard_summary(STANDARD_TPS),
  };
  decorated._decision_delay_ms = delay;
  return decorated;
}

function updateTPSHighlight(provider) {
  const card = document.querySelector(".tps-comparison-card");
  if (!card) return;
  card.querySelectorAll(".tps-bar-row").forEach(row => {
    row.classList.remove("highlighted");
  });
  if (provider === "cerebras") {
    card.querySelector(".cerebras-row").classList.add("highlighted");
  } else {
    card.querySelector(".standard-row").classList.add("highlighted");
  }
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
  state.activeDecision = null;
  state.activeCheckpoint = null;
  state.missionProgress = 0;
  state.agentStage = -1;
  state.breachOccurred = false;
  state.standardFailure = false;
  state.flightPaths = null;
  state.rerouteActivated = false;
  state.rerouteAtProgress = waypointDecisionProgress(state.scenario);
  
  state.scenario = await getJson(`/api/scenarios/${encodeURIComponent(scenarioId)}`);
  state.rerouteAtProgress = waypointDecisionProgress(state.scenario);
  
  setMissionStatus("Preparing", "green");
  setMissionHud(0, "Order confirmed");
  resetDecision();
  renderOrderCard();
  resetTelemetryDisplay();
  renderEmptyAgents();
  renderTrace([]);
  renderFrames();
  renderMission();
  initChart();
  updateDeliveryStepper(0);
  if (state.mapReady && state.scenario) {
    updateMissionMap(state.scenario, null, 0);
  }
  
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
          borderColor: "#06c167",
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          tension: 0.1,
          yAxisID: "y"
        },
        {
          label: "Link Quality %",
          data: [],
          borderColor: "#ff8000",
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
          grid: { color: "rgba(0, 0, 0, 0.04)" },
          ticks: { color: "#9ca3af", font: { family: "DM Sans", size: 9 } }
        },
        y: {
          min: 0,
          max: 100,
          grid: { color: "rgba(0, 0, 0, 0.04)" },
          ticks: { color: "#9ca3af", font: { family: "DM Sans", size: 9 } }
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
  state.activeDecision = null;
  state.activeCheckpoint = null;
  state.missionProgress = 0;
  state.agentStage = -1;
  state.breachOccurred = false;
  state.standardFailure = false;
  state.flightPaths = buildFlightPaths(state.scenario);
  state.rerouteActivated = false;
  state.rerouteAtProgress = waypointDecisionProgress(state.scenario);
  
  // Clear any existing breach overlay
  const overlay = els.mapCanvas.querySelector(".breach-overlay");
  if (overlay) overlay.remove();
  
  els.runButton.disabled = true;
  els.runButton.innerHTML = `<i data-lucide="loader" class="spin"></i><span>Tracking…</span>`;
  typeof lucide !== 'undefined' && lucide.createIcons();
  
  setMissionStatus("Routing", "blue");
  
  els.decisionConfidence.textContent = "--";
  els.decisionAction.textContent = "Checking route";
  els.decisionAction.className = "action-banner";
  els.decisionMessage.textContent = "AI agents are scanning the flight path, checking battery range, and looking for obstacles on your delivery route.";
  els.decisionReasons.innerHTML = "";
  
  renderCheckpointAgents(buildDeliveryCheckpoints(state.scenario)[0], []);
  renderMission();
  renderFrames();
  renderTrace([]);
  initChart();
  
  const started = performance.now();
  const provider = state.activeProvider;
  const runMode = state.runMode || "replay";

  const apiPromise = postJson("/api/runs", {
    scenario_id: state.selectedId,
    mode: runMode,
  });

  updateInferenceModeBadge(runMode);

  try {
    const result = await runDeliveryCheckpointMission(apiPromise, provider, started);
    state.result = result;
    state.scenario = result.scenario;

    if (!state.standardFailure) {
      state.activeDecision = result.decision;
      state.activeCheckpoint = buildDeliveryCheckpoints(result.scenario, result).at(-1) ?? null;
      state.missionProgress = 1;
      renderMission();
      renderFrames();
      setMissionHud(
        1,
        shouldUseDetourPath(state.scenario)
          ? "Detour complete"
          : shouldReturnToStart(state.scenario)
            ? "Back at kitchen"
            : "Arriving soon",
      );
      updateDeliveryStepper(1);
      renderDecision(result.decision, state.activeCheckpoint);
      setMissionStatus(isStandardProvider() ? "Completed slowly" : "Completed", isStandardProvider() ? "amber" : "green");
    } else {
      renderMission();
      renderFrames();
      renderStandardFailureDecision(state.activeCheckpoint, result.decision);
      setMissionStatus("No-fly breach", "red");
      setMissionHud(state.missionProgress, "Restricted zone breach", performance.now() - started);
    }

    renderAgents(result.agents, state.activeCheckpoint);
    renderTrace(result.trace_events, result);

    const elapsed = performance.now() - started;
    const criticalPath = agentCriticalPathMs(result.agents);
    els.totalLatency.textContent = `${formatLatency(criticalPath)} critical path · ${(elapsed / 1000).toFixed(1)} s run`;
  } catch (error) {
    setMissionStatus("Error", "red");
    els.decisionAction.textContent = "Something went wrong";
    els.decisionMessage.textContent = error.message;
  } finally {
    els.runButton.disabled = false;
    els.runButton.innerHTML = `<i data-lucide="navigation"></i><span>Track order</span>`;
    typeof lucide !== 'undefined' && lucide.createIcons();
  }
}

function triggerBreachOverlay() {
  state.breachOccurred = true;
  const overlay = document.createElement("div");
  overlay.className = "breach-overlay";
  overlay.innerHTML = `<div class="breach-banner">⚠️ ${escapeHtml(scenarioProfile(state.scenario).breach_message)}</div>`;
  els.mapCanvas.appendChild(overlay);
}

function renderMission() {
  const scenario = state.scenario;
  if (!scenario) return;
  const decision = state.activeDecision ?? state.result?.decision ?? null;
  
  updateBatteryHUD(state.missionProgress);
  updateTelemetryHUD(state.missionProgress);
  
  if (canUseMapLibre()) {
    ensureMissionMap(scenario);
    updateMissionMap(scenario, decision, state.missionProgress);
  } else {
    els.mapCanvas.innerHTML = buildMapSvg(scenario, decision, state.missionProgress);
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
        zoom: 14.8,
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
        updateMissionMap(scenario, state.activeDecision ?? state.result?.decision, state.missionProgress);
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
      els.mapCanvas.innerHTML = buildMapSvg(scenario, state.activeDecision ?? state.result?.decision, state.missionProgress);
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
    "drone-point",
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

  map.addLayer({
    id: "drone-point-glow",
    type: "circle",
    source: "drone-point",
    paint: {
      "circle-radius": 18,
      "circle-color": "#00ccbc",
      "circle-opacity": 0.22,
      "circle-blur": 0.4,
    },
  });
  map.addLayer({
    id: "drone-point-layer",
    type: "circle",
    source: "drone-point",
    paint: {
      "circle-radius": 8,
      "circle-color": "#06c167",
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  });
}

function refreshMissionMapScenario(scenario) {
  state.mapScenarioId = scenario.scenario_id;
  clearMissionMarkers();
  
  // Set geographic data for flight path layers
  setSourceData("facility-zones", featureCollection(buildFacilityFeatures(scenario)));
  setSourceData("service-road", lineFeature(serviceRoadCoordinates(scenario)));
  const paths = buildFlightPaths(scenario);
  state.flightPaths = paths;
  setSourceData("route-line", lineFeature(paths.autopilot));
  setSourceData("detour-line", lineFeature([]));
  
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
  const homeEl = createWaypointElement("🥙", "Mustafa's Kebap");
  const homeMarker = new window.maplibregl.Marker({ element: homeEl })
    .setLngLat([scenario.start.lon, scenario.start.lat])
    .addTo(state.map);
  state.waypointMarkers.push(homeMarker);
  
  const startCoord = [scenario.start.lon, scenario.start.lat];
  ensureDroneMarker(startCoord);
  setSourceData("drone-point", pointFeature(startCoord));
  fitMissionBounds(scenario);
}

function createDroneMarkerElement() {
  const el = document.createElement("div");
  el.className = "drone-map-avatar";
  el.innerHTML = `
    <svg class="drone-body-svg" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="20" y1="20" x2="80" y2="80" stroke="#00ccbc" stroke-width="6" stroke-linecap="round"/>
      <line x1="80" y1="20" x2="20" y2="80" stroke="#00ccbc" stroke-width="6" stroke-linecap="round"/>
      <circle cx="20" cy="20" r="10" stroke="rgba(255,255,255,0.45)" stroke-width="2"/>
      <circle cx="80" cy="20" r="10" stroke="rgba(255,255,255,0.45)" stroke-width="2"/>
      <circle cx="20" cy="80" r="10" stroke="rgba(255,255,255,0.45)" stroke-width="2"/>
      <circle cx="80" cy="80" r="10" stroke="rgba(255,255,255,0.45)" stroke-width="2"/>
      <g class="spinning-rotor" style="transform-origin: 20px 20px;">
        <line x1="12" y1="20" x2="28" y2="20" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
      </g>
      <g class="spinning-rotor" style="transform-origin: 80px 20px;">
        <line x1="72" y1="20" x2="88" y2="20" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
      </g>
      <g class="spinning-rotor" style="transform-origin: 20px 80px;">
        <line x1="12" y1="80" x2="28" y2="80" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
      </g>
      <g class="spinning-rotor" style="transform-origin: 80px 80px;">
        <line x1="72" y1="80" x2="88" y2="80" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
      </g>
      <circle cx="50" cy="50" r="14" fill="#0d1420" stroke="#00ccbc" stroke-width="3"/>
      <circle cx="50" cy="50" r="6" fill="#06c167"/>
      <path d="M 50 28 L 46 36 L 54 36 Z" fill="#ffffff"/>
    </svg>
  `;
  return el;
}

function ensureDroneMarker(lngLat) {
  if (!state.mapReady || !state.map) return;
  if (!state.droneMarker) {
    const droneEl = createDroneMarkerElement();
    state.droneMarker = new window.maplibregl.Marker({
      element: droneEl,
      anchor: "center",
      className: "drone-marker",
    })
      .setLngLat(lngLat)
      .addTo(state.map);
  }
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

function createObstacleElement(scenario = state.scenario) {
  const el = document.createElement("div");
  el.className = "obstacle-map-marker";
  el.textContent = scenarioProfile(scenario).zone_marker;
  return el;
}

function updateMissionMap(scenario, decision, progress) {
  if (!state.mapReady || state.mapScenarioId !== scenario.scenario_id) return;
  
  const current = resolveFlightCoordinate(scenario, progress);
  const progressPath = resolveProgressPath(scenario, progress);
  const insideZone = isInsideRestrictedZone(scenario, current);
  
  // Calculate bearing angle to point the drone in direction of movement
  let heading = 0;
  if (progress > 0 && progress < 1) {
    const next = resolveFlightCoordinate(scenario, Math.min(1, progress + 0.01));
    const dy = next[1] - current[1];
    const dx = next[0] - current[0];
    heading = (Math.atan2(dx, dy) * 180) / Math.PI;
  }
  
  ensureDroneMarker(current);
  if (state.droneMarker) {
    state.droneMarker.setLngLat(current);
    state.droneMarker.setRotation(heading);
    state.droneMarker.getElement()?.classList.toggle("breach-active", insideZone);
  }
  setSourceData("drone-point", pointFeature(current, { insideZone }));

  setSourceData("progress-line", lineFeature(progressPath));
  setSourceData(
    "detour-line",
    lineFeature(
      state.rerouteActivated
        ? state.flightPaths?.detour ?? buildFlightPaths(scenario).detour
        : [],
    ),
  );
  
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

function resetTelemetryDisplay() {
  els.batteryVal.textContent = "—";
  els.batteryVal.className = "";
  els.altitudeVal.textContent = "—";
  els.speedVal.textContent = "—";
  els.linkVal.textContent = "—";
  for (let i = 1; i <= 5; i++) {
    const bar = document.querySelector(`#sig-${i}`);
    if (bar) {
      bar.classList.remove("active");
      bar.style.backgroundColor = "";
    }
  }
}

function updateBatteryHUD(progress) {
  const scenario = state.scenario;
  if (!scenario || progress <= 0) {
    if (!els.runButton.disabled) resetTelemetryDisplay();
    return;
  }
  
  const startBattery = Number(scenario.starting_battery_pct ?? scenario.latest_battery_pct ?? 100);
  const latestBattery = Number(scenario.latest_battery_pct ?? startBattery);
  const currentPct = startBattery + (latestBattery - startBattery) * clamp(progress, 0, 1);
  
  els.batteryVal.textContent = `${Math.round(currentPct)}%`;
  els.batteryVal.className = currentPct < 25 ? "text-red" : currentPct < 55 ? "text-amber" : "text-green";
}

function updateTelemetryHUD(progress) {
  const scenario = state.scenario;
  if (!scenario || !scenario.telemetry || !scenario.telemetry.length || progress <= 0) return;
  
  const rows = scenario.telemetry;
  const index = Math.min(rows.length - 1, Math.floor(progress * rows.length));
  const row = rows[index];
  
  // LCD gauges
  els.altitudeVal.textContent = row.altitude_m.toFixed(1);
  els.speedVal.textContent = row.speed_mps.toFixed(1);
  
  els.linkVal.textContent = Math.round(row.link_quality_pct);
  
  // Link signal bars indicators active state
  const activeBars = Math.ceil(row.link_quality_pct / 20); // 0 to 5 bars
  for (let i = 1; i <= 5; i++) {
    const bar = document.querySelector(`#sig-${i}`);
    if (bar) {
      if (i <= activeBars) {
        bar.classList.add("active");
        if (row.link_quality_pct < 40) {
          bar.style.backgroundColor = "var(--accent-red)";
        } else if (row.link_quality_pct < 70) {
          bar.style.backgroundColor = "var(--accent-orange)";
        } else {
          bar.style.backgroundColor = "var(--accent-green)";
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

function buildFlightPaths(scenario) {
  const route = routeCoordinates(scenario);
  const obstacle = scenario.obstacles?.[0];
  if (!obstacle || route.length < 4) {
    return { autopilot: route, detour: route, returnFlight: route, approachFraction: 0.75 };
  }

  const zoneCenter = lngLat(obstacle.location);
  const half = obstacle.requires_detour_m / 2;
  const clearance = half + 85;

  // Autopilot: nominal waypoints then straight into the restricted zone center (breach).
  const autopilot = [route[0], route[1], route[2], zoneCenter];

  // Detour: wide arc east of Alexanderplatz — every bypass point stays outside the zone.
  const detour = [
    route[0],
    route[1],
    route[2],
    offsetCoord(obstacle.location, -clearance * 0.55, -clearance * 1.05),
    offsetCoord(obstacle.location, clearance + 60, -clearance * 0.85),
    offsetCoord(obstacle.location, clearance + 70, clearance * 0.75),
    offsetCoord(obstacle.location, clearance * 0.15, clearance * 1.05),
    route[3],
  ];

  const returnFlight = [route[0], route[1], route[2], route[0]];

  return { autopilot, detour, returnFlight, approachFraction: 0.75 };
}

function getFlightPaths(scenario) {
  return state.flightPaths ?? buildFlightPaths(scenario);
}

function resolveFlightCoordinate(scenario, progress) {
  const paths = getFlightPaths(scenario);
  const routeProgress = clamp(progress, 0, 1);

  if (!scenario.obstacles?.length) {
    return pointAlongGeoPath(paths.autopilot, routeProgress);
  }

  if (state.standardFailure && isBreachDemoScenario(scenario)) {
    return pointAlongGeoPath(paths.autopilot, routeProgress);
  }

  const switchAt = state.rerouteAtProgress;
  const approachEnd = paths.approachFraction;

  if (shouldReturnToStart(scenario)) {
    const outbound = paths.returnFlight.slice(0, 3);
    if (!state.rerouteActivated) {
      const t = Math.min(0.85, (routeProgress / switchAt) * 0.85);
      return pointAlongGeoPath(outbound, t);
    }
    if (routeProgress <= switchAt) {
      return pointAlongGeoPath(outbound, 0.85);
    }
    const returnT = (routeProgress - switchAt) / (1 - switchAt);
    const turnPoint = pointAlongGeoPath(outbound, 0.85);
    return pointAlongGeoPath([turnPoint, paths.returnFlight[0]], returnT);
  }

  if (!shouldUseDetourPath(scenario)) {
    return pointAlongGeoPath(paths.autopilot, routeProgress);
  }

  if (!state.rerouteActivated) {
    const t = Math.min(approachEnd, (routeProgress / switchAt) * approachEnd);
    return pointAlongGeoPath(paths.autopilot, t);
  }

  if (routeProgress <= switchAt) {
    return pointAlongGeoPath(paths.autopilot, approachEnd);
  }

  const detourT = (routeProgress - switchAt) / (1 - switchAt);
  return pointAlongGeoPath(paths.detour.slice(2), detourT);
}

function resolveProgressPath(scenario, progress) {
  const paths = getFlightPaths(scenario);
  const routeProgress = clamp(progress, 0, 1);

  if (!scenario.obstacles?.length) {
    return partialGeoPath(paths.autopilot, routeProgress);
  }

  if (state.standardFailure && isBreachDemoScenario(scenario)) {
    return partialGeoPath(paths.autopilot, routeProgress);
  }

  const switchAt = state.rerouteAtProgress;
  const approachEnd = paths.approachFraction;
  const approachPath = partialGeoPath(paths.autopilot, approachEnd);

  if (shouldReturnToStart(scenario)) {
    const outbound = paths.returnFlight.slice(0, 3);
    if (!state.rerouteActivated || routeProgress <= switchAt) {
      const t = Math.min(0.85, (routeProgress / switchAt) * 0.85);
      return partialGeoPath(outbound, t);
    }
    const returnT = (routeProgress - switchAt) / (1 - switchAt);
    const outboundPath = partialGeoPath(outbound, 0.85);
    const returnPath = partialGeoPath(
      [pointAlongGeoPath(outbound, 0.85), paths.returnFlight[0]],
      returnT,
    );
    return outboundPath.length ? [...outboundPath, ...returnPath.slice(1)] : returnPath;
  }

  if (!shouldUseDetourPath(scenario)) {
    return partialGeoPath(paths.autopilot, routeProgress);
  }

  if (!state.rerouteActivated || routeProgress <= switchAt) {
    const t = Math.min(approachEnd, (routeProgress / switchAt) * approachEnd);
    return partialGeoPath(paths.autopilot, t);
  }

  const detourT = (routeProgress - switchAt) / (1 - switchAt);
  const detourPath = partialGeoPath(paths.detour.slice(2), detourT);
  return detourPath.length ? [...approachPath, ...detourPath.slice(1)] : approachPath;
}

function isInsideRestrictedZone(scenario, coord) {
  const obstacle = scenario.obstacles?.[0];
  if (!obstacle || !coord) return false;
  const half = obstacle.requires_detour_m / 2;
  const [lon, lat] = coord;
  const center = obstacle.location;
  const dLat = Math.abs(lat - center.lat) * 111_320;
  const dLon = Math.abs(lon - center.lon) * 111_320 * Math.cos((center.lat * Math.PI) / 180);
  return dLat <= half && dLon <= half;
}

function animationCoordinates(scenario) {
  const paths = getFlightPaths(scenario);
  if (state.standardFailure && isBreachDemoScenario(scenario)) {
    return paths.autopilot;
  }
  if (!state.rerouteActivated) {
    return paths.autopilot;
  }
  if (shouldReturnToStart(scenario)) {
    return paths.returnFlight;
  }
  if (shouldUseDetourPath(scenario)) {
    return paths.detour;
  }
  return paths.autopilot;
}

function detourCoordinates(scenario) {
  return getFlightPaths(scenario).detour;
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

async function runDeliveryCheckpointMission(apiPromise, provider, started) {
  let resolvedResult = null;
  const resultPromise = apiPromise.then((rawResult) => {
    resolvedResult = decorateProviderResult(rawResult, provider);
    return resolvedResult;
  });

  const previewCheckpoints = buildDeliveryCheckpoints(state.scenario);
  for (let index = 0; index < previewCheckpoints.length; index += 1) {
    const preview = previewCheckpoints[index];
    state.activeCheckpoint = preview;
    state.rerouteAtProgress = waypointDecisionProgress(state.scenario);
    await animateMissionSegment(
      state.missionProgress,
      preview.progress,
      flightSegmentDuration(preview, provider),
      `Flying to ${preview.label}`,
      started,
    );
    setMissionHud(preview.progress, `${preview.label} reached — awaiting Commander`, performance.now() - started);
    renderCheckpointAgents(preview, []);
    await wait(CHECKPOINT_SETTLE_MS);

    const result = resolvedResult ?? (await resultPromise);
    state.result = result;
    state.scenario = result.scenario;
    const checkpoints = buildDeliveryCheckpoints(result.scenario, result);
    const checkpoint = checkpoints[Math.min(index, checkpoints.length - 1)];
    state.activeCheckpoint = checkpoint;
    const stoppedEarly = await revealCheckpointDecision(result, checkpoint, started, checkpoints.length);
    if (stoppedEarly) return result;
    if (checkpoint.final) return result;
  }
  return resolvedResult ?? (await resultPromise);
}

async function revealCheckpointDecision(result, checkpoint, started, checkpointCount) {
  const standard = result.provider === "standard";
  const profile = scenarioProfile(state.scenario);
  const standardFailure = shouldStandardBreachBeforeInstruction(result, checkpoint);
  setMissionStatus(standard ? "Standard inferencing" : "Agents reviewing", standard ? "amber" : "blue");
  els.decisionMessage.textContent = standard
    ? profile.standard_message(STANDARD_TPS)
    : `${checkpoint.label} reached. Vision and Waypoint agents are checking the next leg in parallel.`;
  renderAgents(result.agents, checkpoint, ["vision", "telemetry"]);
  setMissionHud(checkpoint.progress, `${checkpoint.label}: Vision + Waypoint responding`, performance.now() - started);

  if (standardFailure) {
    await wait(STANDARD_FAILURE_HOLD_MS);
    state.standardFailure = true;
    const breachProgress = standardFailureProgress(state.scenario, checkpoint.progress);
    setMissionStatus("Autopilot overrun", "red");
    await animateMissionSegment(
      checkpoint.progress,
      breachProgress,
      STANDARD_FAILURE_DRIFT_MS,
      "Autopilot overrun — awaiting Standard inference",
      started,
    );
  } else {
    await wait(parallelAgentRevealDelay(result.agents, checkpointCount));
  }

  renderAgents(result.agents, checkpoint, "commander");
  setMissionHud(
    state.missionProgress,
    standardFailure ? "Commander response arrived after breach" : `${checkpoint.label}: Commander waiting on comments`,
    performance.now() - started,
  );
  await wait(agentRevealDelay(result.agents, "commander", checkpointCount));

  state.activeDecision = standardFailure
    ? standardFailureDecision(checkpoint, result.decision)
    : decisionForCheckpoint(checkpoint, result.decision);
  if (checkpoint.action !== "continue_mission") {
    if (standardFailure) {
      state.standardFailure = true;
    } else {
      state.rerouteActivated = true;
      state.rerouteAtProgress = checkpoint.progress;
    }
  }
  if (standardFailure) {
    renderStandardFailureDecision(checkpoint, result.decision);
  } else {
    renderDecision(result.decision, checkpoint);
  }
  renderAgents(result.agents, checkpoint);
  renderMission();
  renderFrames();
  renderTrace(result.trace_events, result);
  setMissionStatus(
    standardFailure ? "No-fly breach" : checkpoint.action === "continue_mission" ? "Cleared" : checkpoint.actionLabel,
    standardFailure ? "red" : checkpoint.action === "continue_mission" ? "green" : "amber",
  );
  setMissionHud(
    state.missionProgress,
    standardFailure ? `${profile.zone_short} breach — instruction arrived late` : `${checkpoint.label}: ${checkpoint.actionLabel}`,
    performance.now() - started,
  );
  await wait(CHECKPOINT_AGENT_GAP_MS);
  return standardFailure;
}

function flightSegmentDuration(checkpoint, provider) {
  const providerFactor = provider === "slow_gpu" ? 1.08 : 1;
  if (checkpoint?.waypoint_id === "home" || (checkpoint?.final && checkpoint?.action === "return_to_start")) {
    return Math.round(RETURN_FLIGHT_SEGMENT_MS * providerFactor);
  }
  if (checkpoint?.final && checkpoint?.action === "detour_obstacle") {
    return Math.round(DETOUR_FLIGHT_SEGMENT_MS * providerFactor);
  }
  return Math.round(FLIGHT_SEGMENT_MS * providerFactor);
}

function shouldStandardBreachBeforeInstruction(result, checkpoint) {
  return (
    result.provider === "standard" &&
    checkpoint?.action === "detour_obstacle" &&
    !checkpoint.final &&
    isBreachDemoScenario(state.scenario)
  );
}

function standardFailureProgress(scenario, fromProgress) {
  for (let progress = fromProgress; progress <= 1; progress += 0.002) {
    if (isInsideRestrictedZone(scenario, resolveFlightCoordinate(scenario, progress))) {
      return clamp(progress, fromProgress, 1);
    }
  }
  return 1;
}

function standardFailureDecision(checkpoint, finalDecision) {
  const profile = scenarioProfile(state.scenario);
  return {
    recommended_action: "no_fly_breach",
    confidence: finalDecision.confidence,
    operator_message: `Commander selected ${formatAction(finalDecision.recommended_action)}, but QD-3 had already entered ${profile.zone_short} before the instruction arrived.`,
    why: [
      `Standard GPU response arrived after the safe maneuver window at ${checkpoint.label}.`,
      "Autopilot continued on the direct corridor while waiting for Commander.",
      `${profile.zone_short} restricted airspace was breached before reroute execution.`,
    ],
  };
}

function agentRevealDelay(agents, agentName, checkpointCount) {
  const agent = agents.find((item) => item.agent === agentName);
  const latency = Number(agent?.response_time_ms || 0);
  const standard = agents.some((item) => item.mode === "standard_replay" || item.mode === "slow_gpu");
  if (!latency) return standard ? 700 : 220;
  return clamp(
    Math.round(latency / Math.max(1, checkpointCount)),
    standard ? 650 : 180,
    standard ? 2400 : 520,
  );
}

function parallelAgentRevealDelay(agents, checkpointCount) {
  return Math.max(
    agentRevealDelay(agents, "vision", checkpointCount),
    agentRevealDelay(agents, "telemetry", checkpointCount),
  );
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function animateMissionSegment(fromProgress, toProgress, durationMs, phase, started) {
  return new Promise((resolve) => {
    const start = performance.now();
    const startProgress = clamp(fromProgress, 0, 1);
    const targetProgress = clamp(toProgress, 0, 1);
    const tick = (now) => {
      const elapsed = now - start;
      const ratio = clamp(elapsed / durationMs, 0, 1);
      const progress = startProgress + (targetProgress - startProgress) * ratio;
      state.missionProgress = progress;
      updateMission(progress, now - started, phase);
      if (ratio < 1) {
        state.animationFrame = requestAnimationFrame(tick);
      } else {
        state.animationFrame = null;
        resolve();
      }
    };
    state.animationFrame = requestAnimationFrame(tick);
  });
}

function fitMissionBounds(scenario) {
  const bounds = new window.maplibregl.LngLatBounds();
  for (const coord of [...routeCoordinates(scenario), ...animationCoordinates(scenario), ...detourCoordinates(scenario)]) {
    bounds.extend(coord);
  }
  state.map.fitBounds(bounds, {
    padding: { top: 80, right: 80, bottom: 100, left: 340 },
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

function updateMission(progress, elapsedMs, phaseOverride = null) {
  renderMission();
  renderFrames();
  
  // Real-time signals graph update
  setMissionHud(progress, phaseOverride ?? missionPhase(progress, state.scenario), elapsedMs);

  if (
    isStandardProvider() &&
    isBreachDemoScenario(state.scenario) &&
    els.runButton.disabled &&
    isInsideRestrictedZone(state.scenario, resolveFlightCoordinate(state.scenario, progress))
  ) {
    if (!state.breachOccurred) triggerBreachOverlay();
    setMissionStatus("No-fly breach", "red");
  }
  
  const stage = Math.floor(progress * 6);
  if (stage !== state.agentStage && !state.result) {
    state.agentStage = stage;
    renderRunningAgents(progress);
  }
}

function setMissionHud(progress, phase, elapsedMs = null) {
  const seconds = elapsedMs === null ? progress * (MISSION_DURATION_MS / 1000) : elapsedMs / 1000;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  els.clockVal.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  
  els.phaseText.textContent = phase;
  els.progressPctVal.textContent = `${Math.round(progress * 100)}%`;
  els.progressBarFill.style.width = `${Math.round(progress * 100)}%`;
  updateDeliveryStepper(progress);
  updateETA(progress);
}

function missionPhase(progress, scenario) {
  if (progress <= 0) return "Order confirmed";
  if (state.activeCheckpoint && els.runButton.disabled) return `${state.activeCheckpoint.label} checkpoint`;
  const profile = scenarioProfile(scenario);
  if (state.rerouteActivated && progress >= state.rerouteAtProgress) {
    if (shouldUseDetourPath(scenario)) return profile.detour_phase;
    if (shouldReturnToStart(scenario)) return "Returning to kitchen";
  }
  if (progress < 0.18) return "Picked up from restaurant";
  if (progress < 0.42) return "Flying to you";
  if (progress < 0.66) return scenario?.obstacles?.length ? profile.approach_phase : "Navigating city";
  if (progress < 0.82) return scenario?.obstacles?.length ? "Autopilot corridor ahead" : "Turning onto your street";
  if (progress < 0.96) {
    if (shouldReturnToStart(scenario) && state.rerouteActivated) return "Returning to kitchen";
    return "Verifying safe landing";
  }
  if (shouldReturnToStart(scenario)) return "Back at kitchen";
  return "Arriving soon";
}

function renderOrderCard() {
  const scenario = state.scenario;
  if (!scenario) return;
  const order = ORDER_PROFILES[scenario.scenario_id];
  if (!order) return;

  els.restaurantEmoji.textContent = order.restaurant_emoji;
  els.restaurantName.textContent = order.restaurant;
  els.orderId.textContent = order.order_id;
  els.orderPrice.textContent = order.price;
  els.customerAddress.textContent = order.address;
  els.customerName.textContent = order.customer;
  els.courierName.textContent = order.courier;
  els.etaVal.textContent = `${order.eta_minutes} min`;

  els.orderItems.innerHTML = "";
  for (const item of order.items) {
    const li = document.createElement("li");
    li.textContent = item;
    els.orderItems.append(li);
  }
}

function updateETA(progress) {
  const scenario = state.scenario;
  if (!scenario) return;
  const order = ORDER_PROFILES[scenario.scenario_id];
  if (!order) return;

  const remaining = Math.max(1, Math.round(order.eta_minutes * (1 - progress)));
  els.etaVal.textContent = progress >= 0.96 ? "Soon!" : `${remaining} min`;
}

function updateDeliveryStepper(progress) {
  if (!els.deliveryStepper) return;
  const step = progress <= 0 ? 0 : progress < 0.25 ? 1 : progress < 0.7 ? 2 : 3;

  els.deliveryStepper.querySelectorAll(".step").forEach((el) => {
    const s = Number(el.dataset.step);
    el.classList.remove("active", "done");
    if (s < step) el.classList.add("done");
    else if (s === step) el.classList.add("active");
  });

  els.deliveryStepper.querySelectorAll(".step-line").forEach((el, i) => {
    el.classList.toggle("done", i < step);
  });
}

function resetDecision() {
  els.decisionConfidence.textContent = "--";
  els.decisionAction.textContent = "Waiting";
  els.decisionAction.className = "action-banner";
  els.decisionMessage.textContent = "Your order is being prepared. Hit Track order to watch AI-powered drone routing.";
  els.decisionReasons.innerHTML = "";
  els.totalLatency.textContent = "--";
}

function renderDecision(decision, checkpoint = state.activeCheckpoint) {
  const checkpointDecision = checkpoint ? decisionForCheckpoint(checkpoint, decision) : decision;
  els.decisionConfidence.textContent = `${Math.round(checkpointDecision.confidence * 100)}%`;
  els.decisionAction.textContent = formatAction(checkpointDecision.recommended_action);
  els.decisionAction.className = `action-banner ${checkpointDecision.recommended_action}`;
  els.decisionMessage.textContent = displayCopy(checkpointDecision.operator_message);

  els.decisionReasons.innerHTML = "";
  for (const why of checkpointDecision.why) {
    const p = document.createElement("p");
    p.textContent = displayCopy(why);
    els.decisionReasons.append(p);
  }
}

function renderStandardFailureDecision(checkpoint, finalDecision) {
  const decision = standardFailureDecision(checkpoint, finalDecision);
  els.decisionConfidence.textContent = `${Math.round(decision.confidence * 100)}%`;
  els.decisionAction.textContent = formatAction(decision.recommended_action);
  els.decisionAction.className = `action-banner ${decision.recommended_action}`;
  els.decisionMessage.textContent = displayCopy(decision.operator_message);
  els.decisionReasons.innerHTML = "";
  for (const why of decision.why) {
    const p = document.createElement("p");
    p.textContent = displayCopy(why);
    els.decisionReasons.append(p);
  }
}

function renderEmptyAgents() {
  renderCheckpointAgents(null, []);
}

function renderRunningAgents(progress) {
  const agents = [
    runningAgentState("vision", progress, 0.08, 0.44),
    runningAgentState("telemetry", progress, 0.08, 0.44),
    runningAgentState("commander", progress, 0.58, 0.94),
  ];
  renderCheckpointAgents(state.activeCheckpoint, agents);
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

function renderAgents(agents, checkpoint = state.activeCheckpoint, activeAgent = null) {
  renderCheckpointAgents(checkpoint, agents, activeAgent);
  const criticalPath = agentCriticalPathMs(agents);
  if (!criticalPath) {
    els.totalLatency.textContent = "--";
    return;
  }
  const standard = agents.some((agent) => agent.mode === "standard_replay" || agent.mode === "slow_gpu");
  if (standard) {
    const cerebrasEstimate = Math.round(criticalPath * (STANDARD_TPS / CEREBRAS_TPS));
    els.totalLatency.textContent = `Standard path ${formatLatency(criticalPath)} · Cerebras est ${formatLatency(cerebrasEstimate)}`;
  } else {
    const gpuEstimate = Math.round(criticalPath * (CEREBRAS_TPS / STANDARD_TPS));
    els.totalLatency.textContent = `Cerebras path ${formatLatency(criticalPath)} · Standard sim ${formatLatency(gpuEstimate)}`;
  }
}

function agentCriticalPathMs(agents) {
  const byName = new Map((agents ?? []).map((agent) => [agent.agent, Number(agent.response_time_ms || 0)]));
  return Math.max(byName.get("vision") ?? 0, byName.get("telemetry") ?? 0) + (byName.get("commander") ?? 0);
}

function renderCheckpointAgents(checkpoint, agents, activeAgent = null) {
  const models = buildAgentViewModels(agents, checkpoint, activeAgent);
  els.agentTimeline.innerHTML = `
    ${agentGraph(models, checkpoint)}
    ${models.map(agentCard).join("")}
  `;
}

function agentGraph(agents, checkpoint) {
  const checkpointLabel = checkpoint?.label ?? "Awaiting waypoint";
  const vision = agents.find((agent) => agent.agent === "vision") ?? agents[0];
  const waypoint = agents.find((agent) => agent.agent === "telemetry") ?? agents[1];
  const commander = agents.find((agent) => agent.agent === "commander") ?? agents[2];
  return `
    <div class="agent-graph" aria-label="Agent communication graph">
      ${agentNode(vision, "vision-node")}
      ${agentNode(waypoint, "waypoint-node")}
      <span class="agent-arrow vision-arrow">↘</span>
      <span class="agent-arrow waypoint-arrow">↗</span>
      ${agentNode(commander, "commander-node")}
      <p>${escapeHtml(checkpointLabel)} · Vision + Waypoint feed Commander</p>
    </div>
  `;
}

function agentNode(agent, className) {
  return `
    <div class="agent-node ${escapeHtml(`${className} ${statusTone(agent)}`)}">
      <span>${escapeHtml(agent.shortLabel)}</span>
      <strong>${escapeHtml(agentStatusLabel(agent))}</strong>
    </div>
  `;
}

function agentCard(agent) {
  const modeLabel = agentModeLabel(agent);
  return `
    <article class="agent-card ${escapeHtml(agentStatusClass(agent))}">
      <header>
        <h3>${escapeHtml(agent.displayName ?? AGENT_DISPLAY_NAMES[agent.agent] ?? titleCase(agent.agent))}</h3>
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
      <p class="agent-brief">${escapeHtml(displayCopy(agent.brief ?? "Waiting for waypoint evidence."))}</p>
    </article>
  `;
}

function buildAgentViewModels(agents, checkpoint, activeAgent) {
  const byName = new Map((agents ?? []).map((agent) => [agent.agent, agent]));
  const order = ["vision", "telemetry", "commander"];
  return order.map((name) => {
    const base = byName.get(name) ?? {
      agent: name,
      status: "pending",
      mode: state.activeProvider,
      response_time_ms: "--",
      cache_hit: false,
    };
    const status = statusForAgent(name, base.status, activeAgent, byName.size > 0);
    return {
      ...base,
      status,
      displayName: agentDisplayName(name),
      shortLabel: agentShortLabel(name),
      brief: agentBrief(name, base, checkpoint),
    };
  });
}

function statusForAgent(name, fallbackStatus, activeAgent, hasResults) {
  if (!hasResults) return fallbackStatus ?? "pending";
  if (!activeAgent) return "complete";
  const activeAgents = Array.isArray(activeAgent) ? activeAgent : [activeAgent];
  if (activeAgents.includes(name)) return "running";
  if (activeAgents.includes("commander") && (name === "vision" || name === "telemetry")) return "complete";
  return "queued";
}

function agentDisplayName(name) {
  return AGENT_DISPLAY_NAMES[name] ?? titleCase(name);
}

function agentShortLabel(name) {
  if (name === "telemetry") return "Waypoint";
  if (name === "commander") return "Commander";
  return "Vision";
}

function agentBrief(name, agent, checkpoint) {
  const output = agent.normalized_output ?? {};
  if (name === "vision") {
    const hazards = output.hazards ?? [];
    if (hazards.length) {
      const hazard = hazards[0];
      return `${checkpoint?.label ?? "Route"}: ${formatToken(hazard.type)} at ${formatSeverity(hazard.severity)} severity.`;
    }
    return `${checkpoint?.label ?? "Route"}: sampled frames remain clear.`;
  }
  if (name === "telemetry") {
    const reachability = output.mission_reachability ?? {};
    const flags = output.risk_flags ?? [];
    const critical = flags.find((flag) => flag.severity === "high") ?? flags[0];
    if (critical) {
      return `${formatToken(critical.type)}: ${critical.evidence ?? "metric threshold crossed"}`;
    }
    if (reachability.reserve_after_return_m !== undefined) {
      return `Reserve ${Math.round(reachability.reserve_after_return_m)} m after route and return buffer.`;
    }
    return "Waypoint metrics queued for Commander review.";
  }
  if (name === "commander") {
    if (checkpoint) return checkpoint.message;
    return output.operator_message ?? "Awaiting waypoint evidence before choosing the next leg.";
  }
  return "";
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
  if (agent.mode === "slow_gpu" || agent.mode === "standard_replay") return `Standard ${STANDARD_TPS} tok/s`;
  if (agent.mode === "cerebras") return "Cerebras";
  return String(agent.mode ?? "--");
}

function modeTone(agent) {
  if (agent.status === "fallback") return "warning";
  if (agent.mode === "live" || agent.mode === "cerebras" || agent.mode === "replay") return "success";
  if (agent.mode === "slow_gpu" || agent.mode === "standard_replay") return "danger";
  return "neutral";
}

function inferenceModeLabel(mode) {
  return INFERENCE_MODE_LABELS[mode]?.badge ?? mode;
}

function providerLabel(result) {
  if (result?.provider === "standard") return `Standard · ${STANDARD_TPS} tok/s`;
  if (result?.provider === "cerebras") return `Cerebras · ${CEREBRAS_TPS} tok/s`;
  return isStandardProvider() ? `Standard · ${STANDARD_TPS} tok/s` : `Cerebras · ${CEREBRAS_TPS} tok/s`;
}

function formatLatency(value) {
  if (value === "..." || value === "--") return `${value} ms`;
  const number = Number(value);
  return Number.isFinite(number) ? `${number} ms` : "-- ms";
}

function buildDeliveryCheckpoints(scenario, result = null) {
  if (!scenario?.waypoints?.length) return [];
  const finalAction = result?.decision?.recommended_action ?? scenario.expected_action;
  const waypoints = scenario.waypoints;
  const checkpoints = [];
  const denominator = Math.max(1, waypoints.length);
  for (const [index, waypoint] of waypoints.entries()) {
    const isDecisionWaypoint = index === Math.min(1, waypoints.length - 1);
    const isFinalWaypoint = index === waypoints.length - 1;
    const action = isDecisionWaypoint && finalAction !== "continue_mission" ? finalAction : "continue_mission";
    checkpoints.push(
      deliveryCheckpointModel({
        index,
        waypoint,
        progress: (index + 1) / denominator,
        action: isFinalWaypoint ? finalAction : action,
        final: isFinalWaypoint && finalAction !== "return_to_start",
        scenario,
      }),
    );
    if (isDecisionWaypoint && finalAction === "return_to_start") {
      checkpoints.push(
        deliveryCheckpointModel({
          index: index + 1,
          waypoint: { id: "home", label: "Return-to-start corridor" },
          progress: 1,
          action: finalAction,
          final: true,
          scenario,
        }),
      );
      break;
    }
  }
  return checkpoints;
}

function deliveryCheckpointModel({ index, waypoint, progress, action, final, scenario }) {
  const label = waypoint.id === "home" ? "Kitchen" : `WP${Math.min(index + 1, scenario.waypoints.length)}`;
  const actionLabel = formatAction(action);
  const next = scenario.waypoints[index + 1]?.label ?? "customer drop-off";
  const messageByAction = {
    continue_mission: final
      ? `${label} reached. Commander confirms the route remains safe.`
      : `${label} reached. Commander clears the next leg toward ${next}.`,
    detour_obstacle: final
      ? `${label} reached after reroute. Restricted airspace remains avoided.`
      : `${label} reached. Commander routes around ${scenarioProfile(scenario).zone_short}.`,
    return_to_start:
      waypoint.id === "home"
        ? "Return corridor complete. Commander skipped the delivery endpoint to preserve reserve."
        : `${label} reached. Commander sends the drone back to the kitchen before reserve is exhausted.`,
    hold_position: `${label} reached. Commander holds position pending operator review.`,
  };
  const whyByAction = {
    continue_mission: [
      "Waypoint metrics are inside the current safety envelope.",
      "No Commander override is required for the next leg.",
    ],
    detour_obstacle: [
      `${scenarioProfile(scenario).zone_short} intersects the autopilot corridor.`,
      "The detour preserves delivery progress while avoiding restricted airspace.",
    ],
    return_to_start: [
      "The route no longer preserves enough reserve for delivery and return.",
      "Returning now is the safest reachable action.",
    ],
    hold_position: ["Holding avoids committing to an unsafe next leg."],
  };
  return {
    index,
    waypoint_id: waypoint.id,
    waypoint_label: waypoint.label,
    label,
    progress,
    action,
    actionLabel,
    message: messageByAction[action] ?? messageByAction.continue_mission,
    reasons: whyByAction[action] ?? whyByAction.continue_mission,
    final,
  };
}

function decisionForCheckpoint(checkpoint, finalDecision) {
  const finalAction = finalDecision.recommended_action;
  const confidence = checkpoint.action === finalAction
    ? finalDecision.confidence
    : Math.max(0.72, finalDecision.confidence - 0.08);
  return {
    recommended_action: checkpoint.action,
    confidence,
    operator_message: checkpoint.message,
    why: checkpoint.reasons,
  };
}

function waypointDecisionProgress(scenario) {
  if (!scenario?.waypoints?.length) return 0.38;
  const decisionIndex = Math.min(1, scenario.waypoints.length - 1);
  return (decisionIndex + 1) / Math.max(1, scenario.waypoints.length);
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
  els.traceSummary.textContent = events.length ? `${events.length} events · payloads` : "Idle";
  if (!events.length) {
    els.traceEvents.innerHTML = `<p style="color:var(--text-muted);font-size:0.75rem;margin:0;">Start a delivery run to see the dispatch log.</p>`;
    return;
  }
  
  const metadata = events[0]?.metadata ?? {};
  const phoenix = metadata.phoenix ?? {};
  
  const items = [
    ["Run ID", result?.run_id?.slice(0, 16) ?? "--"],
    ["Inference", inferenceModeLabel(result?.mode ?? state.runMode)],
    ["Provider", providerLabel(result)],
    ["Health", result?.run_health?.label ?? "OK"],
    ["Phoenix", phoenix.enabled ? "Enabled" : "Disabled"],
  ];
  
  els.traceEvents.innerHTML = `
    <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:10px; margin-bottom:12px; padding-bottom:12px; border-bottom:1px solid rgba(0,0,0,0.06);">
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
    <div class="trace-payloads">
      <h3>Agent payloads</h3>
      <pre class="dispatch-pre">${escapeHtml(pretty(agentPayloadLog(result)))}</pre>
    </div>
    <div class="trace-payloads">
      <h3>Event JSONL view</h3>
      <pre class="dispatch-pre">${escapeHtml(pretty(events))}</pre>
    </div>
  `;
}

function agentPayloadLog(result) {
  return (result?.agents ?? []).map((agent) => ({
    agent: agent.agent,
    status: agent.status,
    mode: agent.mode,
    cache_hit: agent.cache_hit,
    response_time_ms: agent.response_time_ms,
    model: agent.model,
    cache_key: agent.cache_key,
    request: agent.request,
    response: agent.response,
    normalized_output: agent.normalized_output,
    error: agent.error,
  }));
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

function formatToken(value) {
  return titleCase(String(value ?? "").replace(/_/g, " "));
}

function formatSeverity(value) {
  return String(value ?? "unknown").toLowerCase();
}

function formatAction(value) {
  if (!value) return "—";
  const labels = {
    continue_mission: "On the way to you",
    return_to_start: "Returning to kitchen",
    hold_position: "Hovering — hold tight",
    detour_obstacle: scenarioProfile(state.scenario).detour_action,
    assessing_route: "Checking best route",
    no_fly_breach: "No-fly breach",
  };
  return labels[value] ?? titleCase(value);
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
  const paths = getFlightPaths(scenario);
  const svgProject = projector([
    scenario.start,
    ...scenario.waypoints,
    ...(scenario.obstacles ?? []).map((o) => o.location),
    ...paths.detour.map(([lon, lat]) => ({ lon, lat })),
  ]);
  const detourPath =
    model.obstacle && state.rerouteActivated && !isStandardProvider()
      ? pathFromPoints(paths.detour.map(([lon, lat]) => svgProject({ lon, lat })))
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
          <circle cx="${p.x}" cy="${p.y}" r="10" fill="#1a1f2e" stroke="${index === 0 ? "var(--accent-green)" : "var(--brand)"}" stroke-width="2"></circle>
          <text x="${p.x + 12}" y="${p.y + 4}" font-size="10" font-family="var(--font-lcd)" font-weight="700" fill="#fff">${index === 0 ? "START" : `WP${index}`}</text>
        </g>
      `).join("")}
      
      <!-- Protected Sanctuary Zone -->
      ${model.obstacle ? `
        <g>
          <circle cx="${model.obstacle.x}" cy="${model.obstacle.y}" r="40" fill="rgba(238, 46, 71, 0.15)" stroke="var(--accent-red)" stroke-width="1.5" stroke-dasharray="4 3"></circle>
          <rect x="${model.obstacle.x - 45}" y="${model.obstacle.y - 12}" width="90" height="24" rx="6" fill="#1a1f2e" stroke="var(--accent-red)" stroke-width="1"></rect>
          <text x="${model.obstacle.x}" y="${model.obstacle.y + 5}" font-size="8" font-family="var(--font-data)" font-weight="900" fill="var(--accent-red)" text-anchor="middle">ALEXANDERPLATZ</text>
        </g>
      ` : ""}
      
      <!-- Drone Icon element -->
      <g transform="translate(${model.current.x} ${model.current.y}) rotate(${heading})">
        <circle r="12" fill="rgba(0, 204, 188, 0.15)" stroke="var(--brand)" stroke-width="1.5"></circle>
        <path d="M 0 -16 L -5 -10 L 5 -10 Z" fill="var(--brand)"></path>
        <line x1="-12" y1="-12" x2="12" y2="12" stroke="#fff" stroke-width="2" opacity="0.7"></line>
        <line x1="12" y1="-12" x2="-12" y2="12" stroke="#fff" stroke-width="2" opacity="0.7"></line>
        <circle r="4" fill="var(--accent-green)"></circle>
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
  const progressGeo = resolveProgressPath(scenario, progress).map(([lon, lat]) => ({ lon, lat }));
  const progressPoints = progressGeo.map(projected);
  const currentCoord = resolveFlightCoordinate(scenario, progress);
  const current = projected({ lon: currentCoord[0], lat: currentCoord[1] });
  
  return {
    route,
    obstacle: scenario.obstacles[0] ? projected(scenario.obstacles[0].location) : null,
    current,
    progressPoints,
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
