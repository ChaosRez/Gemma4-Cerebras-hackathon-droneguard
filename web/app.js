const MISSION_DURATION_MS = 6200;
const FLIGHT_SEGMENT_MS = 1450;
const CHECKPOINT_SETTLE_MS = 180;
const CHECKPOINT_AGENT_GAP_MS = 180;
const STANDARD_GPU_MULTIPLIER = 4;

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
  mapStatusNode: null,
  mapUnavailable: false,
};

const els = {
  scenarioList: document.querySelector("#scenarioList"),
  scenarioCount: document.querySelector("#scenarioCount"),
  modeSelect: document.querySelector("#modeSelect"),
  runButton: document.querySelector("#runButton"),
  runHealth: document.querySelector("#runHealth"),
  missionRisk: document.querySelector("#missionRisk"),
  missionTitle: document.querySelector("#missionTitle"),
  batteryMetric: document.querySelector("#batteryMetric"),
  expectedMetric: document.querySelector("#expectedMetric"),
  runMetric: document.querySelector("#runMetric"),
  missionClock: document.querySelector("#missionClock"),
  missionPhase: document.querySelector("#missionPhase"),
  missionProgressValue: document.querySelector("#missionProgressValue"),
  missionProgressFill: document.querySelector("#missionProgressFill"),
  mapCanvas: document.querySelector("#mapCanvas"),
  frameStrip: document.querySelector("#frameStrip"),
  decisionConfidence: document.querySelector("#decisionConfidence"),
  decisionAction: document.querySelector("#decisionAction"),
  decisionMessage: document.querySelector("#decisionMessage"),
  decisionReasons: document.querySelector("#decisionReasons"),
  agentTimeline: document.querySelector("#agentTimeline"),
  totalLatency: document.querySelector("#totalLatency"),
  traceSummary: document.querySelector("#traceSummary"),
  traceEvents: document.querySelector("#traceEvents"),
};

init();

async function init() {
  renderEmptyAgents();
  const payload = await getJson("/api/scenarios");
  state.scenarios = payload.scenarios;
  state.selectedId = state.scenarios[0]?.scenario_id ?? null;
  renderScenarioList();
  if (state.selectedId) {
    await selectScenario(state.selectedId);
  }
  els.runButton.addEventListener("click", runAgents);
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
  els.runMetric.textContent = "--";
  setRunHealth(noRunHealth());
  state.scenario = await getJson(`/api/scenarios/${encodeURIComponent(scenarioId)}`);
  renderScenarioList();
  renderMission();
  renderFrames();
  setMissionHud(0, "Ready");
  resetDecision();
  renderEmptyAgents();
  renderTrace([]);
}

async function runAgents() {
  if (!state.selectedId) return;
  cancelMissionAnimation();
  state.result = null;
  state.activeDecision = null;
  state.activeCheckpoint = null;
  state.missionProgress = 0;
  state.agentStage = -1;
  els.runButton.disabled = true;
  els.runButton.textContent = "Simulating";
  els.runMetric.textContent = "0.0 s";
  els.decisionConfidence.textContent = "--";
  els.decisionAction.textContent = "Assessing";
  els.decisionMessage.textContent = "The drone will pause at each waypoint while agents check the next leg.";
  els.decisionReasons.innerHTML = "";
  setRunHealth(runningRunHealth(els.modeSelect.value));
  renderCheckpointAgents(buildMissionCheckpoints(state.scenario)[0], []);
  renderMission();
  renderFrames();
  renderTrace([]);

  const started = performance.now();
  const apiPromise = postJson("/api/runs", {
    scenario_id: state.selectedId,
    mode: els.modeSelect.value,
  });

  try {
    const result = await runCheckpointMission(apiPromise, started);
    state.result = result;
    state.scenario = result.scenario;
    state.activeDecision = result.decision;
    state.activeCheckpoint = buildMissionCheckpoints(result.scenario, result).at(-1) ?? null;
    state.missionProgress = 1;
    renderMission();
    renderFrames();
    setMissionHud(1, "Decision ready");
    renderDecision(result.decision, state.activeCheckpoint);
    renderAgents(result.agents, state.activeCheckpoint);
    setRunHealth(result.run_health);
    renderTrace(result.trace_events, result);
    els.runMetric.textContent = `${((performance.now() - started) / 1000).toFixed(1)} s`;
  } catch (error) {
    els.runMetric.textContent = "Error";
    els.decisionAction.textContent = "Error";
    els.decisionMessage.textContent = error.message;
    setRunHealth(errorRunHealth(error));
  } finally {
    els.runButton.disabled = false;
    els.runButton.textContent = "Run Agents";
  }
}

function renderScenarioList() {
  els.scenarioCount.textContent = String(state.scenarios.length);
  els.scenarioList.innerHTML = "";
  for (const scenario of state.scenarios) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "scenario-card";
    button.setAttribute("aria-pressed", String(scenario.scenario_id === state.selectedId));
    button.innerHTML = `
      <h3>${escapeHtml(scenario.label)}</h3>
      <dl>
        <div><dt>Risk</dt><dd>${escapeHtml(scenario.risk_label)}</dd></div>
        <div><dt>Waypoints</dt><dd>${scenario.waypoint_count}</dd></div>
        <div><dt>Restricted</dt><dd>${scenario.obstacle_count}</dd></div>
        <div><dt>Expected</dt><dd>${formatAction(scenario.expected_action)}</dd></div>
      </dl>
    `;
    button.addEventListener("click", () => selectScenario(scenario.scenario_id));
    els.scenarioList.append(button);
  }
}

function renderMission() {
  const scenario = state.scenario;
  if (!scenario) return;
  els.missionRisk.textContent = scenario.risk_label;
  els.missionRisk.className = `status-pill ${scenario.risk_label}`;
  els.missionTitle.textContent = scenario.label;
  updateBatteryMetric(state.missionProgress);
  els.expectedMetric.textContent = formatAction(scenario.expected_action);
  els.runMetric.textContent = state.result?.run_id?.slice(0, 18) ?? els.runMetric.textContent;
  const decision = state.activeDecision;
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
      <div id="missionMap" class="mission-map" aria-label="Mission map"></div>
      <div id="mapStatus" class="map-status"></div>
    `;
    state.mapStatusNode = document.querySelector("#mapStatus");
    try {
      state.map = new window.maplibregl.Map({
        container: "missionMap",
        style: missionMapStyle(),
        center: [scenario.start.lon, scenario.start.lat],
        zoom: 15.8,
        pitch: 0,
        bearing: 0,
        attributionControl: false,
        interactive: true,
      });
    } catch (error) {
      state.mapUnavailable = true;
      state.map = null;
      els.mapCanvas.innerHTML = buildMapSvg(scenario, state.result?.decision, state.missionProgress);
      return;
    }
    state.map.addControl(new window.maplibregl.NavigationControl({ showCompass: true }), "top-right");
    state.map.addControl(new window.maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    state.map.on("load", () => {
      state.mapReady = true;
      installMissionMapLayers(state.map);
      refreshMissionMapScenario(scenario);
      updateMissionMap(scenario, state.activeDecision, state.missionProgress);
    });
    return;
  }

  if (state.mapScenarioId !== scenario.scenario_id && state.mapReady) {
    refreshMissionMapScenario(scenario);
  }
}

function missionMapStyle() {
  return {
    version: 8,
    name: "DroneGuard local mission map",
    sources: {},
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#d8e5df" },
      },
    ],
  };
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
    "mission-points",
    "drone-point",
  ];
  for (const source of sources) {
    if (!map.getSource(source)) {
      map.addSource(source, emptyGeoJsonSource());
    }
  }

  map.addLayer({
    id: "facility-fill",
    type: "fill",
    source: "facility-zones",
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": ["get", "opacity"],
    },
  });
  map.addLayer({
    id: "facility-outline",
    type: "line",
    source: "facility-zones",
    paint: {
      "line-color": "#a9bbb5",
      "line-width": 1,
      "line-opacity": 0.55,
    },
  });
  map.addLayer({
    id: "service-road-casing",
    type: "line",
    source: "service-road",
    paint: {
      "line-color": "#f5f7f4",
      "line-width": 24,
      "line-opacity": 0.78,
    },
  });
  map.addLayer({
    id: "service-road-line",
    type: "line",
    source: "service-road",
    paint: {
      "line-color": "#b7c9c4",
      "line-width": 2,
      "line-dasharray": [3, 4],
    },
  });
  map.addLayer({
    id: "route-casing",
    type: "line",
    source: "route-line",
    paint: {
      "line-color": "#7f9997",
      "line-width": 13,
      "line-opacity": 0.35,
    },
  });
  map.addLayer({
    id: "route-line",
    type: "line",
    source: "route-line",
    paint: {
      "line-color": "#1d5d73",
      "line-width": 5,
      "line-opacity": 0.95,
    },
  });
  map.addLayer({
    id: "progress-line",
    type: "line",
    source: "progress-line",
    paint: {
      "line-color": "#39a06a",
      "line-width": 8,
      "line-opacity": 0.96,
    },
  });
  map.addLayer({
    id: "detour-line",
    type: "line",
    source: "detour-line",
    paint: {
      "line-color": "#bd741f",
      "line-width": 5,
      "line-dasharray": [3, 2],
    },
  });
  map.addLayer({
    id: "return-line",
    type: "line",
    source: "return-line",
    paint: {
      "line-color": "#b34534",
      "line-width": 4,
      "line-dasharray": [2, 2],
      "line-opacity": 0.8,
    },
  });
  map.addLayer({
    id: "scan-line",
    type: "line",
    source: "scan-line",
    paint: {
      "line-color": "#ffffff",
      "line-width": 2,
      "line-opacity": 0.72,
    },
  });
  map.addLayer({
    id: "obstacle-zone",
    type: "fill",
    source: "obstacle-zone",
    paint: {
      "fill-color": "#b34534",
      "fill-opacity": 0.2,
    },
  });
  map.addLayer({
    id: "obstacle-zone-outline",
    type: "line",
    source: "obstacle-zone",
    paint: {
      "line-color": "#b34534",
      "line-width": 2,
      "line-opacity": 0.75,
    },
  });
  map.addLayer({
    id: "mission-point-halo",
    type: "circle",
    source: "mission-points",
    paint: {
      "circle-radius": ["case", ["==", ["get", "kind"], "home"], 13, 11],
      "circle-color": "#fbfcfa",
      "circle-stroke-color": "#15222b",
      "circle-stroke-width": 3,
      "circle-opacity": 0.98,
      "circle-pitch-alignment": "map",
    },
  });
  map.addLayer({
    id: "mission-point-core",
    type: "circle",
    source: "mission-points",
    paint: {
      "circle-radius": 4,
      "circle-color": "#1d5d73",
      "circle-pitch-alignment": "map",
    },
  });
  map.addLayer({
    id: "drone-range",
    type: "circle",
    source: "drone-point",
    paint: {
      "circle-radius": 24,
      "circle-color": "rgba(29, 93, 115, 0.14)",
      "circle-stroke-color": "rgba(29, 93, 115, 0.22)",
      "circle-stroke-width": 1,
      "circle-pitch-alignment": "map",
    },
  });
  map.addLayer({
    id: "drone-body",
    type: "circle",
    source: "drone-point",
    paint: {
      "circle-radius": 11,
      "circle-color": "#10222b",
      "circle-stroke-color": "#e8f1ee",
      "circle-stroke-width": 4,
      "circle-pitch-alignment": "map",
    },
  });
}

function refreshMissionMapScenario(scenario) {
  if (!state.mapReady) return;
  clearMissionMarkers();
  state.mapScenarioId = scenario.scenario_id;

  const missionPoints = [scenario.start, ...scenario.waypoints];
  setSourceData("mission-points", featureCollection(buildMissionPointFeatures(scenario)));
  setSourceData("drone-point", featureCollection([pointFeature(lngLat(scenario.start), { kind: "drone" })]));
  state.waypointMarkers = missionPoints.map((point, index) =>
    new window.maplibregl.Marker({
      element: createWaypointElement(index === 0 ? "H" : String(index), index === 0 ? "Home" : `WP${index}`),
      anchor: "bottom",
      offset: [0, -18],
    })
      .setLngLat([point.lon, point.lat])
      .addTo(state.map),
  );

  if (scenario.obstacles[0]) {
    state.obstacleMarker = new window.maplibregl.Marker({
      element: createObstacleElement(),
      anchor: "bottom-left",
      offset: [12, -10],
    })
      .setLngLat([scenario.obstacles[0].location.lon, scenario.obstacles[0].location.lat])
      .addTo(state.map);
  }

  setSourceData("facility-zones", featureCollection(buildFacilityFeatures(scenario)));
  setSourceData("service-road", lineFeature(serviceRoadCoordinates(scenario)));
  setSourceData("route-line", lineFeature(routeCoordinates(scenario)));
  setSourceData("detour-line", lineFeature(detourCoordinates(scenario)));
  setSourceData("obstacle-zone", featureCollection(buildObstacleFeatures(scenario)));
  fitMissionBounds(scenario);
}

function updateMissionMap(scenario, decision, progress) {
  if (!state.mapReady || state.mapScenarioId !== scenario.scenario_id) return;
  const animation = animationCoordinates(scenario, decision);
  const current = pointAlongGeoPath(animation, progress);
  setSourceData("drone-point", featureCollection([pointFeature(current, { kind: "drone" })]));
  setSourceData("progress-line", lineFeature(partialGeoPath(animation, progress)));
  setSourceData("return-line", lineFeature([current, [scenario.start.lon, scenario.start.lat]]));
  setSourceData("scan-line", lineFeature(scanLineCoordinates(scenario, progress)));
  if (state.mapStatusNode) {
    const action = decision?.recommended_action ?? (progress > 0 && progress < 1 ? "assessing_route" : scenario.expected_action);
    state.mapStatusNode.innerHTML = `
      <span>Route update</span>
      <strong>${escapeHtml(formatAction(action))}</strong>
    `;
  }
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

function clearMissionMarkers() {
  for (const marker of state.waypointMarkers) marker.remove();
  state.waypointMarkers = [];
  state.obstacleMarker?.remove();
  state.obstacleMarker = null;
}

function createWaypointElement(code, label) {
  const node = document.createElement("div");
  node.className = "waypoint-map-marker";
  node.innerHTML = `<strong>${escapeHtml(code)}</strong><span>${escapeHtml(label)}</span>`;
  return node;
}

function createObstacleElement() {
  const node = document.createElement("div");
  node.className = "obstacle-map-marker";
  node.textContent = "Restricted Area";
  return node;
}

function fitMissionBounds(scenario) {
  const bounds = new window.maplibregl.LngLatBounds();
  for (const coord of [
    ...routeCoordinates(scenario),
    ...animationCoordinates(scenario, { recommended_action: scenario.expected_action }),
    ...detourCoordinates(scenario),
  ]) {
    bounds.extend(coord);
  }
  state.map.fitBounds(bounds, {
    padding: { top: 52, right: 62, bottom: 52, left: 62 },
    duration: 0,
    bearing: 0,
    pitch: 0,
  });
}

function routeCoordinates(scenario) {
  return [scenario.start, ...scenario.waypoints].map(lngLat);
}

function animationCoordinates(scenario, decision = state.activeDecision) {
  const route = routeCoordinates(scenario);
  const restrictedArea = scenario.obstacles[0];
  const action = decision?.recommended_action;
  if (action === "return_to_start" && route.length >= 3) {
    return [route[0], route[1], route[2], route[0]];
  }
  if (action === "detour_obstacle" && restrictedArea && route.length >= 4) {
    const detour = detourCoordinates(scenario);
    return [route[0], route[1], route[2], ...detour.slice(1)];
  }
  if (restrictedArea && route.length >= 3) {
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

function buildMissionPointFeatures(scenario) {
  return [scenario.start, ...scenario.waypoints].map((point, index) =>
    pointFeature(lngLat(point), {
      kind: index === 0 ? "home" : "waypoint",
      label: index === 0 ? "Home" : `WP${index}`,
    }),
  );
}

function buildFacilityFeatures(scenario) {
  const center = scenario.waypoints[1] ?? scenario.start;
  return [
    polygonFeature(rectAround(center, -190, 125, 122, 70), { color: "#bdd5d4", opacity: 0.72 }),
    polygonFeature(rectAround(center, 72, -132, 140, 64), { color: "#c8d8bf", opacity: 0.82 }),
    polygonFeature(rectAround(center, -88, -22, 94, 56), { color: "#cfd8cf", opacity: 0.78 }),
    polygonFeature(rectAround(center, 206, 96, 126, 72), { color: "#b9c8c2", opacity: 0.72 }),
  ];
}

function buildObstacleFeatures(scenario) {
  const obstacle = scenario.obstacles[0];
  if (!obstacle) return [];
  return [polygonFeature(rectAround(obstacle.location, 0, 0, 72, 72), { id: obstacle.id })];
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

function pointAlongGeoPath(points, progress) {
  return partialGeoPath(points, progress).at(-1) ?? points[0];
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

function buildMapSvg(scenario, decision, progress) {
  const model = buildMapModel(scenario, progress, decision);
  const routePath = pathFromPoints(model.route);
  const progressPath = pathFromPoints(model.progressPoints);
  const returnPath = `M ${model.current.x} ${model.current.y} L ${model.route[0].x} ${model.route[0].y}`;
  const detourPath = model.obstacle
    ? `M ${model.route[2].x} ${model.route[2].y} C ${model.obstacle.x + 64} ${model.obstacle.y + 76}, ${model.route[3].x - 70} ${model.route[3].y + 84}, ${model.route[3].x} ${model.route[3].y}`
    : "";
  const action = decision?.recommended_action ?? (progress > 0 && progress < 1 ? "assessing_route" : scenario.expected_action);
  const scanX = 42 + progress * 540;
  return `
    <svg class="map-svg" viewBox="0 0 640 430" role="img" aria-label="Mission route">
      <defs>
        <pattern id="mapGrid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#c6d7d1" stroke-width="1" />
        </pattern>
        <clipPath id="mapClip"><rect x="0" y="0" width="640" height="430"></rect></clipPath>
      </defs>
      <rect x="0" y="0" width="640" height="430" fill="#d8e5df"></rect>
      <rect x="0" y="0" width="640" height="430" fill="url(#mapGrid)"></rect>
      <g clip-path="url(#mapClip)">
        <polygon points="0,112 160,82 292,132 640,72 640,0 0,0" fill="#bdd5d4" opacity="0.9"></polygon>
        <polygon points="0,430 0,342 180,310 310,356 640,286 640,430" fill="#c8d8bf"></polygon>
        <path d="M 20 310 C 158 252, 252 248, 384 180 C 464 139, 548 116, 640 88" fill="none" stroke="#edf2ef" stroke-width="30" opacity="0.75"></path>
        <path d="M 20 310 C 158 252, 252 248, 384 180 C 464 139, 548 116, 640 88" fill="none" stroke="#baccc7" stroke-width="2" stroke-dasharray="8 8"></path>
        <rect x="456" y="42" width="128" height="58" rx="5" fill="#b9c8c2" opacity="0.8"></rect>
        <rect x="78" y="92" width="98" height="45" rx="4" fill="#cbd3cc" opacity="0.9"></rect>
        <rect x="430" y="262" width="128" height="48" rx="4" fill="#cfd8cf" opacity="0.86"></rect>
        <path d="${routePath}" fill="none" stroke="#8aa2a0" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" opacity="0.42"></path>
        <path d="${routePath}" fill="none" stroke="#1d5d73" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"></path>
        <path d="${progressPath}" fill="none" stroke="#39a06a" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"></path>
        ${detourPath ? `<path d="${detourPath}" fill="none" stroke="#bd741f" stroke-width="5" stroke-dasharray="12 8" stroke-linecap="round"></path>` : ""}
        <path d="${returnPath}" fill="none" stroke="#b34534" stroke-width="4" stroke-dasharray="8 7" stroke-linecap="round" opacity="${decision ? "1" : "0.34"}"></path>
        <line x1="${scanX}" y1="100" x2="${scanX + 44}" y2="332" stroke="#fbfcfa" stroke-width="2" opacity="${progress > 0 && progress < 1 ? "0.92" : "0"}"></line>
      </g>
      ${model.route
        .map(
          (p, index) => `
          <g>
            <circle cx="${p.x}" cy="${p.y}" r="${index === 0 ? 13 : 11}" fill="#fbfcfa" stroke="#15222b" stroke-width="3"></circle>
            <text x="${p.x + 15}" y="${p.y - 10}" font-size="13" font-weight="800" fill="#15222b">${index === 0 ? "START" : `WP${index}`}</text>
          </g>
        `,
        )
        .join("")}
      ${
        model.obstacle
          ? `<g>
              <rect x="${model.obstacle.x - 22}" y="${model.obstacle.y - 34}" width="68" height="48" rx="6" fill="#b34534"></rect>
              <path d="M ${model.obstacle.x - 10} ${model.obstacle.y + 20} L ${model.obstacle.x + 32} ${model.obstacle.y - 22} M ${model.obstacle.x - 10} ${model.obstacle.y - 22} L ${model.obstacle.x + 32} ${model.obstacle.y + 20}" stroke="#fff" stroke-width="5" stroke-linecap="round"></path>
              <text x="${model.obstacle.x - 36}" y="${model.obstacle.y - 44}" font-size="12" font-weight="900" fill="#8b3025">RESTRICTED AREA</text>
            </g>`
          : ""
      }
      <g transform="translate(${model.current.x} ${model.current.y})">
        <circle r="24" fill="#1d5d73" opacity="0.13"></circle>
        <circle r="16" fill="#10222b"></circle>
        <path d="M -26 0 L 26 0 M 0 -26 L 0 26" stroke="#10222b" stroke-width="5" stroke-linecap="round"></path>
        <circle r="7" fill="#e8f1ee"></circle>
        <circle cx="-31" cy="0" r="7" fill="#e8f1ee" stroke="#10222b" stroke-width="3"></circle>
        <circle cx="31" cy="0" r="7" fill="#e8f1ee" stroke="#10222b" stroke-width="3"></circle>
        <circle cx="0" cy="-31" r="7" fill="#e8f1ee" stroke="#10222b" stroke-width="3"></circle>
        <circle cx="0" cy="31" r="7" fill="#e8f1ee" stroke="#10222b" stroke-width="3"></circle>
      </g>
      <g>
        <rect x="18" y="18" width="276" height="70" rx="8" fill="#fbfcfa" stroke="#cbd6d2"></rect>
        <text x="34" y="45" font-size="13" font-weight="900" fill="#60717b">Route update</text>
        <text x="34" y="71" font-size="20" font-weight="900" fill="#15222b">${formatAction(action)}</text>
      </g>
    </svg>
  `;
}

function buildMapModel(scenario, progress, decision) {
  const geoPoints = [scenario.start, ...scenario.waypoints];
  for (const obstacle of scenario.obstacles) geoPoints.push(obstacle.location);
  for (const row of scenario.telemetry ?? []) geoPoints.push(row);
  const projected = projector(geoPoints);
  const route = [scenario.start, ...scenario.waypoints].map(projected);
  const animationGeo = animationCoordinates(scenario, decision).map(([lon, lat]) => ({ lon, lat }));
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
  const pad = 70;
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
    const segment = distance(start, end);
    if (walked + segment >= target) {
      const ratio = segment ? (target - walked) / segment : 0;
      partial.push(lerpPoint(start, end, ratio));
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
  return points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0);
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function lerpPoint(a, b, ratio) {
  return {
    x: a.x + (b.x - a.x) * ratio,
    y: a.y + (b.y - a.y) * ratio,
  };
}

function renderFrames() {
  const scenario = state.scenario;
  els.frameStrip.innerHTML = "";
  const activeIndex = activeFrameIndex(state.missionProgress, scenario.frame_urls?.length ?? 0);
  for (const [index, frame] of (scenario.frame_urls ?? []).entries()) {
    const card = document.createElement("div");
    card.className = `frame-card${index === activeIndex ? " active" : ""}`;
    card.innerHTML = `<img src="${frame.url}" alt="${escapeHtml(frame.frame_id)}" /><span>${escapeHtml(frame.frame_id)} · ${escapeHtml(frame.timestamp.slice(11, 19))}</span>`;
    els.frameStrip.append(card);
  }
}

function activeFrameIndex(progress, frameCount) {
  if (!frameCount) return -1;
  return Math.min(frameCount - 1, Math.floor(clamp(progress, 0, 0.999) * frameCount));
}

function resetDecision() {
  els.decisionConfidence.textContent = "--";
  els.decisionAction.textContent = "Waiting";
  els.decisionMessage.textContent = "Run the agents to produce a recommendation.";
  els.decisionReasons.innerHTML = "";
  els.totalLatency.textContent = "--";
}

function noRunHealth() {
  return {
    status: "no_run",
    label: "No run",
    tone: "neutral",
    summary: "No agent run has completed.",
  };
}

function runningRunHealth(mode) {
  return {
    status: "running",
    label: mode === "replay" ? "Replaying" : "Running live",
    tone: mode === "replay" ? "neutral" : "success",
    summary: mode === "replay" ? "Loading cached agent responses." : "Calling Cerebras for the selected scenario.",
  };
}

function errorRunHealth(error) {
  return {
    status: "attention",
    label: "Run error",
    tone: "danger",
    summary: error.message,
  };
}

function setRunHealth(health = noRunHealth()) {
  els.runHealth.className = `run-health ${health.tone ?? "neutral"}`;
  els.runHealth.title = health.summary ?? health.label ?? "Run health";
  els.runHealth.innerHTML = `
    <span>Run health</span>
    <strong>${escapeHtml(health.label ?? "--")}</strong>
  `;
}

function renderDecision(decision, checkpoint = state.activeCheckpoint) {
  const checkpointDecision = checkpoint ? decisionForCheckpoint(checkpoint, decision) : decision;
  els.decisionConfidence.textContent = `${Math.round(checkpointDecision.confidence * 100)}%`;
  els.decisionAction.textContent = formatAction(checkpointDecision.recommended_action);
  els.decisionMessage.textContent = displayCopy(checkpointDecision.operator_message);
  els.decisionReasons.innerHTML = "";
  for (const reason of checkpointDecision.why) {
    const row = document.createElement("p");
    row.textContent = displayCopy(reason);
    els.decisionReasons.append(row);
  }
}

function renderEmptyAgents() {
  renderCheckpointAgents(null, []);
}

function renderRunningAgents(progress) {
  const agents = [
    runningAgentState("vision", progress, 0.08, 0.36),
    runningAgentState("telemetry", progress, 0.22, 0.58),
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
    mode: els.modeSelect.value,
    response_time_ms: status === "running" ? "..." : "--",
  };
}

function renderAgents(agents, checkpoint = state.activeCheckpoint, activeAgent = null) {
  renderCheckpointAgents(checkpoint, agents, activeAgent);
  const criticalPath = agentCriticalPathMs(agents);
  if (criticalPath > 0) {
    const gpuMs = Math.round(criticalPath * STANDARD_GPU_MULTIPLIER);
    els.totalLatency.textContent = `Cerebras path ${formatLatency(criticalPath)} | GPU sim ${formatLatency(gpuMs)}`;
  } else {
    els.totalLatency.textContent = "--";
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
      <p>${escapeHtml(checkpointLabel)}</p>
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
        <h3>${escapeHtml(agent.displayName ?? titleCase(agent.agent))}</h3>
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
      mode: els.modeSelect.value ?? "--",
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
  if (name === "telemetry") return "Waypoint";
  if (name === "commander") return "Commander";
  return "Vision";
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
  return String(agent.mode ?? "--");
}

function modeTone(agent) {
  if (agent.status === "fallback") return "warning";
  if (agent.mode === "live") return "success";
  return "neutral";
}

function formatLatency(value) {
  if (value === "..." || value === "--") return `${value} ms`;
  const number = Number(value);
  return Number.isFinite(number) ? `${number} ms` : "-- ms";
}

function buildMissionCheckpoints(scenario, result = null) {
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
      checkpointModel({
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
        checkpointModel({
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

function checkpointModel({ index, waypoint, progress, action, final, scenario }) {
  const label = waypoint.id === "home" ? "Home" : `WP${Math.min(index + 1, scenario.waypoints.length)}`;
  const actionLabel = formatAction(action);
  const next = scenario.waypoints[index + 1]?.label ?? "mission endpoint";
  const messageByAction = {
    continue_mission: final
      ? `${label} reached. Commander confirms the route remains safe.`
      : `${label} reached. Commander clears the next leg toward ${next}.`,
    detour_obstacle: final
      ? `${label} reached after reroute. Restricted airspace remains avoided.`
      : `${label} reached. Commander overrides autopilot and routes around restricted airspace.`,
    return_to_start:
      waypoint.id === "home"
        ? "Return corridor active. Commander keeps the mission endpoint skipped to preserve reserve."
        : `${label} reached. Commander stops the route here and sends the drone back to start.`,
    hold_position: `${label} reached. Commander holds position pending operator review.`,
  };
  const whyByAction = {
    continue_mission: [
      "Waypoint metrics are inside the current safety envelope.",
      "No Commander override is required for the next leg.",
    ],
    detour_obstacle: [
      "Restricted airspace intersects the autopilot corridor.",
      "The detour preserves mission progress while avoiding the restricted zone.",
    ],
    return_to_start: [
      "The route no longer preserves enough reserve for final delivery and return.",
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
  const confidence = checkpoint.action === finalAction ? finalDecision.confidence : Math.max(0.72, finalDecision.confidence - 0.08);
  return {
    recommended_action: checkpoint.action,
    confidence,
    operator_message: checkpoint.message,
    why: checkpoint.reasons,
  };
}

async function runCheckpointMission(apiPromise, started) {
  let resolvedResult = null;
  const resultPromise = apiPromise.then((result) => {
    resolvedResult = result;
    return result;
  });
  const previewCheckpoints = buildMissionCheckpoints(state.scenario);
  for (let index = 0; index < previewCheckpoints.length; index += 1) {
    const preview = previewCheckpoints[index];
    state.activeCheckpoint = preview;
    await animateMissionSegment(state.missionProgress, preview.progress, FLIGHT_SEGMENT_MS, `Flying to ${preview.label}`, started);
    setMissionHud(preview.progress, `${preview.label} reached — awaiting Commander`, performance.now() - started);
    renderCheckpointAgents(preview, []);
    await wait(CHECKPOINT_SETTLE_MS);

    const result = resolvedResult ?? (await resultPromise);
    state.result = result;
    state.scenario = result.scenario;
    const checkpoints = buildMissionCheckpoints(result.scenario, result);
    const checkpoint = checkpoints[Math.min(index, checkpoints.length - 1)];
    state.activeCheckpoint = checkpoint;
    await revealCheckpointDecision(result, checkpoint, started, checkpoints.length);
    if (checkpoint.final) return result;
  }
  return resolvedResult ?? (await resultPromise);
}

async function revealCheckpointDecision(result, checkpoint, started, checkpointCount) {
  renderAgents(result.agents, checkpoint, ["vision", "telemetry"]);
  setMissionHud(checkpoint.progress, `${checkpoint.label}: Vision + Waypoint responding`, performance.now() - started);
  await wait(parallelAgentRevealDelay(result.agents, checkpointCount));

  renderAgents(result.agents, checkpoint, "commander");
  setMissionHud(checkpoint.progress, `${checkpoint.label}: Commander waiting on comments`, performance.now() - started);
  await wait(agentRevealDelay(result.agents, "commander", checkpointCount));

  state.activeDecision = decisionForCheckpoint(checkpoint, result.decision);
  renderDecision(result.decision, checkpoint);
  renderAgents(result.agents, checkpoint);
  renderMission();
  renderFrames();
  renderTrace(result.trace_events, result);
  setRunHealth(result.run_health);
  setMissionHud(checkpoint.progress, `${checkpoint.label}: ${checkpoint.actionLabel}`, performance.now() - started);
  await wait(CHECKPOINT_AGENT_GAP_MS);
}

function agentRevealDelay(agents, agentName, checkpointCount) {
  const agent = agents.find((item) => item.agent === agentName);
  const latency = Number(agent?.response_time_ms || 0);
  if (!latency) return 220;
  return clamp(Math.round(latency / Math.max(1, checkpointCount)), 180, 520);
}

function parallelAgentRevealDelay(agents, checkpointCount) {
  return Math.max(agentRevealDelay(agents, "vision", checkpointCount), agentRevealDelay(agents, "telemetry", checkpointCount));
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
  setMissionHud(progress, phaseOverride ?? missionPhase(progress, state.scenario), elapsedMs);
  const stage = Math.floor(progress * 6);
  if (stage !== state.agentStage && !state.result) {
    state.agentStage = stage;
    renderRunningAgents(progress);
  }
  els.runMetric.textContent = `${(elapsedMs / 1000).toFixed(1)} s`;
}

function setMissionHud(progress, phase, elapsedMs = null) {
  const seconds = elapsedMs === null ? progress * (MISSION_DURATION_MS / 1000) : elapsedMs / 1000;
  els.missionClock.textContent = `${seconds.toFixed(1)} s`;
  els.missionPhase.textContent = phase;
  els.missionProgressValue.textContent = `${Math.round(progress * 100)}%`;
  els.missionProgressFill.style.width = `${Math.round(progress * 100)}%`;
}

function missionPhase(progress, scenario) {
  if (progress <= 0) return "Ready";
  if (progress < 0.18) return "Departing start";
  if (progress < 0.42) return "Waypoint 1";
  if (progress < 0.66) return "Waypoint 2";
  if (progress < 0.82) return scenario?.obstacles?.length ? "Restricted area scan" : "Final leg";
  if (progress < 0.96) return "Reserve check";
  return "Decision ready";
}

function updateBatteryMetric(progress) {
  const scenario = state.scenario;
  const startBattery = Number(scenario.starting_battery_pct ?? scenario.latest_battery_pct ?? 0);
  const latestBattery = Number(scenario.latest_battery_pct ?? startBattery);
  const value = startBattery + (latestBattery - startBattery) * clamp(progress, 0, 1);
  els.batteryMetric.textContent = `${Math.round(value)}%`;
}

function cancelMissionAnimation() {
  if (state.animationFrame) {
    cancelAnimationFrame(state.animationFrame);
    state.animationFrame = null;
  }
}

function renderTrace(events, result = state.result) {
  els.traceSummary.textContent = events.length ? `${events.length} events` : "No run";
  if (!events.length) {
    els.traceEvents.innerHTML = "";
    return;
  }
  const scenarioMetadata = events[0]?.metadata ?? {};
  const phoenix = scenarioMetadata.phoenix ?? {};
  const overviewItems = [
    ["Run", result?.run_id ?? events[0]?.run_id ?? "--"],
    ["Health", result?.run_health?.label ?? "--"],
    ["Runtime", scenarioMetadata.agent_runtime ?? "--"],
    ["Phoenix", phoenix.enabled ? `${phoenix.project ?? "enabled"}` : phoenix.reason ?? "disabled"],
    ["Mode", result?.mode ?? scenarioMetadata.mode ?? "--"],
  ];
  els.traceEvents.innerHTML = `
    <div class="trace-overview">
      ${overviewItems
        .map(
          ([label, value]) => `
            <div>
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(value)}</strong>
            </div>
          `,
        )
        .join("")}
    </div>
    <div class="event-list">
      ${events
        .map(
          (event) => `
        <div class="event-row">
          <strong>${escapeHtml(event.event_type)}</strong>
          <span>${escapeHtml(event.message)}</span>
        </div>
      `,
        )
        .join("")}
    </div>
    <div class="payload-log">
      <h3>Agent Payloads</h3>
      <pre>${escapeHtml(pretty(agentPayloadLog(result)))}</pre>
    </div>
    <div class="payload-log trace-json">
      <h3>Event JSONL View</h3>
      <pre>${escapeHtml(pretty(events))}</pre>
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
