"use client";

import { type MutableRefObject, useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { isValidCell, parsePacket } from "./utils";

const GRID_SIZE = 8;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;
const MIN_DISTANCE_MM = 300;
const MAX_DISTANCE_MM = 3800;
const BASE_RANGE_MM = MAX_DISTANCE_MM - MIN_DISTANCE_MM;
const MAX_LEVELS = 18;
const MIN_LEVELS = 2;

type ToFViewerProps = {
  lastPacketRef: MutableRefObject<ArrayBuffer | null>;
  littleEndian: boolean;
  depthScale: number;
  xyScale: number;
  useBitmask: boolean;
  reverseBitOrder: boolean;
  legendMin: number | null;
  legendMax: number | null;
};

type ViewerConfig = {
  littleEndian: boolean;
  depthScale: number;
  xyScale: number;
  useBitmask: boolean;
  reverseBitOrder: boolean;
  version: number;
};

type CellTower = {
  visible: boolean;
  x: number;
  y: number;
  z: number;
  height: number;
  r: number;
  g: number;
  b: number;
};

type TowerFrame = {
  towers: CellTower[];
  footprint: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function buildTowerFrame(
  bitmask: bigint,
  values: Int16Array,
  depthScale: number,
  xyScale: number,
  useBitmask: boolean,
  reverseBitOrder: boolean
): TowerFrame {
  const validSet = new Set<number>();
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if (useBitmask && !isValidCell(bitmask, index, reverseBitOrder)) {
      continue;
    }
    validSet.add(index);
  }

  // Fallback when bitmask mapping is different from expectation.
  if (validSet.size === 0) {
    for (let index = 0; index < CELL_COUNT; index += 1) {
      validSet.add(index);
    }
  }

  const distances = Array.from({ length: CELL_COUNT }, (_, index) =>
    clamp(values[index], MIN_DISTANCE_MM, MAX_DISTANCE_MM)
  );
  const minDistance = Math.min(...distances);
  const maxDistance = Math.max(...distances);
  const frameRangeMm = Math.max(1, maxDistance - minDistance);

  // Sensors can encode "near" as smaller or larger values.
  const heightsNearSmall = distances.map((distance) => maxDistance - distance);
  const heightsNearLarge = distances.map((distance) => distance - minDistance);
  const maxNearSmall = Math.max(1, ...heightsNearSmall);
  const maxNearLarge = Math.max(1, ...heightsNearLarge);
  const highSmallCount = heightsNearSmall.filter((height) => height > maxNearSmall * 0.6).length;
  const highLargeCount = heightsNearLarge.filter((height) => height > maxNearLarge * 0.6).length;
  const useNearLargeMode = highLargeCount < highSmallCount;

  const footprint = Math.max(0.012, xyScale * 0.96);
  const depthFactor = clamp(depthScale / 0.001, 0.5, 2.6);
  const maxLevels = clamp(Math.round(11 * depthFactor), MIN_LEVELS, MAX_LEVELS);
  const levelStep = footprint * (0.72 * depthFactor);
  const color = new THREE.Color();

  const towers: CellTower[] = [];
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if (!validSet.has(index)) {
      towers.push({
        visible: false,
        x: 0,
        y: 0,
        z: 0,
        height: 0,
        r: 0,
        g: 0,
        b: 0,
      });
      continue;
    }

    const row = Math.floor(index / GRID_SIZE);
    const col = index % GRID_SIZE;
    const distance = distances[index];

    const absoluteHeightMm = clamp(
      useNearLargeMode ? distance - MIN_DISTANCE_MM : MAX_DISTANCE_MM - distance,
      0,
      BASE_RANGE_MM
    );
    const relativeHeightMm = clamp(
      useNearLargeMode ? distance - minDistance : maxDistance - distance,
      0,
      frameRangeMm
    );
    const absoluteNormalized = clamp(absoluteHeightMm / BASE_RANGE_MM, 0, 1);
    const relativeNormalized = clamp(relativeHeightMm / frameRangeMm, 0, 1);
    const normalized = clamp(absoluteNormalized * 0.45 + relativeNormalized * 0.55, 0, 1);

    const levels = Math.max(
      MIN_LEVELS,
      Math.round(Math.pow(normalized, 0.82) * maxLevels)
    );
    const towerHeight = Math.max(footprint * 0.5, levels * levelStep);
    const x = (col - 3.5) * xyScale;
    const y = -(row - 3.5) * xyScale;
    const z = towerHeight / 2;

    const hue = clamp(lerp(0.58, 0.03, normalized), 0, 1);
    const lightness = clamp(0.44 + normalized * 0.2, 0, 1);
    color.setHSL(hue, 0.92, lightness);

    towers.push({
      visible: true,
      x,
      y,
      z,
      height: towerHeight,
      r: color.r,
      g: color.g,
      b: color.b,
    });
  }

  return {
    towers,
    footprint,
  };
}

export function ToFViewer({
  lastPacketRef,
  littleEndian,
  depthScale,
  xyScale,
  useBitmask,
  reverseBitOrder,
  legendMin,
  legendMax,
}: ToFViewerProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const configRef = useRef<ViewerConfig>({
    littleEndian,
    depthScale,
    xyScale,
    useBitmask,
    reverseBitOrder,
    version: 0,
  });

  useEffect(() => {
    const prev = configRef.current;
    const changed =
      prev.littleEndian !== littleEndian ||
      prev.depthScale !== depthScale ||
      prev.xyScale !== xyScale ||
      prev.useBitmask !== useBitmask ||
      prev.reverseBitOrder !== reverseBitOrder;

    if (!changed) {
      return;
    }

    configRef.current = {
      littleEndian,
      depthScale,
      xyScale,
      useBitmask,
      reverseBitOrder,
      version: prev.version + 1,
    };
  }, [littleEndian, depthScale, xyScale, useBitmask, reverseBitOrder]);

  useEffect(() => {
    const mountNode = mountRef.current;
    if (!mountNode) {
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0f172a");

    const cameraTarget = new THREE.Vector3(0.01, -0.01, 0.12);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.01, 20);
    camera.up.set(0, 0, 1);
    camera.position.set(0.78, -0.88, 0.72);
    camera.lookAt(cameraTarget);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mountNode.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.copy(cameraTarget);

    const initialOffset = new THREE.Vector3().subVectors(camera.position, cameraTarget);
    const initialRadius = Math.max(0.001, initialOffset.length());
    const initialPolar = Math.acos(clamp(initialOffset.z / initialRadius, -1, 1));
    controls.minPolarAngle = initialPolar;
    controls.maxPolarAngle = initialPolar;
    controls.minDistance = initialRadius;
    controls.maxDistance = initialRadius;
    controls.update();

    const guideGrid = new THREE.GridHelper(
      GRID_SIZE,
      GRID_SIZE,
      "#64748b",
      "#94a3b8"
    );
    guideGrid.rotation.x = Math.PI / 2;
    guideGrid.position.z = 0.0005;
    guideGrid.scale.setScalar(configRef.current.xyScale);
    scene.add(guideGrid);

    const towerGeometry = new THREE.BoxGeometry(1, 1, 1);
    const towers: THREE.Mesh[] = [];
    for (let i = 0; i < CELL_COUNT; i += 1) {
      const material = new THREE.MeshBasicMaterial({ color: "#38bdf8" });
      const mesh = new THREE.Mesh(towerGeometry, material);
      mesh.visible = false;
      towers.push(mesh);
      scene.add(mesh);
    }

    const resize = () => {
      const width = Math.max(mountNode.clientWidth, 1);
      const height = Math.max(mountNode.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      controls.update();
      renderer.setSize(width, height, false);
    };

    resize();
    window.addEventListener("resize", resize);

    let lastPacket: ArrayBuffer | null = null;
    let lastRenderConfigVersion = -1;
    let lastGridConfigVersion = -1;

    let rafId = 0;
    const animate = () => {
      const config = configRef.current;
      const packet = lastPacketRef.current;
      const packetChanged = packet !== null && packet !== lastPacket;
      const renderConfigChanged = config.version !== lastRenderConfigVersion;
      const gridConfigChanged = config.version !== lastGridConfigVersion;

      if (gridConfigChanged) {
        guideGrid.scale.setScalar(config.xyScale);
        lastGridConfigVersion = config.version;
      }

      if (
        packet !== null &&
        packet.byteLength === 141 &&
        (packetChanged || renderConfigChanged)
      ) {
        try {
          const parsed = parsePacket(packet, config.littleEndian);
          const frame = buildTowerFrame(
            parsed.bitmask,
            parsed.values,
            config.depthScale,
            config.xyScale,
            config.useBitmask,
            config.reverseBitOrder
          );

          for (let index = 0; index < CELL_COUNT; index += 1) {
            const tower = frame.towers[index];
            const mesh = towers[index];
            mesh.visible = tower.visible;
            if (!tower.visible) {
              continue;
            }

            mesh.position.set(tower.x, tower.y, tower.z);
            mesh.scale.set(frame.footprint, frame.footprint, tower.height);
            const material = mesh.material as THREE.MeshBasicMaterial;
            material.color.setRGB(tower.r, tower.g, tower.b);
          }

          lastPacket = packet;
          lastRenderConfigVersion = config.version;
        } catch {
          // Invalid packets are ignored to keep rendering loop stable.
        }
      }

      renderer.render(scene, camera);
      controls.update();
      rafId = window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      controls.dispose();
      towerGeometry.dispose();
      for (const mesh of towers) {
        (mesh.material as THREE.Material).dispose();
      }
      renderer.dispose();
      if (renderer.domElement.parentNode === mountNode) {
        mountNode.removeChild(renderer.domElement);
      }
    };
  }, [lastPacketRef]);
  return (
    <div className="viewer-shell">
      <div className="viewer-canvas" ref={mountRef} />
      <div className="viewer-legend">
        <div className="viewer-legend-title">
          {"\ub192\uc774 \ubc94\uc704(mm)"}
        </div>
        <div className="viewer-legend-bar" />
        <div className="viewer-legend-range">
          <span>{legendMin ?? "-"}</span>
          <span>{legendMax ?? "-"}</span>
        </div>
      </div>
    </div>
  );
}
