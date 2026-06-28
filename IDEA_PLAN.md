# DroneGuard Mission Control

## Base Open-Source Environment

Use [m72900024/LOS-Flight-Simulator](https://github.com/m72900024/LOS-Flight-Simulator) as the base.

Why this base:

- Browser-based Three.js drone simulator.
- Lightweight static app, easy to deploy.
- Already includes drone physics, FPV/LOS camera modes, waypoints, gates, landing zones, HUD, and levels.
- Nonviolent by default.

Scope decision: use **one drone only**. The base simulator is single-drone, so avoiding multi-drone support keeps the demo focused and achievable.

## Objective / Mission

Mission: complete a facility inspection route without entering restricted airspace.

The drone must:

- Visit inspection checkpoints.
- Avoid a red restricted/no-fly zone.
- Stay within safe altitude and speed bounds.
- Complete the route before time expires.

Win condition:

```text
Inspection complete + zero restricted-zone breaches.
```

Failure condition:

```text
Drone enters restricted zone, crashes, or misses the inspection window.
```

## Agents

Use three visible agents, each shown as a live panel in the demo.

### 1. Watchtower Agent

Purpose: understand what is happening right now.

Inputs:

- Drone position, altitude, speed, and heading.
- Active checkpoint.
- Distance to restricted zone.
- Optional FPV or top-down screenshot.

Output:

```text
Drone is approaching C3 and drifting toward Zone A.
Distance to restricted zone: 8.4m.
```

### 2. Risk Agent

Purpose: predict what will go wrong soon.

Inputs:

- Watchtower summary.
- Current telemetry.
- Mission rules.

Output:

```text
HIGH RISK: restricted-zone breach in 4.2 seconds if current heading continues.
```

### 3. Commander Agent

Purpose: choose the next mission action.

Inputs:

- Watchtower output.
- Risk output.
- Mission objective.

Output:

```json
{
  "command": "reroute",
  "target": "safe-waypoint-c2",
  "speed": "medium",
  "operator_message": "Rerouting around Zone A before breach."
}
```

## Demo Story

Show one main story in the 60-second hackathon video.

### Restricted Zone Save

1. The drone starts a normal inspection route.
2. A restricted zone appears near the next checkpoint, or wind/trajectory pushes the drone toward it.
3. Watchtower detects the drift.
4. Risk predicts a breach in a few seconds.
5. Commander reroutes the drone to a safe waypoint.
6. The drone avoids the restricted zone and completes the checkpoint.

Optional second story only if the core demo is already working:

- A checkpoint becomes blocked.
- Commander changes the checkpoint order.
- The drone continues without mission failure.

## Why Cerebras Fast Inference Is Crucial

The agent decision has an expiration time. If the model responds late, the drone has already crossed the restricted zone.

Demo comparison:

- **Cerebras mode:** agents respond in time, and the drone reroutes before breach.
- **Slow baseline mode:** same scenario with delayed response, and the command arrives after breach.

This makes inference speed mission-critical rather than a minor UX improvement.

## Required Modifications

Expected modification level: moderate.

Keep the simulator single-drone and add only what supports the demo:

- Rebrand the experience as DroneGuard Mission Control.
- Select or adapt one LOS level into an inspection route.
- Add restricted-zone geometry and breach detection.
- Expose structured telemetry from the game loop.
- Add Watchtower, Risk, and Commander panels.
- Add a top-down tactical view if time allows.
- Connect Commander outputs to high-level reroute actions.

Avoid for the hackathon scope:

- True multi-drone physics.
- Full multiplayer.
- Complex collision systems.
- Large simulator rewrites.

