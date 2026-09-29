"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import SquishyBody, { type Tool } from "./SquishyBody";
import type { ShapeParams } from "@/lib/sdf";
import type { Look } from "@/lib/squishyMaterial";
import type { MoldResult } from "@/lib/mold";
import type { Mesh } from "@/lib/mesher";

interface Props {
  view: "play" | "mold";
  shape: ShapeParams;
  look: Look;
  material: string;
  tool: Tool;
  fingerSize: number;
  squeezeAt: number;
  mold: MoldResult | null;
  explode: number;
  moldLayout: "open" | "closed";
  sizeMm: number;
  background: string;
  onPress?: (n: number) => void;
}

export default function Scene(p: Props) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 1.3, 4.2], fov: 38 }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      style={{ touchAction: "none" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.NeutralToneMapping;
      }}
    >
      <color attach="background" args={[p.background]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 5, 4]} intensity={1.4} castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} shadow-normalBias={0.02} />
      <directionalLight position={[-4, 2, -2]} intensity={0.4} color="#bcd4ff" />
      <CameraRig view={p.view} />
      <Environment resolution={256} environmentIntensity={0.7}>
        <Lightformer form="rect" intensity={2} position={[0, 4, 3]} scale={[6, 3, 1]} />
        <Lightformer form="rect" intensity={1} color="#ffd6e7" position={[-4, 1, 1]} rotation-y={Math.PI / 2} scale={[4, 2, 1]} />
        <Lightformer form="rect" intensity={1} color="#d6ecff" position={[4, 1, 1]} rotation-y={-Math.PI / 2} scale={[4, 2, 1]} />
        <Lightformer form="circle" intensity={1.5} position={[0, -3, 2]} scale={3} />
      </Environment>

      <group position={[0, -0.9, 0]}>
        <SquishyBody
          shape={p.shape}
          look={p.look}
          material={p.material}
          tool={p.tool}
          fingerSize={p.fingerSize}
          squeezeAt={p.squeezeAt}
          onPress={p.onPress}
          visible={p.view === "play"}
        />
        {p.view === "mold" && p.mold && <MoldView mold={p.mold} explode={p.explode} sizeMm={p.sizeMm} layout={p.moldLayout} />}
        <ContactShadows position={[0, 0.001, 0]} opacity={0.45} scale={6} blur={2.4} far={2.5} resolution={512} frames={Infinity} />
      </group>
      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={2.2}
        maxDistance={9}
        maxPolarAngle={Math.PI * 0.62}
        target={[0, -0.1, 0]}
      />
    </Canvas>
  );
}

function toGeometry(m: Mesh) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeVertexNormals();
  return g;
}

const PART_COLORS = ["#8ec5ff", "#ffb3c7", "#b8f0c8"];

/** Reframe the camera when switching between play and mold views. */
function CameraRig({ view }: { view: "play" | "mold" }) {
  const { camera, controls, size } = useThree();
  const narrow = size.width / size.height < 0.9;
  useEffect(() => {
    const target = view === "mold" ? new THREE.Vector3(0, 2.6, 4.6) : new THREE.Vector3(0, 1.3, 4.2);
    if (narrow) target.multiplyScalar(1.35);
    camera.position.copy(target);
    (controls as unknown as { update?: () => void } | null)?.update?.();
  }, [view, camera, controls, narrow]);
  return null;
}

/** Z-up print layout -> Y-up scene, centred on the origin, resting on y=0 */
function printLayoutGeometry(m: Mesh, cx: number, cy: number) {
  const src = m.positions;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    out[i] = src[i] - cx;
    out[i + 1] = src[i + 2];
    out[i + 2] = -(src[i + 1] - cy);
  }
  return toGeometry({ positions: out, indices: m.indices });
}

function MoldView({ mold, explode, sizeMm, layout }: { mold: MoldResult; explode: number; sizeMm: number; layout: "open" | "closed" }) {
  const geos = useMemo(() => {
    if (layout === "closed") return mold.parts.map((p) => toGeometry(p.preview));
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of mold.parts) {
      const a = p.print.positions;
      for (let i = 0; i < a.length; i += 3) {
        if (a[i] < minX) minX = a[i]; if (a[i] > maxX) maxX = a[i];
        if (a[i + 1] < minY) minY = a[i + 1]; if (a[i + 1] > maxY) maxY = a[i + 1];
      }
    }
    return mold.parts.map((p) => printLayoutGeometry(p.print, (minX + maxX) / 2, (minY + maxY) / 2));
  }, [mold, layout]);
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);
  // keep the whole plate in view regardless of the squishy size
  const s = Math.min(2 / sizeMm, 3.4 / (sizeMm * 2.6));
  const groundY = layout === "open" ? 0 : mold.box.min[1];
  // assembled front/back molds are turned sideways so the halves separate left/right
  const rotY = layout === "closed" && mold.axis === 2 ? -Math.PI / 2.6 : 0;
  return (
    <group scale={s} position={[0, -groundY * s, 0]} rotation-y={rotY}>
      {geos.map((g, i) => {
        const dir = i === 0 ? -1 : 1;
        const off = layout === "closed" && mold.parts.length > 1 ? explode * sizeMm * 0.55 * dir : 0;
        // for a top/bottom split the lower half stays on the floor, the upper half lifts
        const pos: [number, number, number] =
          mold.axis === 2 ? [0, 0, off] : [0, i === 0 ? 0 : Math.max(0, off * 2), 0];
        return (
          <mesh key={i} geometry={g} position={pos} castShadow receiveShadow>
            <meshPhysicalMaterial color={PART_COLORS[i]} roughness={0.45} clearcoat={0.3} />
          </mesh>
        );
      })}
    </group>
  );
}
