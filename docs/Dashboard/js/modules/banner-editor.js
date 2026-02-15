// ============================================
// BANNER EDITOR MODULE
// ============================================
// WebGL preview engine, controls, profiles, publish.
// ============================================

import { Trace, ctx, escHTML } from './utils.js';
import { buildDripShader, buildGooeyShader, buildRibbonShader, buildGroovyShader, buildPainterShader } from './banner-shaders.js';

export function initBannerEditor() {
  Trace.group("BANNER_PARAMS");

  const bEl = {
    section: document.getElementById("bannerParamsSection"),
    canvas: document.getElementById("shaderCanvas"),
    overlay: document.getElementById("bannerPreviewOverlay"),
    wrapper: document.getElementById("bannerPreviewWrapper"),
    resetBtn: document.getElementById("reset-params"),
    exportBtn: document.getElementById("export-params"),
    message: document.getElementById("bannerParamsMessage"),
    // Profile elements
    profilesList: document.getElementById("profilesList"),
    saveProfileBtn: document.getElementById("save-profile-btn"),
    saveProfileForm: document.getElementById("saveProfileForm"),
    profileNameInput: document.getElementById("profileNameInput"),
    confirmSaveBtn: document.getElementById("confirmSaveProfile"),
    cancelSaveBtn: document.getElementById("cancelSaveProfile"),
    profilesMessage: document.getElementById("profilesMessage"),
    shaderSelect: document.getElementById("shader-active"),
  };

  /* ── Default values (mirror of WEBGL_CONFIG in webgl.js) ── */
  const BANNER_DEFAULTS = {
    colors: {
      c0: { r: 0.004, g: 0.569, b: 0.663 },
      c1: { r: 0.482, g: 0.804, b: 0.796 },
      c2: { r: 0.988, g: 0.855, b: 0.024 },
      c3: { r: 0.973, g: 0.561, b: 0.173 },
      c4: { r: 0.937, g: 0.341, b: 0.553 },
      background: { r: 1.0, g: 1.0, b: 1.0 },
    },
    thickness: {
      base: 0.1,
      stretchMin: 0.8,
      stretchMax: 1.2,
      stretchSpeed: 1.3,
      stretchFrequency: 2.5,
    },
    wave: {
      mainSpeed: 1.0,
      mainFrequency: 3.0,
      mainAmplitude: 0.25,
      secondarySpeed: 1.8,
      secondaryFreq: 1.1,
      secondaryAmp: 0.1,
      horizontalSpeed: 0.7,
      horizontalFrequency: 2.0,
      horizontalAmount: 0.25,
      offsetBlend: 0.3,
    },
    twist: {
      enabled: false,
      intensity: 0.5,
    },
    appearance: {
      brightness: 1.125,
      plasticEffect: false,
      centerSoftness: 0.35,
      specularPower: 50.0,
      specularIntensity: 0.75,
      shadowStrength: 0.1,
      shadowWidth: 2.0,
      aaSharpness: 0.5,
      aaFallback: 0.001,
    },
    positioning: {
      verticalOffset: 0.205,
      bandCount: 5,
    },
    interaction: {
      hoverSlowdown: 0.1,
      smoothTime: 0.25,
    },
    performance: {
      supersampleDesktop: 2.5,
      supersampleMobile: 1.0,
      mobileBreakpoint: 768,
      respectDPR: true,
      pauseWhenHidden: true,
      maxDeltaTime: 0.05,
      debugMode: false,
    },
    shaderType: "ribbon_wave",
    drip: {
      scale: 1.0,
      density: 0.75,
      dripDistance: 0.1,
      sdfWidth: 0.18,
      fallSpeed: 6.0,
      bFreq: 3.5,
      bRange: 0.35,
      viscosity: 1.5,
    },
    gooey: {
      animSpeed: 2.0,
      paintLength: 15.0,
      loopSize: 24.0,
    },
    groovy: {
      speed: 1.0,
      mixPowerMin: 0.15,
      mixPowerMax: 0.80,
      iterations: 11,
      mouseInfluence: 3.0,
    },
    painter: {
      brushSize: 80.0,
      softness: 1.2,
      noiseScale: 4.0,
      noiseInfluence: 0.4,
      cycleSpeed: 0.2,
    },
  };

  /* ── Map of every control: config path → DOM id ── */
  const PARAM_MAP = [
    // Thickness
    { path: "thickness.base", id: "thickness-base", type: "range" },
    { path: "thickness.stretchMin", id: "thickness-stretchMin", type: "range" },
    { path: "thickness.stretchMax", id: "thickness-stretchMax", type: "range" },
    { path: "thickness.stretchSpeed", id: "thickness-stretchSpeed", type: "range" },
    { path: "thickness.stretchFrequency", id: "thickness-stretchFrequency", type: "range" },
    // Wave
    { path: "wave.mainSpeed", id: "wave-mainSpeed", type: "range" },
    { path: "wave.mainFrequency", id: "wave-mainFrequency", type: "range" },
    { path: "wave.mainAmplitude", id: "wave-mainAmplitude", type: "range" },
    { path: "wave.secondarySpeed", id: "wave-secondarySpeed", type: "range" },
    { path: "wave.secondaryFreq", id: "wave-secondaryFreq", type: "range" },
    { path: "wave.secondaryAmp", id: "wave-secondaryAmp", type: "range" },
    { path: "wave.horizontalSpeed", id: "wave-horizontalSpeed", type: "range" },
    { path: "wave.horizontalFrequency", id: "wave-horizontalFrequency", type: "range" },
    { path: "wave.horizontalAmount", id: "wave-horizontalAmount", type: "range" },
    { path: "wave.offsetBlend", id: "wave-offsetBlend", type: "range" },
    // World Rotation
    { path: "twist.enabled", id: "twist-enabled", type: "checkbox" },
    { path: "twist.intensity", id: "twist-intensity", type: "range" },
    // Appearance
    { path: "appearance.brightness", id: "appearance-brightness", type: "range" },
    { path: "appearance.plasticEffect", id: "appearance-plasticEffect", type: "checkbox" },
    { path: "appearance.centerSoftness", id: "appearance-centerSoftness", type: "range" },
    { path: "appearance.specularPower", id: "appearance-specularPower", type: "range" },
    { path: "appearance.specularIntensity", id: "appearance-specularIntensity", type: "range" },
    { path: "appearance.shadowStrength", id: "appearance-shadowStrength", type: "range" },
    { path: "appearance.shadowWidth", id: "appearance-shadowWidth", type: "range" },
    { path: "appearance.aaSharpness", id: "appearance-aaSharpness", type: "range" },
    { path: "appearance.aaFallback", id: "appearance-aaFallback", type: "number" },
    // Positioning
    { path: "positioning.verticalOffset", id: "positioning-verticalOffset", type: "range" },
    { path: "positioning.bandCount", id: "positioning-bandCount", type: "number" },
    // Interaction
    { path: "interaction.hoverSlowdown", id: "interaction-hoverSlowdown", type: "range" },
    { path: "interaction.smoothTime", id: "interaction-smoothTime", type: "range" },
    // Performance
    { path: "performance.supersampleDesktop", id: "performance-supersampleDesktop", type: "range" },
    { path: "performance.supersampleMobile", id: "performance-supersampleMobile", type: "range" },
    { path: "performance.mobileBreakpoint", id: "performance-mobileBreakpoint", type: "number" },
    { path: "performance.respectDPR", id: "performance-respectDPR", type: "checkbox" },
    { path: "performance.pauseWhenHidden", id: "performance-pauseWhenHidden", type: "checkbox" },
    { path: "performance.maxDeltaTime", id: "performance-maxDeltaTime", type: "range" },
    { path: "performance.debugMode", id: "performance-debugMode", type: "checkbox" },
    // Drip
    { path: "drip.scale", id: "drip-scale", type: "range" },
    { path: "drip.density", id: "drip-density", type: "range" },
    { path: "drip.dripDistance", id: "drip-distance", type: "range" },
    { path: "drip.sdfWidth", id: "drip-sdfWidth", type: "range" },
    { path: "drip.fallSpeed", id: "drip-fallSpeed", type: "range" },
    { path: "drip.bFreq", id: "drip-bFreq", type: "range" },
    { path: "drip.bRange", id: "drip-bRange", type: "range" },
    { path: "drip.viscosity", id: "drip-viscosity", type: "range" },
    // Gooey
    { path: "gooey.animSpeed", id: "gooey-animSpeed", type: "range" },
    { path: "gooey.paintLength", id: "gooey-paintLength", type: "range" },
    { path: "gooey.loopSize", id: "gooey-loopSize", type: "range" },
    // Groovy
    { path: "groovy.speed", id: "groovy-speed", type: "range" },
    { path: "groovy.mixPowerMin", id: "groovy-mixPowerMin", type: "range" },
    { path: "groovy.mixPowerMax", id: "groovy-mixPowerMax", type: "range" },
    { path: "groovy.iterations", id: "groovy-iterations", type: "range" },
    { path: "groovy.mouseInfluence", id: "groovy-mouseInfluence", type: "range" },
    // Painter
    { path: "painter.brushSize", id: "painter-brushSize", type: "range" },
    { path: "painter.softness", id: "painter-softness", type: "range" },
    { path: "painter.noiseScale", id: "painter-noiseScale", type: "range" },
    { path: "painter.noiseInfluence", id: "painter-noiseInfluence", type: "range" },
    { path: "painter.cycleSpeed", id: "painter-cycleSpeed", type: "range" },
  ];

  /* ── Helpers ── */
  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }
  function getPath(obj, path) {
    const parts = path.split(".");
    let cur = obj;
    for (const p of parts) {
      cur = cur?.[p];
    }
    return cur;
  }
  function setPath(obj, path, val) {
    const parts = path.split(".");
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] == null) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = val;
  }

  /* ── Live config object (mutable, used by preview engine) ── */
  let liveConfig = deepClone(BANNER_DEFAULTS);

  /* ── Sync UI controls from liveConfig ── */
  function syncControls() {
    for (const p of PARAM_MAP) {
      const val = getPath(liveConfig, p.path);
      if (val === undefined) continue;
      if (p.type === "checkbox") {
        const el = document.getElementById(p.id);
        if (el) el.checked = !!val;
      } else if (p.type === "range") {
        const slider = document.getElementById(p.id);
        const num = document.getElementById(p.id + "-num");
        if (slider) slider.value = val;
        if (num) num.value = val;
      } else {
        const el = document.getElementById(p.id);
        if (el) el.value = val;
      }
    }
    // Sync shader mode dropdown
    if (bEl.shaderSelect) {
      const mode = liveConfig.shaderType || "ribbon_wave";
      bEl.shaderSelect.value = mode;
      document.body.dataset.activeShader = mode;
    }
  }

  /* ── Read a single control value ── */
  function readControlValue(p) {
    if (p.type === "checkbox") {
      const el = document.getElementById(p.id);
      return el ? el.checked : getPath(BANNER_DEFAULTS, p.path);
    }
    const el = document.getElementById(p.id);
    if (!el) return getPath(BANNER_DEFAULTS, p.path);
    const v = parseFloat(el.value);
    return isNaN(v) ? getPath(BANNER_DEFAULTS, p.path) : v;
  }

  /* ── Read all controls into liveConfig ── */
  function readAllControls() {
    for (const p of PARAM_MAP) {
      setPath(liveConfig, p.path, readControlValue(p));
    }
    // Read shader mode from dropdown (not in PARAM_MAP)
    if (bEl.shaderSelect) {
      liveConfig.shaderType = bEl.shaderSelect.value;
    }
  }

  /* ── Debounced preview rebuild ── */
  let rebuildTimer = null;
  function scheduleRebuild() {
    readAllControls();
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      rebuildPreview();
    }, 150);
  }

  /* ── Bidirectional slider ↔ number sync ── */
  if (bEl.section) {
    bEl.section.addEventListener("input", (e) => {
      const el = e.target;
      if (!el || !el.id) return;

      // Slider changed → update paired number
      if (el.type === "range") {
        const numEl = document.getElementById(el.id + "-num");
        if (numEl) numEl.value = el.value;
      }
      // Number changed → update paired slider
      else if (el.type === "number" && el.id.endsWith("-num")) {
        const sliderId = el.id.replace(/-num$/, "");
        const sliderEl = document.getElementById(sliderId);
        if (sliderEl) sliderEl.value = el.value;
      }
      scheduleRebuild();
    });

    // Checkbox toggles fire 'change', not always 'input'
    bEl.section.addEventListener("change", (e) => {
      if (e.target && e.target.type === "checkbox") {
        scheduleRebuild();
      }
    });

    // Shader mode dropdown: trigger crossfade on selection change
    if (bEl.shaderSelect) {
      bEl.shaderSelect.addEventListener("change", () => {
        const mode = bEl.shaderSelect.value;
        document.body.dataset.activeShader = mode;
        if (window.transitionShader) {
          window.transitionShader(mode);
        } else {
          // Fallback for when WebGL isn't loaded/ready
          liveConfig.shaderType = bEl.shaderSelect.value;
          console.warn(
            "transitionShader not ready, update queued via liveConfig",
          );
        }
        console.log("[BannerPreview] Shader mode -->", liveConfig.shaderType);

        // Drive the production WebGL banner crossfade (if present)
        if (typeof window.transitionShader === "function") {
          window.transitionShader(liveConfig.shaderType);
        }

        // Also crossfade the local preview engine
        if (mode !== previewState.shaderTo) {
          previewState.shaderFrom = previewState.shaderTo;
          previewState.shaderTo = mode;
          previewState.crossfadeFactor = 0.0;
        }
      });
    }
  }

  // ================================================
  // SELF-CONTAINED WEBGL PREVIEW ENGINE
  // ================================================

  /* ── Master Loop Duration (phase-space) ── */
  const PREVIEW_LOOP_SECONDS = 12.0;

  const previewState = {
    gl: null,
    ribbonProg: null,
    paintProg: null,
    gooeyProg: null,
    groovyProg: null,
    ribbonUni: null,
    paintUni: null,
    gooeyUni: null,
    groovyUni: null,
    rafId: null,
    animTime: 0,
    lastTime: 0,
    curSpeed: 1.0,
    targetSpeed: 1.0,
    running: false,
    shaderFrom: "ribbon_wave",
    shaderTo: "ribbon_wave",
    crossfadeFactor: 1.0,
  };

  /* ── Compile a single shader ── */
  function compileShaderSrc(gl, src, type) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error(
        "[BannerPreview] Shader compile error:",
        gl.getShaderInfoLog(sh),
      );
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  /* ── Create a WebGL program ── */
  function createPreviewProgram(gl, vsSrc, fsSrc) {
    const vs = compileShaderSrc(gl, vsSrc, gl.VERTEX_SHADER);
    const fs = compileShaderSrc(gl, fsSrc, gl.FRAGMENT_SHADER);
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      return null;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    // Force attribute location 0 to match the hardcoded vertexAttribPointer
    gl.bindAttribLocation(prog, 0, "a_position");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error(
        "[BannerPreview] Program link error:",
        gl.getProgramInfoLog(prog),
      );
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return null;
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return prog;
  }

  /* ── Init WebGL context on the preview canvas ── */
  function initPreview() {
    if (!bEl.canvas) return false;

    const glOpts = {
      alpha: false,
      antialias: false,
      powerPreference: "default",
    };
    const gl =
      bEl.canvas.getContext("webgl", glOpts) ||
      bEl.canvas.getContext("experimental-webgl", glOpts);
    if (!gl) {
      console.warn("[BannerPreview] WebGL not supported");
      return false;
    }
    gl.getExtension("OES_standard_derivatives");

    previewState.gl = gl;

    // Fullscreen quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    previewState.buffer = buf;

    // Build all three programs
    const vsSrc =
      "attribute vec2 a_position; void main(){ gl_Position = vec4(a_position,0.0,1.0); }";

    const ribbonProg = createPreviewProgram(gl, vsSrc, buildRibbonShader(liveConfig));
    const paintProg = createPreviewProgram(gl, vsSrc, buildDripShader(liveConfig));
    const gooeyProg = createPreviewProgram(gl, vsSrc, buildGooeyShader(liveConfig));
    const groovyProg = createPreviewProgram(gl, vsSrc, buildGroovyShader(liveConfig));
    const painterProg = createPreviewProgram(gl, vsSrc, buildPainterShader(liveConfig));
    if (!ribbonProg) return false;

    previewState.ribbonProg = ribbonProg;
    previewState.paintProg = paintProg;
    previewState.gooeyProg = gooeyProg;
    previewState.groovyProg = groovyProg;
    previewState.painterProg = painterProg;

    // Uniform locations for all programs
    previewState.ribbonUni = {
      res: gl.getUniformLocation(ribbonProg, "iResolution"),
      time: gl.getUniformLocation(ribbonProg, "iTime"),
    };
    previewState.paintUni = paintProg
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
    previewState.gooeyUni = gooeyProg
      ? {
          res: gl.getUniformLocation(gooeyProg, "u_resolution"),
          time: gl.getUniformLocation(gooeyProg, "u_time"),
        }
      : null;
    previewState.groovyUni = groovyProg
      ? {
          res: gl.getUniformLocation(groovyProg, "iResolution"),
          time: gl.getUniformLocation(groovyProg, "iTime"),
          speed: gl.getUniformLocation(groovyProg, "u_groovy_speed"),
          mixMin: gl.getUniformLocation(groovyProg, "u_groovy_mixMin"),
          mixMax: gl.getUniformLocation(groovyProg, "u_groovy_mixMax"),
          iterations: gl.getUniformLocation(groovyProg, "u_groovy_iterations"),
          mouseInfl: gl.getUniformLocation(groovyProg, "u_groovy_mouseInfl"),
        }
      : null;
    previewState.painterUni = painterProg
      ? {
          res: gl.getUniformLocation(painterProg, "iResolution"),
          time: gl.getUniformLocation(painterProg, "iTime"),
          brushSize: gl.getUniformLocation(painterProg, "u_painter_brushSize"),
          softness: gl.getUniformLocation(painterProg, "u_painter_softness"),
          noiseScale: gl.getUniformLocation(painterProg, "u_painter_noiseScale"),
          noiseInfluence: gl.getUniformLocation(painterProg, "u_painter_noiseInfluence"),
          cycleSpeed: gl.getUniformLocation(painterProg, "u_painter_cycleSpeed"),
        }
      : null;

    // Set initial crossfade state
    const initType = liveConfig.shaderType || "ribbon_wave";
    previewState.shaderFrom = initType;
    previewState.shaderTo = initType;
    previewState.crossfadeFactor = 1.0;

    resizePreviewCanvas();

    // Hide overlay
    if (bEl.overlay) {
      bEl.overlay.style.opacity = "0";
      bEl.overlay.style.pointerEvents = "none";
    }

    Trace.log("BANNER_PREVIEW_INIT");
    return true;
  }

  /* ── Rebuild all shader programs (hot-swap on param change) ── */
  function rebuildShader() {
    const gl = previewState.gl;
    if (!gl) return;
    const vsSrc =
      "attribute vec2 a_position; void main(){ gl_Position = vec4(a_position,0.0,1.0); }";

    // Rebuild ribbon
    const newRibbon = createPreviewProgram(gl, vsSrc, buildRibbonShader(liveConfig));
    if (newRibbon) {
      if (previewState.ribbonProg) gl.deleteProgram(previewState.ribbonProg);
      previewState.ribbonProg = newRibbon;
      previewState.ribbonUni = {
        res: gl.getUniformLocation(newRibbon, "iResolution"),
        time: gl.getUniformLocation(newRibbon, "iTime"),
      };
    }

    // Rebuild paint
    const newPaint = createPreviewProgram(gl, vsSrc, buildDripShader(liveConfig));
    if (newPaint) {
      if (previewState.paintProg) gl.deleteProgram(previewState.paintProg);
      previewState.paintProg = newPaint;
      console.log("🟢 [WebGL] Paint program compiled successfully.");
      previewState.paintUni = {
        res: gl.getUniformLocation(newPaint, "iResolution"),
        time: gl.getUniformLocation(newPaint, "iTime"),
        scale: gl.getUniformLocation(newPaint, "u_scale"),
        density: gl.getUniformLocation(newPaint, "u_density"),
        dripDistance: gl.getUniformLocation(newPaint, "u_dripDistance"),
        sdfWidth: gl.getUniformLocation(newPaint, "u_sdfWidth"),
        fallSpeed: gl.getUniformLocation(newPaint, "u_fallSpeed"),
        bFreq: gl.getUniformLocation(newPaint, "u_bFreq"),
        bRange: gl.getUniformLocation(newPaint, "u_bRange"),
        viscosity: gl.getUniformLocation(newPaint, "u_viscosity"),
      };
    }

    // Rebuild gooey
    const newGooey = createPreviewProgram(gl, vsSrc, buildGooeyShader(liveConfig));
    if (newGooey) {
      if (previewState.gooeyProg) gl.deleteProgram(previewState.gooeyProg);
      previewState.gooeyProg = newGooey;
      previewState.gooeyUni = {
        res: gl.getUniformLocation(newGooey, "u_resolution"),
        time: gl.getUniformLocation(newGooey, "u_time"),
      };
    }

    // Rebuild groovy
    const newGroovy = createPreviewProgram(gl, vsSrc, buildGroovyShader(liveConfig));
    if (newGroovy) {
      if (previewState.groovyProg) gl.deleteProgram(previewState.groovyProg);
      previewState.groovyProg = newGroovy;
      previewState.groovyUni = {
        res: gl.getUniformLocation(newGroovy, "iResolution"),
        time: gl.getUniformLocation(newGroovy, "iTime"),
        speed: gl.getUniformLocation(newGroovy, "u_groovy_speed"),
        mixMin: gl.getUniformLocation(newGroovy, "u_groovy_mixPowerMin"),
        mixMax: gl.getUniformLocation(newGroovy, "u_groovy_mixPowerMax"),
        iterations: gl.getUniformLocation(newGroovy, "u_groovy_iterations"),
        mouseInfl: gl.getUniformLocation(newGroovy, "u_groovy_mouseInfluence"),
      };
    }

    // Rebuild painter
    const newPainter = createPreviewProgram(gl, vsSrc, buildPainterShader(liveConfig));
    if (newPainter) {
      if (previewState.painterProg) gl.deleteProgram(previewState.painterProg);
      previewState.painterProg = newPainter;
      previewState.painterUni = {
        res: gl.getUniformLocation(newPainter, "iResolution"),
        time: gl.getUniformLocation(newPainter, "iTime"),
        brushSize: gl.getUniformLocation(newPainter, "u_painter_brushSize"),
        softness: gl.getUniformLocation(newPainter, "u_painter_softness"),
        noiseScale: gl.getUniformLocation(newPainter, "u_painter_noiseScale"),
        noiseInfluence: gl.getUniformLocation(newPainter, "u_painter_noiseInfluence"),
        cycleSpeed: gl.getUniformLocation(newPainter, "u_painter_cycleSpeed"),
      };
    }

    // Re-bind attribute (location 0 = a_position)
    gl.bindBuffer(gl.ARRAY_BUFFER, previewState.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    resizePreviewCanvas();
  }

  /* ── Resize canvas to CSS dimensions ── */
  function resizePreviewCanvas() {
    const gl = previewState.gl;
    if (!gl || !bEl.canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(bEl.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(bEl.canvas.clientHeight * dpr));
    if (bEl.canvas.width !== w || bEl.canvas.height !== h) {
      bEl.canvas.width = w;
      bEl.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    // Update resolution uniform on all programs
    if (previewState.ribbonProg) {
      gl.useProgram(previewState.ribbonProg);
      if (previewState.ribbonUni?.res)
        gl.uniform2f(previewState.ribbonUni.res, w, h);
    }
    if (previewState.paintProg) {
      gl.useProgram(previewState.paintProg);
      if (previewState.paintUni?.res)
        gl.uniform2f(previewState.paintUni.res, w, h);
    }
    if (previewState.gooeyProg) {
      gl.useProgram(previewState.gooeyProg);
      if (previewState.gooeyUni?.res)
        gl.uniform2f(previewState.gooeyUni.res, w, h);
    }
    if (previewState.groovyProg) {
      gl.useProgram(previewState.groovyProg);
      if (previewState.groovyUni?.res)
        gl.uniform2f(previewState.groovyUni.res, w, h);
    }
    if (previewState.painterProg) {
      gl.useProgram(previewState.painterProg);
      if (previewState.painterUni?.res)
        gl.uniform2f(previewState.painterUni.res, w, h);
    }
  }

  /* ── Upload drip uniforms to paint program ── */
  function uploadPreviewDripUniforms(gl) {
    if (!previewState.paintUni) return;
    const d = liveConfig.drip;

    // Log payload once
    if (!uploadPreviewDripUniforms._logged) {
      console.log("🔵 [WebGL] Uploading Drip Uniforms:", JSON.stringify(d));
      uploadPreviewDripUniforms._logged = true;
    }

    const u = previewState.paintUni;
    if (u.scale) gl.uniform1f(u.scale, d.scale || 1.0);
    if (u.density) gl.uniform1f(u.density, d.density);
    if (u.dripDistance) gl.uniform1f(u.dripDistance, d.dripDistance);
    if (u.sdfWidth) gl.uniform1f(u.sdfWidth, d.sdfWidth);
    if (u.fallSpeed) gl.uniform1f(u.fallSpeed, d.fallSpeed);
    if (u.bFreq) gl.uniform1f(u.bFreq, d.bFreq);
    if (u.bRange) gl.uniform1f(u.bRange, d.bRange);
    if (u.viscosity) gl.uniform1f(u.viscosity, d.viscosity);
  }

  /* ── Upload groovy uniforms to groovy program ── */
  function uploadPreviewGroovyUniforms(gl) {
    if (!previewState.groovyUni) return;
    const g = liveConfig.groovy;
    const u = previewState.groovyUni;
    if (u.speed) gl.uniform1f(u.speed, g.speed);
    if (u.mixMin) gl.uniform1f(u.mixMin, g.mixPowerMin);
    if (u.mixMax) gl.uniform1f(u.mixMax, g.mixPowerMax);
    if (u.iterations) gl.uniform1f(u.iterations, g.iterations);
    if (u.mouseInfl) gl.uniform1f(u.mouseInfl, g.mouseInfluence);
  }

  /* ── Upload painter uniforms to painter program ── */
  function uploadPreviewPainterUniforms(gl) {
    if (!previewState.painterUni) return;
    const p = liveConfig.painter;
    const u = previewState.painterUni;
    if (u.brushSize) gl.uniform1f(u.brushSize, p.brushSize);
    if (u.softness) gl.uniform1f(u.softness, p.softness);
    if (u.noiseScale) gl.uniform1f(u.noiseScale, p.noiseScale);
    if (u.noiseInfluence) gl.uniform1f(u.noiseInfluence, p.noiseInfluence);
    if (u.cycleSpeed) gl.uniform1f(u.cycleSpeed, p.cycleSpeed);
  }

  /* ── Crossfade duration ── */
  const PREVIEW_CROSSFADE_DURATION = 2.0;

  /* ── Render one frame with hover slowdown + crossfade ── */
  function renderPreviewFrame(timestamp) {
    if (!previewState.running) return;
    const gl = previewState.gl;
    if (!gl) return;

    const now = timestamp * 0.001;
    const dt = Math.min(now - previewState.lastTime, 0.05);
    previewState.lastTime = now;

    // Smooth speed transition for hover slowdown
    const tau = Math.max(0.0001, liveConfig.interaction.smoothTime);
    previewState.curSpeed +=
      (previewState.targetSpeed - previewState.curSpeed) *
      (1.0 - Math.exp(-dt / tau));

    // Phase-space: accumulate real seconds, normalize to 0→1 phase for shader
    previewState.animTime =
      (previewState.animTime + dt * previewState.curSpeed) %
      PREVIEW_LOOP_SECONDS;
    const loopPhase = previewState.animTime / PREVIEW_LOOP_SECONDS;

    // Crossfade blend update (from/to architecture)
    if (previewState.crossfadeFactor < 1.0) {
      const speed = 1.0 / Math.max(0.001, PREVIEW_CROSSFADE_DURATION);
      previewState.crossfadeFactor = Math.min(
        previewState.crossfadeFactor + speed * dt,
        1.0,
      );
      if (previewState.crossfadeFactor >= 1.0) {
        previewState.shaderFrom = previewState.shaderTo;
      }
    }

    // Helper: resolve shader type → program/uni/flags
    function resolvePreviewShader(type) {
      if (type === "paint_drip" && previewState.paintProg)
        return {
          prog: previewState.paintProg,
          uni: previewState.paintUni,
          drip: true,
          gooey: false,
        };
      if (type === "gooey_drip" && previewState.gooeyProg)
        return {
          prog: previewState.gooeyProg,
          uni: previewState.gooeyUni,
          drip: false,
          gooey: true,
          groovy: false,
        };
      if (type === "groovy" && previewState.groovyProg)
        return {
          prog: previewState.groovyProg,
          uni: previewState.groovyUni,
          drip: false,
          gooey: false,
          groovy: true,
          painter: false,
        };
      if (type === "painter" && previewState.painterProg)
        return {
          prog: previewState.painterProg,
          uni: previewState.painterUni,
          drip: false,
          gooey: false,
          groovy: false,
          painter: true,
        };
      return {
        prog: previewState.ribbonProg,
        uni: previewState.ribbonUni,
        drip: false,
        gooey: false,
        groovy: false,
        painter: false,
      };
    }

    const cf = previewState.crossfadeFactor;
    const toInfo = resolvePreviewShader(previewState.shaderTo);

    // Log the render state once per second
    if (liveConfig.performance && liveConfig.performance.debugMode) {
      if (now - (renderPreviewFrame._dbgRouterLog || 0) >= 1.0) {
        console.log(
          `\uD83D\uDFE1 [WebGL Router] From: ${previewState.shaderFrom} To: ${previewState.shaderTo} | Factor: ${cf.toFixed(3)}`,
        );
        renderPreviewFrame._dbgRouterLog = now;
      }
    }

    gl.clear(gl.COLOR_BUFFER_BIT);

    function drawPreviewShader(info, blended, alpha) {
      if (blended) {
        gl.enable(gl.BLEND);
        gl.blendColor(0, 0, 0, alpha);
        gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
      }
      gl.useProgram(info.prog);
      if (info.uni?.time)
        gl.uniform1f(
          info.uni.time,
          (info.gooey || info.groovy || info.painter) ? previewState.animTime : loopPhase,
        );
      if (info.drip) uploadPreviewDripUniforms(gl);
      if (info.groovy) uploadPreviewGroovyUniforms(gl);
      if (info.painter) uploadPreviewPainterUniforms(gl);

      gl.bindBuffer(gl.ARRAY_BUFFER, previewState.buffer);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (blended) gl.disable(gl.BLEND);
    }

    if (cf >= 0.999) {
      drawPreviewShader(toInfo, false, 0);
    } else {
      const fromInfo = resolvePreviewShader(previewState.shaderFrom);
      drawPreviewShader(fromInfo, false, 0);
      drawPreviewShader(toInfo, true, cf);
    }

    previewState.rafId = requestAnimationFrame(renderPreviewFrame);
  }

  /* ── Start / stop / rebuild helpers ── */
  function startPreview() {
    if (previewState.running) return;
    previewState.running = true;
    previewState.lastTime = performance.now() * 0.001;
    previewState.rafId = requestAnimationFrame(renderPreviewFrame);
  }
  function stopPreview() {
    previewState.running = false;
    if (previewState.rafId) {
      cancelAnimationFrame(previewState.rafId);
      previewState.rafId = null;
    }
  }
  function rebuildPreview() {
    if (!previewState.gl) return;
    rebuildShader();
  }

  /* ── Message flash ── */
  function showBannerMsg(text, type) {
    if (!bEl.message) return;
    bEl.message.textContent = text;
    bEl.message.className =
      "gallery-msg " + (type === "error" ? "is-error" : "is-success");
    bEl.message.classList.remove("is-hidden");
    setTimeout(() => {
      bEl.message.classList.add("is-hidden");
    }, 4000);
  }

  /* ── Build config for publishing (colors excluded) ── */
  function buildPublishConfig() {
    const out = { shaderType: liveConfig.shaderType };
    const groups = [
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
    ];
    for (const g of groups) {
      if (liveConfig[g]) out[g] = deepClone(liveConfig[g]);
    }
    console.log("📦 [BannerParams] Publishing Payload:", JSON.stringify(out));
    return out;
  }

  /* ── Load saved config from Supabase ── */
  async function loadBannerConfig() {
    if (!ctx.db || !ctx.adminCode) return;
    try {
      const { data, error } = await ctx.db.rpc("admin_get_banner_config", {
        p_admin_code: ctx.adminCode,
      });
      if (error) throw error;
      if (data?.success && data.config) {
        const saved = data.config;
        const groups = [
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
        ];
        for (const g of groups) {
          if (saved[g] && typeof saved[g] === "object" && liveConfig[g]) {
            for (const key in saved[g]) {
              if (key in liveConfig[g]) {
                liveConfig[g][key] = saved[g][key];
              }
            }
          }
        }
        // Restore top-level shaderType (not inside any group)
        if (typeof saved.shaderType === "string") {
          liveConfig.shaderType = saved.shaderType;
        }
        Trace.log("BANNER_CONFIG_LOADED");
      }
    } catch (err) {
      console.warn("[BannerParams] Failed to load config:", err);
    }
  }

  /* ── Reset button ── */
  if (bEl.resetBtn) {
    bEl.resetBtn.addEventListener("click", () => {
      liveConfig = deepClone(BANNER_DEFAULTS);
      syncControls();
      rebuildPreview();
      showBannerMsg("Reset to defaults", "success");
      Trace.log("BANNER_RESET");
    });
  }

  /* ── Publish button (save to Supabase) ── */
  if (bEl.exportBtn) {
    bEl.exportBtn.addEventListener("click", async () => {
      if (!ctx.db || !ctx.adminCode) {
        showBannerMsg("Not authenticated", "error");
        return;
      }
      bEl.exportBtn.disabled = true;
      bEl.exportBtn.textContent = "Publishing…";
      try {
        const payload = buildPublishConfig();
        const { data, error } = await ctx.db.rpc("admin_set_banner_config", {
          p_admin_code: ctx.adminCode,
          p_config: payload,
        });
        if (error) throw error;
        if (!data?.success) throw new Error(data?.error || "Unknown error");
        showBannerMsg(
          "Published! Live site will use new config on next load.",
          "success",
        );
        Trace.log("BANNER_PUBLISHED");

        // Also copy JSON to clipboard as backup
        try {
          await navigator.clipboard.writeText(
            JSON.stringify(payload, null, 2),
          );
        } catch (_) {
          /* clipboard optional */
        }
      } catch (err) {
        showBannerMsg("Publish failed: " + (err.message || err), "error");
        Trace.log("BANNER_PUBLISH_FAILED", {
          error: err.message || String(err),
        });
      } finally {
        bEl.exportBtn.disabled = false;
        bEl.exportBtn.textContent = "Publish to Site";
      }
    });
  }

  // ================================================
  // SAVED PROFILES (localStorage)
  // ================================================
  const PROFILES_KEY = "jossd_banner_profiles";

  function loadProfiles() {
    try {
      const raw = localStorage.getItem(PROFILES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveProfiles(profiles) {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  }

  function showProfileMsg(text, type) {
    if (!bEl.profilesMessage) return;
    bEl.profilesMessage.textContent = text;
    bEl.profilesMessage.className =
      "gallery-msg " + (type === "error" ? "is-error" : "is-success");
    bEl.profilesMessage.classList.remove("is-hidden");
    setTimeout(() => {
      bEl.profilesMessage.classList.add("is-hidden");
    }, 3500);
  }

  function fmtDate(ts) {
    const d = new Date(ts);
    return (
      d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }) +
      " " +
      d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    );
  }

  function renderProfiles() {
    if (!bEl.profilesList) return;
    const profiles = loadProfiles();

    if (profiles.length === 0) {
      bEl.profilesList.innerHTML =
        '<p class="text-muted-2 text-xs profiles-empty">No saved profiles yet. Click \u201c\ud83d\udcbe Save as Profile\u201d below to create one.</p>';
      return;
    }

    bEl.profilesList.innerHTML = profiles
      .map(
        (p, i) => `
          <div class="profile-item" data-profile-idx="${i}">
              <div class="profile-item-info">
                  <span class="profile-name">${escHTML(p.name)}</span>
                  <span class="profile-date">${fmtDate(p.savedAt)}</span>
              </div>
              <div class="profile-item-actions">
                  <button type="button" class="btn-load-profile" data-action="load" data-idx="${i}">Load</button>
                  <button type="button" class="btn-rename-profile" data-action="rename" data-idx="${i}">Rename</button>
                  <button type="button" class="btn-delete-profile" data-action="delete" data-idx="${i}">Delete</button>
              </div>
          </div>
        `,
      )
      .join("");
  }

  /* ── Save Profile button → show form ── */
  if (bEl.saveProfileBtn) {
    bEl.saveProfileBtn.addEventListener("click", () => {
      if (bEl.saveProfileForm)
        bEl.saveProfileForm.classList.remove("is-hidden");
      if (bEl.profileNameInput) {
        bEl.profileNameInput.value = "";
        bEl.profileNameInput.focus();
      }
    });
  }

  /* ── Cancel save ── */
  if (bEl.cancelSaveBtn) {
    bEl.cancelSaveBtn.addEventListener("click", () => {
      if (bEl.saveProfileForm) bEl.saveProfileForm.classList.add("is-hidden");
    });
  }

  /* ── Confirm save ── */
  if (bEl.confirmSaveBtn) {
    bEl.confirmSaveBtn.addEventListener("click", () => {
      const name = (bEl.profileNameInput?.value || "").trim();
      if (!name) {
        showProfileMsg("Please enter a profile name.", "error");
        return;
      }
      readAllControls();
      const profiles = loadProfiles();
      profiles.push({
        name,
        savedAt: Date.now(),
        config: deepClone(liveConfig),
      });
      saveProfiles(profiles);
      renderProfiles();
      if (bEl.saveProfileForm) bEl.saveProfileForm.classList.add("is-hidden");
      showProfileMsg(`Profile "${name}" saved.`, "success");
      Trace.log("PROFILE_SAVED", { name });
    });
  }

  /* ── Allow Enter key to confirm save ── */
  if (bEl.profileNameInput) {
    bEl.profileNameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        bEl.confirmSaveBtn?.click();
      }
    });
  }

  /* ── Profile list actions (delegated) ── */
  if (bEl.profilesList) {
    bEl.profilesList.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      const idx = parseInt(btn.dataset.idx, 10);
      const profiles = loadProfiles();
      if (idx < 0 || idx >= profiles.length) return;

      if (action === "load") {
        const saved = profiles[idx].config;
        const groups = [
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
        ];
        for (const g of groups) {
          if (saved[g] && typeof saved[g] === "object" && liveConfig[g]) {
            for (const key in saved[g]) {
              if (key in liveConfig[g]) {
                liveConfig[g][key] = saved[g][key];
              }
            }
          }
        }
        // Preserve colors from saved profile if present
        if (saved.colors) liveConfig.colors = deepClone(saved.colors);

        // Restore shader type
        if (saved.shaderType) {
          liveConfig.shaderType = saved.shaderType;
          if (bEl.shaderSelect) bEl.shaderSelect.value = saved.shaderType;
          document.body.dataset.activeShader = saved.shaderType;

          // Crossfade preview engine to the loaded shader type
          if (saved.shaderType !== previewState.shaderTo) {
            previewState.shaderFrom = previewState.shaderTo;
            previewState.shaderTo = saved.shaderType;
            previewState.crossfadeFactor = 0.0;
          }
        }

        syncControls();
        rebuildPreview();

        // Force transition
        if (window.transitionShader && saved.shaderType) {
          window.transitionShader(saved.shaderType);
        }

        showProfileMsg(`Loaded "${profiles[idx].name}".`, "success");
        Trace.log("PROFILE_LOADED", { name: profiles[idx].name });
      } else if (action === "rename") {
        const item = btn.closest(".profile-item");
        const nameSpan = item?.querySelector(".profile-name");
        if (!nameSpan) return;

        // Replace name with inline input
        const currentName = profiles[idx].name;
        const inp = document.createElement("input");
        inp.type = "text";
        inp.className = "profile-rename-input";
        inp.value = currentName;
        inp.maxLength = 50;
        nameSpan.replaceWith(inp);
        inp.focus();
        inp.select();

        // Swap Rename button to Confirm
        btn.textContent = "OK";
        btn.dataset.action = "confirm-rename";

        const commit = () => {
          const newName = (inp.value || "").trim() || currentName;
          profiles[idx].name = newName;
          saveProfiles(profiles);
          renderProfiles();
          showProfileMsg(`Renamed to "${newName}".`, "success");
          Trace.log("PROFILE_RENAMED", { oldName: currentName, newName });
        };

        inp.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            commit();
          }
          if (ev.key === "Escape") {
            renderProfiles();
          }
        });
        inp.addEventListener("blur", () => {
          // Slight delay so click on OK still fires
          setTimeout(() => {
            if (document.querySelector(".profile-rename-input")) commit();
          }, 150);
        });
      } else if (action === "confirm-rename") {
        const item = btn.closest(".profile-item");
        const inp = item?.querySelector(".profile-rename-input");
        const newName = (inp?.value || "").trim() || profiles[idx].name;
        profiles[idx].name = newName;
        saveProfiles(profiles);
        renderProfiles();
        showProfileMsg(`Renamed to "${newName}".`, "success");
      } else if (action === "delete") {
        const name = profiles[idx].name;
        if (!confirm(`Delete profile "${name}"?`)) return;
        profiles.splice(idx, 1);
        saveProfiles(profiles);
        renderProfiles();
        showProfileMsg(`Deleted "${name}".`, "success");
        Trace.log("PROFILE_DELETED", { name });
      }
    });
  }

  /* ── Render profiles on load ── */
  renderProfiles();

  /* ── Lazy-init on section open ── */
  let bannerInited = false;
  if (bEl.section) {
    bEl.section.addEventListener("toggle", async () => {
      // 1. Handle Closing
      if (!bEl.section.open) {
        stopPreview();
        return;
      }

      // 2. Handle First-Time Initialization
      if (!bannerInited && ctx.db && ctx.adminCode) {
        // Wrap await in try/catch so preview initializes even if network fails
        try {
          await loadBannerConfig();
        } catch (err) {
          console.warn("Config load failed, using defaults", err);
        }

        syncControls();

        // Only set bannerInited to true if the GL context was actually created
        if (initPreview()) {
          bannerInited = true;
          startPreview();
        }
      }
      // 3. Handle Re-opening (Resume)
      // Check for ribbonProg to ensure we have a valid shader program, not just a GL context
      else if (previewState.gl && previewState.ribbonProg) {
        startPreview();
      }

      // 4. Force a resize calculation after a brief delay.
      // The <details> element often reports 0 clientWidth immediately upon opening.
      setTimeout(() => {
        resizePreviewCanvas();
      }, 50);
    });
  }

  /* ── Resize listener ── */
  window.addEventListener("resize", () => {
    if (previewState.running) resizePreviewCanvas();
  });

  /* ── Pointer hover slowdown on preview canvas ── */
  if (bEl.wrapper) {
    bEl.wrapper.addEventListener("pointerenter", () => {
      previewState.targetSpeed = liveConfig.interaction.hoverSlowdown;
    });
    bEl.wrapper.addEventListener("pointerleave", () => {
      previewState.targetSpeed = 1.0;
    });
  }

  Trace.log("BANNER_PARAMS_READY");
  Trace.groupEnd();
}
