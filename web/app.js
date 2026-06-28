const MISSION_DURATION_MS = 6200;

const state = {
  scenarios: [],
  selectedId: null,
  scenario: null,
  result: null,
  missionProgress: 0,
  animationFrame: null,
  agentStage: -1,
};

const els = {
  scenarioList: document.querySelector("#scenarioList"),
  scenarioCount: document.querySelector("#scenarioCount"),
  modeSelect: document.querySelector("#modeSelect"),
  runButton: document.querySelector("#runButton"),
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
  state.missionProgress = 0;
  state.agentStage = -1;
  els.runMetric.textContent = "--";
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
  state.missionProgress = 0;
  state.agentStage = -1;
  els.runButton.disabled = true;
  els.runButton.textContent = "Simulating";
  els.runMetric.textContent = "0.0 s";
  els.decisionConfidence.textContent = "--";
  els.decisionAction.textContent = "Assessing";
  els.decisionMessage.textContent = "Mission evidence is streaming through Vision, Telemetry, and Commander.";
  els.decisionReasons.innerHTML = "";
  renderRunningAgents(0);
  renderMission();
  renderFrames();
  renderTrace([]);

  const started = performance.now();
  const apiPromise = postJson("/api/runs", {
    scenario_id: state.selectedId,
    mode: els.modeSelect.value,
  });
  const animationPromise = runMissionAnimation(MISSION_DURATION_MS);

  try {
    const result = await apiPromise;
    await animationPromise;
    state.result = result;
    state.scenario = result.scenario;
    state.missionProgress = 1;
    renderMission();
    renderFrames();
    setMissionHud(1, "Decision ready");
    renderDecision(result.decision);
    renderAgents(result.agents);
    renderTrace(result.trace_events);
    els.runMetric.textContent = `${((performance.now() - started) / 1000).toFixed(1)} s`;
  } catch (error) {
    await animationPromise.catch(() => undefined);
    els.runMetric.textContent = "Error";
    els.decisionAction.textContent = "Error";
    els.decisionMessage.textContent = error.message;
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
        <div><dt>Obstacles</dt><dd>${scenario.obstacle_count}</dd></div>
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
  els.mapCanvas.innerHTML = buildMapSvg(scenario, state.result?.decision, state.missionProgress);
}

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
              <text x="${model.obstacle.x - 17}" y="${model.obstacle.y - 44}" font-size="12" font-weight="900" fill="#8b3025">OBSTACLE</text>
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

function buildMapModel(scenario, progress) {
  const geoPoints = [scenario.start, ...scenario.waypoints];
  for (const obstacle of scenario.obstacles) geoPoints.push(obstacle.location);
  for (const row of scenario.telemetry ?? []) geoPoints.push(row);
  const projected = projector(geoPoints);
  const route = [scenario.start, ...scenario.waypoints].map(projected);
  const animationGeo =
    scenario.telemetry?.length > 1
      ? scenario.telemetry.map((row) => ({ lat: row.lat, lon: row.lon }))
      : [scenario.start, ...scenario.waypoints];
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

function renderDecision(decision) {
  els.decisionConfidence.textContent = `${Math.round(decision.confidence * 100)}%`;
  els.decisionAction.textContent = formatAction(decision.recommended_action);
  els.decisionMessage.textContent = decision.operator_message;
  els.decisionReasons.innerHTML = "";
  for (const reason of decision.why) {
    const row = document.createElement("p");
    row.textContent = reason;
    els.decisionReasons.append(row);
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
    mode: els.modeSelect.value,
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
  return `
    <article class="agent-card">
      <header>
        <h3>${titleCase(agent.agent)}</h3>
        <small>${agent.status} · ${agent.mode} · ${agent.response_time_ms} ms</small>
      </header>
      ${output ? `<pre>${escapeHtml(output)}</pre>` : ""}
      ${
        raw
          ? `<details><summary>Raw payloads</summary><pre>${escapeHtml(pretty({ request: agent.request, response: agent.response, cache_key: agent.cache_key, error: agent.error }))}</pre></details>`
          : ""
      }
    </article>
  `;
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
  renderFrames();
  setMissionHud(progress, missionPhase(progress, state.scenario));
  const stage = Math.floor(progress * 6);
  if (stage !== state.agentStage && !state.result) {
    state.agentStage = stage;
    renderRunningAgents(progress);
  }
  els.runMetric.textContent = `${(elapsedMs / 1000).toFixed(1)} s`;
}

function setMissionHud(progress, phase) {
  const seconds = progress * (MISSION_DURATION_MS / 1000);
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
  if (progress < 0.82) return scenario?.obstacles?.length ? "Obstacle scan" : "Final leg";
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

function renderTrace(events) {
  els.traceSummary.textContent = events.length ? `${events.length} events` : "No run";
  if (!events.length) {
    els.traceEvents.innerHTML = "";
    return;
  }
  els.traceEvents.innerHTML = `
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
    <pre>${escapeHtml(pretty(events))}</pre>
  `;
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
  return titleCase(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
