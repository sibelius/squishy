"use client";
/* eslint-disable react-hooks/immutability -- the soft body is a mutable simulation object driven from useFrame */

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { buildSDF, SHAPE_BOUNDS, type ShapeParams } from "@/lib/sdf";
import { meshSDF } from "@/lib/mesher";
import { MATERIALS, SoftBody } from "@/lib/softbody";
import { createSquishyMaterial, type Look } from "@/lib/squishyMaterial";

export type Tool = "poke" | "squash" | "pull";

interface PointerState {
  tool: Tool;
  hit: THREE.Vector3;
  anchor: THREE.Vector3;
  dir: THREE.Vector3;
  plane: THREE.Plane;
  depth: number;
  r: number;
}

interface Props {
  shape: ShapeParams;
  look: Look;
  material: string;
  tool: Tool;
  fingerSize: number;
  squeezeAt: number;
  onPress?: (active: number) => void;
  visible?: boolean;
}

export function buildBodyMesh(shape: ShapeParams, cells = 56) {
  const f = buildSDF(shape);
  const b = SHAPE_BOUNDS;
  const ext = [b * shape.stretchX, b * shape.stretchY, b * shape.stretchZ];
  const cell = (2 * Math.max(...ext)) / cells;
  return meshSDF(f, { min: [-ext[0], -ext[1], -ext[2]], max: [ext[0], ext[1], ext[2]] }, cell, { project: 3, smooth: 1 });
}

export default function SquishyBody({ shape, look, material, tool, fingerSize, squeezeAt, onPress, visible = true }: Props) {
  const { gl, camera, controls } = useThree();
  const meshRef = useRef<THREE.Mesh>(null);
  const plateRef = useRef<THREE.Mesh>(null);
  const pointers = useRef(new Map<number, PointerState>());
  const toolRef = useRef({ tool, fingerSize, onPress });
  useEffect(() => {
    toolRef.current = { tool, fingerSize, onPress };
  }, [tool, fingerSize, onPress]);

  const shapeKey = `${shape.type}|${shape.stretchX}|${shape.stretchY}|${shape.stretchZ}|${shape.puff}`;
  const body = useMemo(() => {
    const m = buildBodyMesh(shape);
    const b = new SoftBody(m.positions, m.indices);
    b.kick(0.25);
    return b;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeKey]);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(body.pos, 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", pos);
    g.setAttribute("restPos", new THREE.BufferAttribute(body.rest, 3));
    g.setIndex(new THREE.BufferAttribute(body.indices, 1));
    g.computeVertexNormals();
    g.setAttribute("restNormal", (g.getAttribute("normal") as THREE.BufferAttribute).clone());
    g.computeBoundingSphere();
    return g;
  }, [body]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const mat = useMemo(() => createSquishyMaterial(), []);
  useEffect(() => mat.apply(look), [mat, look]);
  useEffect(() => () => mat.material.dispose(), [mat]);

  useEffect(() => {
    body.material = MATERIALS[material] ?? MATERIALS.slowRise;
  }, [body, material]);

  // ---- pointer / multi-touch interaction ----
  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const ctl = controls as unknown as { enabled: boolean } | null;
    const setRay = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
    };
    const notify = () => toolRef.current.onPress?.(pointers.current.size);

    const down = (e: PointerEvent) => {
      const mesh = meshRef.current;
      if (!mesh || !mesh.visible) return;
      setRay(e);
      const hit = raycaster.intersectObject(mesh, false)[0];
      if (!hit) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      if (ctl) ctl.enabled = false;
      const { tool, fingerSize } = toolRef.current;
      const p = mesh.worldToLocal(hit.point.clone());
      const r = tool === "squash" ? fingerSize * 3.2 : fingerSize;
      const st: PointerState = {
        tool,
        hit: p.clone(),
        anchor: p.clone(),
        dir: raycaster.ray.direction.clone(),
        plane: new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), p),
        depth: 0,
        r,
      };
      pointers.current.set(e.pointerId, st);
      if (tool === "pull") body.startGrab(e.pointerId, p.x, p.y, p.z, fingerSize * 2.2);
      else body.fingers.set(e.pointerId, { id: e.pointerId, cx: p.x, cy: p.y, cz: p.z, r, active: true });
      navigator.vibrate?.(8);
      notify();
    };
    const tmp = new THREE.Vector3();
    const move = (e: PointerEvent) => {
      const st = pointers.current.get(e.pointerId);
      if (!st) return;
      setRay(e);
      const mesh = meshRef.current;
      if (!mesh) return;
      const ray = raycaster.ray.clone().applyMatrix4(mesh.matrixWorld.clone().invert());
      if (ray.intersectPlane(st.plane, tmp)) {
        st.anchor.copy(tmp);
        st.dir.copy(ray.direction);
      }
    };
    const up = (e: PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.delete(e.pointerId);
      body.fingers.delete(e.pointerId);
      body.grabs.delete(e.pointerId);
      if (pointers.current.size === 0 && ctl) ctl.enabled = true;
      notify();
    };
    el.addEventListener("pointerdown", down, { capture: true });
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    const ptrs = pointers.current;
    return () => {
      el.removeEventListener("pointerdown", down, { capture: true });
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      ptrs.clear();
      body.fingers.clear();
      body.grabs.clear();
      if (ctl) ctl.enabled = true;
    };
  }, [gl, camera, controls, body]);

  const height = useMemo(() => body.maxY() - body.groundY, [body]);

  useFrame((state, dt) => {
    // fingers press deeper the longer you hold
    for (const [id, st] of pointers.current) {
      if (st.tool === "pull") {
        const g = body.grabs.get(id);
        if (g) {
          const d = tmp3.subVectors(st.anchor, st.hit);
          const l = d.length();
          if (l > 0.9) d.multiplyScalar(0.9 / l);
          g.dx = d.x; g.dy = d.y; g.dz = d.z;
        }
        continue;
      }
      const maxDepth = st.tool === "squash" ? height * 0.45 : st.r * 1.5;
      st.depth = Math.min(maxDepth, st.depth + dt * (st.tool === "squash" ? 1.4 : 2.2));
      const f = body.fingers.get(id);
      if (f) {
        const c = tmp3.copy(st.anchor).addScaledVector(st.dir, st.depth - st.r);
        f.cx = c.x; f.cy = c.y; f.cz = c.z;
      }
    }

    // squeeze animation: a plate comes down, holds, releases
    const t = (performance.now() - squeezeAt) / 1000;
    if (squeezeAt > 0 && t < 1.6) {
      const ease = (x: number) => x * x * (3 - 2 * x);
      let s = 0;
      if (t < 0.45) s = ease(t / 0.45);
      else if (t < 1.0) s = 1;
      else if (t < 1.25) s = 1 - ease((t - 1.0) / 0.25);
      body.plateTop = body.groundY + height * (1.05 - 0.62 * s);
      if (plateRef.current) {
        plateRef.current.visible = s > 0.001;
        plateRef.current.position.y = body.plateTop + 0.03;
        (plateRef.current.material as THREE.MeshPhysicalMaterial).opacity = Math.min(1, s * 3) * 0.28;
      }
    } else {
      body.plateTop = Infinity;
      if (plateRef.current) plateRef.current.visible = false;
    }

    body.step(dt);
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    state.invalidate();
  });

  return (
    // sit the squishy on the floor (y = 0)
    <group visible={visible} position={[0, -body.groundY, 0]}>
      <mesh ref={meshRef} geometry={geometry} material={mat.material} castShadow receiveShadow visible={visible} />
      <mesh ref={plateRef} visible={false}>
        <cylinderGeometry args={[1.25, 1.25, 0.05, 48]} />
        <meshPhysicalMaterial color="#9ad7ff" transparent opacity={0.35} roughness={0.05} transmission={0} />
      </mesh>
    </group>
  );
}

const tmp3 = new THREE.Vector3();
