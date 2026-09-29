// GLSL sources. Pool coordinates: x and z in [-1, 1], water surface at y = 0,
// pool bottom at y = -depth. Simulation texture uv = xz * 0.5 + 0.5.
// Simulation texel layout: r = height, g = vertical velocity, b/a = surface normal x/z.

const common = /* glsl */ `
  const float PI = 3.141592653589793;
  const float IOR_AIR = 1.0;
  const float IOR_WATER = 1.333;
`;

export const fullscreenVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Dispersive 2D wave equation: gravity term (Laplacian) plus a surface
// tension term (biharmonic), so a single drop spreads into a train of
// ripples whose short waves run ahead, like real capillary ripples.
// Viscosity damps short wavelengths faster than long ones.
// Clamp-to-edge sampling mirrors the border texels, which gives
// reflective (Neumann) boundaries at the pool walls.
export const updateFragment = /* glsl */ `
  uniform sampler2D tex;
  uniform vec2 delta;
  uniform float waveSpeed;
  uniform float surfaceTension;
  uniform float viscosity;
  uniform float damping;
  varying vec2 vUv;

  vec2 hv(vec2 offset) {
    return texture2D(tex, vUv + offset * delta).rg;
  }

  void main() {
    vec4 info = texture2D(tex, vUv);

    vec2 l  = hv(vec2(-1.0, 0.0));
    vec2 r  = hv(vec2( 1.0, 0.0));
    vec2 d  = hv(vec2( 0.0,-1.0));
    vec2 u  = hv(vec2( 0.0, 1.0));
    float h = info.r;

    // Discrete Laplacian (scaled by 1/4) of height at the centre and its neighbours.
    float lapC = (l.x + r.x + d.x + u.x) * 0.25 - h;
    float lapL = (hv(vec2(-2.0, 0.0)).r + h + hv(vec2(-1.0,-1.0)).r + hv(vec2(-1.0, 1.0)).r) * 0.25 - l.x;
    float lapR = (hv(vec2( 2.0, 0.0)).r + h + hv(vec2( 1.0,-1.0)).r + hv(vec2( 1.0, 1.0)).r) * 0.25 - r.x;
    float lapD = (hv(vec2( 0.0,-2.0)).r + h + hv(vec2(-1.0,-1.0)).r + hv(vec2( 1.0,-1.0)).r) * 0.25 - d.x;
    float lapU = (hv(vec2( 0.0, 2.0)).r + h + hv(vec2(-1.0, 1.0)).r + hv(vec2( 1.0, 1.0)).r) * 0.25 - u.x;
    float biharmonic = (lapL + lapR + lapD + lapU) * 0.25 - lapC;

    float velocityLap = (l.y + r.y + d.y + u.y) * 0.25 - info.g;

    info.g += waveSpeed * lapC - surfaceTension * biharmonic;
    info.g += viscosity * velocityLap;
    info.g *= damping;
    info.r += info.g;
    // Slowly relax the mean water level back to rest.
    info.r *= 0.9999;

    gl_FragColor = info;
  }
`;

export const dropFragment = /* glsl */ `
  ${common}
  uniform sampler2D tex;
  uniform vec2 center;
  uniform float radius;
  uniform float strength;
  uniform float rings;
  varying vec2 vUv;

  // A drop impact: a central dent surrounded by a few concentric ripples,
  // faded out smoothly towards the given radius.
  void main() {
    vec4 info = texture2D(tex, vUv);
    float x = length(center - vUv) / radius;
    if (x < 1.0) {
      float window = 0.5 + 0.5 * cos(x * PI);
      info.r += strength * window * cos(x * PI * 2.0 * rings);
    }
    gl_FragColor = info;
  }
`;

export const normalFragment = /* glsl */ `
  uniform sampler2D tex;
  uniform vec2 delta;
  uniform float texelWorld;
  varying vec2 vUv;

  void main() {
    vec4 info = texture2D(tex, vUv);
    vec2 dx = vec2(delta.x, 0.0);
    vec2 dy = vec2(0.0, delta.y);
    float hx = texture2D(tex, vUv + dx).r - texture2D(tex, vUv - dx).r;
    float hz = texture2D(tex, vUv + dy).r - texture2D(tex, vUv - dy).r;
    vec3 normal = normalize(vec3(-hx, 2.0 * texelWorld, -hz));
    info.ba = normal.xz;
    gl_FragColor = info;
  }
`;

// Caustics: every vertex of a fine grid refracts the sunlight through the
// (displaced) surface onto the pool bottom. The ratio between the undisturbed
// and the refracted triangle area gives the light concentration.
export const causticsVertex = /* glsl */ `
  ${common}
  uniform sampler2D water;
  uniform vec3 light;
  uniform float depth;
  varying vec3 oldPos;
  varying vec3 newPos;

  vec3 projectToBottom(vec3 origin, vec3 ray) {
    float t = (-depth - origin.y) / ray.y;
    return origin + ray * t;
  }

  void main() {
    vec4 info = texture2D(water, position.xy * 0.5 + 0.5);
    vec3 normal = vec3(info.b, sqrt(max(0.0, 1.0 - dot(info.ba, info.ba))), info.a);
    vec3 flatRay = refract(-light, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
    vec3 ray = refract(-light, normal, IOR_AIR / IOR_WATER);
    vec3 surface = vec3(position.x, 0.0, position.y);

    oldPos = projectToBottom(surface, flatRay);
    newPos = projectToBottom(surface + vec3(0.0, info.r, 0.0), ray);
    gl_Position = vec4(newPos.x, newPos.z, 0.0, 1.0);
  }
`;

export const causticsFragment = /* glsl */ `
  varying vec3 oldPos;
  varying vec3 newPos;

  void main() {
    float oldArea = length(dFdx(oldPos)) * length(dFdy(oldPos));
    float newArea = length(dFdx(newPos)) * length(dFdy(newPos));
    float intensity = oldArea / max(newArea, 1e-9);
    gl_FragColor = vec4(vec3(intensity), 1.0);
  }
`;

export const waterVertex = /* glsl */ `
  uniform sampler2D water;
  varying vec3 vWorld;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    world.y += texture2D(water, world.xz * 0.5 + 0.5).r;
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const waterFragment = /* glsl */ `
  ${common}
  uniform sampler2D water;
  uniform sampler2D tiles;
  uniform sampler2D caustics;
  uniform vec3 light;
  uniform float depth;
  uniform float causticsEnabled;
  varying vec3 vWorld;

  const vec3 absorption = vec3(0.9, 0.3, 0.2);

  vec2 intersectBox(vec3 origin, vec3 ray, vec3 boxMin, vec3 boxMax) {
    vec3 tMin = (boxMin - origin) / ray;
    vec3 tMax = (boxMax - origin) / ray;
    vec3 t1 = min(tMin, tMax);
    vec3 t2 = max(tMin, tMax);
    float tNear = max(max(t1.x, t1.y), t1.z);
    float tFar = min(min(t2.x, t2.y), t2.z);
    return vec2(tNear, tFar);
  }

  vec3 poolColor(vec3 p) {
    vec3 toLight = -refract(-light, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
    vec3 color;
    vec3 normal;
    float lightAmount;

    if (abs(p.x) > 0.999) {
      color = texture2D(tiles, vec2(p.z, p.y) * 0.5 + 0.5).rgb;
      normal = vec3(-sign(p.x), 0.0, 0.0);
      lightAmount = 0.45 + 0.45 * max(0.0, dot(toLight, normal));
    } else if (abs(p.z) > 0.999) {
      color = texture2D(tiles, vec2(p.x, p.y) * 0.5 + 0.5).rgb;
      normal = vec3(0.0, 0.0, -sign(p.z));
      lightAmount = 0.45 + 0.45 * max(0.0, dot(toLight, normal));
    } else {
      color = texture2D(tiles, p.xz * 0.5 + 0.5).rgb;
      float caustic = min(texture2D(caustics, p.xz * 0.5 + 0.5).r, 6.0);
      caustic = mix(1.0, caustic, causticsEnabled);
      lightAmount = 0.25 + 0.8 * toLight.y * caustic;
    }

    // Ambient occlusion in the corners between walls and bottom.
    float wallDist = 1.0 - max(abs(p.x), abs(p.z));
    float floorDist = p.y + depth;
    lightAmount *= 1.0 - 0.35 * exp(-min(wallDist, floorDist) * 30.0);

    return color * lightAmount;
  }

  void main() {
    vec4 info = texture2D(water, vWorld.xz * 0.5 + 0.5);
    vec3 normal = normalize(vec3(info.b, sqrt(max(0.0, 1.0 - dot(info.ba, info.ba))), info.a));
    vec3 incoming = normalize(vWorld - cameraPosition);

    vec3 refracted = refract(incoming, normal, IOR_AIR / IOR_WATER);
    vec2 t = intersectBox(vWorld, refracted, vec3(-1.0, -depth, -1.0), vec3(1.0, 2.0, 1.0));
    vec3 hit = vWorld + refracted * t.y;
    vec3 color = poolColor(hit) * exp(-t.y * absorption);

    vec3 reflected = reflect(incoming, normal);
    vec3 sky = mix(vec3(0.78, 0.86, 0.95), vec3(0.32, 0.52, 0.82), clamp(reflected.y, 0.0, 1.0));
    float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(-incoming, normal), 0.0), 5.0);
    color = mix(color, sky, fresnel);

    float spec = pow(max(dot(reflected, light), 0.0), 300.0);
    color += vec3(1.0, 0.97, 0.9) * spec * 2.0;

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
