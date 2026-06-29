# DroneGuard Cooperative Search

## Core Idea

Build a **2D top-down mission-control game** where two drones cooperate to inspect a facility without entering restricted airspace.

The demo should feel like a tactical command view:

- A flat 2D map.
- Two drones with distinct battery, position, and task status.
- Inspection checkpoints.
- A red restricted/no-fly zone.
- A timer and mission score.
- Three visible agents coordinating the mission.

Do not build around a 3D simulator, FPV mode, physics engine, or external open-source flight simulator. The product should be a focused 2D top-view game designed for a clear hackathon demo.

## Objective / Mission

Mission: complete critical facility inspection coverage using two cooperating drones.

The drones must:

- Inspect all critical checkpoints.
- Avoid the red restricted/no-fly zone.
- Preserve enough battery for each drone to return safely.
- Avoid duplicate work when another critical checkpoint remains uncovered.
- Complete the mission before the inspection window expires.

Win condition:

```text
All critical checkpoints inspected + zero restricted-zone breaches + both drones retain return reserve.
```

Failure conditions:

```text
Any drone enters restricted airspace.
Any drone cannot return safely.
A critical checkpoint is missed before time expires.
Both drones choose the same checkpoint while another critical checkpoint remains uncovered.
```

## Game Setup

### Drone 1

Drone 1 starts closer to the northern inspection corridor.

Strength:

- Faster access to the first high-priority checkpoint.
- Better position for early hazard detection.

Constraint:

- Lower battery.
- Cannot safely take the long detour around the restricted zone and still return.

Expected role:

```text
Inspect nearby checkpoint C2, then return before battery reserve becomes unsafe.
```

### Drone 2

Drone 2 starts closer to the southern corridor.

Strength:

- Higher battery reserve.
- Safer access to the long detour route.

Constraint:

- Farther from the first priority checkpoint.

Expected role:

```text
Accept the handoff from Drone 1 and reroute to checkpoint C3 through the safe southern corridor.
```

### Restricted Zone

A red no-fly zone blocks the direct path between checkpoints.

The mission should force a cooperation decision:

- Drone 1 can reach the near checkpoint but cannot safely complete the detour.
- Drone 2 can take over the farther checkpoint if assigned quickly.
- If the handoff is late, Drone 1 commits too far or Drone 2 misses the safe reroute window.

## Agents

Use exactly three visible agents, each shown as a live panel in the demo.

### 1. Watchtower Agent

Purpose: coordinate the global mission.

The Watchtower Agent sees:

- Both drone positions.
- Battery and return reserve for both drones.
- Active checkpoint assignments.
- Restricted-zone distance for both drones.
- Which checkpoints are complete, pending, or at risk.
- The remaining inspection window.

The Watchtower Agent directs both drone agents, but does not fly them frame-by-frame. It makes high-level task assignments and handoff decisions.

Example output:

```json
{
  "mission_state": "handoff_required",
  "global_risk": "high",
  "assignment": {
    "drone_1": "inspect_c2_then_return",
    "drone_2": "reroute_to_c3"
  },
  "reason": "Drone 1 cannot safely complete C3 and return. Drone 2 has enough reserve for the southern detour."
}
```

### 2. Drone 1 Agent

Purpose: represent Drone 1's local safety and task acceptance.

Drone 1 Agent sees:

- Drone 1 position.
- Drone 1 battery and return reserve.
- Distance to assigned checkpoint.
- Distance to restricted zone.
- Watchtower's requested assignment.

It can accept, reject, or modify Watchtower's assignment if the task is unsafe.

Example output:

```json
{
  "drone_id": "drone_1",
  "status": "accept_partial_task",
  "accepted_task": "inspect_c2_then_return",
  "cannot_do": "c3_detour",
  "reason": "Battery reserve would fall below return threshold after the detour."
}
```

### 3. Drone 2 Agent

Purpose: represent Drone 2's local route and handoff execution.

Drone 2 Agent sees:

- Drone 2 position.
- Drone 2 battery and return reserve.
- Distance to the handoff checkpoint.
- Safe southern detour route.
- Watchtower's requested assignment.

It can accept the handoff, choose a safe route, or refuse if the route becomes unsafe.

Example output:

```json
{
  "drone_id": "drone_2",
  "status": "accept_handoff",
  "accepted_task": "reroute_to_c3",
  "route": "south_safe_corridor",
  "reason": "Drone 2 has enough reserve and can avoid the restricted zone."
}
```

## Agent Collaboration Pattern

The agents should operate as a coordinated team:

1. Watchtower reads the full 2D tactical state.
2. Watchtower proposes assignments for Drone 1 and Drone 2.
3. Drone 1 Agent evaluates whether its assignment is locally safe.
4. Drone 2 Agent evaluates whether it can accept the handoff.
5. Watchtower resolves the final team plan.
6. The game executes the high-level assignments on the 2D map.

Important behavior:

- Drone agents should be able to reject unsafe assignments.
- Watchtower should reroute based on those rejections.
- Cooperation should be visible on the map through task lines, checkpoint claims, and handoff status.

## Demo Story

Show one main story in the 60-second hackathon video.

### Cooperative Handoff Save

1. Two drones start a coordinated facility inspection.
2. Drone 1 heads toward the northern checkpoints.
3. Drone 2 covers the southern corridor.
4. A restricted zone blocks the direct route to checkpoint C3.
5. Watchtower detects that Drone 1 cannot safely complete C3 and return.
6. Drone 1 accepts a partial task: inspect C2, then return.
7. Drone 2 accepts the handoff and reroutes through the southern safe corridor to C3.
8. The team completes all critical checkpoints with no restricted-zone breach.

## Why Cerebras Fast Inference Is Crucial

The handoff decision has an expiration time.

If Watchtower responds quickly:

```text
Drone 1 stops before overcommitting.
Drone 2 starts the safe detour in time.
The mission completes.
```

If the response is slow:

```text
Drone 1 commits too far toward the restricted zone.
Drone 2 misses the safe handoff window.
The team fails despite choosing the same logical plan.
```

Demo comparison:

- **Cerebras mode:** Watchtower coordinates the handoff before the deadline.
- **Slow baseline mode:** the same handoff arrives late, causing a restricted-zone breach or missed checkpoint.

This makes inference speed mission-critical because the agents are coordinating moving drones under a real deadline.

## 2D Top-View UI Requirements

The first screen should be the actual playable mission view, not a landing page.

Required UI:

- Top-down facility map.
- Drone 1 and Drone 2 icons with labels.
- Battery bars for both drones.
- Checkpoint markers with status: pending, assigned, inspected.
- Red restricted/no-fly zone.
- Safe corridor / reroute path.
- Watchtower, Drone 1 Agent, and Drone 2 Agent panels.
- Mission timer.
- Team score.
- Clear final result banner: mission saved or mission failed.
- Cerebras-vs-slow comparison panel.

The game should be understandable from the map alone:

```text
Drone 1 cannot finish alone.
Drone 2 must accept the handoff.
Watchtower coordinates the team fast enough to save the mission.
```

## Required Implementation Scope

Build only what supports the two-drone 2D demo:

- Two controllable simulated drones on a 2D map.
- Checkpoint assignment and completion.
- Restricted-zone breach detection.
- Battery / return-reserve checks.
- Watchtower assignment decision.
- Drone 1 and Drone 2 local acceptance decisions.
- Handoff visualization.
- Fast-vs-slow timing comparison.

Avoid for the hackathon scope:

- 3D flight simulation.
- FPV camera mode.
- Real drone physics.
- Multiplayer.
- Large simulator rewrites.
- Complex collision systems beyond restricted-zone breach checks.
