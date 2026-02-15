// ============================================
// BANNER SHADER BUILDERS MODULE
// ============================================
// Pure functions that generate GLSL fragment shader source strings.
// No DOM, no state — just config → GLSL text.
// ============================================

/* ── GLSL float formatter ── */
function fmtF(num) {
  const n = Math.round(num * 1e6) / 1e6;
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}
function fmtVec3(c) {
  return `vec3(${fmtF(c.r)}, ${fmtF(c.g)}, ${fmtF(c.b)})`;
}

/* ── Paint Drip Fragment Shader ── */
export function buildDripShader(cfg) {
  return `
  precision highp float;

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

  vec3 c0 = ${fmtVec3(cfg.colors.c0)};
  vec3 c1 = ${fmtVec3(cfg.colors.c1)};
  vec3 c2 = ${fmtVec3(cfg.colors.c2)};
  vec3 c3 = ${fmtVec3(cfg.colors.c3)};
  vec3 c4 = ${fmtVec3(cfg.colors.c4)};
  vec3 bg = ${fmtVec3(cfg.colors.background)};

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

      float safeFreq = max(u_bFreq, 0.001);
      float cycleDivisor = max(1.0, floor((LOOP_SECONDS / safeFreq) + 0.5));
      float lockedFreq = LOOP_SECONDS / cycleDivisor;

      float s = safeSdfWidth * abs((1.0 - uv.y) - 0.75) + 0.05;
      float o = 1.0;
      float dripDist = 999.0;

      float loopTime = iTime * LOOP_SECONDS;
      float fallSpeedRange = u_fallSpeed * u_bRange;
      float invS = 1.0 / max(s, 0.000001); 
      float densityThreshold = 1.0 - u_density; 

      float x = uv.x - safeSdfWidth;
      x += safeDripDist - mod(x, safeDripDist);
      x -= safeDripDist;

      for(int i = 0; i < 150; i++) {
          if (x > uv.x + safeSdfWidth) break;
          
          x += safeDripDist;
          
          float isLine = step(densityThreshold, rand(x, seed));
          
          if (isLine > 0.0) {
              float y = rand(seed, x) * 0.8 + 0.1;
              
              float animTime = loopTime + (y * 10.0);
              float tMod = mod(animTime, lockedFreq);
              
              float a = bCurve * tMod;
              float bounce = -a * exp(1.0 - a);
              
              y += bounce * u_bRange;
              y = min(y, uv.y);

              float f = y + tMod * fallSpeedRange;

              float d1 = distance(vec2(x, y), uv);
              o *= clamp(d1 * invS, 0.0, 1.0);
              
              float currentDripD = distance(vec2(x, f), uv);
              dripDist = smin(dripDist, currentDripD, k);
          }
      }

      o = smin(o, clamp(dripDist * invS, 0.0, 1.0), k);

      float ceilS = sin(uv.x * 20.0 + (iTime * TAU)) * 0.3 + 0.4;
      
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
}

/* ── Gooey Drip Fragment Shader ── */
export function buildGooeyShader(cfg) {
  const g = cfg.gooey || {
    animSpeed: 2.0,
    paintLength: 15.0,
    loopSize: 24.0,
  };
  return `
  precision highp float;

  uniform vec2 u_resolution;
  uniform float u_time;

  const float ANIM_SPEED  = ${g.animSpeed.toFixed(4)};
  const float PAINT_LENGTH = ${g.paintLength.toFixed(4)};
  const float LOOP_SIZE    = ${g.loopSize.toFixed(4)};

  vec3 c0 = ${fmtVec3(cfg.colors.c0)};
  vec3 c1 = ${fmtVec3(cfg.colors.c1)};
  vec3 c2 = ${fmtVec3(cfg.colors.c2)};
  vec3 c3 = ${fmtVec3(cfg.colors.c3)};
  vec3 c4 = ${fmtVec3(cfg.colors.c4)};
  vec3 bg = ${fmtVec3(cfg.colors.background)};

  float DE( vec2 pp, float t )
  {
      pp.y += (
          0.4 * sin(0.5 * 2.3 * pp.x + pp.y) +
          0.2 * sin(0.5 * 5.5 * pp.x + pp.y) +
          0.1 * sin(0.5 * 13.7 * pp.x) +
          0.06 * sin(0.5 * 23.0 * pp.x)
      );

      float halfLoop = LOOP_SIZE * 0.5;
      float localY = mod(pp.y + ANIM_SPEED * t + halfLoop, LOOP_SIZE) - halfLoop;

      float paintRadius = PAINT_LENGTH * 0.5;
      return paintRadius - abs(localY);
  }

  float getSurfaceHeight(vec2 pp, float t) {
      float sd = DE(pp, t);
      float h = clamp(smoothstep(0.0, 0.25, max(sd, 0.0)), 0.0, 1.0);
      return 4.0 * pow(h, 0.2);
  }

  vec3 getMultiColor(float x) {
      float viewWidth = 8.0 * (u_resolution.x / u_resolution.y);
      float spread = clamp(x / viewWidth, 0.0, 1.0);
      float v = spread * 4.0;
      if (v < 1.0) return mix(c0, c1, v);
      if (v < 2.0) return mix(c1, c2, v - 1.0);
      if (v < 3.0) return mix(c2, c3, v - 2.0);
      return mix(c3, c4, clamp(v - 3.0, 0.0, 1.0));
  }

  vec3 sceneColour( in vec2 pp, float pxSize )
  {
      float t = u_time;
      float sd = DE(pp, t);
      float alpha = smoothstep(-pxSize, pxSize, sd);

      if(alpha <= 0.0) return bg;

      vec2 e = vec2(0.02, 0.0);
      float h = getSurfaceHeight(pp, t);
      float hx = getSurfaceHeight(pp + e.xy, t);
      float hy = getSurfaceHeight(pp + e.yx, t);

      vec3 N = normalize(vec3(-(hx - h) / e.x, 1.0, -(hy - h) / e.x));
      vec3 L = normalize(vec3(0.5, 0.7, -0.5));

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
}

/* ── Ribbon Wave Fragment Shader ── */
export function buildRibbonShader(cfg) {
  const bandMax = cfg.positioning.bandCount - 1;
  const maxWaveAbs =
    cfg.wave.mainAmplitude +
    cfg.wave.secondaryAmp +
    cfg.wave.horizontalAmount * Math.abs(cfg.wave.offsetBlend);
  const maxRibbonHalfHeight =
    maxWaveAbs +
    cfg.thickness.base *
      cfg.thickness.stretchMax *
      cfg.positioning.bandCount +
    cfg.appearance.aaFallback;

  const twistEnabled = cfg.twist.enabled;
  const hasDerivatives = true;

  const speedMain = Math.round(cfg.wave.mainSpeed);
  const speedSec = Math.round(cfg.wave.secondarySpeed);
  const speedHoriz = Math.round(cfg.wave.horizontalSpeed);
  const speedStretch = Math.round(cfg.thickness.stretchSpeed);
  const speedTwist = Math.round(cfg.twist.intensity);

  return `
precision highp float;
#extension GL_OES_standard_derivatives : enable

uniform vec2 iResolution;
uniform float iTime;

#define R iResolution
#define T iTime
#define BASE_THICKNESS ${fmtF(cfg.thickness.base)}

vec3 c0 = ${fmtVec3(cfg.colors.c0)};
vec3 c1 = ${fmtVec3(cfg.colors.c1)};
vec3 c2 = ${fmtVec3(cfg.colors.c2)};
vec3 c3 = ${fmtVec3(cfg.colors.c3)};
vec3 c4 = ${fmtVec3(cfg.colors.c4)};
vec3 bg = ${fmtVec3(cfg.colors.background)};

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

  #define TAU 6.28318530718
  float t = T * TAU;

  ${
    twistEnabled
      ? ""
      : `
  float halfH = ${fmtF(maxRibbonHalfHeight)} * R.y / min(R.x, R.y);
  float ribbonMinY = ${fmtF(cfg.positioning.verticalOffset)} - halfH;
  float ribbonMaxY = ${fmtF(cfg.positioning.verticalOffset)} + halfH;
  if (uv.y < ribbonMinY || uv.y > ribbonMaxY) {
    gl_FragColor = vec4(bg, 1.0);
    return;
  }
  `
  }

  ${
    twistEnabled
      ? `
    uv *= rot(t * ${fmtF(speedTwist)});
  `
      : ""
  }

  float yWave = sin(uv.x * ${fmtF(cfg.wave.mainFrequency)} + t * ${fmtF(speedMain)}) * ${fmtF(cfg.wave.mainAmplitude)}
              + sin(uv.x * ${fmtF(cfg.wave.secondaryFreq)} - t * ${fmtF(speedSec)}) * ${fmtF(cfg.wave.secondaryAmp)};

  float xOffset = sin(t * ${fmtF(speedHoriz)} + uv.y * ${fmtF(cfg.wave.horizontalFrequency)}) * ${fmtF(cfg.wave.horizontalAmount)};

  float stretch = mix(
    ${fmtF(cfg.thickness.stretchMin)},
    ${fmtF(cfg.thickness.stretchMax)},
    0.5 + 0.5 * sin(t * ${fmtF(speedStretch)} + uv.x * ${fmtF(cfg.thickness.stretchFrequency)})
  );

  float bandThickness = BASE_THICKNESS * stretch;
  float offset = (uv.y - yWave) + xOffset * ${fmtF(cfg.wave.offsetBlend)};

  float s = clamp((offset + ${fmtF(cfg.positioning.verticalOffset)}) / bandThickness, -100.0, 100.0);

  ${
    hasDerivatives
      ? `
  float aaw = clamp(fwidth(s) * ${fmtF(cfg.appearance.aaSharpness)}, ${fmtF(cfg.appearance.aaFallback)}, 0.35);
  `
      : `
  float aaw = ${fmtF(cfg.appearance.aaFallback)};
  `
  }

  float xi = floor(s);
  float xf = s - xi;

  int iCenter = int(xi);
  int cCenter = int(clamp(float(iCenter), 0.0, ${fmtF(bandMax)}));
  vec3 bandCol;

  if (xf > aaw && xf < (1.0 - aaw)) {
    bandCol = getColor(cCenter);
  } else {
    int cLeft   = int(clamp(float(iCenter - 1), 0.0, ${fmtF(bandMax)}));
    int cRight  = int(clamp(float(iCenter + 1), 0.0, ${fmtF(bandMax)}));

    vec3 colC = getColor(cCenter);
    vec3 colL = getColor(cLeft);
    vec3 colR = getColor(cRight);

    float wL = 1.0 - smoothstep(0.0, aaw, xf);
    float wR = smoothstep(1.0 - aaw, 1.0, xf);
    float w0 = 1.0 - wL - wR;
    bandCol = colC*w0 + colL*wL + colR*wR;
  }

  vec3 shaded = bandCol;

  ${
    cfg.appearance.plasticEffect
      ? `
    float dEdge = min(xf, 1.0 - xf);
    float centerFactor = smoothstep(0.0, ${fmtF(cfg.appearance.centerSoftness)}, dEdge);
    shaded = bandCol * mix(${fmtF(cfg.appearance.brightness)}, 1.0, centerFactor);
    float highlight = pow(centerFactor, ${fmtF(cfg.appearance.specularPower)});
    shaded = mix(shaded, vec3(1.0), highlight * ${fmtF(cfg.appearance.specularIntensity)});
    float edgeShadow = 1.0 - smoothstep(0.0, max(aaw * ${fmtF(cfg.appearance.shadowWidth)}, 0.002), xf);
    shaded *= 1.0 - edgeShadow * ${fmtF(cfg.appearance.shadowStrength)};
  `
      : `
    shaded = bandCol * ${fmtF(cfg.appearance.brightness)};
  `
  }

  float inRangeAA = smoothstep(-aaw, 0.0, s) * (1.0 - smoothstep(${fmtF(cfg.positioning.bandCount)}, ${fmtF(cfg.positioning.bandCount)} + aaw, s));
  col = mix(bg, shaded, inRangeAA);

  gl_FragColor = vec4(col, 1.0);
}
`;
}
