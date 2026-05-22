// Camera controls + smooth preset transitions for the 3D city scene.
//
// The actual PerspectiveCamera is configured on <Canvas camera={...}>.
// This component:
//   - wires OrbitControls (pan / rotate / zoom)
//   - listens for `presetKey` changes and lerps the camera position +
//     OrbitControls target toward the new (`position`, `target`) pair
//
// Animation is keyed on `presetKey` (a string), NOT the position/target
// arrays themselves -- otherwise unrelated re-renders would yank the
// camera around. After settling, OrbitControls take over freely; the
// user can drag without fighting the animation.

import { useRef, useEffect } from 'react';
import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const TRANSITION_LERP = 0.08;     // per-frame blend factor (~8% closer / frame)
const SETTLE_EPSILON = 0.4;       // stop animating when within this many units
const TMP_TARGET = new THREE.Vector3();
const TMP_POSITION = new THREE.Vector3();

function CameraRig({
  // Optional preset target / camera position. When `presetKey` flips,
  // the camera animates toward these.
  presetKey = 'all',
  target = [0, 0, 0],
  position,                          // [x, y, z] -- if omitted, only target is animated
  enablePan = true,
  enableZoom = true,
  enableRotate = true,
  minDistance = 20,
  maxDistance = 400,
  maxPolarAngle = Math.PI / 2.05,
}) {
  const controlsRef = useRef(null);
  const camera = useThree((s) => s.camera);

  // Held in refs so useFrame can read the latest values without
  // re-subscribing every render.
  const desiredTarget = useRef(new THREE.Vector3(...target));
  const desiredPosition = useRef(
    position ? new THREE.Vector3(...position) : null
  );
  const animating = useRef(false);

  // Trigger an animation when (and only when) the preset key changes.
  useEffect(() => {
    desiredTarget.current.set(target[0], target[1], target[2]);
    if (position) {
      if (!desiredPosition.current) desiredPosition.current = new THREE.Vector3();
      desiredPosition.current.set(position[0], position[1], position[2]);
    } else {
      desiredPosition.current = null;
    }
    animating.current = true;
    // Intentionally only depends on presetKey: target/position arrays
    // are read inside, but unrelated re-renders shouldn't yank the camera.
  }, [presetKey]);

  useFrame(() => {
    if (!animating.current) return;
    const controls = controlsRef.current;

    let settled = true;

    if (controls) {
      TMP_TARGET.copy(desiredTarget.current);
      controls.target.lerp(TMP_TARGET, TRANSITION_LERP);
      if (controls.target.distanceTo(TMP_TARGET) > SETTLE_EPSILON) {
        settled = false;
      }
    }

    if (desiredPosition.current) {
      TMP_POSITION.copy(desiredPosition.current);
      camera.position.lerp(TMP_POSITION, TRANSITION_LERP);
      if (camera.position.distanceTo(TMP_POSITION) > SETTLE_EPSILON) {
        settled = false;
      }
    }

    if (controls) controls.update();

    if (settled) animating.current = false;
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enablePan={enablePan}
      enableZoom={enableZoom}
      enableRotate={enableRotate}
      minDistance={minDistance}
      maxDistance={maxDistance}
      maxPolarAngle={maxPolarAngle}
    />
  );
}

export default CameraRig;
