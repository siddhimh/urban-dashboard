// Flat ground plane for the 3D city scene.
// Sized generously so future borough/building layers fit comfortably.
// Receives shadows so the directional light reads correctly.

function GroundPlane({ size = 400, color = '#e6e8f0' }) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
      receiveShadow
    >
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

export default GroundPlane;
