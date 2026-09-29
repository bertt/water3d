# Water Pool

A top-down view of a shallow, tiled water pool rendered with [three.js](https://threejs.org/).
No frameworks and no build step. It is plain HTML, CSS and ES modules.

Click anywhere on the water to drop a ripple. Waves spread out, interfere with each other,
reflect off the pool walls and slowly fade out. Refraction distorts the tiles on the bottom,
and the light patterns on the bottom (caustics) move with the waves.

## Running

ES modules need to be served over HTTP, so start any static file server in this folder, for example:

```sh
python -m http.server 8000
# or
npx http-server -p 8000
```

Then open <http://localhost:8000> in a WebGL2-capable browser. Three.js is loaded from the jsDelivr CDN
through an import map, so you need an internet connection.

## Controls

| Control       | Effect                                                        |
|---------------|---------------------------------------------------------------|
| Left click    | Drops a ripple at the clicked point (click as often as you like) |
| Wave speed    | How fast the waves travel                                     |
| Surface tension | Dispersion: short ripples run ahead of longer ones          |
| Damping       | How quickly the waves fade out                                |
| Drop size     | Radius of the ripple train created by a drop                  |
| Drop strength | Height of the ripples created by a drop                       |
| Caustics      | Turns the light patterns on the pool bottom on or off         |
| Reset water   | Makes the water surface flat again                            |

## How it works

- **Simulation (`simulation.js`)**: The water height field (512×512) lives on the GPU in two
  floating-point render targets that swap roles every step. Each step solves a dispersive 2D wave
  equation: a gravity term (Laplacian), a surface tension term (biharmonic) and a viscosity term
  that damps short ripples faster. Waves add up linearly, so overlapping ripple trains interfere
  and form a visible pattern. The pool walls use reflective boundaries. Damping fades the waves
  out. The simulation runs at a fixed number of steps per second, whatever the frame rate.
- **Drops**: A click is raycast onto the water plane. The hit point is queued and applied as a
  drop impact: a central dent surrounded by a few concentric ripples.
- **Normals**: A separate pass works out the surface normals from the height field.
- **Caustics**: A fine grid refracts the sunlight through the surface onto the pool bottom. The
  change in triangle area gives the light concentration.
- **Rendering (`shaders.js`)**: The water shader refracts the view ray into the pool, finds where
  it hits the bottom or a wall, and samples the procedural tile texture and the caustics. It then
  adds water absorption, a Fresnel sky reflection and sun highlights.

## Files

- `index.html`: page, import map and settings panel
- `style.css`: layout and panel styling
- `main.js`: scene, camera, input handling and animation loop
- `simulation.js`: GPU wave simulation and caustics renderer
- `shaders.js`: GLSL shader sources
