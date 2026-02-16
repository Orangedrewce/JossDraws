// =============================================================================
// WEBGL RIBBON BANNER — Animated header background via fragment shader
// =============================================================================
// Renders a five-color undulating ribbon in the <header> canvas using a
// custom GLSL fragment shader compiled from WEBGL_CONFIG design tokens.
//
//   Boot: DOMContentLoaded → loadBannerConfig() (Supabase RPC, non-blocking)
//         → initWebGL(). Hardcoded defaults used if fetch fails.
//
//   Features: configurable wave dynamics, continuous world rotation, plastic/specular
//   lighting, supersampled FBO with box-filter downsample pass, hover
//   slowdown on <header>, visibility-API pause, context-loss recovery,
//   reduced-motion support, and ResizeObserver-driven resize.
//
//   Guard: double-init via initWebGL._initialized; stale-RAF protection
//   via generation counter.
// =============================================================================

/**
 * ============================================================================
 * ENGINEERING CONFIGURATION DASHBOARD
 * Adjust parameters here. Values are injected into the shader at compile time.
 * ============================================================================
 */
const WEBGL_CONFIG = {
  // 1. Color Palette (RGB 0.0 – 1.0)
  colors: {
    c0: { r: 0.004, g: 0.569, b: 0.663 }, // Home    (Blue)
    c1: { r: 0.482, g: 0.804, b: 0.796 }, // Gallery (Teal)
    c2: { r: 0.988, g: 0.855, b: 0.024 }, // About   (Yellow)
    c3: { r: 0.973, g: 0.561, b: 0.173 }, // Shop    (Orange)
    c4: { r: 0.937, g: 0.341, b: 0.553 }, // Contact (Pink)
    background: { r: 1.0, g: 1.0, b: 1.0 }, // Canvas fill (White)
  },

  // 2. Geometry & Physics
  thickness: {
    base: 0.1, // Base width of the ribbon
    stretchMin: 0.8, // Minimum thickness during stretch
    stretchMax: 1.2, // Maximum thickness during stretch
    stretchSpeed: 1.3, // Temporal speed of breathing motion
    stretchFrequency: 2.5, // Spatial frequency of stretch variation
  },

  // 3. Wave Dynamics (the sine-wave motion)
  wave: {
    mainSpeed: 1.0, // Speed of the primary undulation
    mainFrequency: 3.0, // How many "humps" visible across width
    mainAmplitude: 0.25, // Height of the wave
    secondarySpeed: 1.8, // Speed of secondary detail wave
    secondaryFreq: 1.1, // Frequency of secondary detail
    secondaryAmp: 0.1, // Amplitude of secondary detail
    horizontalSpeed: 0.7, // Speed of horizontal offset motion
    horizontalFrequency: 2.0, // Frequency of horizontal wobble
    horizontalAmount: 0.25, // Amplitude of horizontal offset
    offsetBlend: 0.3, // How much horizontal affects vertical
  },

  // 4. World Rotation (continuous rigid rotation of the entire ribbon)
  twist: {
    enabled: false, // Set false to disable world rotation
    intensity: 0.5, // Rotation speed in rad/s (negative = counter-clockwise)
  },

  // 5. Visual Styling
  appearance: {
    brightness: 1.125, // Global brightness multiplier
    plasticEffect: false, // Enable specular highlights (glossy look)
    centerSoftness: 0.35, // Specular falloff threshold (domain: 0–0.5, matches dEdge range)
    specularPower: 50.0, // Sharpness of the gloss (higher = sharper)
    specularIntensity: 0.75, // Strength of specular highlight
    shadowStrength: 0.1, // Intensity of drop shadow
    shadowWidth: 2.0, // Width multiplier for shadow blur
    aaSharpness: 0.5, // Anti-aliasing edge sharpness
    aaFallback: 0.001, // Fallback AA when derivatives unavailable
  },

  // 6. Positioning
  positioning: {
    verticalOffset: 0.205, // Vertical position in view
    bandCount: 5, // Number of color bands (max index auto-computed)
  },

  // 7. Interaction
  interaction: {
    hoverSlowdown: 0.1, // Speed multiplier when hovering (0.2 = 20%)
    smoothTime: 0.25, // Time to transition speeds (seconds)
  },

  // 8. Performance
  performance: {
    supersampleDesktop: 2.5, // 2× rendering for sharp edges on desktop
    supersampleMobile: 1.0, // 1× rendering for mobile performance
    mobileBreakpoint: 768, // Pixels width to consider "mobile"
    respectDPR: true, // Account for devicePixelRatio (high-DPI screens)
    pauseWhenHidden: true, // Pause animation when tab not visible
    maxDeltaTime: 0.05, // Max frame time to prevent jumps (seconds)
    debugMode: true, // DEBUG: Force Enable WebGL error checking (dev only)
  },

  // 9. Shader selection + Paint Drip params
  shaderType: "ribbon_wave", // "ribbon_wave" | "paint_drip"
  drip: {
    scale: 1.0,
    density: 0.75, // Probability a slot spawns a drip
    dripDistance: 0.1, // Spacing between drip slots
    sdfWidth: 0.18, // SDF sharpness (Drop Thickness)
    fallSpeed: 6.0, // Drip fall speed
    bFreq: 3.5, // Bounce frequency
    bRange: 0.35, // Bounce range
    viscosity: 1.5, // Smooth-min viscosity
  },
  gooey: {
    animSpeed: 2.0, // Sweep speed
    paintLength: 15.0, // Width of the paint block
    loopSize: 24.0, // Domain repetition period (must be > paintLength + screen height)
  },
  groovy: {
    speed: 1.0,
    mixPowerMin: 0.15,
    mixPowerMax: 0.8,
    iterations: 11,
    mouseInfluence: 3.0,
  },
  painter: {
    brushSize: 80.0,
    softness: 1.2,
    noiseScale: 4.0,
    noiseInfluence: 0.4,
    cycleSpeed: 0.2,
    colorIndex: 0.0, // Active tab color: 0=home/c0, 1=gallery/c1, 2=about/c2, 3=shop/c3, 4=contact/c4, 5=reviews/c0
  },
};

/**
 * ============================================================================
 * CORE ENGINE
 * ============================================================================
 */

/**
 * Fetch published banner config from Supabase and merge over WEBGL_CONFIG.
 * Non-blocking: if fetch fails, hardcoded defaults are used silently.
 */
async function loadBannerConfig() {
  try {
    // Wait for Supabase client (may not be available immediately if deferred)
    if (
      typeof supabase === "undefined" ||
      typeof supabase.createClient !== "function"
    )
      return;

    const SUPABASE_URL = "https://pciubbwphwpnptgawgok.supabase.co";
    const SUPABASE_KEY = "sb_publishable_jz1pWpo7TDvURxQ8cqP06A_xc4ckSwv";
    const db =
      window.__supabaseClient ||
      supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    if (!window.__supabaseClient) window.__supabaseClient = db;

    const { data, error } = await db.rpc("get_banner_config");
    if (error || !data || !data.success || !data.config) return;

    const saved = data.config;
    // Merge each group's keys over WEBGL_CONFIG (colors are never overwritten)
    for (const group of [
      "thickness",
      "wave",
      "twist",
      "appearance",
      "positioning",
      "interaction",
      "performance",
      "drip",
      "gooey",
      "groovy",
      "painter",
    ]) {
      if (
        saved[group] &&
        typeof saved[group] === "object" &&
        WEBGL_CONFIG[group]
      ) {
        for (const key in saved[group]) {
          if (key in WEBGL_CONFIG[group]) {
            WEBGL_CONFIG[group][key] = saved[group][key];
          }
        }
      }
    }
    // Merge top-level shaderType
    if (typeof saved.shaderType === "string") {
      WEBGL_CONFIG.shaderType = saved.shaderType;
    }
  } catch (_) {
    // Silently fail — hardcoded defaults remain
  }
}

function initWebGL() {
  // ── Double-init guard [P2] ──
  if (initWebGL._initialized) return;

  initWebGL._generation = (initWebGL._generation || 0) + 1;
  const generation = initWebGL._generation;

  // ── WEBGL_CONFIG validation [v4: P5] ──
  // Ribbon-specific checks -- not applicable in drip mode
  if (WEBGL_CONFIG.shaderType !== "paint_drip") {
    if (
      WEBGL_CONFIG.thickness.base <= 0 ||
      WEBGL_CONFIG.positioning.bandCount < 1 ||
      WEBGL_CONFIG.positioning.bandCount > 5
    ) {
      console.error(
        "[WebGL] Invalid WEBGL_CONFIG — check thickness.base, bandCount.",
      );
      return;
    }
  }

  const canvas = document.getElementById("shaderCanvas");
  if (!canvas) {
    console.warn("[WebGL] Canvas #shaderCanvas not found.");
    return;
  }

  // ── Context with performance hints [P3] ──
  const glOpts = {
    alpha: false,
    antialias: false,
    powerPreference: "high-performance",
  };
  const gl =
    canvas.getContext("webgl", glOpts) ||
    canvas.getContext("experimental-webgl", glOpts);
  if (!gl) {
    console.error("[WebGL] Not supported.");
    return;
  }

  // ── Kill any previous RAF chain + detach stale listeners (survives re-entry) ──
  if (initWebGL._rafId) {
    cancelAnimationFrame(initWebGL._rafId);
    initWebGL._rafId = null;
  }
  if (initWebGL._onVisibilityChange) {
    document.removeEventListener(
      "visibilitychange",
      initWebGL._onVisibilityChange,
    );
    initWebGL._onVisibilityChange = null;
  }
  if (initWebGL._onWindowResize) {
    window.removeEventListener("resize", initWebGL._onWindowResize);
    initWebGL._onWindowResize = null;
  }
  if (
    initWebGL._headerEl &&
    initWebGL._onHeaderEnter &&
    initWebGL._onHeaderLeave
  ) {
    initWebGL._headerEl.removeEventListener(
      "pointerenter",
      initWebGL._onHeaderEnter,
    );
    initWebGL._headerEl.removeEventListener(
      "pointerleave",
      initWebGL._onHeaderLeave,
    );
    initWebGL._headerEl.removeEventListener(
      "pointermove",
      initWebGL._onHeaderMove,
    );
  }
  initWebGL._headerEl = null;
  initWebGL._onHeaderEnter = null;
  initWebGL._onHeaderLeave = null;
  initWebGL._onHeaderMove = null;

  // ── Context loss/restore (attached once) [P1, P3, P4] ──
  if (!initWebGL._contextHandlers) {
    initWebGL._contextHandlers = true;
    canvas.addEventListener(
      "webglcontextlost",
      (e) => {
        e.preventDefault();
        initWebGL._generation++; // [v4] kills stale render loop immediately
        initWebGL._initialized = false;
        if (initWebGL._rafId) {
          cancelAnimationFrame(initWebGL._rafId);
          initWebGL._rafId = null;
        }
        console.warn("[WebGL] Context lost.");
      },
      false,
    );
    canvas.addEventListener(
      "webglcontextrestored",
      () => {
        console.log("[WebGL] Context restored. Re-initializing...");
        initWebGL._initialized = false;
        initWebGL();
      },
      false,
    );
  }

  // ── Accessibility: reduced-motion [P5] ──
  const reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── Derived constants ──
  const bandMax = WEBGL_CONFIG.positioning.bandCount - 1; // auto-compute [P1,P5]

  // ── GLSL float formatter (rounds away JS float noise) ──
  const f = (num) => {
    const n = Math.round(num * 1e6) / 1e6;
    return Number.isInteger(n) ? `${n}.0` : `${n}`;
  };
  const vec3 = (c) => `vec3(${f(c.r)}, ${f(c.g)}, ${f(c.b)})`;

  // ── Shader compilation with error handling [P1] ──
  function compileShader(src, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn(
        "[WebGL] Shader compile error:",
        gl.getShaderInfoLog(shader),
      );
      // Always log source on error for debugging
      console.warn("Source:\n", src);
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  // ── Paint Drip Fragment Shader  ──
  const createPaintShader = () => `
    ${precisionLine}

    uniform vec2 iResolution;
    uniform float iTime;

    uniform float u_scale;
    uniform float u_density;
    uniform float u_dripDistance;
    uniform float u_sdfWidth;
    uniform float u_fallSpeed;
    uniform float u_bFreq;
    uniform float u_bRange;
    uniform float u_viscosity;

    const float PI = 3.14159265359;
    const float TAU = 6.28318530718;
    const float seed = 0.25;
    const float bCurve = 1.5;
    const float LOOP_SECONDS = 12.0;

    vec3 c0 = ${vec3(WEBGL_CONFIG.colors.c0)};
    vec3 c1 = ${vec3(WEBGL_CONFIG.colors.c1)};
    vec3 c2 = ${vec3(WEBGL_CONFIG.colors.c2)};
    vec3 c3 = ${vec3(WEBGL_CONFIG.colors.c3)};
    vec3 c4 = ${vec3(WEBGL_CONFIG.colors.c4)};
    vec3 bg = ${vec3(WEBGL_CONFIG.colors.background)};

    vec3 getColor(int i) {
        if (i == 0) return c0;
        if (i == 1) return c1;
        if (i == 2) return c2;
        if (i == 3) return c3;
        if (i == 4) return c4;
        return vec3(1.0);
    }

    float rand(float x, float y) {
        return fract(sin(dot(vec2(x, y), vec2(12.9898, 78.233))) * 43758.5453);
    }

    float smin(float a, float b, float k) {
        k = max(k, 0.001); 
        float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
        return mix(b, a, h) - k * h * (1.0 - h);
    }

    float dripSDF(vec2 uv) {
        float safeSdfWidth = max(u_sdfWidth, 0.001);
        float safeDripDist = max(u_dripDistance, 0.001);
        float k = max(u_viscosity * 0.05, 0.001);

        // SEAMLESS LOOP FIX
        float safeFreq = max(u_bFreq, 0.001);
        float cycleDivisor = max(1.0, floor((LOOP_SECONDS / safeFreq) + 0.5));
        float lockedFreq = LOOP_SECONDS / cycleDivisor;

        float s = safeSdfWidth * abs((1.0 - uv.y) - 0.75) + 0.05;
        float o = 1.0;
        
        // Initialize to a large number since we are using squared distances now
        float drip2 = 999999.0;

        // ✨ PRE-COMPUTED CONSTANTS & HOISTED MATH
        float loopTime = iTime * LOOP_SECONDS;
        float fallSpeedRange = u_fallSpeed * u_bRange;
        float invS2 = 1.0 / max(s * s, 0.000001); 
        float densityThreshold = 1.0 - u_density; 

        float x = uv.x - safeSdfWidth;
        x += safeDripDist - mod(x, safeDripDist);
        x -= safeDripDist;

        for(int i = 0; i < 150; i++) {
            if (x > uv.x + safeSdfWidth) break;
            
            x += safeDripDist;
            
            // ✨ HARDWARE STEP INSTEAD OF FLOOR+ADD
            float isLine = step(densityThreshold, rand(x, seed));
            
            if (isLine > 0.0) {
                float y = rand(seed, x) * 0.8 + 0.1;
                
                float animTime = loopTime + (y * 10.0);
                float tMod = mod(animTime, lockedFreq);
                
                // ✨ EXTRACTED BCURVE MULTIPLICATION
                float a = bCurve * tMod;
                float bounce = -a * exp(1.0 - a);
                
                y += bounce * u_bRange;
                y = min(y, uv.y);

                float f = y + tMod * fallSpeedRange;

                // ✨ SQUARED DISTANCES (No sqrt)
                vec2 p1 = vec2(x, y) - uv;
                float d2 = dot(p1, p1);
                
                // ✨ MULTIPLY INSTEAD OF DIVIDE
                o *= clamp(d2 * invS2, 0.0, 1.0);
                
                vec2 p2 = vec2(x, f) - uv;
                float currentDripD2 = dot(p2, p2);
                drip2 = smin(drip2, currentDripD2, k);
            }
        }

        o = smin(o, clamp(drip2 * invS2, 0.0, 1.0), k);

        float ceilS = sin(uv.x * 20.0 + (iTime * TAU)) * 0.3 + 0.4;
        
        // ✨ REMOVED UNNECESSARY 1D DISTANCE()
        return o * clamp(uv.y / max(ceilS, 0.001), 0.0, 1.0);
    }

    void main() {
        vec2 normUV = gl_FragCoord.xy / iResolution.xy;
        vec2 uv = normUV;
        uv.x *= iResolution.x / iResolution.y; 
        uv.y = 1.0 - uv.y; 

        float t = normUV.x * 4.0;
        int idx = int(floor(t));
        float fBand = smoothstep(0.0, 1.0, fract(t));

        vec3 cLeft = getColor(idx);
        
        int idx2 = idx + 1;
        if (idx2 > 4) idx2 = 4;
        vec3 cRight = getColor(idx2);

        vec3 ribbonColor = mix(cLeft, cRight, fBand);

        float safeSdfWidth = max(u_sdfWidth, 0.001);
        float c = 1.0 / safeSdfWidth * 0.025;
        float w = 0.03;

        float d = dripSDF(uv * u_scale);
        float mask = 1.0 - smoothstep(c - w, c + w, d);

        gl_FragColor = vec4(mix(bg, ribbonColor, mask), 1.0);
    }
  `;

  // ── Gooey Drip Fragment Shader (SDE-based viscous paint) ──
  const createGooeyShader = () => `
    ${precisionLine}

    uniform vec2 u_resolution;
    uniform float u_time;

    // --- CONFIGURATION (baked from WEBGL_CONFIG) ---
    const float ANIM_SPEED  = ${f(WEBGL_CONFIG.gooey.animSpeed)};
    const float PAINT_LENGTH = ${f(WEBGL_CONFIG.gooey.paintLength)};
    const float LOOP_SIZE    = ${f(WEBGL_CONFIG.gooey.loopSize)};

    vec3 c0 = ${vec3(WEBGL_CONFIG.colors.c0)};
    vec3 c1 = ${vec3(WEBGL_CONFIG.colors.c1)};
    vec3 c2 = ${vec3(WEBGL_CONFIG.colors.c2)};
    vec3 c3 = ${vec3(WEBGL_CONFIG.colors.c3)};
    vec3 c4 = ${vec3(WEBGL_CONFIG.colors.c4)};
    vec3 bg = ${vec3(WEBGL_CONFIG.colors.background)};

    // --- SIGNED DISTANCE ESTIMATOR ---
    float DE( vec2 pp, float t )
    {
        // Fluid dynamics
        pp.y += (
            0.4 * sin(0.5 * 2.3 * pp.x + pp.y) +
            0.2 * sin(0.5 * 5.5 * pp.x + pp.y) +
            0.1 * sin(0.5 * 13.7 * pp.x) +
            0.06 * sin(0.5 * 23.0 * pp.x)
        );

        // Continuous Domain Repetition (eliminates mod-boundary glitch)
        float halfLoop = LOOP_SIZE * 0.5;
        float localY = mod(pp.y + ANIM_SPEED * t + halfLoop, LOOP_SIZE) - halfLoop;

        // Signed distance to a centered paint band
        float paintRadius = PAINT_LENGTH * 0.5;
        return paintRadius - abs(localY);
    }

    // --- HEIGHT MAP ISOLATION ---
    float getSurfaceHeight(vec2 pp, float t) {
        float sd = DE(pp, t);
        float h = clamp(smoothstep(0.0, 0.25, max(sd, 0.0)), 0.0, 1.0);
        return 4.0 * pow(h, 0.2);
    }

    // --- COLOR MAPPING ---
    vec3 getMultiColor(float x) {
        float viewWidth = 8.0 * (u_resolution.x / u_resolution.y);
        float spread = clamp(x / viewWidth, 0.0, 1.0);
        float v = spread * 4.0;
        if (v < 1.0) return mix(c0, c1, v);
        if (v < 2.0) return mix(c1, c2, v - 1.0);
        if (v < 3.0) return mix(c2, c3, v - 2.0);
        return mix(c3, c4, clamp(v - 3.0, 0.0, 1.0));
    }

    // --- RENDERING ---
    vec3 sceneColour( in vec2 pp, float pxSize )
    {
        float t = u_time;
        float sd = DE(pp, t);
        float alpha = smoothstep(-pxSize, pxSize, sd);

        // Early exit for background
        if(alpha <= 0.0) return bg;

        vec2 e = vec2(0.02, 0.0);
        float h = getSurfaceHeight(pp, t);
        float hx = getSurfaceHeight(pp + e.xy, t);
        float hy = getSurfaceHeight(pp + e.yx, t);

        // Forward differencing normals
        vec3 N = normalize(vec3(-(hx - h) / e.x, 1.0, -(hy - h) / e.x));
        vec3 L = normalize(vec3(0.5, 0.7, -0.5));

        // Mirrored specular lobe
        float spec = pow(max(abs(dot(N, L)), 0.0), 10.0);

        vec3 baseColor = getMultiColor(pp.x);
        vec3 paintColor = baseColor + vec3(spec * 0.5);
        return mix(bg, paintColor, alpha);
    }

    void main()
    {
        vec2 uv = gl_FragCoord.xy / u_resolution.xy;
        uv.x *= u_resolution.x / u_resolution.y;
        float pxSize = 8.0 / u_resolution.y;
        gl_FragColor = vec4(sceneColour(uv * 8.0, pxSize), 1.0);
    }
  `;

  // ── Groovy Shader Fragment (swirling color-mix) ──
  const createGroovyShader = () => {
    const cfg = WEBGL_CONFIG;
    // Adapted from banner-shaders.js to match Dashboard preview
    return `
      ${precisionLine}
      uniform vec2 iResolution;
      uniform float iTime;
      uniform vec2 u_mouse;
      uniform float u_groovy_speed;

      uniform float u_groovy_mixPowerMin;
      uniform float u_groovy_mixPowerMax;
      uniform float u_groovy_iterations;
      uniform float u_groovy_mouseInfluence;

      vec3 c0 = ${vec3(cfg.colors.c0)};
      vec3 c1 = ${vec3(cfg.colors.c1)};
      vec3 c2 = ${vec3(cfg.colors.c2)};
      vec3 c3 = ${vec3(cfg.colors.c3)};
      vec3 c4 = ${vec3(cfg.colors.c4)};
      vec3 bg = ${vec3(cfg.colors.background)};

      void main() {
          // Normalize coordinates
          vec2 uv = (2.0 * gl_FragCoord.xy - iResolution) / min(iResolution.x, iResolution.y);
          vec2 m = (2.0 * u_mouse - iResolution) / min(iResolution.x, iResolution.y);

          // --- ZOOM LOGIC ---
          float zoom = 0.8; 
          uv *= zoom;
          m *= zoom;

          // --- PERFECT LOOP LOGIC ---
          float speedInt = max(1.0, floor(u_groovy_speed)); 
          float t = iTime * 6.28318530718 * speedInt;

          // Mouse influence
          float dist = length(uv - m);
          float mouseInfluence = exp(-u_groovy_mouseInfluence * dist * dist);
          float mixingPower = mix(u_groovy_mixPowerMin, u_groovy_mixPowerMax, mouseInfluence);

          // Domain warping (int loop for mobile GLSL ES 1.0 compat)
          for (int i = 2; i < 25; i++) {
              float fi = float(i);
              if (fi >= u_groovy_iterations) break;
              uv.x += (mixingPower / fi) * cos(fi * 2.0 * uv.y + t);
              uv.y += (mixingPower / fi) * cos(fi * 2.0 * uv.x + t);
          }

          // Final scalar map (integers only)
          float val = 0.5 + 0.5 * cos(uv.x + uv.y + t);

          vec3 col;
          if (val < 0.25) {
              col = mix(c0, c1, val * 4.0);
          } else if (val < 0.5) {
              col = mix(c1, c2, (val - 0.25) * 4.0);
          } else if (val < 0.75) {
              col = mix(c2, c3, (val - 0.5) * 4.0);
          } else {
              col = mix(c3, c4, (val - 0.75) * 4.0);
          }

          gl_FragColor = vec4(mix(bg, col, 0.8), 1.0);
      }
    `;
  };

  // ── Painter Fragment Shader (interactive mouse-driven paint with feedback) ──
  const createPainterShader = () => {
    const cfg = WEBGL_CONFIG;
    return `
      ${precisionLine}
      uniform vec2 iResolution;
      uniform float iTime;
      uniform vec4 u_mouse;
      uniform sampler2D u_prevFrame;
      uniform float u_frame;
      uniform float u_painter_brushSize;
      uniform float u_painter_softness;
      uniform float u_painter_noiseScale;
      uniform float u_painter_noiseInfluence;
      uniform float u_painter_cycleSpeed;
      uniform float u_painter_colorIndex;

      vec3 c0 = ${vec3(cfg.colors.c0)};
      vec3 c1 = ${vec3(cfg.colors.c1)};
      vec3 c2 = ${vec3(cfg.colors.c2)};
      vec3 c3 = ${vec3(cfg.colors.c3)};
      vec3 c4 = ${vec3(cfg.colors.c4)};
      vec3 bg = ${vec3(cfg.colors.background)};

      float SEED = 12345.0;
      float n1(float n) { return fract(cos(n * 85.62 + SEED) * 941.53); }
      float p1(vec2 n) {
          vec2 F = floor(n);
          vec2 S = fract(n);
          return mix(
              mix(n1(F.x + n1(F.y)),       n1(F.x + 1.0 + n1(F.y)),       S.x),
              mix(n1(F.x + n1(F.y + 1.0)), n1(F.x + 1.0 + n1(F.y + 1.0)), S.x),
              S.y
          );
      }

      vec3 getTabColor(float idx) {
          if (idx < 0.5) return c0;
          if (idx < 1.5) return c1;
          if (idx < 2.5) return c2;
          if (idx < 3.5) return c3;
          if (idx < 4.5) return c4;
          return c0;
      }

      vec3 getPaletteColor(float t) {
          float val = fract(t * u_painter_cycleSpeed);
          if (val < 0.25)      return mix(c0, c1, val * 4.0);
          else if (val < 0.5)  return mix(c1, c2, (val - 0.25) * 4.0);
          else if (val < 0.75) return mix(c2, c3, (val - 0.5) * 4.0);
          return mix(c3, c4, (val - 0.75) * 4.0);
      }

      void main() {
          vec2 fragCoord = gl_FragCoord.xy;
          vec4 C;

          if (u_frame < 0.5) {
              C = vec4(bg, 1.0);
          } else {
              vec2 UV = fragCoord / iResolution.xy;
              C = texture2D(u_prevFrame, UV);

              vec2 mousePos = u_mouse.xy;
              if (u_mouse.z <= 0.0) mousePos = vec2(-1000.0);

              float dist = length(fragCoord - mousePos);

              float noiseVal = p1(fragCoord / u_painter_noiseScale);
              float brushPattern = noiseVal * u_painter_noiseInfluence
                                 + (1.0 - u_painter_noiseInfluence);

              float outerRadius = u_painter_brushSize * u_painter_softness;
              float intensity = 1.0 - smoothstep(0.0, outerRadius, dist / brushPattern);

              if (u_mouse.z > 0.0) {
                  vec3 brushColor = getTabColor(u_painter_colorIndex);
                  C = mix(C, vec4(brushColor, 1.0), intensity * 0.5);
              }
          }

          gl_FragColor = C;
      }
    `;
  };

  // ── Safe program creation: null-guards + deletes shaders after link [P1] ──
  function createProgramSafe(vsSrc, fsSrc) {
    const vs = compileShader(vsSrc, gl.VERTEX_SHADER);
    const fs = compileShader(fsSrc, gl.FRAGMENT_SHADER);
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      return null;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    // Force attribute location to 0 to ensure VAO compatibility across programs [P1 fix]
    gl.bindAttribLocation(prog, 0, "a_position");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("[WebGL] Program link error:", gl.getProgramInfoLog(prog));
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return null;
    }
    // Shaders can be freed after a successful link
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return prog;
  }

  // ── Extensions ──
  const hasDerivatives = !!gl.getExtension("OES_standard_derivatives");
  if (!hasDerivatives)
    console.warn(
      "[WebGL] OES_standard_derivatives unavailable; using fallback AA.",
    );
  const vaoExt = gl.getExtension("OES_vertex_array_object");

  // ── Precision detection [v4: P2, P4] ──
  const fragHighp =
    gl.getShaderPrecisionFormat &&
    gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT).precision >
      0;
  const precisionLine = fragHighp
    ? "precision highp float;"
    : "precision mediump float;";

  // ── Conditional extension line [P1] ──
  const extLine = hasDerivatives
    ? "#extension GL_OES_standard_derivatives : enable"
    : "";

  // ── World rotation (reduced-motion slows speed but doesn't disable rotation) ──
  const twistEnabled = WEBGL_CONFIG.twist.enabled;
  const maxWaveAbs =
    WEBGL_CONFIG.wave.mainAmplitude +
    WEBGL_CONFIG.wave.secondaryAmp +
    WEBGL_CONFIG.wave.horizontalAmount *
      Math.abs(WEBGL_CONFIG.wave.offsetBlend);
  const maxRibbonHalfHeight =
    maxWaveAbs +
    WEBGL_CONFIG.thickness.base *
      WEBGL_CONFIG.thickness.stretchMax *
      WEBGL_CONFIG.positioning.bandCount +
    WEBGL_CONFIG.appearance.aaFallback;

  // ── Master Loop Duration (phase-space: shader receives 0→1 phase, multiplied by TAU inside) ──
  const LOOP_SECONDS = 12.0;

  // Force all speed multipliers to integers — guarantees sin(t*N) = sin(t*N + TAU*N)
  // at every loop boundary, regardless of Supabase overrides.
  const speedMain = Math.round(WEBGL_CONFIG.wave.mainSpeed);
  const speedSec = Math.round(WEBGL_CONFIG.wave.secondarySpeed);
  const speedHoriz = Math.round(WEBGL_CONFIG.wave.horizontalSpeed);
  const speedStretch = Math.round(WEBGL_CONFIG.thickness.stretchSpeed);
  const speedTwist = Math.round(WEBGL_CONFIG.twist.intensity);

  // ── Ribbon Wave Fragment Shader (original sine-wave GLSL) [P3] ──
  const createRibbonShader = () => `
    ${precisionLine}
    ${extLine}

    uniform vec2 iResolution;
    uniform float iTime;

    #define R iResolution
    #define T iTime
    #define BASE_THICKNESS ${f(WEBGL_CONFIG.thickness.base)}

    vec3 c0 = ${vec3(WEBGL_CONFIG.colors.c0)};
    vec3 c1 = ${vec3(WEBGL_CONFIG.colors.c1)};
    vec3 c2 = ${vec3(WEBGL_CONFIG.colors.c2)};
    vec3 c3 = ${vec3(WEBGL_CONFIG.colors.c3)};
    vec3 c4 = ${vec3(WEBGL_CONFIG.colors.c4)};
    vec3 bg = ${vec3(WEBGL_CONFIG.colors.background)};

    vec3 getColor(int i){
        if(i==0) return c0;
        if(i==1) return c1;
        if(i==2) return c2;
        if(i==3) return c3;
        if(i==4) return c4;
        return vec3(1.0);
    }

    mat2 rot(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);}

    void main() {
      vec2 fragCoord = gl_FragCoord.xy;
      vec2 uv = (fragCoord - 0.5 * R.xy) / min(R.x, R.y);
      vec3 col = bg;

      // Phase-space time: T is normalized 0→1 phase, convert to radians
      #define TAU 6.28318530718
      float t = T * TAU;

      // --- Early Ribbon Rejection (aspect-corrected for min(R.x,R.y) UV normalization) ---
      ${
        twistEnabled
          ? ""
          : `
      float halfH = ${f(maxRibbonHalfHeight)} * R.y / min(R.x, R.y);
      float ribbonMinY = ${f(WEBGL_CONFIG.positioning.verticalOffset)} - halfH;
      float ribbonMaxY = ${f(WEBGL_CONFIG.positioning.verticalOffset)} + halfH;
      if (uv.y < ribbonMinY || uv.y > ribbonMaxY) {
        gl_FragColor = vec4(bg, 1.0);
        return;
      }
      `
      }

      // --- World Rotation (rotate entire coordinate space, then build ribbon inside it) ---
      ${
        twistEnabled
          ? `
        uv *= rot(t * ${f(speedTwist)});
      `
          : ""
      }

      // --- Wave Motion (integer speeds × phase radians = guaranteed seamless loop) ---
      float yWave = sin(uv.x * ${f(WEBGL_CONFIG.wave.mainFrequency)} + t * ${f(speedMain)}) * ${f(WEBGL_CONFIG.wave.mainAmplitude)}
                  + sin(uv.x * ${f(WEBGL_CONFIG.wave.secondaryFreq)} - t * ${f(speedSec)}) * ${f(WEBGL_CONFIG.wave.secondaryAmp)};

      float xOffset = sin(t * ${f(speedHoriz)} + uv.y * ${f(WEBGL_CONFIG.wave.horizontalFrequency)}) * ${f(WEBGL_CONFIG.wave.horizontalAmount)};

      float stretch = mix(
        ${f(WEBGL_CONFIG.thickness.stretchMin)},
        ${f(WEBGL_CONFIG.thickness.stretchMax)},
        0.5 + 0.5 * sin(t * ${f(speedStretch)} + uv.x * ${f(WEBGL_CONFIG.thickness.stretchFrequency)})
      );

      float bandThickness = BASE_THICKNESS * stretch;
      float offset = (uv.y - yWave) + xOffset * ${f(WEBGL_CONFIG.wave.offsetBlend)};

      // --- Mapping (defensive clamp prevents precision blowout) ---
      float s = clamp((offset + ${f(WEBGL_CONFIG.positioning.verticalOffset)}) / bandThickness, -100.0, 100.0);

      // --- AA width (clamped to prevent screen-flooding tearing artifacts) ---
      ${
        hasDerivatives
          ? `
      float aaw = clamp(fwidth(s) * ${f(WEBGL_CONFIG.appearance.aaSharpness)}, ${f(WEBGL_CONFIG.appearance.aaFallback)}, 0.35);
      `
          : `
      float aaw = ${f(WEBGL_CONFIG.appearance.aaFallback)};
      `
      }

      float xi = floor(s);
      float xf = s - xi;

      int iCenter = int(xi);
      int cCenter = int(clamp(float(iCenter), 0.0, ${f(bandMax)}));
      vec3 bandCol;

      // Early path: center of the band uses solid color (no adjacent lookups/blend math)
      if (xf > aaw && xf < (1.0 - aaw)) {
        bandCol = getColor(cCenter);
      } else {
        int cLeft   = int(clamp(float(iCenter - 1), 0.0, ${f(bandMax)}));
        int cRight  = int(clamp(float(iCenter + 1), 0.0, ${f(bandMax)}));

        vec3 colC = getColor(cCenter);
        vec3 colL = getColor(cLeft);
        vec3 colR = getColor(cRight);

        float wL = 1.0 - smoothstep(0.0, aaw, xf);
        float wR = smoothstep(1.0 - aaw, 1.0, xf);
        float w0 = 1.0 - wL - wR;
        bandCol = colC*w0 + colL*wL + colR*wR;
      }

      // --- Lighting / Plastic Effect ---
      vec3 shaded = bandCol;

      ${
        WEBGL_CONFIG.appearance.plasticEffect
          ? `
        float dEdge = min(xf, 1.0 - xf);
        float centerFactor = smoothstep(0.0, ${f(WEBGL_CONFIG.appearance.centerSoftness)}, dEdge);

        // Brightness
        shaded = bandCol * mix(${f(WEBGL_CONFIG.appearance.brightness)}, 1.0, centerFactor);

        // Specular
        float highlight = pow(centerFactor, ${f(WEBGL_CONFIG.appearance.specularPower)});
        shaded = mix(shaded, vec3(1.0), highlight * ${f(WEBGL_CONFIG.appearance.specularIntensity)});

        // Drop Shadow
        float edgeShadow = 1.0 - smoothstep(0.0, max(aaw * ${f(WEBGL_CONFIG.appearance.shadowWidth)}, 0.002), xf);
        shaded *= 1.0 - edgeShadow * ${f(WEBGL_CONFIG.appearance.shadowStrength)};
      `
          : `
        shaded = bandCol * ${f(WEBGL_CONFIG.appearance.brightness)};
      `
      }

      // Masking
      float inRangeAA = smoothstep(-aaw, 0.0, s) * (1.0 - smoothstep(${f(WEBGL_CONFIG.positioning.bandCount)}, ${f(WEBGL_CONFIG.positioning.bandCount)} + aaw, s));
      col = mix(bg, shaded, inRangeAA);

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  // ── Paint Drip Fragment Shader (SDF-based O(1) drip physics) ──
  // (Old createPaintShader removed)

  const vertexShaderSource = `
    attribute vec2 a_position;
    void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
  `;

  // ── Compile BOTH shader programs (dual-program crossfade architecture) ──
  const ribbonProg = createProgramSafe(
    vertexShaderSource,
    createRibbonShader(),
  );
  if (!ribbonProg) {
    console.error("[WebGL] Ribbon program creation failed.");
    return;
  }
  const paintProg = createProgramSafe(vertexShaderSource, createPaintShader());
  if (!paintProg) {
    console.warn(
      "[WebGL] Paint program creation failed — paint mode unavailable.",
    );
  }
  const gooeyProg = createProgramSafe(vertexShaderSource, createGooeyShader());
  if (!gooeyProg) {
    console.warn(
      "[WebGL] Gooey program creation failed — gooey mode unavailable.",
    );
  }
  const groovyProg = createProgramSafe(
    vertexShaderSource,
    createGroovyShader(),
  );
  if (!groovyProg) {
    console.warn(
      "[WebGL] Groovy program creation failed — groovy mode unavailable.",
    );
  }
  const painterProg = createProgramSafe(
    vertexShaderSource,
    createPainterShader(),
  );
  if (!painterProg) {
    console.warn(
      "[WebGL] Painter program creation failed — painter mode unavailable.",
    );
  }

  const dsVsSrc = `attribute vec2 a_position; varying vec2 v; void main(){v=a_position*0.5+0.5;gl_Position=vec4(a_position,0.0,1.0);}`;
  const dsFsSrc = `${precisionLine} varying vec2 v; uniform sampler2D t; uniform vec2 s;
    void main(){
      vec2 o=s*0.5;
      vec4 c = texture2D(t,v-o) + texture2D(t,v+vec2(o.x,-o.y)) + texture2D(t,v+vec2(-o.x,o.y)) + texture2D(t,v+o);
      gl_FragColor = c * 0.25;
    }`;
  const dsProg = createProgramSafe(dsVsSrc, dsFsSrc);
  if (!dsProg) {
    console.error("[WebGL] Downsample program creation failed.");
    return;
  }

  // ── Geometry buffer (shared, one-time) ──
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );

  // ── Attribute locations [P1] ──
  const posLoc = gl.getAttribLocation(ribbonProg, "a_position");
  const dsPos = gl.getAttribLocation(dsProg, "p");

  // ── VAO setup — bind correct program first [P1 fix] ──
  let mainVAO = null,
    dsVAO = null;
  if (vaoExt) {
    gl.useProgram(ribbonProg); // Both programs share vertex shader → same attrib layout
    mainVAO = vaoExt.createVertexArrayOES();
    vaoExt.bindVertexArrayOES(mainVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    if (posLoc !== -1) {
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    }

    gl.useProgram(dsProg); // [P1] switch program before capturing ds VAO
    dsVAO = vaoExt.createVertexArrayOES();
    vaoExt.bindVertexArrayOES(dsVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    if (dsPos !== -1) {
      gl.enableVertexAttribArray(dsPos);
      gl.vertexAttribPointer(dsPos, 2, gl.FLOAT, false, 0, 0);
    }

    vaoExt.bindVertexArrayOES(null);
  }

  // ── Non-VAO attribute setup (one-time; avoids per-frame thrash) ──
  if (!vaoExt) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    if (posLoc !== -1) {
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    }
    if (dsPos !== -1) {
      gl.enableVertexAttribArray(dsPos);
      gl.vertexAttribPointer(dsPos, 2, gl.FLOAT, false, 0, 0);
    }
  }

  // ── Uniform locations (dual-program) ──
  const ribbonUni = {
    res: gl.getUniformLocation(ribbonProg, "iResolution"),
    time: gl.getUniformLocation(ribbonProg, "iTime"),
  };
  const paintUni = paintProg
    ? {
        res: gl.getUniformLocation(paintProg, "iResolution"),
        time: gl.getUniformLocation(paintProg, "iTime"),
        scale: gl.getUniformLocation(paintProg, "u_scale"),
        density: gl.getUniformLocation(paintProg, "u_density"),
        dripDistance: gl.getUniformLocation(paintProg, "u_dripDistance"),
        sdfWidth: gl.getUniformLocation(paintProg, "u_sdfWidth"),
        fallSpeed: gl.getUniformLocation(paintProg, "u_fallSpeed"),
        bFreq: gl.getUniformLocation(paintProg, "u_bFreq"),
        bRange: gl.getUniformLocation(paintProg, "u_bRange"),
        viscosity: gl.getUniformLocation(paintProg, "u_viscosity"),
      }
    : null;
  const gooeyUni = gooeyProg
    ? {
        res: gl.getUniformLocation(gooeyProg, "u_resolution"),
        time: gl.getUniformLocation(gooeyProg, "u_time"),
      }
    : null;
  const groovyUni = groovyProg
    ? {
        res: gl.getUniformLocation(groovyProg, "iResolution"),
        time: gl.getUniformLocation(groovyProg, "iTime"),
        mouse: gl.getUniformLocation(groovyProg, "u_mouse"),
        speed: gl.getUniformLocation(groovyProg, "u_groovy_speed"),
        mixMin: gl.getUniformLocation(groovyProg, "u_groovy_mixPowerMin"),
        mixMax: gl.getUniformLocation(groovyProg, "u_groovy_mixPowerMax"),
        iterations: gl.getUniformLocation(groovyProg, "u_groovy_iterations"),
        mouseInfl: gl.getUniformLocation(groovyProg, "u_groovy_mouseInfluence"),
      }
    : null;
  const painterUni = painterProg
    ? {
        res: gl.getUniformLocation(painterProg, "iResolution"),
        time: gl.getUniformLocation(painterProg, "iTime"),
        mouse: gl.getUniformLocation(painterProg, "u_mouse"),
        prevFrame: gl.getUniformLocation(painterProg, "u_prevFrame"),
        frame: gl.getUniformLocation(painterProg, "u_frame"),
        brushSize: gl.getUniformLocation(painterProg, "u_painter_brushSize"),
        softness: gl.getUniformLocation(painterProg, "u_painter_softness"),
        noiseScale: gl.getUniformLocation(painterProg, "u_painter_noiseScale"),
        noiseInfluence: gl.getUniformLocation(
          painterProg,
          "u_painter_noiseInfluence",
        ),
        cycleSpeed: gl.getUniformLocation(painterProg, "u_painter_cycleSpeed"),
        colorIndex: gl.getUniformLocation(painterProg, "u_painter_colorIndex"),
      }
    : null;
  const dsTex = gl.getUniformLocation(dsProg, "t");
  const dsSize = gl.getUniformLocation(dsProg, "s");

  // Set texture unit once (never changes)
  gl.useProgram(dsProg);
  if (dsTex) gl.uniform1i(dsTex, 0);

  // ── Hardware limits [P3] ──
  const maxTexSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);

  // ── Framebuffer state ──
  let fb = null,
    fbTex = null;
  let fbWidth = 0,
    fbHeight = 0;
  let ssFactor = 1.0;

  // ── Painter feedback FBO state (ping-pong for frame persistence) ──
  let painterFbA = null,
    painterTexA = null;
  let painterFbB = null,
    painterTexB = null;
  let painterPing = 0; // 0: read A → write B, 1: read B → write A
  let painterFrameCount = 0;
  let painterFbW = 0,
    painterFbH = 0;

  // Re-evaluate supersample factor on every resize [P2]
  function computeSuperSampleFactor() {
    const isMobile =
      window.innerWidth <= WEBGL_CONFIG.performance.mobileBreakpoint;
    let ss = isMobile
      ? WEBGL_CONFIG.performance.supersampleMobile
      : WEBGL_CONFIG.performance.supersampleDesktop;
    // Reduce supersample on very-high-DPR screens [v4: P2]
    if (WEBGL_CONFIG.performance.respectDPR) {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      if (dpr > 2) ss = Math.max(1.0, ss / (dpr / 2));
    }
    return ss;
  }

  // Integer-guarded, DPR-aware, MAX_TEXTURE_SIZE-clamped framebuffer [P1, P3]
  function setupFramebuffer(pixelW, pixelH, ss) {
    // Direct mode: no FBO, but still cache resolution uniform on resize.
    if (ss <= 1.0) {
      if (fb) {
        gl.deleteFramebuffer(fb);
        fb = null;
      }
      if (fbTex) {
        gl.deleteTexture(fbTex);
        fbTex = null;
      }
      fbWidth = fbHeight = 0;

      gl.useProgram(ribbonProg);
      if (ribbonUni.res) gl.uniform2f(ribbonUni.res, pixelW, pixelH);
      if (paintProg) {
        gl.useProgram(paintProg);
        if (paintUni.res) gl.uniform2f(paintUni.res, pixelW, pixelH);
      }
      if (gooeyProg) {
        gl.useProgram(gooeyProg);
        if (gooeyUni.res) gl.uniform2f(gooeyUni.res, pixelW, pixelH);
      }
      if (groovyProg) {
        gl.useProgram(groovyProg);
        if (groovyUni.res) gl.uniform2f(groovyUni.res, pixelW, pixelH);
      }
      if (painterProg) {
        gl.useProgram(painterProg);
        if (painterUni.res) gl.uniform2f(painterUni.res, pixelW, pixelH);
      }
      return;
    }

    let targetW = Math.max(1, Math.floor(pixelW * ss));
    let targetH = Math.max(1, Math.floor(pixelH * ss));

    // Clamp to hardware maximum [P3]
    const scale = Math.min(1.0, maxTexSize / targetW, maxTexSize / targetH);
    if (scale < 1.0) {
      targetW = Math.max(1, Math.floor(targetW * scale));
      targetH = Math.max(1, Math.floor(targetH * scale));
    }

    // Skip rebuild if dimensions unchanged
    if (fb && targetW === fbWidth && targetH === fbHeight) return;

    // Create new resources before deleting old [v4: P5]
    const oldFb = fb;
    const oldTex = fbTex;

    fbTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, fbTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      targetW,
      targetH,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );

    fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      fbTex,
      0,
    );

    if (WEBGL_CONFIG.performance.debugMode) {
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        console.error("[WebGL] Framebuffer incomplete:", status);
      }
    }

    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Safe to delete old resources [v4]
    if (oldFb) gl.deleteFramebuffer(oldFb);
    if (oldTex) gl.deleteTexture(oldTex);

    fbWidth = targetW;
    fbHeight = targetH;

    // Cache resolution uniforms (only change on resize, not every frame) [P3]
    gl.useProgram(ribbonProg);
    if (ribbonUni.res) gl.uniform2f(ribbonUni.res, targetW, targetH);
    if (paintProg) {
      gl.useProgram(paintProg);
      if (paintUni.res) gl.uniform2f(paintUni.res, targetW, targetH);
    }
    if (gooeyProg) {
      gl.useProgram(gooeyProg);
      if (gooeyUni.res) gl.uniform2f(gooeyUni.res, targetW, targetH);
    }
    if (groovyProg) {
      gl.useProgram(groovyProg);
      if (groovyUni.res) gl.uniform2f(groovyUni.res, targetW, targetH);
    }
    if (painterProg) {
      gl.useProgram(painterProg);
      if (painterUni.res) gl.uniform2f(painterUni.res, targetW, targetH);
    }
    gl.useProgram(dsProg);
    if (dsSize) gl.uniform2f(dsSize, 1.0 / targetW, 1.0 / targetH);
  }

  // ── Deferred resize [P4] — process at frame boundary, not mid-frame ──
  let resizePending = true; // true initially to force first resize

  function handleResize() {
    resizePending = true;
  }

  function processResize() {
    resizePending = false;
    const cssW = Math.max(1, canvas.clientWidth);
    const cssH = Math.max(1, canvas.clientHeight);
    const dpr = WEBGL_CONFIG.performance.respectDPR
      ? Math.max(1, window.devicePixelRatio || 1)
      : 1;

    // Compute ssFactor BEFORE canvas resize [P1 order fix]
    ssFactor = computeSuperSampleFactor();

    const pixelW = Math.max(1, Math.floor(cssW * dpr));
    const pixelH = Math.max(1, Math.floor(cssH * dpr));

    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }

    setupFramebuffer(pixelW, pixelH, ssFactor);

    // Resize painter feedback FBOs (resets paint canvas on resize)
    if (painterProg) setupPainterFeedback(pixelW, pixelH);
  }

  // ── Painter feedback FBO helpers ──
  function makePainterFb(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      w,
      h,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tex,
      0,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { fbo, tex };
  }

  function setupPainterFeedback(w, h) {
    if (!painterProg) return;
    if (painterFbW === w && painterFbH === h && painterFbA) return;

    // Detect if we have existing content to preserve [Persistence]
    let preservedTex = null;
    let otherTex = null;
    let otherFb = null;
    let preservedFb = null;

    if (painterFbA && painterFrameCount > 0) {
      // The valid content is in the READ texture of the NEXT step.
      // If ping=0, we read A. So A has the content.
      preservedTex = painterPing === 0 ? painterTexA : painterTexB;
      preservedFb = painterPing === 0 ? painterFbA : painterFbB;

      otherTex = painterPing === 0 ? painterTexB : painterTexA;
      otherFb = painterPing === 0 ? painterFbB : painterFbA;
    } else {
      // Just explicit delete if no content to save
      if (painterFbA) gl.deleteFramebuffer(painterFbA);
      if (painterTexA) gl.deleteTexture(painterTexA);
      if (painterFbB) gl.deleteFramebuffer(painterFbB);
      if (painterTexB) gl.deleteTexture(painterTexB);
    }

    const a = makePainterFb(w, h);
    const b = makePainterFb(w, h);

    // Blit preserved content into new A
    if (preservedTex) {
      // Use A as the target
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0); // ensure clean
      gl.clear(gl.COLOR_BUFFER_BIT);

      // Simple blit using dsProg (passthrough)
      gl.useProgram(dsProg);
      // Reset scale uniform
      if (dsSize) gl.uniform2f(dsSize, 0.0, 0.0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, preservedTex);

      bindAttributes(dsProg);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Restore dsSize default
      if (dsSize) gl.uniform2f(dsSize, 1.0 / w, 1.0 / h);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);

      // Now delete the old resources
      gl.deleteTexture(preservedTex);
      gl.deleteFramebuffer(preservedFb);
      if (otherTex) gl.deleteTexture(otherTex);
      if (otherFb) gl.deleteFramebuffer(otherFb);

      // IMPORTANT: Set frame count > 0 so shader doesn't clear it
      painterFrameCount = Math.max(1, painterFrameCount);
    } else {
      painterFrameCount = 0;
    }

    painterFbA = a.fbo;
    painterTexA = a.tex;
    painterFbB = b.fbo;
    painterTexB = b.tex;
    painterFbW = w;
    painterFbH = h;
    painterPing = 0; // Reset ping to 0 (Read A, Write B).
    // But wait, we wrote the preserved content into A.
    // So we want the NEXT step to Read A.
    // If ping=0, stepPainterFeedback Reads A. Correct.
  }

  // Run one feedback iteration: read previous frame → painter shader → write new frame
  function stepPainterFeedback() {
    if (!painterProg || !painterFbA) return;
    const readTex = painterPing === 0 ? painterTexA : painterTexB;
    const writeFb = painterPing === 0 ? painterFbB : painterFbA;

    gl.bindFramebuffer(gl.FRAMEBUFFER, writeFb);
    gl.viewport(0, 0, painterFbW, painterFbH);
    gl.useProgram(painterProg);

    // Bind previous frame texture on unit 1
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, readTex);
    if (painterUni.prevFrame) gl.uniform1i(painterUni.prevFrame, 1);

    // Set per-frame uniforms
    if (painterUni.res) gl.uniform2f(painterUni.res, painterFbW, painterFbH);
    if (painterUni.time) gl.uniform1f(painterUni.time, animTime);
    if (painterUni.mouse)
      gl.uniform4f(
        painterUni.mouse,
        initWebGL._painterMouseX ?? -1000,
        initWebGL._painterMouseY ?? -1000,
        initWebGL._painterMouseOver ? 1.0 : 0.0,
        0.0,
      );
    if (painterUni.frame) gl.uniform1f(painterUni.frame, painterFrameCount);
    uploadPainterUniforms();

    bindAttributes(painterProg);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Cleanup
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Swap buffers and advance frame
    painterPing = 1 - painterPing;
    painterFrameCount++;
  }

  // Blit the painter feedback result to screen (with optional blend for crossfade)
  function drawPainterToScreen(blended, alpha) {
    // After swap, current painterPing index points to the just-written texture
    const displayTex = painterPing === 0 ? painterTexA : painterTexB;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);

    if (blended) {
      gl.enable(gl.BLEND);
      gl.blendColor(0, 0, 0, alpha);
      gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
    } else {
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    // Reuse downsample shader as a 1:1 blit (zero offset = passthrough)
    gl.useProgram(dsProg);
    if (dsSize) gl.uniform2f(dsSize, 0.0, 0.0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, displayTex);

    bindAttributes(dsProg);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindTexture(gl.TEXTURE_2D, null);
    if (blended) gl.disable(gl.BLEND);

    // Restore dsSize for non-painter shaders
    if (dsSize && fbWidth > 0 && fbHeight > 0) {
      gl.uniform2f(dsSize, 1.0 / fbWidth, 1.0 / fbHeight);
    }
  }

  // ── Animation state ──
  let animTime = 0;
  let lastTime = performance.now() * 0.001;
  let curSpeed = 1.0;
  let targetSpeed = reduceMotion ? 0.3 : 1.0; // [P5] slower if reduced-motion
  let isVisible = !document.hidden;
  let firstFrame = true;

  // ── Crossfade state (from/to architecture for N shaders) ──
  const CROSSFADE_DURATION = 2.0;

  // Helper: resolve shader type → program/uni/needsDrip/needsGooey
  function resolveShader(type) {
    if (type === "paint_drip" && paintProg)
      return {
        prog: paintProg,
        uni: paintUni,
        drip: true,
        gooey: false,
        groovy: false,
        painter: false,
      };
    if (type === "gooey_drip" && gooeyProg)
      return {
        prog: gooeyProg,
        uni: gooeyUni,
        drip: false,
        gooey: true,
        groovy: false,
        painter: false,
      };
    if (type === "groovy" && groovyProg)
      return {
        prog: groovyProg,
        uni: groovyUni,
        drip: false,
        gooey: false,
        groovy: true,
        painter: false,
      };
    if (type === "painter" && painterProg)
      return {
        prog: painterProg,
        uni: painterUni,
        drip: false,
        gooey: false,
        groovy: false,
        painter: true,
      };
    return {
      prog: ribbonProg,
      uni: ribbonUni,
      drip: false,
      gooey: false,
      groovy: false,
      painter: false,
    };
  }

  let shaderFrom = WEBGL_CONFIG.shaderType || "ribbon_wave";
  let shaderTo = shaderFrom;
  let crossfadeFactor = 1.0; // 1.0 = fully showing shaderTo (no blend)

  // Expose transition trigger so the dashboard UI can drive crossfade
  window.transitionShader = (type) => {
    WEBGL_CONFIG.shaderType = type;
    if (type === shaderTo) return; // already there
    shaderFrom = shaderTo;
    shaderTo = type;
    crossfadeFactor = 0.0;

    // Toggle touch-action for painter mode (prevent scroll on mobile)
    const headerEl = initWebGL._headerEl;
    if (headerEl) {
      headerEl.style.touchAction = type === "painter" ? "none" : "";
    }
  };

  // Gooey shader bakes config at compile time (no runtime uniforms to upload).
  // This no-op prevents a ReferenceError when the FBO path calls it.
  function uploadGooeyUniforms() {
    /* compile-time constants — nothing to upload */
  }

  function uploadGroovyUniforms() {
    if (!groovyUni) return;
    const g = WEBGL_CONFIG.groovy;
    if (groovyUni.mouse) {
      const rw = fbWidth || canvas.width;
      const cw = canvas.clientWidth || 1;
      const s = rw / cw;
      gl.uniform2f(
        groovyUni.mouse,
        (initWebGL._mouseX || 0) * s,
        (initWebGL._mouseY || 0) * s,
      );
    }
    if (groovyUni.speed) gl.uniform1f(groovyUni.speed, g.speed);
    if (groovyUni.mixMin) gl.uniform1f(groovyUni.mixMin, g.mixPowerMin);
    if (groovyUni.mixMax) gl.uniform1f(groovyUni.mixMax, g.mixPowerMax);
    if (groovyUni.iterations) gl.uniform1f(groovyUni.iterations, g.iterations);
    if (groovyUni.mouseInfl)
      gl.uniform1f(groovyUni.mouseInfl, g.mouseInfluence);
  }

  function uploadPainterUniforms() {
    if (!painterUni) return;
    const p = WEBGL_CONFIG.painter;
    if (painterUni.brushSize) gl.uniform1f(painterUni.brushSize, p.brushSize);
    if (painterUni.softness) gl.uniform1f(painterUni.softness, p.softness);
    if (painterUni.noiseScale)
      gl.uniform1f(painterUni.noiseScale, p.noiseScale);
    if (painterUni.noiseInfluence)
      gl.uniform1f(painterUni.noiseInfluence, p.noiseInfluence);
    if (painterUni.cycleSpeed)
      gl.uniform1f(painterUni.cycleSpeed, p.cycleSpeed);
    if (painterUni.colorIndex)
      gl.uniform1f(painterUni.colorIndex, p.colorIndex ?? 0.0);
  }

  let _debugDripLogged = false;
  function uploadDripUniforms() {
    if (!paintUni) return;
    const d = WEBGL_CONFIG.drip;
    if (!_debugDripLogged) {
      console.log(
        "[WebGL] Uploading drip uniforms:",
        JSON.parse(JSON.stringify(d)),
      );
      _debugDripLogged = true;
    }
    if (paintUni.scale) gl.uniform1f(paintUni.scale, d.scale || 1.0);
    if (paintUni.density) gl.uniform1f(paintUni.density, d.density);
    if (paintUni.dripDistance)
      gl.uniform1f(paintUni.dripDistance, d.dripDistance);
    if (paintUni.sdfWidth) gl.uniform1f(paintUni.sdfWidth, d.sdfWidth);
    if (paintUni.fallSpeed) gl.uniform1f(paintUni.fallSpeed, d.fallSpeed);
    if (paintUni.bFreq) gl.uniform1f(paintUni.bFreq, d.bFreq);
    if (paintUni.bRange) gl.uniform1f(paintUni.bRange, d.bRange);
    if (paintUni.viscosity) gl.uniform1f(paintUni.viscosity, d.viscosity);
  }

  /**
   * Draw a shader through the full render pipeline (direct or FBO+downsample).
   * @param {WebGLProgram} prog   - ribbon or paint program
   * @param {Object} uni          - uniform locations for this program
   * @param {boolean} blended     - true → use GL constant-alpha blending on top of existing screen
   * @param {number} alpha        - blend factor 0→1 (only used when blended=true)
   * @param {number} phase        - normalized loop phase 0→1
   * @param {boolean} direct      - true → skip FBO, draw straight to screen
   */
  // ── Manual Attribute Binding (Replaces VAO for robustness) [P1 Fix] ──
  let _dbgLogAttr = false;
  function bindAttributes(prog) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const loc = gl.getAttribLocation(prog, "a_position");
    if (!_dbgLogAttr) {
      console.log(`[WebGL] Attrib 'a_position' loc: ${loc}`);
      _dbgLogAttr = true;
    }
    if (loc !== -1) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }
  }

  let _dbgLogView = false;
  function drawShaderPass(prog, uni, blended, alpha, phase, direct) {
    if (!prog) return;

    // Painter uses its own feedback pipeline — blit result to screen instead
    if (prog === painterProg) {
      drawPainterToScreen(blended, alpha);
      return;
    }

    // Always bind attributes manually for this program
    bindAttributes(prog);

    if (!_dbgLogView) {
      console.log(`[WebGL] Viewport: ${canvas.width}x${canvas.height}`);
      _dbgLogView = true;
    }

    if (direct) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(prog);
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (blended) {
        gl.enable(gl.BLEND);
        gl.blendColor(0, 0, 0, alpha);
        gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
      } else {
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      if (uni.time)
        gl.uniform1f(
          uni.time,
          prog === gooeyProg || prog === painterProg ? animTime : phase,
        );
      if (prog === paintProg) uploadDripUniforms();
      if (prog === gooeyProg) uploadGooeyUniforms();
      if (prog === groovyProg) uploadGroovyUniforms();
      if (prog === painterProg) uploadPainterUniforms();

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      if (blended) gl.disable(gl.BLEND);
      checkGLError(blended ? "blend pass" : "direct pass");
    } else {
      if (!fb) return;
      // Render shader → FBO
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.useProgram(prog);
      gl.viewport(0, 0, fbWidth, fbHeight);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (uni.time)
        gl.uniform1f(
          uni.time,
          prog === gooeyProg || prog === painterProg ? animTime : phase,
        );
      if (prog === paintProg) uploadDripUniforms();
      if (prog === gooeyProg) uploadGooeyUniforms();
      if (prog === groovyProg) uploadGroovyUniforms();
      if (prog === painterProg) uploadPainterUniforms();

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      checkGLError(blended ? "fbo blend pass" : "fbo main pass");
      // Downsample FBO → screen
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(dsProg);
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (blended) {
        gl.enable(gl.BLEND);
        gl.blendColor(0, 0, 0, alpha);
        gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
      } else {
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fbTex);

      // Bind attributes for downsample program
      bindAttributes(dsProg);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindTexture(gl.TEXTURE_2D, null);
      if (blended) gl.disable(gl.BLEND);
      checkGLError(blended ? "ds blend pass" : "downsample pass");
    }
  }

  // ── Visibility API: pause when tab hidden [P1 + P3] ──
  if (WEBGL_CONFIG.performance.pauseWhenHidden) {
    initWebGL._onVisibilityChange = () => {
      isVisible = !document.hidden;
      if (isVisible) {
        lastTime = performance.now() * 0.001; // avoid time-jump
        if (!initWebGL._rafId) initWebGL._rafId = requestAnimationFrame(render);
      } else {
        if (initWebGL._rafId) {
          cancelAnimationFrame(initWebGL._rafId);
          initWebGL._rafId = null;
        }
      }
    };
    document.addEventListener(
      "visibilitychange",
      initWebGL._onVisibilityChange,
    );
  }

  // ── Interaction: pointer events only (covers mouse + touch) [P1 + P3] ──
  const header = document.querySelector("header");
  if (header) {
    initWebGL._headerEl = header;
    initWebGL._onHeaderEnter = () =>
      (targetSpeed = WEBGL_CONFIG.interaction.hoverSlowdown);
    initWebGL._onHeaderLeave = () => {
      targetSpeed = reduceMotion ? 0.3 : 1.0;
      initWebGL._painterMouseOver = false;
    };

    // Mouse tracking for interactive shaders (Groovy + Painter)
    initWebGL._onHeaderMove = (e) => {
      // Disable painting if on Reviews tab [User Request]
      if (document.getElementById("tab-reviews")?.checked) {
        initWebGL._painterMouseOver = false;
        return;
      }
      const rect = header.getBoundingClientRect();
      initWebGL._mouseX = e.clientX - rect.left;
      initWebGL._mouseY = header.clientHeight - (e.clientY - rect.top); // Flip Y
      // Painter: precise GL pixel coordinates
      initWebGL._painterMouseX =
        ((e.clientX - rect.left) / rect.width) * canvas.width;
      initWebGL._painterMouseY =
        (1.0 - (e.clientY - rect.top) / rect.height) * canvas.height;
      initWebGL._painterMouseOver = true;
    };

    header.addEventListener("pointerenter", initWebGL._onHeaderEnter);
    header.addEventListener("pointerleave", initWebGL._onHeaderLeave);
    header.addEventListener("pointermove", initWebGL._onHeaderMove);

    // Painter touch: capture initial contact + release for mobile painting
    initWebGL._onHeaderDown = (e) => {
      if (shaderTo !== "painter") return;
      // Disable painting if on Reviews tab
      if (document.getElementById("tab-reviews")?.checked) {
        initWebGL._painterMouseOver = false;
        return;
      }
      const rect = header.getBoundingClientRect();
      initWebGL._mouseX = e.clientX - rect.left;
      initWebGL._mouseY = header.clientHeight - (e.clientY - rect.top);
      initWebGL._painterMouseX =
        ((e.clientX - rect.left) / rect.width) * canvas.width;
      initWebGL._painterMouseY =
        (1.0 - (e.clientY - rect.top) / rect.height) * canvas.height;
      initWebGL._painterMouseOver = true;
    };
    initWebGL._onHeaderUp = () => {
      initWebGL._painterMouseOver = false;
    };
    header.addEventListener("pointerdown", initWebGL._onHeaderDown);
    header.addEventListener("pointerup", initWebGL._onHeaderUp);
    header.addEventListener("pointercancel", initWebGL._onHeaderUp);

    // Set touch-action based on initial shader type
    if (WEBGL_CONFIG.shaderType === "painter") {
      header.style.touchAction = "none";
    }
  }

  // ── Debug helper [P3] ──
  function checkGLError(label) {
    if (!WEBGL_CONFIG.performance.debugMode) return;
    const err = gl.getError();
    if (err !== gl.NO_ERROR)
      console.error(`[WebGL] GL error at ${label}:`, err);
  }

  // ── Clear color (set once — matches WEBGL_CONFIG background) [P1] ──
  // DEBUG CHECK: Force Black to prove context is clearing
  gl.clearColor(0.0, 0.0, 0.0, 1.0);

  // ── Render loop ──
  function render() {
    // Stale closure check — stop if a newer initWebGL() has run [P1]
    if (generation !== initWebGL._generation) return;

    if (!isVisible && WEBGL_CONFIG.performance.pauseWhenHidden) {
      // Pause loop; visibility handler will restart it when visible again.
      initWebGL._rafId = null;
      return;
    }

    // Process deferred resize at frame boundary [P4]
    if (resizePending) processResize();

    const now = performance.now() * 0.001;
    let dt = Math.min(now - lastTime, WEBGL_CONFIG.performance.maxDeltaTime);
    lastTime = now;

    // Smooth speed transition
    const smoothTau = Math.max(0.0001, WEBGL_CONFIG.interaction.smoothTime);
    curSpeed += (targetSpeed - curSpeed) * (1.0 - Math.exp(-dt / smoothTau));

    // Phase-space: accumulate real seconds, normalize to 0→1 phase for shader
    animTime = (animTime + dt * curSpeed) % LOOP_SECONDS;
    const loopPhase = animTime / LOOP_SECONDS;

    // ── Crossfade blend update (from/to architecture) ──
    const directRender = ssFactor <= 1.0;

    if (crossfadeFactor < 1.0) {
      const speed = 1.0 / Math.max(0.001, CROSSFADE_DURATION);
      crossfadeFactor = Math.min(crossfadeFactor + speed * dt, 1.0);
      if (crossfadeFactor >= 1.0) {
        shaderFrom = shaderTo; // snap: transition complete
      }
    }

    // ── Resolve active shader programs ──
    const toInfo = resolveShader(shaderTo);

    // ── Painter feedback: run one step before any drawShaderPass calls ──
    const painterActive =
      shaderTo === "painter" ||
      (crossfadeFactor < 1.0 && shaderFrom === "painter");
    if (painterActive && painterProg && painterFbA) {
      stepPainterFeedback();
    }

    if (crossfadeFactor >= 0.999) {
      // Pure single shader
      drawShaderPass(
        toInfo.prog,
        toInfo.uni,
        false,
        0,
        loopPhase,
        directRender,
      );
    } else {
      // Crossfade: from first, to blended on top
      const fromInfo = resolveShader(shaderFrom);
      drawShaderPass(
        fromInfo.prog,
        fromInfo.uni,
        false,
        0,
        loopPhase,
        directRender,
      );
      drawShaderPass(
        toInfo.prog,
        toInfo.uni,
        true,
        crossfadeFactor,
        loopPhase,
        directRender,
      );
    }

    // ── Debug FPS [v4: P5] ──
    if (WEBGL_CONFIG.performance.debugMode) {
      initWebGL._dbgFrames = (initWebGL._dbgFrames || 0) + 1;
      if (now - (initWebGL._dbgLastLog || 0) >= 1.0) {
        const elapsed = now - (initWebGL._dbgLastLog || now);
        if (elapsed > 0) {
          const fps = initWebGL._dbgFrames / elapsed;
          console.log(
            `[WebGL] FPS: ${fps.toFixed(1)} | ${directRender ? "direct" : fbWidth + "\u00d7" + fbHeight + " @" + ssFactor + "x"}`,
          );
        }
        initWebGL._dbgFrames = 0;
        initWebGL._dbgLastLog = now;
      }
    }

    // ── Show canvas after first successful frame [P4] ──
    if (firstFrame) {
      firstFrame = false;
      canvas.classList.add("is-ready");
    }

    initWebGL._rafId = requestAnimationFrame(render);
  }

  // ── Kickoff ──
  processResize(); // sync canvas size + create FBO with correct dims
  initWebGL._initialized = true; // prevent future re-init [P2]
  lastTime = performance.now() * 0.001;
  if (initWebGL._rafId) cancelAnimationFrame(initWebGL._rafId); // prevent duplicate RAF chains
  initWebGL._rafId = requestAnimationFrame(render);

  // ── ResizeObserver: disconnect old + create new [v4: all peers] ──
  if (initWebGL._ro) initWebGL._ro.disconnect();
  if (typeof ResizeObserver !== "undefined") {
    initWebGL._ro = new ResizeObserver(handleResize);
    initWebGL._ro.observe(canvas);
  } else {
    initWebGL._onWindowResize = handleResize;
    window.addEventListener("resize", initWebGL._onWindowResize);
  }

  // ── Persistence: Save/Restore Painter State [Persistence] ──
  function savePainterState() {
    if (!painterFbA || !painterProg || painterFrameCount === 0) return;

    // Identify valid framebuffer (the one we read from)
    const sourceFb = painterPing === 0 ? painterFbA : painterFbB;
    const w = painterFbW;
    const h = painterFbH;

    // Read pixels
    const pixels = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sourceFb);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Draw to temporary 2D canvas to encode
    const c2d = document.createElement("canvas");
    c2d.width = w;
    c2d.height = h;
    const ctx2d = c2d.getContext("2d");
    const imgData = ctx2d.createImageData(w, h);

    // Flip Y (WebGL is bottom-up, Canvas is top-down)
    // Also, readPixels returns bottom-up? Yes.
    // So we need to flip rows.
    for (let y = 0; y < h; y++) {
      const srcRow = (h - 1 - y) * w * 4;
      const dstRow = y * w * 4;
      // Copy row
      for (let i = 0; i < w * 4; i++) {
        imgData.data[dstRow + i] = pixels[srcRow + i];
      }
    }

    ctx2d.putImageData(imgData, 0, 0);

    try {
      const dataUrl = c2d.toDataURL("image/png");
      localStorage.setItem("joss_painter_state", dataUrl);
      // console.log("[WebGL] Painter state saved.");
    } catch (e) {
      console.warn("[WebGL] Failed to save painter state:", e);
    }
  }

  function restorePainterState() {
    const dataUrl = localStorage.getItem("joss_painter_state");
    if (!dataUrl) return;

    const img = new Image();
    img.onload = () => {
      if (!painterProg || !painterFbA) return;
      console.log("[WebGL] Restoring painter state...");

      // Draw image to A
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      // Upload flipped? browser handles image flip?
      // gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // needed?
      // WebGL 0,0 is bottom-left. Texture 0,0 is usually bottom-left?
      // HTML Image 0,0 is top-left.
      // Usually we need flip.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

      gl.bindFramebuffer(gl.FRAMEBUFFER, painterFbA); // Write to A
      gl.viewport(0, 0, painterFbW, painterFbH);
      gl.useProgram(dsProg);
      if (dsSize) gl.uniform2f(dsSize, 0.0, 0.0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      bindAttributes(dsProg);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteTexture(tex);

      // Force init
      painterPing = 0; // Read A next frame (which we just wrote to? No wait)
      // If ping=0, read A, write B.
      // We wrote to A.
      // So next frame reads A. Correct.
      painterFrameCount = Math.max(1, painterFrameCount);
    };
    img.onerror = () => {
      console.warn("[WebGL] Failed to load saved painter state.");
    };
    img.src = dataUrl;
  }

  // Attach auto-save listeners
  if (header) {
    // Save when finishing a stroke (globally, in case they drag off)
    window.addEventListener("pointerup", savePainterState);
    window.addEventListener("touchend", savePainterState);
    window.addEventListener("pointercancel", savePainterState);

    // Save on visibility change/unload
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) savePainterState();
    });
    window.addEventListener("pagehide", savePainterState);
    window.addEventListener("beforeunload", savePainterState);
  }

  // Clear painter state when Reviews tab is selected [User Request]
  const reviewsTab = document.getElementById("tab-reviews");
  if (reviewsTab) {
    reviewsTab.addEventListener("change", () => {
      if (reviewsTab.checked) {
        console.log("[WebGL] Reviews tab selected -> Clearing painter state.");
        initWebGL._painterMouseOver = false; // Disable brush
        painterFrameCount = 0;
        if (painterFbA) {
          // Clear FBOs to black/transparent
          gl.bindFramebuffer(gl.FRAMEBUFFER, painterFbA);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.bindFramebuffer(gl.FRAMEBUFFER, painterFbB);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }
        localStorage.removeItem("joss_painter_state");
      }
    });
  }

  // Attempt restore on boot (regardless of current mode, so it's ready if we switch)
  requestAnimationFrame(restorePainterState);
}

// Ensure DOM is ready before initializing
// Fetch published config from Supabase, then start the WebGL engine.
// If the fetch fails or Supabase isn't loaded yet, hardcoded defaults are used.
async function bootWebGL() {
  await loadBannerConfig();
  initWebGL();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootWebGL);
} else {
  bootWebGL();
}

// ── Expose for console access (const is lexically scoped, not on window) ──
window.WEBGL_CONFIG = WEBGL_CONFIG;
window.initWebGL = initWebGL;
