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
const MM_TO_M = 0.001;
const MAX_LEVELS = 18;
const MIN_LEVELS = 2;
export const DEFAULT_CEILING_HEIGHT_M = 2.4;
const RAY_H_FOV_DEG = 45;
const RAY_V_FOV_DEG = 45;
const RAY_NEAR_COLOR = new THREE.Color("#facc15");
const RAY_FAR_COLOR = new THREE.Color("#2563eb");
const RAY_INVALID_COLOR = new THREE.Color("#64748b");

export type RenderMode = "tower" | "ray";
export type ViewMode = "topdown";

function buildRayDirections(hFovDeg: number, vFovDeg: number): Float32Array {
  const directions = new Float32Array(CELL_COUNT * 3);
  const tanHalfH = Math.tan((hFovDeg * Math.PI) / 360);
  const tanHalfV = Math.tan((vFovDeg * Math.PI) / 360);

  for (let index = 0; index < CELL_COUNT; index += 1) {
    const row = Math.floor(index / GRID_SIZE);
    const col = index % GRID_SIZE;
    const nx = ((col + 0.5) / GRID_SIZE - 0.5) * 2;
    const nz = (0.5 - (row + 0.5) / GRID_SIZE) * 2;
    const x = nx * tanHalfH;
    const y = -1;
    const z = nz * tanHalfV;
    const invLen = 1 / Math.sqrt(x * x + y * y + z * z);
    const base = index * 3;
    directions[base] = x * invLen;
    directions[base + 1] = y * invLen;
    directions[base + 2] = z * invLen;
  }

  return directions;
}

const PRECOMPUTED_RAY_DIRS = buildRayDirections(RAY_H_FOV_DEG, RAY_V_FOV_DEG);

type ToFViewerProps = {
  lastPacketRef: MutableRefObject<ArrayBuffer | null>;
  littleEndian: boolean;
  depthScale: number;
  xyScale: number;
  useBitmask: boolean;
  reverseBitOrder: boolean;
  legendMin: number | null;
  legendMax: number | null;
  renderMode?: RenderMode;
  ceilingHeight?: number;
  view?: ViewMode;
};

type ViewerConfig = {
  littleEndian: boolean;
  depthScale: number;
  xyScale: number;
  useBitmask: boolean;
  reverseBitOrder: boolean;
  renderMode: RenderMode;
  ceilingHeight: number;
  view: ViewMode;
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
  renderMode = "tower",
  ceilingHeight = DEFAULT_CEILING_HEIGHT_M,
  view = "topdown",
}: ToFViewerProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const configRef = useRef<ViewerConfig>({
    littleEndian,
    depthScale,
    xyScale,
    useBitmask,
    reverseBitOrder,
    renderMode,
    ceilingHeight,
    view,
    version: 0,
  });

  useEffect(() => {
    const prev = configRef.current;
    const changed =
      prev.littleEndian !== littleEndian ||
      prev.depthScale !== depthScale ||
      prev.xyScale !== xyScale ||
      prev.useBitmask !== useBitmask ||
      prev.reverseBitOrder !== reverseBitOrder ||
      prev.renderMode !== renderMode ||
      prev.ceilingHeight !== ceilingHeight ||
      prev.view !== view;

    if (!changed) {
      return;
    }

    configRef.current = {
      littleEndian,
      depthScale,
      xyScale,
      useBitmask,
      reverseBitOrder,
      renderMode,
      ceilingHeight,
      view,
      version: prev.version + 1,
    };
  }, [
    littleEndian,
    depthScale,
    xyScale,
    useBitmask,
    reverseBitOrder,
    renderMode,
    ceilingHeight,
    view,
  ]);

  useEffect(() => {
    const mountNode = mountRef.current;
    if (!mountNode) {
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0f172a");

    const towerCameraTarget = new THREE.Vector3(0.01, -0.01, 0.12);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.01, 20);
    camera.up.set(0, 0, 1);
    camera.position.set(0.78, -0.88, 0.72);
    camera.lookAt(towerCameraTarget);

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
    controls.target.copy(towerCameraTarget);

    const cameraOffset = new THREE.Vector3();
    const cameraUp = new THREE.Vector3();
    const orbitOffset = new THREE.Vector3();
    const orbitSpherical = new THREE.Spherical();
    let lockedPolarAngle = Number.NaN;
    const applyCameraPreset = (mode: RenderMode, viewMode: ViewMode, ceiling: number) => {
      if (mode === "ray") {
        const topdownMode = viewMode;
        if (topdownMode === "topdown") {
          camera.up.set(0, 1, 0);
          camera.position.set(1.85, ceiling + 0.08, 1.85);
          controls.enableRotate = true;
          controls.target.set(0, Math.max(0.5, ceiling * 0.4), 0);
        }
      } else {
        camera.up.set(0, 0, 1);
        camera.position.set(0.78, -0.88, 0.72);
        controls.enableRotate = true;
        controls.target.copy(towerCameraTarget);
      }

      camera.lookAt(controls.target);
      cameraOffset.subVectors(camera.position, controls.target);
      const radius = Math.max(0.001, cameraOffset.length());
      cameraUp.copy(camera.up).normalize();
      const polar = Math.acos(
        clamp(cameraOffset.normalize().dot(cameraUp), -1, 1)
      );
      controls.minPolarAngle = polar;
      controls.maxPolarAngle = polar;
      controls.minAzimuthAngle = -Infinity;
      controls.maxAzimuthAngle = Infinity;
      controls.minDistance = radius;
      controls.maxDistance = radius;
      lockedPolarAngle = mode === "ray" && viewMode === "topdown" ? polar : Number.NaN;
      controls.update();
    };
    applyCameraPreset(
      configRef.current.renderMode,
      configRef.current.view,
      configRef.current.ceilingHeight
    );

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

    const floorPlaneGeometry = new THREE.PlaneGeometry(4.8, 4.8, 1, 1);
    const floorPlaneMaterial = new THREE.MeshBasicMaterial({
      color: "#334155",
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
    });
    const floorPlane = new THREE.Mesh(floorPlaneGeometry, floorPlaneMaterial);
    floorPlane.rotation.x = -Math.PI / 2;
    floorPlane.position.y = 0;
    floorPlane.visible = false;
    scene.add(floorPlane);

    const towerGeometry = new THREE.BoxGeometry(1, 1, 1);
    const towers: THREE.Mesh[] = [];
    for (let i = 0; i < CELL_COUNT; i += 1) {
      const material = new THREE.MeshBasicMaterial({ color: "#38bdf8" });
      const mesh = new THREE.Mesh(towerGeometry, material);
      mesh.visible = false;
      towers.push(mesh);
      scene.add(mesh);
    }

    const rayLinePositions = new Float32Array(CELL_COUNT * 2 * 3);
    const rayLineColors = new Float32Array(CELL_COUNT * 2 * 3);
    const rayLineGeometry = new THREE.BufferGeometry();
    const rayLinePositionAttribute = new THREE.BufferAttribute(rayLinePositions, 3);
    const rayLineColorAttribute = new THREE.BufferAttribute(rayLineColors, 3);
    rayLineGeometry.setAttribute("position", rayLinePositionAttribute);
    rayLineGeometry.setAttribute("color", rayLineColorAttribute);

    const rayLines = new THREE.LineSegments(
      rayLineGeometry,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 })
    );
    rayLines.visible = false;
    rayLines.frustumCulled = false;
    scene.add(rayLines);

    const rayPointPositions = new Float32Array(CELL_COUNT * 3);
    const rayPointColors = new Float32Array(CELL_COUNT * 3);
    const rayPointGeometry = new THREE.BufferGeometry();
    const rayPointPositionAttribute = new THREE.BufferAttribute(rayPointPositions, 3);
    const rayPointColorAttribute = new THREE.BufferAttribute(rayPointColors, 3);
    rayPointGeometry.setAttribute("position", rayPointPositionAttribute);
    rayPointGeometry.setAttribute("color", rayPointColorAttribute);

    const rayPoints = new THREE.Points(
      rayPointGeometry,
      new THREE.PointsMaterial({ size: 0.03, sizeAttenuation: true, vertexColors: true })
    );
    rayPoints.visible = false;
    rayPoints.frustumCulled = false;
    scene.add(rayPoints);

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
    let lastMode: RenderMode | null = null;
    let lastView: ViewMode | null = null;
    let lastCeilingHeight = Number.NaN;
    const color = new THREE.Color();

    let rafId = 0;
    const animate = () => {
      const config = configRef.current;
      const packet = lastPacketRef.current;
      const packetChanged = packet !== null && packet !== lastPacket;
      const renderConfigChanged = config.version !== lastRenderConfigVersion;
      const gridConfigChanged = config.version !== lastGridConfigVersion;
      const cameraPresetChanged =
        config.renderMode !== lastMode ||
        config.view !== lastView ||
        config.ceilingHeight !== lastCeilingHeight;

      if (cameraPresetChanged) {
        applyCameraPreset(config.renderMode, config.view, config.ceilingHeight);
        lastView = config.view;
        lastCeilingHeight = config.ceilingHeight;
      }

      if (gridConfigChanged) {
        if (config.renderMode === "tower") {
          guideGrid.rotation.x = Math.PI / 2;
          guideGrid.position.set(0, 0, 0.0005);
          guideGrid.scale.setScalar(config.xyScale);
          guideGrid.visible = true;
          floorPlane.visible = false;
        } else {
          guideGrid.visible = false;
          floorPlane.visible = true;
        }
        lastGridConfigVersion = config.version;
      }

      if (
        packet !== null &&
        packet.byteLength === 141 &&
        (packetChanged || renderConfigChanged)
      ) {
        try {
          const parsed = parsePacket(packet, config.littleEndian);
          if (config.renderMode === "tower") {
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
          } else {
            const sensorX = 0;
            const sensorY = config.ceilingHeight;
            const sensorZ = 0;
            let minHeightMm = Number.POSITIVE_INFINITY;
            let maxHeightMm = Number.NEGATIVE_INFINITY;

            for (let index = 0; index < CELL_COUNT; index += 1) {
              const dirBase = index * 3;
              const valid = config.useBitmask
                ? isValidCell(parsed.bitmask, index, config.reverseBitOrder)
                : true;
              if (!valid) {
                continue;
              }

              const depthMm = clamp(parsed.values[index], MIN_DISTANCE_MM, MAX_DISTANCE_MM);
              const depthMeters = depthMm * MM_TO_M;
              const endY = sensorY + PRECOMPUTED_RAY_DIRS[dirBase + 1] * depthMeters;
              const heightMm = endY * 1000;
              minHeightMm = Math.min(minHeightMm, heightMm);
              maxHeightMm = Math.max(maxHeightMm, heightMm);
            }
            if (!Number.isFinite(minHeightMm) || !Number.isFinite(maxHeightMm)) {
              minHeightMm = 0;
              maxHeightMm = 1;
            }
            const heightRangeMm = Math.max(1, maxHeightMm - minHeightMm);

            for (let index = 0; index < CELL_COUNT; index += 1) {
              const lineBase = index * 6;
              const pointBase = index * 3;
              const dirBase = index * 3;
              const valid = config.useBitmask
                ? isValidCell(parsed.bitmask, index, config.reverseBitOrder)
                : true;

              let depthMm = MIN_DISTANCE_MM;
              if (valid) {
                depthMm = clamp(parsed.values[index], MIN_DISTANCE_MM, MAX_DISTANCE_MM);
              }
              const depthMeters = valid ? depthMm * MM_TO_M : 0;
              const endX = sensorX + PRECOMPUTED_RAY_DIRS[dirBase] * depthMeters;
              const endY = sensorY + PRECOMPUTED_RAY_DIRS[dirBase + 1] * depthMeters;
              const endZ = sensorZ + PRECOMPUTED_RAY_DIRS[dirBase + 2] * depthMeters;
              const heightMm = endY * 1000;

              if (valid) {
                const normalized = clamp(
                  (heightMm - minHeightMm) / heightRangeMm,
                  0,
                  1
                );
                color.lerpColors(RAY_FAR_COLOR, RAY_NEAR_COLOR, normalized);
              } else {
                color.copy(RAY_INVALID_COLOR);
              }

              rayLinePositions[lineBase] = sensorX;
              rayLinePositions[lineBase + 1] = sensorY;
              rayLinePositions[lineBase + 2] = sensorZ;
              rayLinePositions[lineBase + 3] = endX;
              rayLinePositions[lineBase + 4] = endY;
              rayLinePositions[lineBase + 5] = endZ;

              rayPointPositions[pointBase] = endX;
              rayPointPositions[pointBase + 1] = endY;
              rayPointPositions[pointBase + 2] = endZ;

              rayLineColors[lineBase] = color.r;
              rayLineColors[lineBase + 1] = color.g;
              rayLineColors[lineBase + 2] = color.b;
              rayLineColors[lineBase + 3] = color.r;
              rayLineColors[lineBase + 4] = color.g;
              rayLineColors[lineBase + 5] = color.b;

              rayPointColors[pointBase] = color.r;
              rayPointColors[pointBase + 1] = color.g;
              rayPointColors[pointBase + 2] = color.b;
            }
            rayLinePositionAttribute.needsUpdate = true;
            rayLineColorAttribute.needsUpdate = true;
            rayPointPositionAttribute.needsUpdate = true;
            rayPointColorAttribute.needsUpdate = true;
          }

          lastPacket = packet;
          lastRenderConfigVersion = config.version;
        } catch {
          // Invalid packets are ignored to keep rendering loop stable.
        }
      }

      if (lastMode !== config.renderMode) {
        const isTower = config.renderMode === "tower";
        for (const mesh of towers) {
          mesh.visible = isTower && mesh.visible;
        }
        rayLines.visible = !isTower;
        rayPoints.visible = !isTower;
        lastMode = config.renderMode;
      }

      controls.update();
      if (Number.isFinite(lockedPolarAngle)) {
        orbitOffset.subVectors(camera.position, controls.target);
        orbitSpherical.setFromVector3(orbitOffset);
        orbitSpherical.phi = lockedPolarAngle;
        orbitOffset.setFromSpherical(orbitSpherical);
        camera.position.copy(controls.target).add(orbitOffset);
        camera.lookAt(controls.target);
      }
      renderer.render(scene, camera);
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
      rayLineGeometry.dispose();
      rayPointGeometry.dispose();
      (rayLines.material as THREE.Material).dispose();
      (rayPoints.material as THREE.Material).dispose();
      floorPlaneGeometry.dispose();
      floorPlaneMaterial.dispose();
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
