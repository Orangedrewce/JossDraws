// WebGL Shader for Header Background
(function() {
  const canvas = document.getElementById('shaderCanvas');
  if (!canvas) return;
  
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (!gl) {
    console.error('WebGL not supported on this browser.');
    return;
  }

  // Vertex shader
  const vertexShaderSource = `
    attribute vec2 a_position;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  // Fragment shader 
  const fragmentShaderSource = `
    precision mediump float;
    #extension GL_OES_standard_derivatives : enable
    uniform vec2 iResolution;
    uniform float iTime;
    
    #define R iResolution
    #define T iTime
    #define BASE_THICKNESS 0.10
    
    // Brand colors
    vec3 home      = vec3(0.004, 0.569, 0.663);
    vec3 gallery   = vec3(0.482, 0.804, 0.796);
    vec3 about     = vec3(0.988, 0.855, 0.024);
    vec3 shop      = vec3(0.973, 0.561, 0.173);
    vec3 contact   = vec3(0.937, 0.341, 0.553);
    
    vec3 getColor(int i){
        if(i==0)return home;
        if(i==1)return gallery;
        if(i==2)return about;
        if(i==3)return shop;
        if(i==4)return contact;
        return vec3(1.0);
    }
    
    mat2 rot(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);}
    
  void main() {
    vec2 fragCoord = gl_FragCoord.xy;
    vec2 uv = (fragCoord - 0.5 * R.xy) / R.y;
    vec3 col = vec3(1.0); // white background

    // --- Base wavy motion ---
    float yWave = sin(uv.x*3.0 + T*1.0)*0.25 
          + sin(uv.x*1.1 - T*0.8)*0.1;
    float xOffset = sin(T*0.7 + uv.y*2.0)*0.25;
    float stretch = 0.8 + 0.4*sin(T*1.3 + uv.x*2.5);
    float bandThickness = BASE_THICKNESS * stretch;
    float offset = (uv.y - yWave) + xOffset * 0.3;

    // --- 180° twist logic ---
    float twistPeriod = 6.0;                   // seconds between twists
    float tPhase = floor(T / twistPeriod);     // which interval we're in
    float localT = fract(T / twistPeriod);     // progress in this interval
    float twistAngle = smoothstep(0.0, 0.9, localT) * 3.14159; // 0→π over half interval

    // pseudo-random direction (+ or -)
    float randDir = sign(sin(tPhase * 12.345)); 
    twistAngle *= randDir;

    // apply the twist as rotation of the UV frame
    uv *= rot(twistAngle * 0.5);

    // --- Color band mapping with AA and no white seams ---
    // Placement of the band in the header
    float s = (offset + 0.205) / bandThickness;   

    // Screen-space AA width using derivatives (fallback constant if unavailable)
    #ifdef GL_OES_standard_derivatives
      float aaw = max(fwidth(s) * 0.5, 0.001); // Sharper anti-aliasing
    #else
      float aaw = 0.001; // conservative fallback
    #endif

    float xi = floor(s);
    float xf = s - xi; // local position within current band [0,1)

    //number is stroke width lower number is blended
    int iCenter = int(xi);
    int iLeft   = iCenter - 1;
    int iRight  = iCenter + 1;

  // Valid band indices are [0..4] (use float clamp for WebGL1 compatibility)
  int cCenter = int(clamp(float(iCenter), 0.0, 4.0));
  int cLeft   = int(clamp(float(iLeft),   0.0, 4.0));
  int cRight  = int(clamp(float(iRight),  0.0, 4.0));
  vec3 c0 = getColor(cCenter);
  vec3 cL = getColor(cLeft);
  vec3 cR = getColor(cRight);

    // Three-way blend across the band with antialiased edges
    float wL = 1.0 - smoothstep(0.0, aaw, xf);
    float wR = smoothstep(1.0 - aaw, 1.0, xf);
    float w0 = 1.0 - wL - wR;
    vec3 bandCol = c0*w0 + cL*wL + cR*wR;

    // --- Plastic Surface Shading ---
    // We model the ribbon as a cylinder. The lighting will be based on the angle
    // to a simulated light source.
    // 'centerFactor' is 1 at the center of the ribbon and 0 at the edges.
    float dEdge = min(xf, 1.0 - xf);
    //opacity color 
    float centerFactor = smoothstep(0.0, 10.0, dEdge);

    
    // 1.125 is the brightness level of the colors.
    vec3 shaded = bandCol * mix(1.125, 1.0, centerFactor);

    // Specular highlight for a "glossy" look.
    // This creates a sharp, bright reflection near the center.
    float specularPower = 50.0; // Higher value = sharper highlight
    float highlight = pow(centerFactor, specularPower);
    shaded = mix(shaded, vec3(1.0), highlight * 0.75); // Mix with white for the highlight

    // Subtle drop shadow for depth.
    float edgeShadow = 1.0 - smoothstep(0.0, max(aaw*2.0, 0.002), xf);
    shaded *= 1.0 - edgeShadow * 0.1;

    // Only show bands in the intended range [0,5); AA the outermost boundary
    float inRangeAA = smoothstep(-aaw, 0.0, s) * (1.0 - smoothstep(5.0, 5.0 + aaw, s));
    col = mix(vec3(1.0), shaded, inRangeAA);

    gl_FragColor = vec4(col, 1.0);
  }
  `;

  // Compile shader
  function compileShader(source, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  // Enable standard derivatives for better AA in fragment shader (if available)
  gl.getExtension('OES_standard_derivatives');

  // Create program
  const vertexShader = compileShader(vertexShaderSource, gl.VERTEX_SHADER);
  const fragmentShader = compileShader(fragmentShaderSource, gl.FRAGMENT_SHADER);
  
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    return;
  }
  
  gl.useProgram(program);

  // Set up geometry (full-screen quad)
  const positions = new Float32Array([
    -1, -1,
     1, -1,
    -1,  1,
     1,  1
  ]);
  
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  
  const positionLocation = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  // --- Supersampling setup ---
  // Use 2x SSAA on desktop, skip on mobile/low-power to save GPU
  const isMobile = window.innerWidth <= 768 || (window.devicePixelRatio || 1) >= 2.5;
  const supersampleFactor = isMobile ? 1.0 : 2.0;
  let fb, fbTexture;

  // Create a framebuffer to render to
  function setupFramebuffer() {
    // If it exists, clean up old versions
    if (fb) gl.deleteFramebuffer(fb);
    if (fbTexture) gl.deleteTexture(fbTexture);

    fbTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, fbTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 
                  canvas.width * supersampleFactor, canvas.height * supersampleFactor, 
                  0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fbTexture, 0);

    // Unbind
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // --- Second shader for downsampling ---
  const downsampleVertexShaderSource = `
    attribute vec2 a_position;
    varying vec2 v_texCoord;
    void main() {
      v_texCoord = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;
  const downsampleFragmentShaderSource = `
    precision mediump float;
    varying vec2 v_texCoord;
    uniform sampler2D u_texture;
    uniform vec2 u_texelSize; // size of one texel in the supersampled texture

    const float GAMMA = 2.2;

    vec3 to_linear(vec3 v) {
      return pow(v, vec3(GAMMA));
    }

    vec3 to_gamma(vec3 v) {
      return pow(v, vec3(1.0/GAMMA));
    }

    void main() {
      // 2x2 box filter for 2x SSAA
      // Sample the four texels that correspond to the 2x2 pixel block
      // in the high-resolution texture.
      vec2 offset = u_texelSize * 0.5;
      vec3 s1 = to_linear(texture2D(u_texture, v_texCoord - offset).rgb);
      vec3 s2 = to_linear(texture2D(u_texture, v_texCoord + vec2(offset.x, -offset.y)).rgb);
      vec3 s3 = to_linear(texture2D(u_texture, v_texCoord + vec2(-offset.x, offset.y)).rgb);
      vec3 s4 = to_linear(texture2D(u_texture, v_texCoord + offset).rgb);
      
      vec3 averaged = (s1 + s2 + s3 + s4) / 4.0;
      
      gl_FragColor = vec4(to_gamma(averaged), 1.0);
    }
  `;

  const downsampleProgram = gl.createProgram();
  const dsVertexShader = compileShader(downsampleVertexShaderSource, gl.VERTEX_SHADER);
  const dsFragmentShader = compileShader(downsampleFragmentShaderSource, gl.FRAGMENT_SHADER);
  gl.attachShader(downsampleProgram, dsVertexShader);
  gl.attachShader(downsampleProgram, dsFragmentShader);
  gl.linkProgram(downsampleProgram);
  const dsPositionLocation = gl.getAttribLocation(downsampleProgram, 'a_position');
  const dsTextureLocation = gl.getUniformLocation(downsampleProgram, 'u_texture');
  const dsTexelSizeLocation = gl.getUniformLocation(downsampleProgram, 'u_texelSize');

  // Get uniform locations
  const resolutionLocation = gl.getUniformLocation(program, 'iResolution');
  const timeLocation = gl.getUniformLocation(program, 'iTime');

  // --- Interactive speed control (hover to slow down) ---
  // We'll accumulate our own shader time (animTime) using a smoothed speed factor.
  let animTime = 0.0;                 // time fed to the shader
  let lastRealTime = performance.now() * 0.001; // seconds
  let currentSpeed = 1.0;             // smoothed speed factor actually used each frame
  let targetSpeed = 1.0;              // 1.0 = normal, 0.2 = slowed
  const SPEED_SMOOTH_TAU = 0.25;      // seconds to ease between speeds (~250ms)

  // Listen for hover on the header (canvas has pointer-events: none in CSS)
  const hoverEl = document.querySelector('header');
  if (hoverEl) {
    // Use pointerenter/leave for broader device support, fall back to mouse events
    const onEnter = () => { targetSpeed = 0.2; };
    const onLeave = () => { targetSpeed = 1.0; };
    hoverEl.addEventListener('pointerenter', onEnter);
    hoverEl.addEventListener('pointerleave', onLeave);
    hoverEl.addEventListener('mouseenter', onEnter);
    hoverEl.addEventListener('mouseleave', onLeave);
  }

  // Resize canvas to match display size
  function resize() {
    const displayWidth = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;
    
    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
      // When canvas resizes, our framebuffer needs to be recreated
      setupFramebuffer();
    }
  }

  // --- Page Visibility: pause when tab/app is hidden ---
  let paused = false;
  let rafId = null;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      paused = true;
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    } else {
      paused = false;
      lastRealTime = performance.now() * 0.001; // reset clock to avoid time-jump
      if (!rafId) { rafId = requestAnimationFrame(render); }
    }
  });

  // Animation loop
  let firstFrameShown = false;
  function render() {
    if (paused) { rafId = null; return; }
    resize();
    // Real elapsed time since last frame
    const now = performance.now() * 0.001; // seconds
    let dt = now - lastRealTime;
    lastRealTime = now;
    // Clamp dt to avoid spikes when the tab regains focus
    dt = Math.max(0.0, Math.min(dt, 0.05));

    // Smoothly ease currentSpeed toward targetSpeed with a time-constant
    const blend = 1.0 - Math.exp(-dt / SPEED_SMOOTH_TAU);
    currentSpeed += (targetSpeed - currentSpeed) * blend;

    // Advance the shader time with the (smoothed) speed factor
    animTime += dt * currentSpeed;

    // --- PASS 1: Render high-resolution shader to framebuffer ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.useProgram(program);
    gl.viewport(0, 0, canvas.width * supersampleFactor, canvas.height * supersampleFactor);
    
    gl.uniform2f(resolutionLocation, canvas.width * supersampleFactor, canvas.height * supersampleFactor);
    gl.uniform1f(timeLocation, animTime);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(positionLocation);
    
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // --- PASS 2: Downsample to canvas ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(downsampleProgram);
    gl.viewport(0, 0, canvas.width, canvas.height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fbTexture);
    gl.uniform1i(dsTextureLocation, 0);
    gl.uniform2f(dsTexelSizeLocation, 1.0 / (canvas.width * supersampleFactor), 1.0 / (canvas.height * supersampleFactor));

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.vertexAttribPointer(dsPositionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(dsPositionLocation);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Reveal canvas after the first complete frame to avoid flash/artifacts on load
    if (!firstFrameShown) {
      firstFrameShown = true;
      // Use a class so CSS can animate the fade-in
      canvas.classList.add('is-ready');
    }
    
    rafId = requestAnimationFrame(render);
  }
  
  // Initial setup
  setupFramebuffer();
  rafId = requestAnimationFrame(render);
})();