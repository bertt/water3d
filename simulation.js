import * as THREE from 'three';
import {
  fullscreenVertex,
  updateFragment,
  dropFragment,
  normalFragment,
  causticsVertex,
  causticsFragment,
} from './shaders.js';

function pickSimulationType(renderer) {
  const ext = renderer.extensions;
  if (ext.has('EXT_color_buffer_float') && ext.has('OES_texture_float_linear')) {
    return THREE.FloatType;
  }
  if (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float')) {
    return THREE.HalfFloatType;
  }
  return null;
}

function createTarget(size, type) {
  return new THREE.WebGLRenderTarget(size, size, {
    type,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

function passMaterial(fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({
    vertexShader: fullscreenVertex,
    fragmentShader,
    uniforms: { tex: { value: null }, ...uniforms },
    depthTest: false,
    depthWrite: false,
  });
}

/**
 * GPU heightfield water simulation using two ping-pong render targets.
 */
export class WaterSimulation {
  constructor(renderer, { resolution = 256, poolSize = 2 } = {}) {
    const type = pickSimulationType(renderer);
    if (type === null) {
      throw new Error('This browser does not support rendering to floating-point textures.');
    }

    this.renderer = renderer;
    this.resolution = resolution;
    this.targets = [createTarget(resolution, type), createTarget(resolution, type)];
    this.current = 0;

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    const delta = new THREE.Vector2(1 / resolution, 1 / resolution);
    this.updateMaterial = passMaterial(updateFragment, {
      delta: { value: delta },
      waveSpeed: { value: 1.2 },
      surfaceTension: { value: 0.18 },
      viscosity: { value: 0.03 },
      damping: { value: 0.997 },
    });
    this.dropMaterial = passMaterial(dropFragment, {
      center: { value: new THREE.Vector2() },
      radius: { value: 0.035 },
      strength: { value: 0.004 },
      rings: { value: 3 },
    });
    this.normalMaterial = passMaterial(normalFragment, {
      delta: { value: delta },
      texelWorld: { value: poolSize / resolution },
    });

    this.reset();
  }

  get texture() {
    return this.targets[this.current].texture;
  }

  // The explicit scheme is stable while waveSpeed + 2 * surfaceTension <= 2,
  // so the surface tension is limited to keep a small safety margin.
  setWaveParameters(waveSpeed, surfaceTension) {
    const uniforms = this.updateMaterial.uniforms;
    uniforms.waveSpeed.value = waveSpeed;
    uniforms.surfaceTension.value = Math.min(surfaceTension, Math.max(0, (1.95 - waveSpeed) / 2));
  }

  set damping(value) {
    this.updateMaterial.uniforms.damping.value = value;
  }

  runPass(material) {
    const next = 1 - this.current;
    material.uniforms.tex.value = this.texture;
    this.quad.material = material;
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.targets[next]);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(previous);
    this.current = next;
  }

  addDrop(u, v, radius, strength) {
    const uniforms = this.dropMaterial.uniforms;
    uniforms.center.value.set(u, v);
    uniforms.radius.value = radius;
    uniforms.strength.value = strength;
    this.runPass(this.dropMaterial);
  }

  step() {
    this.runPass(this.updateMaterial);
  }

  updateNormals() {
    this.runPass(this.normalMaterial);
  }

  reset() {
    const previous = this.renderer.getRenderTarget();
    const clearColor = this.renderer.getClearColor(new THREE.Color());
    const clearAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);
    for (const target of this.targets) {
      this.renderer.setRenderTarget(target);
      this.renderer.clear(true, false, false);
    }
    this.renderer.setClearColor(clearColor, clearAlpha);
    this.renderer.setRenderTarget(previous);
  }
}

/**
 * Renders a caustics light map of the pool bottom (x/z in [-1, 1]).
 */
export class CausticsRenderer {
  constructor(renderer, { resolution = 1024, gridSize = 256, light, depth }) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(resolution, resolution, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });

    this.material = new THREE.ShaderMaterial({
      vertexShader: causticsVertex,
      fragmentShader: causticsFragment,
      uniforms: {
        water: { value: null },
        light: { value: light },
        depth: { value: depth },
      },
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, gridSize, gridSize), this.material);
    mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  get texture() {
    return this.target.texture;
  }

  update(waterTexture) {
    this.material.uniforms.water.value = waterTexture;
    const previous = this.renderer.getRenderTarget();
    const clearColor = this.renderer.getClearColor(new THREE.Color());
    const clearAlpha = this.renderer.getClearAlpha();
    this.renderer.setRenderTarget(this.target);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear(true, false, false);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setClearColor(clearColor, clearAlpha);
    this.renderer.setRenderTarget(previous);
  }
}
