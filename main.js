import * as THREE from 'three';
import { WaterSimulation, CausticsRenderer } from './simulation.js';
import { waterVertex, waterFragment } from './shaders.js';

const POOL_DEPTH = 0.2;
const RIM_WIDTH = 0.3;
const SIM_STEPS_PER_SECOND = 90;
const MAX_STEPS_PER_FRAME = 8;
const MAX_QUEUED_DROPS = 32;
const LIGHT_DIRECTION = new THREE.Vector3(0.35, 1.0, 0.25).normalize();

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

let simulation;
let caustics;
try {
  simulation = new WaterSimulation(renderer, { resolution: 512, poolSize: 2 });
  caustics = new CausticsRenderer(renderer, {
    resolution: 1024,
    gridSize: 512,
    light: LIGHT_DIRECTION,
    depth: POOL_DEPTH,
  });
} catch (error) {
  const box = document.getElementById('error');
  box.textContent = `Sorry, the water simulation cannot run here: ${error.message}`;
  box.hidden = false;
  throw error;
}

// Scene: camera looking straight down on the pool.
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a3230);

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
camera.up.set(0, 0, -1);

function fitCamera() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  const halfExtent = 1 + RIM_WIDTH + 0.1;
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const fitHeight = halfExtent / Math.tan(halfFov);
  const fitWidth = halfExtent / (Math.tan(halfFov) * camera.aspect);
  camera.position.set(0, Math.max(fitHeight, fitWidth), 0);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}
fitCamera();
window.addEventListener('resize', fitCamera);

scene.add(new THREE.HemisphereLight(0xdfeaf5, 0x3a3a30, 1.2));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.0);
sun.position.copy(LIGHT_DIRECTION).multiplyScalar(5);
scene.add(sun);

function createTileTexture() {
  const size = 1024;
  const tiles = 16;
  const tileSize = size / tiles;
  const grout = 3;
  const canvasEl = document.createElement('canvas');
  canvasEl.width = canvasEl.height = size;
  const ctx = canvasEl.getContext('2d');

  ctx.fillStyle = '#9db4bd';
  ctx.fillRect(0, 0, size, size);

  for (let y = 0; y < tiles; y++) {
    for (let x = 0; x < tiles; x++) {
      const border = x === 0 || y === 0 || x === tiles - 1 || y === tiles - 1;
      const variation = (Math.random() - 0.5) * 14;
      const [r, g, b] = border ? [46, 118, 168] : [196, 230, 238];
      ctx.fillStyle = `rgb(${r + variation}, ${g + variation}, ${b + variation})`;
      ctx.fillRect(x * tileSize + grout / 2, y * tileSize + grout / 2, tileSize - grout, tileSize - grout);

      // Subtle glaze highlight on each tile.
      const gradient = ctx.createLinearGradient(x * tileSize, y * tileSize, (x + 1) * tileSize, (y + 1) * tileSize);
      gradient.addColorStop(0, 'rgba(255,255,255,0.10)');
      gradient.addColorStop(1, 'rgba(0,0,0,0.06)');
      ctx.fillStyle = gradient;
      ctx.fillRect(x * tileSize + grout / 2, y * tileSize + grout / 2, tileSize - grout, tileSize - grout);
    }
  }

  const texture = new THREE.CanvasTexture(canvasEl);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

// Water surface: renders refraction into the pool, reflection and sun glints.
const waterMaterial = new THREE.ShaderMaterial({
  vertexShader: waterVertex,
  fragmentShader: waterFragment,
  uniforms: {
    water: { value: null },
    tiles: { value: createTileTexture() },
    caustics: { value: null },
    light: { value: LIGHT_DIRECTION },
    depth: { value: POOL_DEPTH },
    causticsEnabled: { value: 1 },
  },
});
const waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 256, 256), waterMaterial);
waterMesh.rotation.x = -Math.PI / 2;
scene.add(waterMesh);

// Stone rim around the pool.
const rimMaterial = new THREE.MeshStandardMaterial({ color: 0xe6e0d4, roughness: 0.85 });
const rimHeight = 0.06;
const outer = 2 + RIM_WIDTH * 2;
const rimPieces = [
  [outer, RIM_WIDTH, 0, -(1 + RIM_WIDTH / 2)],
  [outer, RIM_WIDTH, 0, 1 + RIM_WIDTH / 2],
  [RIM_WIDTH, 2, -(1 + RIM_WIDTH / 2), 0],
  [RIM_WIDTH, 2, 1 + RIM_WIDTH / 2, 0],
];
for (const [w, d, x, z] of rimPieces) {
  const piece = new THREE.Mesh(new THREE.BoxGeometry(w, rimHeight, d), rimMaterial);
  piece.position.set(x, 0.01 - rimHeight / 2, z);
  scene.add(piece);
}

// Settings panel.
const settings = {
  waveSpeed: 1.2,
  surfaceTension: 0.18,
  damping: 0.9980,
  dropSize: 0.07,
  dropStrength: 0.004,
};

function bindSlider(id, format, apply) {
  const input = document.getElementById(id);
  const output = document.getElementById(`${id}Value`);
  const update = () => {
    const value = parseFloat(input.value);
    output.textContent = format(value);
    apply(value);
  };
  input.addEventListener('input', update);
  update();
}

bindSlider('waveSpeed', (v) => v.toFixed(2), (v) => {
  settings.waveSpeed = v;
  simulation.setWaveParameters(settings.waveSpeed, settings.surfaceTension);
});
bindSlider('surfaceTension', (v) => v.toFixed(2), (v) => {
  settings.surfaceTension = v;
  simulation.setWaveParameters(settings.waveSpeed, settings.surfaceTension);
});
bindSlider('damping', (v) => `${v}%`, (v) => {
  settings.damping = 1 - 0.0002 - (v / 100) * 0.012;
  simulation.damping = settings.damping;
});
bindSlider('dropSize', (v) => v.toFixed(3), (v) => {
  settings.dropSize = v;
});
bindSlider('dropStrength', (v) => v.toFixed(4), (v) => {
  settings.dropStrength = v;
});

const causticsToggle = document.getElementById('caustics');
const applyCaustics = () => {
  waterMaterial.uniforms.causticsEnabled.value = causticsToggle.checked ? 1 : 0;
};
causticsToggle.addEventListener('change', applyCaustics);
applyCaustics();

document.getElementById('reset').addEventListener('click', () => {
  dropQueue.length = 0;
  simulation.reset();
});

// Mouse input: clicks are queued and applied at the start of the next frame.
const dropQueue = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitPoint = new THREE.Vector3();

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  const rect = canvas.getBoundingClientRect();
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(waterPlane, hitPoint)) return;
  if (Math.abs(hitPoint.x) > 1 || Math.abs(hitPoint.z) > 1) return;
  if (dropQueue.length < MAX_QUEUED_DROPS) {
    dropQueue.push({ u: hitPoint.x * 0.5 + 0.5, v: hitPoint.z * 0.5 + 0.5 });
  }
});

// Animation loop with a fixed simulation timestep.
const clock = new THREE.Clock();
const stepInterval = 1 / SIM_STEPS_PER_SECOND;
let accumulator = 0;

function animate() {
  accumulator += Math.min(clock.getDelta(), 0.1);

  while (dropQueue.length > 0) {
    const { u, v } = dropQueue.shift();
    // Negative strength: a falling drop pushes the surface down.
    simulation.addDrop(u, v, settings.dropSize, -settings.dropStrength);
  }

  let steps = 0;
  while (accumulator >= stepInterval && steps < MAX_STEPS_PER_FRAME) {
    simulation.step();
    accumulator -= stepInterval;
    steps++;
  }
  if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;

  simulation.updateNormals();
  if (causticsToggle.checked) caustics.update(simulation.texture);

  waterMaterial.uniforms.water.value = simulation.texture;
  waterMaterial.uniforms.caustics.value = caustics.texture;
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
