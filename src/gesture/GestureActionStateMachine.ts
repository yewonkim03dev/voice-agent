import type {
  GestureAction,
  GestureCameraMode,
  GestureName,
  GestureRuntimeState,
  GestureWakeConfig
} from "./GestureWakeConfig.ts";

export interface GestureObservation {
  gesture: GestureName;
  timestamp: number;
  confidence?: number;
}

export interface GestureTrigger {
  action: GestureAction;
  gesture: GestureName;
  state: GestureRuntimeState;
  cameraMode: GestureCameraMode;
  timestamp: number;
}

export class GestureActionStateMachine {
  private readonly config: GestureWakeConfig;
  private readonly now: () => number;
  private state: GestureRuntimeState = "idle";
  private heldGesture: GestureName = "none";
  private heldSince = 0;
  private cooldownUntil = 0;

  constructor(options: {
    config: GestureWakeConfig;
    now?: () => number;
  }) {
    this.config = options.config;
    this.now = options.now ?? Date.now;
  }

  setState(state: GestureRuntimeState): void {
    if (this.state === state) return;
    this.state = state;
    this.resetHold();
  }

  getState(): GestureRuntimeState {
    return this.state;
  }

  getCameraMode(): GestureCameraMode {
    if (!this.config.enabled) return "off";
    switch (this.state) {
      case "idle":
        return "idle";
      case "listening":
      case "pending_approval":
        return "listening";
      case "running":
        return this.config.runningMode === "emergency_only" ? "emergency" : "running";
    }
  }

  observe(observation: GestureObservation): GestureTrigger | null {
    const timestamp = observation.timestamp;
    const action = this.actionForGesture(observation.gesture);

    if (!action || timestamp < this.cooldownUntil) {
      this.updateHeldGesture(observation.gesture, timestamp);
      return null;
    }

    this.updateHeldGesture(observation.gesture, timestamp);

    if (this.heldGesture !== observation.gesture) return null;
    if (timestamp - this.heldSince < this.config.holdMs) return null;

    this.cooldownUntil = timestamp + this.config.cooldownMs;
    this.resetHold();
    return {
      action,
      gesture: observation.gesture,
      state: this.state,
      cameraMode: this.getCameraMode(),
      timestamp
    };
  }

  private actionForGesture(gesture: GestureName): GestureAction | undefined {
    if (!this.config.enabled || gesture === "none") return undefined;

    switch (this.state) {
      case "idle":
        return this.config.bindings.wake === gesture ? "wake" : undefined;
      case "listening":
        return this.config.bindings.stop === gesture ? "stop" : undefined;
      case "running":
        return this.config.bindings.stop === gesture ? "stop" : undefined;
      case "pending_approval":
        if (this.config.bindings.stop === gesture) return "stop";
        return approvalActionForGesture(this.config.bindings, gesture);
    }
  }

  private updateHeldGesture(gesture: GestureName, timestamp: number): void {
    if (gesture === this.heldGesture) return;
    this.heldGesture = gesture;
    this.heldSince = timestamp || this.now();
  }

  private resetHold(): void {
    this.heldGesture = "none";
    this.heldSince = 0;
  }
}

function approvalActionForGesture(
  bindings: GestureWakeConfig["bindings"],
  gesture: GestureName
): GestureAction | undefined {
  if (bindings["approval.once"] === gesture) return "approval.once";
  if (bindings["approval.deny"] === gesture) return "approval.deny";
  if (bindings["approval.session"] === gesture) return "approval.session";
  if (bindings["approval.policy"] === gesture) return "approval.policy";
  return undefined;
}
