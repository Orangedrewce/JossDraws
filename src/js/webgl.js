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
    background: { r: 1.0, g: 1.0, b: 1.0 } // Canvas fill (White)
  },

  // 2. Geometry & Physics
  thickness: {
    base: 0.10,              // Base width of the ribbon
    stretchMin: 0.8,         // Minimum thickness during stretch
    stretchMax: 1.2,         // Maximum thickness during stretch
    stretchSpeed: 1.3,       // Temporal speed of breathing motion
    stretchFrequency: 2.5    // Spatial frequency of stretch variation
  },

  // 3. Wave Dynamics (the sine-wave motion)
  wave: {
    mainSpeed: 1.0,          // Speed of the primary undulation
    mainFrequency: 3.0,      // How many "humps" visible across width
    mainAmplitude: 0.25,     // Height of the wave
    secondarySpeed: 1.8,     // Speed of secondary detail wave
    secondaryFreq: 1.1,      // Frequency of secondary detail
    secondaryAmp: 0.1,       // Amplitude of secondary detail
    horizontalSpeed: 0.7,    // Speed of horizontal offset motion
    horizontalFrequency: 2.0,// Frequency of horizontal wobble
    horizontalAmount: 0.25,  // Amplitude of horizontal offset
    offsetBlend: 0.3         // How much horizontal affects vertical
  },

  // 4. The Twist (180-degree rotation effect)
  twist: {
    enabled: true,           // Set false for a standard parallel ribbon
    period: 6.0,             // Seconds between twists
    duration: 0.9,           // 0.0–1.0 (how fast the twist happens within period)
    intensity: 0.5,          // Strength multiplier for twist rotation
    randomSeed: 12.345       // Seed for pseudo-random direction
  },

  // 5. Visual Styling
  appearance: {
    brightness: 1.125,       // Global brightness multiplier
    plasticEffect: true,     // Enable specular highlights (glossy look)
    centerSoftness: 10.0,    // Smoothness of center highlight
    specularPower: 50.0,     // Sharpness of the gloss (higher = sharper)
    specularIntensity: 0.75, // Strength of specular highlight
    shadowStrength: 0.1,     // Intensity of drop shadow
    shadowWidth: 2.0,        // Width multiplier for shadow blur
    aaSharpness: 0.5,        // Anti-aliasing edge sharpness
    aaFallback: 0.001        // Fallback AA when derivatives unavailable
  },

  // 6. Positioning
  positioning: {
    verticalOffset: 0.205,   // Vertical position in view
    bandCount: 5             // Number of color bands (max index auto-computed)
  },

  // 7. Interaction
  interaction: {
    hoverSlowdown: 0.1,     // Speed multiplier when hovering (0.2 = 20%)
    smoothTime: 0.25         // Time to transition speeds (seconds)
  },

  // 8. Performance
  performance: {
    supersampleDesktop: 2.5, // 2× rendering for sharp edges on desktop
    supersampleMobile: 1.0,  // 1× rendering for mobile performance
    mobileBreakpoint: 768,   // Pixels width to consider "mobile"
    respectDPR: true,        // Account for devicePixelRatio (high-DPI screens)
    pauseWhenHidden: true,   // Pause animation when tab not visible
    maxDeltaTime: 0.05,      // Max frame time to prevent jumps (seconds)
    debugMode: false          // Enable WebGL error checking (dev only)
  }
};

/**
 * ============================================================================
 * CORE ENGINE  
 * ============================================================================
 */
function initWebGL() {
  // ── Double-init guard [P2] ──
  if (initWebGL._initialized) return;

  initWebGL._generation = (initWebGL._generation || 0) + 1;
  const generation = initWebGL._generation;

  // ── WEBGL_CONFIG validation [v4: P5] ──
  if (WEBGL_CONFIG.thickness.base <= 0 ||
      WEBGL_CONFIG.positioning.bandCount < 1 || WEBGL_CONFIG.positioning.bandCount > 5 ||
      WEBGL_CONFIG.twist.period <= 0) {
    console.error('[WebGL] Invalid WEBGL_CONFIG — check thickness.base, bandCount, twist.period.');
    return;
  }

  const canvas = document.getElementById('shaderCanvas');
  if (!canvas) {
    console.warn('[WebGL] Canvas #shaderCanvas not found.');
    return;
  }

  // ── Context with performance hints [P3] ──
  const glOpts = { alpha: false, antialias: false, powerPreference: 'high-performance' };
  const gl = canvas.getContext('webgl', glOpts)
          || canvas.getContext('experimental-webgl', glOpts);
  if (!gl) {
    console.error('[WebGL] Not supported.');
    return;
  }

  // ── Kill any previous RAF chain + detach stale listeners (survives re-entry) ──
  if (initWebGL._rafId) {
    cancelAnimationFrame(initWebGL._rafId);
    initWebGL._rafId = null;
  }
  if (initWebGL._onVisibilityChange) {
    document.removeEventListener('visibilitychange', initWebGL._onVisibilityChange);
    initWebGL._onVisibilityChange = null;
  }
  if (initWebGL._onWindowResize) {
    window.removeEventListener('resize', initWebGL._onWindowResize);
    initWebGL._onWindowResize = null;
  }
  if (initWebGL._headerEl && initWebGL._onHeaderEnter && initWebGL._onHeaderLeave) {
    initWebGL._headerEl.removeEventListener('pointerenter', initWebGL._onHeaderEnter);
    initWebGL._headerEl.removeEventListener('pointerleave', initWebGL._onHeaderLeave);
  }
  initWebGL._headerEl = null;
  initWebGL._onHeaderEnter = null;
  initWebGL._onHeaderLeave = null;

  // ── Context loss/restore (attached once) [P1, P3, P4] ──
  if (!initWebGL._contextHandlers) {
    initWebGL._contextHandlers = true;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      initWebGL._generation++;  // [v4] kills stale render loop immediately
      initWebGL._initialized = false;
      if (initWebGL._rafId) {
        cancelAnimationFrame(initWebGL._rafId);
        initWebGL._rafId = null;
      }
      console.warn('[WebGL] Context lost.');
    }, false);
    canvas.addEventListener('webglcontextrestored', () => {
      console.log('[WebGL] Context restored. Re-initializing...');
      initWebGL._initialized = false;
      initWebGL();
    }, false);
  }

  // ── Accessibility: reduced-motion [P5] ──
  const reduceMotion = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Derived constants ──
  const bandMax = WEBGL_CONFIG.positioning.bandCount - 1;  // auto-compute [P1,P5]

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
      console.error('[WebGL] Shader compile error:', gl.getShaderInfoLog(shader));
      if (WEBGL_CONFIG.performance.debugMode) console.error('Source:\n', src);
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

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
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[WebGL] Program link error:', gl.getProgramInfoLog(prog));
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
  const hasDerivatives = !!gl.getExtension('OES_standard_derivatives');
  if (!hasDerivatives) console.warn('[WebGL] OES_standard_derivatives unavailable; using fallback AA.');
  const vaoExt = gl.getExtension('OES_vertex_array_object');

  // ── Precision detection [v4: P2, P4] ──
  const fragHighp = gl.getShaderPrecisionFormat
    && gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT).precision > 0;
  const precisionLine = fragHighp ? 'precision highp float;' : 'precision mediump float;';

  // ── Conditional extension line [P1] ──
  const extLine = hasDerivatives
    ? '#extension GL_OES_standard_derivatives : enable'
    : '';

  // ── Effective twist (respects reduced-motion) [P5] ──
  const twistEnabled = WEBGL_CONFIG.twist.enabled && !reduceMotion;
  const maxWaveAbs = WEBGL_CONFIG.wave.mainAmplitude
                   + WEBGL_CONFIG.wave.secondaryAmp
                   + (WEBGL_CONFIG.wave.horizontalAmount * Math.abs(WEBGL_CONFIG.wave.offsetBlend));
  const maxRibbonHalfHeight = maxWaveAbs
                            + (WEBGL_CONFIG.thickness.base * WEBGL_CONFIG.thickness.stretchMax * WEBGL_CONFIG.positioning.bandCount)
                            + WEBGL_CONFIG.appearance.aaFallback;

  // ── Dynamic Fragment Shader Source (all magic numbers from WEBGL_CONFIG) [P3] ──
  const createFragmentShader = () => `
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
    // Trig-less float hash (stable across vendors)
    float hashf(float p){
      p = fract(p * 0.1031);
      p *= p + 33.33;
      p *= p + p;
      return fract(p);
    }

    void main() {
      vec2 fragCoord = gl_FragCoord.xy;
      vec2 uv = (fragCoord - 0.5 * R.xy) / R.y;
      vec3 col = bg;

      // --- Early Ribbon Rejection (skip expensive math for background pixels) ---
      float ribbonMinY = ${f(WEBGL_CONFIG.positioning.verticalOffset)} - ${f(maxRibbonHalfHeight)};
      float ribbonMaxY = ${f(WEBGL_CONFIG.positioning.verticalOffset)} + ${f(maxRibbonHalfHeight)};
      if (uv.y < ribbonMinY || uv.y > ribbonMaxY) {
        gl_FragColor = vec4(bg, 1.0);
        return;
      }

      // --- Wave Motion ---
      float yWave = sin(uv.x * ${f(WEBGL_CONFIG.wave.mainFrequency)} + T * ${f(WEBGL_CONFIG.wave.mainSpeed)}) * ${f(WEBGL_CONFIG.wave.mainAmplitude)}
                  + sin(uv.x * ${f(WEBGL_CONFIG.wave.secondaryFreq)} - T * ${f(WEBGL_CONFIG.wave.secondarySpeed)}) * ${f(WEBGL_CONFIG.wave.secondaryAmp)};

      float xOffset = sin(T * ${f(WEBGL_CONFIG.wave.horizontalSpeed)} + uv.y * ${f(WEBGL_CONFIG.wave.horizontalFrequency)}) * ${f(WEBGL_CONFIG.wave.horizontalAmount)};

      float stretch = ${f(WEBGL_CONFIG.thickness.stretchMin)} +
                      ${f(WEBGL_CONFIG.thickness.stretchMax - WEBGL_CONFIG.thickness.stretchMin)} * sin(T * ${f(WEBGL_CONFIG.thickness.stretchSpeed)} + uv.x * ${f(WEBGL_CONFIG.thickness.stretchFrequency)});

      float bandThickness = BASE_THICKNESS * stretch;
      float offset = (uv.y - yWave) + xOffset * ${f(WEBGL_CONFIG.wave.offsetBlend)};

      // --- Twist Logic ---
      ${twistEnabled ? `
        float twistPeriod = ${f(WEBGL_CONFIG.twist.period)};
        float tPhase = floor(T / twistPeriod);
        float localT = fract(T / twistPeriod);
        float twistAngle = smoothstep(0.0, ${f(WEBGL_CONFIG.twist.duration)}, localT) * 3.14159;
        float randDir = mix(-1.0, 1.0, step(0.5, hashf(tPhase + ${f(WEBGL_CONFIG.twist.randomSeed)})));
        twistAngle *= randDir;
        uv *= rot(twistAngle * ${f(WEBGL_CONFIG.twist.intensity)});
      ` : ''}

      // --- Mapping ---
      float s = (offset + ${f(WEBGL_CONFIG.positioning.verticalOffset)}) / bandThickness;

      ${hasDerivatives ? `
      float aaw = max(fwidth(s) * ${f(WEBGL_CONFIG.appearance.aaSharpness)}, ${f(WEBGL_CONFIG.appearance.aaFallback)});
      ` : `
      float aaw = ${f(WEBGL_CONFIG.appearance.aaFallback)};
      `}

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

      ${WEBGL_CONFIG.appearance.plasticEffect ? `
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
      ` : `
        shaded = bandCol * ${f(WEBGL_CONFIG.appearance.brightness)};
      `}

      // Masking
      float inRangeAA = smoothstep(-aaw, 0.0, s) * (1.0 - smoothstep(${f(WEBGL_CONFIG.positioning.bandCount)}, ${f(WEBGL_CONFIG.positioning.bandCount)} + aaw, s));
      col = mix(bg, shaded, inRangeAA);

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const vertexShaderSource = `
    attribute vec2 a_position;
    void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
  `;

  // ── Create programs safely [P1] ──
  const program = createProgramSafe(vertexShaderSource, createFragmentShader());
  if (!program) { console.error('[WebGL] Main program creation failed.'); return; }

  const dsVsSrc = `attribute vec2 p; varying vec2 v; void main(){v=p*0.5+0.5;gl_Position=vec4(p,0,1);}`;
  const dsFsSrc = `${precisionLine} varying vec2 v; uniform sampler2D t; uniform vec2 s;
    void main(){
      vec2 o=s*0.5;
      vec4 c = texture2D(t,v-o) + texture2D(t,v+vec2(o.x,-o.y)) + texture2D(t,v+vec2(-o.x,o.y)) + texture2D(t,v+o);
      gl_FragColor = c * 0.25;
    }`;
  const dsProg = createProgramSafe(dsVsSrc, dsFsSrc);
  if (!dsProg) { console.error('[WebGL] Downsample program creation failed.'); return; }

  // ── Geometry buffer (shared, one-time) ──
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

  // ── Attribute locations (with -1 guards) [P1] ──
  const posLoc = gl.getAttribLocation(program, 'a_position');
  const dsPos  = gl.getAttribLocation(dsProg, 'p');

  // ── VAO setup — bind correct program first [P1 fix] ──
  let mainVAO = null, dsVAO = null;
  if (vaoExt) {
    gl.useProgram(program);   // [P1] VAO captures state for the active program
    mainVAO = vaoExt.createVertexArrayOES();
    vaoExt.bindVertexArrayOES(mainVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    if (posLoc !== -1) {
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    }

    gl.useProgram(dsProg);    // [P1] switch program before capturing ds VAO
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

  // ── Uniform locations ──
  const resLoc  = gl.getUniformLocation(program, 'iResolution');
  const timeLoc = gl.getUniformLocation(program, 'iTime');
  const dsTex   = gl.getUniformLocation(dsProg, 't');
  const dsSize  = gl.getUniformLocation(dsProg, 's');

  // Set texture unit once (never changes)
  gl.useProgram(dsProg);
  if (dsTex) gl.uniform1i(dsTex, 0);

  // ── Hardware limits [P3] ──
  const maxTexSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);

  // ── Framebuffer state ──
  let fb = null, fbTex = null;
  let fbWidth = 0, fbHeight = 0;
  let ssFactor = 1.0;

  // Re-evaluate supersample factor on every resize [P2]
  function computeSuperSampleFactor() {
    const isMobile = window.innerWidth <= WEBGL_CONFIG.performance.mobileBreakpoint;
    let ss = isMobile ? WEBGL_CONFIG.performance.supersampleMobile : WEBGL_CONFIG.performance.supersampleDesktop;
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

      gl.useProgram(program);
      if (resLoc) gl.uniform2f(resLoc, pixelW, pixelH);
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
    const oldFb  = fb;
    const oldTex = fbTex;

    fbTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, fbTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, targetW, targetH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fbTex, 0);

    if (WEBGL_CONFIG.performance.debugMode) {
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        console.error('[WebGL] Framebuffer incomplete:', status);
      }
    }

    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Safe to delete old resources [v4]
    if (oldFb)  gl.deleteFramebuffer(oldFb);
    if (oldTex) gl.deleteTexture(oldTex);

    fbWidth  = targetW;
    fbHeight = targetH;

    // Cache resolution uniforms (only change on resize, not every frame) [P3]
    gl.useProgram(program);
    if (resLoc) gl.uniform2f(resLoc, targetW, targetH);
    gl.useProgram(dsProg);
    if (dsSize) gl.uniform2f(dsSize, 1.0 / targetW, 1.0 / targetH);
  }

  // ── Deferred resize [P4] — process at frame boundary, not mid-frame ──
  let resizePending = true;  // true initially to force first resize

  function handleResize() {
    resizePending = true;
  }

  function processResize() {
    resizePending = false;
    const cssW = Math.max(1, canvas.clientWidth);
    const cssH = Math.max(1, canvas.clientHeight);
    const dpr  = WEBGL_CONFIG.performance.respectDPR ? Math.max(1, window.devicePixelRatio || 1) : 1;

    // Compute ssFactor BEFORE canvas resize [P1 order fix]
    ssFactor = computeSuperSampleFactor();

    const pixelW = Math.max(1, Math.floor(cssW * dpr));
    const pixelH = Math.max(1, Math.floor(cssH * dpr));

    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width  = pixelW;
      canvas.height = pixelH;
    }

    setupFramebuffer(pixelW, pixelH, ssFactor);
  }

  // ── Animation state ──
  let animTime  = 0;
  let lastTime  = performance.now() * 0.001;
  let curSpeed  = 1.0;
  let targetSpeed = reduceMotion ? 0.3 : 1.0;  // [P5] slower if reduced-motion
  let isVisible = !document.hidden;
  let firstFrame = true;

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
    document.addEventListener('visibilitychange', initWebGL._onVisibilityChange);
  }

  // ── Interaction: pointer events only (covers mouse + touch) [P1 + P3] ──
  const header = document.querySelector('header');
  if (header) {
    initWebGL._headerEl = header;
    initWebGL._onHeaderEnter = () => targetSpeed = WEBGL_CONFIG.interaction.hoverSlowdown;
    initWebGL._onHeaderLeave = () => targetSpeed = reduceMotion ? 0.3 : 1.0;
    header.addEventListener('pointerenter', initWebGL._onHeaderEnter);
    header.addEventListener('pointerleave', initWebGL._onHeaderLeave);
  }

  // ── Debug helper [P3] ──
  function checkGLError(label) {
    if (!WEBGL_CONFIG.performance.debugMode) return;
    const err = gl.getError();
    if (err !== gl.NO_ERROR) console.error(`[WebGL] GL error at ${label}:`, err);
  }

  // ── Clear color (set once — matches WEBGL_CONFIG background) [P1] ──
  const bgC = WEBGL_CONFIG.colors.background;
  gl.clearColor(bgC.r, bgC.g, bgC.b, 1.0);

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
    const tau = Math.max(0.0001, WEBGL_CONFIG.interaction.smoothTime);
    curSpeed += (targetSpeed - curSpeed) * (1.0 - Math.exp(-dt / tau));
    animTime = (animTime + dt * curSpeed) % 10000.0;  // [v4: P1] prevent precision decay

    // ── FBO bypass when supersampling disabled [v4: P1, P4] ──
    const directRender = (ssFactor <= 1.0);

    if (directRender) {
      // ═══ Single pass: render straight to screen ═══
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(program);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (timeLoc) gl.uniform1f(timeLoc, animTime);

      if (vaoExt && mainVAO) {
        vaoExt.bindVertexArrayOES(mainVAO);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (vaoExt) vaoExt.bindVertexArrayOES(null);
      checkGLError('direct pass');

    } else {
      // Guard against failed framebuffer [P4]
      if (!fb) {
        initWebGL._rafId = requestAnimationFrame(render);
        return;
      }

      // ═══ Pass 1: High-res render into framebuffer ═══
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.useProgram(program);
      gl.viewport(0, 0, fbWidth, fbHeight);
      gl.clear(gl.COLOR_BUFFER_BIT);  // [P1] required for tile-based mobile GPUs
      if (timeLoc) gl.uniform1f(timeLoc, animTime);

      if (vaoExt && mainVAO) {
        vaoExt.bindVertexArrayOES(mainVAO);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (vaoExt) vaoExt.bindVertexArrayOES(null);
      checkGLError('main pass');

      // ═══ Pass 2: Downsample to screen ═══
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(dsProg);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fbTex);

      if (vaoExt && dsVAO) {
        vaoExt.bindVertexArrayOES(dsVAO);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (vaoExt) vaoExt.bindVertexArrayOES(null);
      checkGLError('downsample pass');
    }

    // ── Debug FPS [v4: P5] ──
    if (WEBGL_CONFIG.performance.debugMode) {
      initWebGL._dbgFrames = (initWebGL._dbgFrames || 0) + 1;
      if (now - (initWebGL._dbgLastLog || 0) >= 1.0) {
        const elapsed = now - (initWebGL._dbgLastLog || now);
        if (elapsed > 0) {
          const fps = initWebGL._dbgFrames / elapsed;
          console.log(`[WebGL] FPS: ${fps.toFixed(1)} | ${directRender ? 'direct' : fbWidth + '\u00d7' + fbHeight + ' @' + ssFactor + 'x'}`);
        }
        initWebGL._dbgFrames = 0;
        initWebGL._dbgLastLog = now;
      }
    }

    // ── Show canvas after first successful frame [P4] ──
    if (firstFrame) {
      firstFrame = false;
      canvas.classList.add('is-ready');
    }

    initWebGL._rafId = requestAnimationFrame(render);
  }

  // ── Kickoff ──
  processResize();                         // sync canvas size + create FBO with correct dims
  initWebGL._initialized = true;           // prevent future re-init [P2]
  lastTime = performance.now() * 0.001;
  if (initWebGL._rafId) cancelAnimationFrame(initWebGL._rafId);  // prevent duplicate RAF chains
  initWebGL._rafId = requestAnimationFrame(render);

  // ── ResizeObserver: disconnect old + create new [v4: all peers] ──
  if (initWebGL._ro) initWebGL._ro.disconnect();
  if (typeof ResizeObserver !== 'undefined') {
    initWebGL._ro = new ResizeObserver(handleResize);
    initWebGL._ro.observe(canvas);
  } else {
    initWebGL._onWindowResize = handleResize;
    window.addEventListener('resize', initWebGL._onWindowResize);
  }
}

// Ensure DOM is ready before initializing
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWebGL);
} else {
  initWebGL();
}