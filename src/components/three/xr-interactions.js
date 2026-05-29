// XR-native interaction helpers for the Levitating City Twin.
//
// Three knobs Phase 5 adds on top of the desktop pipeline:
//   1. Thumbstick scaling   -- per-frame poll of the controller gamepad.
//   2. Two-hand pinch scale -- baseline-distance ratio between hands.
//   3. Surface placement    -- continuous hit-test + select-to-place.
//
// Each hook is a no-op when its `enabled` flag is false so it can sit in
// the React tree unconditionally and react to AR session start / end.

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import {
  useXRInputSourceState,
  useXRInputSourceEvent,
  useXRHitTest,
} from "@react-three/xr";

// Scale bounds, in "fraction of WORLD_SIZE units". With WORLD_SIZE = 12
// (long axis of the Manhattan platform), real-world long axis ≈ scale × 12 m.
export const AR_SCALE_MIN = 0.06;
export const AR_SCALE_MAX = 0.22;
export const AR_SCALE_INITIAL = 0.12;

// Default spawn: lower and closer so the model fills more of the view.
export const AR_POSITION_INITIAL = [0, 0.75, -0.45];

// Rotate the BoroughTwin in AR so the long platform edge (north–south)
// runs horizontally left-to-right in the headset instead of into depth.
export const AR_MODEL_ROTATION_Y = Math.PI / 2;

const THUMB_DEADZONE = 0.15;

function pickThumbY(right, left) {
  const ry = right?.gamepad?.["xr-standard-thumbstick"]?.yAxis;
  if (typeof ry === "number" && Math.abs(ry) > THUMB_DEADZONE) return ry;
  const ly = left?.gamepad?.["xr-standard-thumbstick"]?.yAxis;
  if (typeof ly === "number" && Math.abs(ly) > THUMB_DEADZONE) return ly;
  return 0;
}

/**
 * Per-frame poll of the right (preferred) or left thumbstick Y-axis to
 * drive an exponential scale change. Forward stick shrinks the model,
 * pulling back grows it -- matching the standard "push to push away" feel.
 * Clamped to [min, max]; no-op while disabled.
 */
export function useXRThumbstickScale({
  scaleRef,
  setScale,
  enabled,
  min = AR_SCALE_MIN,
  max = AR_SCALE_MAX,
  ratePerSecond = 1.2,
}) {
  const right = useXRInputSourceState("controller", "right");
  const left = useXRInputSourceState("controller", "left");

  useFrame((_, delta) => {
    if (!enabled) return;
    const y = pickThumbY(right, left);
    if (y === 0) return;
    // Clamp delta -- if the headset stalls for a beat we don't want one
    // frame of input to leap the scale to the bound.
    const dt = Math.min(delta, 0.1);
    const factor = 1 - y * ratePerSecond * dt;
    const next = THREE.MathUtils.clamp(scaleRef.current * factor, min, max);
    if (Math.abs(next - scaleRef.current) > 1e-5) {
      scaleRef.current = next;
      setScale(next);
    }
  });
}

/**
 * Two-hand pinch -> scale gesture. While both hands are pinching, the
 * model is rescaled by the ratio of current inter-hand distance to the
 * distance recorded at pinch-start. Composes with thumbstick scaling
 * because both update the same source-of-truth scale state.
 *
 * The select pipeline still fires for individual hands -- this hook only
 * activates the gesture once both pinches are sustained simultaneously,
 * so a single hand pinching a building still drives onSelect normally.
 */
export function useXRTwoHandPinchScale({
  scaleRef,
  setScale,
  enabled,
  min = AR_SCALE_MIN,
  max = AR_SCALE_MAX,
}) {
  const left = useXRInputSourceState("hand", "left");
  const right = useXRInputSourceState("hand", "right");

  const leftPinching = useRef(false);
  const rightPinching = useRef(false);
  const baseline = useRef(null);

  const tmpL = useMemo(() => new THREE.Vector3(), []);
  const tmpR = useMemo(() => new THREE.Vector3(), []);

  useXRInputSourceEvent(
    left?.inputSource,
    "selectstart",
    () => {
      leftPinching.current = true;
    },
    [left?.inputSource]
  );
  useXRInputSourceEvent(
    left?.inputSource,
    "selectend",
    () => {
      leftPinching.current = false;
      baseline.current = null;
    },
    [left?.inputSource]
  );
  useXRInputSourceEvent(
    right?.inputSource,
    "selectstart",
    () => {
      rightPinching.current = true;
    },
    [right?.inputSource]
  );
  useXRInputSourceEvent(
    right?.inputSource,
    "selectend",
    () => {
      rightPinching.current = false;
      baseline.current = null;
    },
    [right?.inputSource]
  );

  useFrame(() => {
    if (!enabled) return;
    if (!leftPinching.current || !rightPinching.current) return;
    const lo = left?.object;
    const ro = right?.object;
    if (!lo || !ro) return;
    lo.getWorldPosition(tmpL);
    ro.getWorldPosition(tmpR);
    const dist = tmpL.distanceTo(tmpR);
    if (!Number.isFinite(dist) || dist < 1e-4) return;
    if (!baseline.current) {
      baseline.current = { dist, scale: scaleRef.current };
      return;
    }
    const ratio = dist / baseline.current.dist;
    const next = THREE.MathUtils.clamp(
      baseline.current.scale * ratio,
      min,
      max
    );
    if (Math.abs(next - scaleRef.current) > 1e-5) {
      scaleRef.current = next;
      setScale(next);
    }
  });
}

/**
 * Hit-test driven placement reticle for AR. Mounted only while the user
 * is in "Place" mode (toggled from the AR banner). Continuously projects
 * a ring on the nearest detected plane in front of the camera; the next
 * `select` event reads that pose and fires `onPlace`. The parent scene
 * then re-anchors the BoroughTwin group to that position.
 */
/**
 * In-headset debug HUD. Renders a small 3D text panel that follows the
 * camera and shows live XR input state (controllers, hands, thumbstick,
 * pinch). Use this to diagnose "nothing works in AR" -- if it shows no
 * controllers and no hands, the headset isn't routing input to WebXR
 * at all; if it shows them but values don't change on input, the input
 * isn't wired to our handlers.
 */
export function XRDebugHUD({ scale, lastEvent, enabled = true }) {
  const left = useXRInputSourceState("controller", "left");
  const right = useXRInputSourceState("controller", "right");
  const handL = useXRInputSourceState("hand", "left");
  const handR = useXRInputSourceState("hand", "right");

  const [text, setText] = useState("XR Debug");
  const lastUpdate = useRef(0);

  useFrame((state) => {
    if (!enabled) return;
    const now = performance.now();
    // Throttle updates to 4Hz so text doesn't reflow every frame.
    if (now - lastUpdate.current < 250) return;
    lastUpdate.current = now;

    const rightStick =
      right?.gamepad?.["xr-standard-thumbstick"];
    const leftStick =
      left?.gamepad?.["xr-standard-thumbstick"];
    const rTrig = right?.gamepad?.["xr-standard-trigger"]?.state;
    const lTrig = left?.gamepad?.["xr-standard-trigger"]?.state;

    const fmt = (v) => (typeof v === "number" ? v.toFixed(2) : "—");

    const lines = [
      `Scale: ${scale != null ? scale.toFixed(3) : "—"}`,
      `Ctrl  L: ${left ? "✓" : "—"}  R: ${right ? "✓" : "—"}`,
      `Hand  L: ${handL ? "✓" : "—"}  R: ${handR ? "✓" : "—"}`,
      `Stick R: x=${fmt(rightStick?.xAxis)} y=${fmt(rightStick?.yAxis)}`,
      `Stick L: x=${fmt(leftStick?.xAxis)} y=${fmt(leftStick?.yAxis)}`,
      `Trig  L: ${lTrig ?? "—"}  R: ${rTrig ?? "—"}`,
      `Last: ${lastEvent ?? "—"}`,
    ];
    setText(lines.join("\n"));

    // Pin to head-relative position: 0.6 m ahead, 0.25 m down-left.
    const obj = state.scene.getObjectByName("__xr_debug_hud__");
    if (!obj) return;
    const cam = state.camera;
    obj.position.copy(cam.position);
    obj.quaternion.copy(cam.quaternion);
    obj.translateX(-0.25);
    obj.translateY(-0.18);
    obj.translateZ(-0.6);
  });

  if (!enabled) return null;

  return (
    <group name="__xr_debug_hud__" raycast={() => null}>
      <mesh position={[0.08, 0.05, 0]}>
        <planeGeometry args={[0.34, 0.20]} />
        <meshBasicMaterial
          color="#03070d"
          transparent
          opacity={0.78}
          depthTest={false}
        />
      </mesh>
      <Text
        position={[-0.08, 0.13, 0.001]}
        fontSize={0.014}
        color="#39d5ff"
        anchorX="left"
        anchorY="top"
        maxWidth={0.32}
        lineHeight={1.2}
      >
        {text}
      </Text>
    </group>
  );
}

export function HitTestReticle({ onPlace, visible = true }) {
  const groupRef = useRef();
  const lastHit = useRef(null);

  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const quat = useMemo(() => new THREE.Quaternion(), []);
  const scl = useMemo(() => new THREE.Vector3(), []);

  useXRHitTest(
    (results, getWorldMatrix) => {
      const g = groupRef.current;
      if (!g) return;
      if (!visible || !results || results.length === 0) {
        g.visible = false;
        return;
      }
      if (!getWorldMatrix(matrix, results[0])) {
        g.visible = false;
        return;
      }
      matrix.decompose(pos, quat, scl);
      g.visible = true;
      g.position.copy(pos);
      g.quaternion.copy(quat);
      lastHit.current = {
        position: pos.toArray(),
        quaternion: quat.toArray(),
      };
    },
    "viewer",
    ["plane", "point"]
  );

  // Reset visibility immediately when placement is toggled off; without
  // this the reticle hangs on the last frame's pose until the next hit
  // test resolves.
  useEffect(() => {
    if (!visible && groupRef.current) {
      groupRef.current.visible = false;
    }
  }, [visible]);

  useXRInputSourceEvent(
    "all",
    "select",
    () => {
      if (!visible) return;
      const hit = lastHit.current;
      if (!hit) return;
      onPlace?.(hit);
    },
    [visible, onPlace]
  );

  return (
    <group ref={groupRef} visible={false} raycast={() => null}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.08, 0.1, 48]} />
        <meshBasicMaterial
          color="#39d5ff"
          transparent
          opacity={0.85}
          side={THREE.DoubleSide}
          depthTest={false}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <circleGeometry args={[0.018, 24]} />
        <meshBasicMaterial color="#39d5ff" depthTest={false} />
      </mesh>
    </group>
  );
}
