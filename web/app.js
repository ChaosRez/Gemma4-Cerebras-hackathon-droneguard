const state = {
  scenarios: [],
  selectedId: null,
  scenario: null,
  result: null,
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
  state.selectedId = scenarioId;
  state.result = null;
  state.scenario = await getJson(`/api/scenarios/${encodeURIComponent(scenarioId)}`);
  renderScenarioList();
  renderMission();
  renderFrames();
  resetDecision();
  renderEmptyAgents();
  renderTrace([]);
}

async function runAgents() {
  if (!state.selectedId) return;
  els.runButton.disabled = true;
  els.runButton.textContent = "Running";
  els.runMetric.textContent = "Running";
  markAgentsRunning();
  try {
    state.result = await postJson("/api/runs", {
      scenario_id: state.selectedId,
      mode: els.modeSelect.value,
    });
    state.scenario = state.result.scenario;
    renderMission();
    renderFrames();
    renderDecision(state.result.decision);
    renderAgents(state.result.agents);
    renderTrace(state.result.trace_events);
    els.runMetric.textContent = `${state.result.total_run_time_ms} ms`;
  } catch (error) {
    els.runMetric.textContent = "Error";
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
  els.batteryMetric.textContent = `${scenario.latest_battery_pct}%`;
  els.expectedMetric.textContent = formatAction(scenario.expected_action);
  els.runMetric.textContent = state.result?.run_id?.slice(0, 18) ?? "--";
  els.mapCanvas.innerHTML = buildMapSvg(scenario, state.result?.decision);
}

function buildMapSvg(scenario, decision) {
  const points = [scenario.start, ...scenario.waypoints];
  for (const obstacle of scenario.obstacles) points.push(obstacle.location);
  const projected = projector(points);
  const route = [scenario.start, ...scenario.waypoints].map(projected);
  const obstacle = scenario.obstacles[0] ? projected(scenario.obstacles[0].location) : null;
  const current = scenario.telemetry?.length
    ? projected(scenario.telemetry[scenario.telemetry.length - 1])
    : route[Math.max(0, route.length - 2)];
  const routePath = route.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const returnPath = `M ${current.x} ${current.y} L ${route[0].x} ${route[0].y}`;
  const detourPath = obstacle
    ? `M ${route[2].x} ${route[2].y} C ${obstacle.x + 65} ${obstacle.y + 76}, ${route[3].x - 70} ${route[3].y + 85}, ${route[3].x} ${route[3].y}`
    : "";
  const action = decision?.recommended_action ?? scenario.expected_action;
  return `
    <svg class="map-svg" viewBox="0 0 640 430" role="img" aria-label="Mission route">
      <rect x="0" y="0" width="640" height="430" fill="#dce7e2"></rect>
      ${gridLines()}
      <path d="${routePath}" fill="none" stroke="#1d5d73" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path>
      ${detourPath ? `<path d="${detourPath}" fill="none" stroke="#bd741f" stroke-width="5" stroke-dasharray="12 8" stroke-linecap="round"></path>` : ""}
      <path d="${returnPath}" fill="none" stroke="#b34534" stroke-width="4" stroke-dasharray="8 7" stroke-linecap="round"></path>
      ${route
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
        obstacle
          ? `<g>
              <rect x="${obstacle.x - 20}" y="${obstacle.y - 34}" width="64" height="46" rx="6" fill="#b34534"></rect>
              <text x="${obstacle.x - 12}" y="${obstacle.y - 7}" font-size="12" font-weight="900" fill="#fff">OBS</text>
            </g>`
          : ""
      }
      <g>
        <circle cx="${current.x}" cy="${current.y}" r="17" fill="#10222b"></circle>
        <path d="M ${current.x - 26} ${current.y} L ${current.x + 26} ${current.y} M ${current.x} ${current.y - 26} L ${current.x} ${current.y + 26}" stroke="#10222b" stroke-width="5" stroke-linecap="round"></path>
        <circle cx="${current.x}" cy="${current.y}" r="7" fill="#e8f1ee"></circle>
      </g>
      <g>
        <rect x="20" y="20" width="260" height="64" rx="8" fill="#fbfcfa" stroke="#cbd6d2"></rect>
        <text x="36" y="46" font-size="13" font-weight="900" fill="#60717b">Route update</text>
        <text x="36" y="70" font-size="20" font-weight="900" fill="#15222b">${formatAction(action)}</text>
      </g>
    </svg>
  `;
}

function gridLines() {
  let out = "";
  for (let x = 0; x <= 640; x += 40) out += `<line x1="${x}" y1="0" x2="${x}" y2="430" stroke="#c7d5d0" stroke-width="1"></line>`;
  for (let y = 0; y <= 430; y += 40) out += `<line x1="0" y1="${y}" x2="640" y2="${y}" stroke="#c7d5d0" stroke-width="1"></line>`;
  return out;
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

function renderFrames() {
  const scenario = state.scenario;
  els.frameStrip.innerHTML = "";
  for (const frame of scenario.frame_urls ?? []) {
    const card = document.createElement("div");
    card.className = "frame-card";
    card.innerHTML = `<img src="${frame.url}" alt="${escapeHtml(frame.frame_id)}" /><span>${escapeHtml(frame.frame_id)} · ${escapeHtml(frame.timestamp.slice(11, 19))}</span>`;
    els.frameStrip.append(card);
  }
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

function markAgentsRunning() {
  els.agentTimeline.innerHTML = ["vision", "telemetry", "commander"]
    .map((name) => agentCard({ agent: name, status: "running", mode: els.modeSelect.value, response_time_ms: "--" }))
    .join("");
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
