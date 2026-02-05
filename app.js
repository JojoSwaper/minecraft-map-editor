import * as THREE from "https://cdn.jsdelivr.net/npm/three@latest/build/three.module.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@latest/examples/jsm/controls/OrbitControls.js";
import { parse, simplify } from "https://cdn.jsdelivr.net/npm/prismarine-nbt@latest/+esm";
import { Buffer } from "https://cdn.jsdelivr.net/npm/buffer@latest/+esm";
import pako from "https://cdn.jsdelivr.net/npm/pako@latest/+esm";

const DEFAULT_BLOCKS = [
  "minecraft:air",
  "minecraft:stone",
  "minecraft:grass_block",
  "minecraft:dirt",
  "minecraft:oak_planks",
  "minecraft:cobblestone",
  "minecraft:bricks",
  "minecraft:sand",
  "minecraft:glass",
  "minecraft:water",
];

const KNOWN_COLORS = {
  stone: 0x7d7d7d,
  grass_block: 0x5fa83b,
  dirt: 0x8b5a2b,
  oak_planks: 0xb78a57,
  cobblestone: 0x7a7a7a,
  bricks: 0xb05a4f,
  sand: 0xd7c27c,
  glass: 0x8ec6d1,
  water: 0x3b6ef5,
  lava: 0xf97316,
  oak_log: 0x8f6b3a,
  spruce_log: 0x6d4c2b,
  birch_log: 0xd7c69d,
  netherrack: 0x7a2e2e,
  quartz_block: 0xece6db,
};

const dom = {
  fileInput: document.getElementById("fileInput"),
  sizeX: document.getElementById("sizeX"),
  sizeY: document.getElementById("sizeY"),
  sizeZ: document.getElementById("sizeZ"),
  newWorldBtn: document.getElementById("newWorldBtn"),
  blockSelect: document.getElementById("blockSelect"),
  customBlockName: document.getElementById("customBlockName"),
  addBlockBtn: document.getElementById("addBlockBtn"),
  exportBtn: document.getElementById("exportBtn"),
  statusText: document.getElementById("statusText"),
  statsText: document.getElementById("statsText"),
  hoverText: document.getElementById("hoverText"),
  resetViewBtn: document.getElementById("resetViewBtn"),
  canvasContainer: document.getElementById("canvasContainer"),
  toolRadios: Array.from(document.querySelectorAll("input[name='tool']")),
};

const state = {
  size: { x: 32, y: 16, z: 32 },
  grid: null,
  palette: [],
  selectedIndex: 1,
  tool: "place",
  gridOrigin: new THREE.Vector3(),
  mesh: null,
  instanceToCell: [],
  filledCount: 0,
  hover: null,
  blockColors: new Map(),
};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setClearColor(0x0b0d12);
renderer.setPixelRatio(window.devicePixelRatio || 1);
dom.canvasContainer.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const ambient = new THREE.AmbientLight(0xffffff, 0.55);
const sun = new THREE.DirectionalLight(0xffffff, 0.85);
sun.position.set(30, 50, 20);
scene.add(ambient, sun);

const gridGroup = new THREE.Group();
scene.add(gridGroup);

const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
const cubeMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.65,
  metalness: 0.05,
});

const cursorMaterial = new THREE.MeshBasicMaterial({
  color: 0x5eead4,
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
});
const cursorMesh = new THREE.Mesh(
  new THREE.BoxGeometry(1.02, 1.02, 1.02),
  cursorMaterial
);
cursorMesh.visible = false;
scene.add(cursorMesh);

const groundPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(500, 500),
  new THREE.MeshBasicMaterial({ visible: false })
);
groundPlane.rotation.x = -Math.PI / 2;
scene.add(groundPlane);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

init();

function init() {
  setPalette(DEFAULT_BLOCKS);
  resetGrid(state.size.x, state.size.y, state.size.z);
  bindUi();
  resizeRenderer();
  resetView();
  animate();
}

function bindUi() {
  dom.fileInput.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    await loadFile(file);
    dom.fileInput.value = "";
  });

  dom.newWorldBtn.addEventListener("click", () => {
    const sizeX = clampInt(dom.sizeX.value, 1, 256);
    const sizeY = clampInt(dom.sizeY.value, 1, 256);
    const sizeZ = clampInt(dom.sizeZ.value, 1, 256);
    resetGrid(sizeX, sizeY, sizeZ);
    rebuildMesh();
    setStatus("Created new empty world.");
  });

  dom.blockSelect.addEventListener("change", (event) => {
    state.selectedIndex = Number(event.target.value);
  });

  dom.addBlockBtn.addEventListener("click", () => {
    const name = dom.customBlockName.value.trim();
    if (!name) return;
    addBlockToPalette(normalizeBlockName(name));
    dom.customBlockName.value = "";
  });

  dom.exportBtn.addEventListener("click", () => {
    downloadJson();
  });

  dom.resetViewBtn.addEventListener("click", () => {
    resetView();
  });

  dom.toolRadios.forEach((radio) => {
    radio.addEventListener("change", (event) => {
      if (event.target.checked) {
        state.tool = event.target.value;
        updateCursorFromHover();
      }
    });
  });

  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  window.addEventListener("resize", resizeRenderer);
}

function resetGrid(sizeX, sizeY, sizeZ) {
  state.size = { x: sizeX, y: sizeY, z: sizeZ };
  state.grid = new Uint32Array(sizeX * sizeY * sizeZ);
  state.gridOrigin.set(-sizeX / 2, 0, -sizeZ / 2);
  updateHelpers();
  syncSizeInputs();
  updateStats();
}

function syncSizeInputs() {
  dom.sizeX.value = state.size.x;
  dom.sizeY.value = state.size.y;
  dom.sizeZ.value = state.size.z;
}

function setPalette(blocks) {
  const normalized = ensureAirFirst(blocks.map(normalizeBlockName));
  state.palette = normalized;
  state.blockColors = new Map();
  normalized.forEach((name, index) => {
    state.blockColors.set(index, getBlockColor(name));
  });
  buildPaletteUi();
}

function addBlockToPalette(name) {
  if (!name) return;
  const existingIndex = state.palette.findIndex((item) => item === name);
  if (existingIndex !== -1) {
    state.selectedIndex = existingIndex;
    dom.blockSelect.value = String(existingIndex);
    setStatus(`Block already exists: ${name}`);
    return;
  }
  state.palette.push(name);
  state.blockColors.set(state.palette.length - 1, getBlockColor(name));
  buildPaletteUi();
  state.selectedIndex = state.palette.length - 1;
  dom.blockSelect.value = String(state.selectedIndex);
  setStatus(`Added block: ${name}`);
}

function buildPaletteUi() {
  dom.blockSelect.innerHTML = "";
  state.palette.forEach((name, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = name;
    dom.blockSelect.appendChild(option);
  });
  if (state.selectedIndex >= state.palette.length) {
    state.selectedIndex = Math.min(1, state.palette.length - 1);
  }
  dom.blockSelect.value = String(state.selectedIndex);
}

function rebuildMesh() {
  if (state.mesh) {
    scene.remove(state.mesh);
    state.mesh = null;
  }

  const blocks = [];
  for (let y = 0; y < state.size.y; y += 1) {
    for (let z = 0; z < state.size.z; z += 1) {
      for (let x = 0; x < state.size.x; x += 1) {
        const idx = indexFor(x, y, z);
        const paletteIndex = state.grid[idx];
        if (paletteIndex !== 0) {
          blocks.push({ x, y, z, paletteIndex });
        }
      }
    }
  }

  state.filledCount = blocks.length;

  if (!blocks.length) {
    state.mesh = null;
    updateStats();
    return;
  }

  const mesh = new THREE.InstancedMesh(cubeGeometry, cubeMaterial, blocks.length);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  state.instanceToCell = new Array(blocks.length);

  blocks.forEach((block, i) => {
    dummy.position.set(
      state.gridOrigin.x + block.x + 0.5,
      state.gridOrigin.y + block.y + 0.5,
      state.gridOrigin.z + block.z + 0.5
    );
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    const blockColor =
      state.blockColors.get(block.paletteIndex) || new THREE.Color(0xffffff);
    color.copy(blockColor);
    mesh.setColorAt(i, color);
    state.instanceToCell[i] = { x: block.x, y: block.y, z: block.z };
  });

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }

  state.mesh = mesh;
  scene.add(mesh);
  updateStats();
}

function updateHelpers() {
  gridGroup.clear();

  const size = Math.max(state.size.x, state.size.z);
  const gridHelper = new THREE.GridHelper(
    size,
    size,
    0x2a3140,
    0x1f2433
  );
  gridGroup.add(gridHelper);

  const boxGeometry = new THREE.BoxGeometry(
    state.size.x,
    state.size.y,
    state.size.z
  );
  const edges = new THREE.EdgesGeometry(boxGeometry);
  const outline = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: 0x394155 })
  );
  outline.position.set(0, state.size.y / 2, 0);
  gridGroup.add(outline);

  controls.target.set(0, state.size.y / 2, 0);
  controls.update();
}

function resizeRenderer() {
  const { clientWidth, clientHeight } = dom.canvasContainer;
  renderer.setSize(clientWidth, clientHeight);
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
}

function resetView() {
  const maxDim = Math.max(state.size.x, state.size.y, state.size.z);
  camera.position.set(maxDim * 1.1, maxDim * 0.9, maxDim * 1.1);
  controls.target.set(0, state.size.y / 2, 0);
  controls.update();
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

function onPointerMove(event) {
  updatePointer(event);
  updateCursorFromHover();
}

function onPointerDown(event) {
  updatePointer(event);
  const hover = state.hover;
  if (!hover) return;

  const action =
    event.button === 2 || event.shiftKey ? "erase" : state.tool;
  const targetCell =
    action === "erase" ? hover.eraseCell : hover.placeCell;

  if (!targetCell) return;
  if (!isWithinBounds(targetCell)) return;

  const paletteIndex =
    action === "erase" ? 0 : Number(state.selectedIndex);
  const changed = setBlock(targetCell, paletteIndex);
  if (changed) {
    rebuildMesh();
    updateCursorFromHover();
  }
}

function updatePointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  state.hover = resolveHoverTarget();
}

function resolveHoverTarget() {
  const hits = state.mesh
    ? raycaster.intersectObject(state.mesh, false)
    : [];

  if (hits.length) {
    const hit = hits[0];
    const cell = state.instanceToCell[hit.instanceId];
    if (!cell || !hit.face) return null;
    const normal = hit.face.normal.clone().round();
    const placeCell = {
      x: cell.x + normal.x,
      y: cell.y + normal.y,
      z: cell.z + normal.z,
    };
    return {
      hasVoxel: true,
      eraseCell: cell,
      placeCell,
    };
  }

  const groundHits = raycaster.intersectObject(groundPlane, false);
  if (!groundHits.length) return null;

  const point = groundHits[0].point.clone().sub(state.gridOrigin);
  const cell = {
    x: Math.floor(point.x),
    y: 0,
    z: Math.floor(point.z),
  };
  return {
    hasVoxel: false,
    eraseCell: null,
    placeCell: cell,
  };
}

function updateCursorFromHover() {
  const hover = state.hover;
  if (!hover) {
    cursorMesh.visible = false;
    dom.hoverText.textContent = "Hover a block to edit.";
    return;
  }

  const targetCell =
    state.tool === "erase" ? hover.eraseCell : hover.placeCell;
  const actionLabel = state.tool === "erase" ? "Erase" : "Place";

  if (!targetCell || !isWithinBounds(targetCell)) {
    cursorMesh.visible = false;
    dom.hoverText.textContent = "Outside of world bounds.";
    return;
  }

  cursorMesh.visible = true;
  cursorMaterial.color.set(state.tool === "erase" ? 0xf87171 : 0x5eead4);
  cursorMesh.position.set(
    state.gridOrigin.x + targetCell.x + 0.5,
    state.gridOrigin.y + targetCell.y + 0.5,
    state.gridOrigin.z + targetCell.z + 0.5
  );

  dom.hoverText.textContent = `${actionLabel} at (${targetCell.x}, ${targetCell.y}, ${targetCell.z})`;
}

function setBlock(cell, paletteIndex) {
  const idx = indexFor(cell.x, cell.y, cell.z);
  if (state.grid[idx] === paletteIndex) return false;
  state.grid[idx] = paletteIndex;
  return true;
}

function indexFor(x, y, z) {
  return x + z * state.size.x + y * state.size.x * state.size.z;
}

function isWithinBounds(cell) {
  return (
    cell.x >= 0 &&
    cell.y >= 0 &&
    cell.z >= 0 &&
    cell.x < state.size.x &&
    cell.y < state.size.y &&
    cell.z < state.size.z
  );
}

function updateStats() {
  dom.statsText.textContent = `Blocks: ${state.filledCount.toLocaleString()}`;
}

function setStatus(message) {
  dom.statusText.textContent = message;
}

function getBlockColor(name) {
  const clean = normalizeBlockName(name);
  const base = clean.replace(/^minecraft:/, "").split("[")[0];
  if (KNOWN_COLORS[base]) {
    return new THREE.Color(KNOWN_COLORS[base]);
  }
  const hue = Math.abs(hashString(base)) % 360;
  const color = new THREE.Color();
  color.setHSL(hue / 360, 0.55, 0.55);
  return color;
}

function normalizeBlockName(name) {
  if (!name) return "minecraft:air";
  if (name.includes(":")) return name;
  return `minecraft:${name}`;
}

function ensureAirFirst(blocks) {
  const list = blocks.filter(Boolean);
  const airIndex = list.findIndex((name) => isAirBlock(name));
  if (airIndex === 0) return list;
  const withoutAir = list.filter((name, idx) => idx !== airIndex);
  return ["minecraft:air", ...withoutAir];
}

function isAirBlock(name) {
  const base = normalizeBlockName(name).replace(/^minecraft:/, "").split("[")[0];
  return base === "air" || base === "cave_air" || base === "void_air";
}

function hashString(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return hash;
}

function clampInt(value, min, max) {
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num)) return min;
  return Math.min(Math.max(num, min), max);
}

async function loadFile(file) {
  setStatus(`Loading ${file.name}...`);
  try {
    if (file.name.toLowerCase().endsWith(".json")) {
      const text = await file.text();
      loadFromJson(text);
      setStatus(`Loaded ${file.name}`);
      return;
    }

    const nbtData = await parseNbtFile(file);
    if (isStructureNbt(nbtData)) {
      loadStructureNbt(nbtData);
      setStatus(`Loaded structure ${file.name}`);
    } else if (isSchematicNbt(nbtData)) {
      loadSchematicNbt(nbtData);
      setStatus(`Loaded schematic ${file.name}`);
    } else {
      throw new Error("Unsupported NBT structure.");
    }
  } catch (error) {
    console.error(error);
    setStatus(`Failed to load: ${error.message}`);
  }
}

async function parseNbtFile(file) {
  const buffer = await file.arrayBuffer();
  let bytes = new Uint8Array(buffer);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = pako.ungzip(bytes);
  }
  const parsed = await parse(Buffer.from(bytes));
  return simplify(parsed);
}

function isStructureNbt(data) {
  return (
    data &&
    Array.isArray(data.size) &&
    Array.isArray(data.blocks) &&
    Array.isArray(data.palette)
  );
}

function isSchematicNbt(data) {
  return (
    data &&
    (data.Width || data.width) &&
    (data.Height || data.height) &&
    (data.Length || data.length) &&
    (data.Palette || data.palette) &&
    (data.BlockData || data.blockData)
  );
}

function loadStructureNbt(data) {
  const [sizeX, sizeY, sizeZ] = data.size;
  const paletteData = data.palette || [];
  const blocks = data.blocks || [];

  const { palette, map } = buildPaletteFromList(paletteData);
  setPalette(palette);
  resetGrid(sizeX, sizeY, sizeZ);

  blocks.forEach((block) => {
    if (!block || !block.pos) return;
    const [x, y, z] = block.pos;
    if (!isWithinBounds({ x, y, z })) return;
    const mapped = map.get(block.state) ?? 0;
    state.grid[indexFor(x, y, z)] = mapped;
  });

  rebuildMesh();
}

function loadSchematicNbt(data) {
  const sizeX = data.Width || data.width;
  const sizeY = data.Height || data.height;
  const sizeZ = data.Length || data.length;
  const rawPalette = data.Palette || data.palette;
  const rawBlockData = data.BlockData || data.blockData;

  const paletteList = buildPaletteList(rawPalette);
  const { palette, map } = buildPaletteFromNames(paletteList);

  const blockData = normalizeByteArray(rawBlockData);
  const count = sizeX * sizeY * sizeZ;
  const indices = decodeVarIntArray(blockData, count);

  setPalette(palette);
  resetGrid(sizeX, sizeY, sizeZ);

  let cursor = 0;
  for (let y = 0; y < sizeY; y += 1) {
    for (let z = 0; z < sizeZ; z += 1) {
      for (let x = 0; x < sizeX; x += 1) {
        const sourceIndex = indices[cursor++];
        const mapped = map.get(sourceIndex) ?? 0;
        state.grid[indexFor(x, y, z)] = mapped;
      }
    }
  }

  rebuildMesh();
}

function buildPaletteFromList(entries) {
  const palette = ["minecraft:air"];
  const nameToIndex = new Map([["minecraft:air", 0]]);
  const map = new Map();

  entries.forEach((entry, idx) => {
    const name = buildBlockName(entry);
    if (isAirBlock(name)) {
      map.set(idx, 0);
      return;
    }
    if (!nameToIndex.has(name)) {
      nameToIndex.set(name, palette.length);
      palette.push(name);
    }
    map.set(idx, nameToIndex.get(name));
  });

  return { palette, map };
}

function buildPaletteFromNames(names) {
  const palette = ["minecraft:air"];
  const nameToIndex = new Map([["minecraft:air", 0]]);
  const map = new Map();

  names.forEach((name, idx) => {
    const clean = normalizeBlockName(name);
    if (isAirBlock(clean)) {
      map.set(idx, 0);
      return;
    }
    if (!nameToIndex.has(clean)) {
      nameToIndex.set(clean, palette.length);
      palette.push(clean);
    }
    map.set(idx, nameToIndex.get(clean));
  });

  return { palette, map };
}

function buildPaletteList(paletteTag) {
  if (Array.isArray(paletteTag)) {
    return paletteTag.map((entry) => buildBlockName(entry));
  }
  const list = [];
  Object.entries(paletteTag).forEach(([name, index]) => {
    list[index] = normalizeBlockName(name);
  });
  return list;
}

function buildBlockName(entry) {
  if (typeof entry === "string") {
    return normalizeBlockName(entry);
  }
  if (!entry) return "minecraft:air";
  const base = entry.Name || entry.name || entry.id || "minecraft:air";
  const props = entry.Properties || entry.properties;
  if (props && Object.keys(props).length) {
    const propsString = Object.entries(props)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join(",");
    return `${base}[${propsString}]`;
  }
  return normalizeBlockName(base);
}

function normalizeByteArray(value) {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return Uint8Array.from(value);
  if (value && value.buffer instanceof ArrayBuffer) {
    return new Uint8Array(value.buffer);
  }
  return new Uint8Array();
}

function decodeVarIntArray(bytes, expectedCount) {
  const values = new Array(expectedCount);
  let value = 0;
  let shift = 0;
  let index = 0;

  for (let i = 0; i < bytes.length && index < expectedCount; i += 1) {
    const byte = bytes[i];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      values[index] = value;
      index += 1;
      value = 0;
      shift = 0;
    } else {
      shift += 7;
      if (shift > 35) {
        throw new Error("Invalid BlockData varint.");
      }
    }
  }

  if (index < expectedCount) {
    throw new Error("BlockData ended early.");
  }

  return values;
}

function loadFromJson(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data.size) || data.size.length < 3) {
    throw new Error("Invalid JSON structure.");
  }
  const [sizeX, sizeY, sizeZ] = data.size;
  const paletteInput = Array.isArray(data.palette) ? data.palette : [];
  const blocksInput = Array.isArray(data.blocks) ? data.blocks : [];
  const { palette, map } = buildPaletteFromNames(paletteInput);
  const remappedBlocks = new Array(blocksInput.length);

  for (let i = 0; i < blocksInput.length; i += 1) {
    const sourceIndex = Number(blocksInput[i]) || 0;
    remappedBlocks[i] = map.get(sourceIndex) ?? 0;
  }

  setPalette(palette);
  resetGrid(sizeX, sizeY, sizeZ);

  const max = Math.min(state.grid.length, remappedBlocks.length);
  for (let i = 0; i < max; i += 1) {
    state.grid[i] = remappedBlocks[i];
  }
  rebuildMesh();
}

function downloadJson() {
  const payload = {
    size: [state.size.x, state.size.y, state.size.z],
    palette: state.palette,
    blocks: Array.from(state.grid),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "voxel-map.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus("Exported JSON.");
}
