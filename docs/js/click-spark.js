// =============================================================================
// CLICK SPARK EFFECT
// =============================================================================
class ClickSpark {
  constructor(options = {}) {
    this.sparkColor = options.sparkColor || '#fff';
    this.sparkSize = options.sparkSize || 10;
    this.sparkRadius = options.sparkRadius || 15;
    this.sparkCount = options.sparkCount || 8;
    this.duration = options.duration || 400;
    this.easing = options.easing || 'ease-out';
    this.extraScale = options.extraScale || 1.0;
    
    this.canvas = null;
    this.ctx = null;
    this.sparks = [];
    this.animationId = null;
    this.resizeTimeout = null;
  }
  
  init(container) {
    if (!container) return;
    
    // Create canvas element
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = `
      width: 100%;
      height: 100%;
      display: block;
      user-select: none;
      position: fixed;
      top: 0;
      left: 0;
      pointer-events: none;
      z-index: 999999;
      isolation: isolate;
    `;
    
    // Append to body to avoid stacking context issues
    document.body.appendChild(this.canvas);
    
    this.ctx = this.canvas.getContext('2d');
    
    // Set up canvas size
    this.resizeCanvas();
    
    // Set up event listeners
    this.setupEventListeners(container);
    
    // Start animation loop
    this.startAnimation();
  }
  
  resizeCanvas() {
    if (!this.canvas) return;
    
    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    // Set display size (CSS)
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
    
    // Set actual canvas size (accounting for device pixel ratio)
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    
    // Scale context to match device pixel ratio
    if (this.ctx) {
      this.ctx.scale(dpr, dpr);
    }
  }
  
  setupEventListeners(container) {
    // Handle window resize
    const handleResize = () => {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = setTimeout(() => this.resizeCanvas(), 100);
    };
    
    window.addEventListener('resize', handleResize);
    
    // Handle clicks on document
    document.addEventListener('click', (e) => this.handleClick(e), true);
    
    // Store cleanup function
    this.cleanup = () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('click', (e) => this.handleClick(e), true);
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
      }
      if (this.canvas && this.canvas.parentElement) {
        this.canvas.parentElement.removeChild(this.canvas);
      }
    };
  }
  
  handleClick(e) {
    if (!this.canvas) return;
    
    // Get coordinates relative to viewport (fixed positioning)
    const x = e.clientX;
    const y = e.clientY;
    
    const now = performance.now();
    const newSparks = Array.from({ length: this.sparkCount }, (_, i) => ({
      x,
      y,
      angle: (2 * Math.PI * i) / this.sparkCount,
      startTime: now
    }));
    
    this.sparks.push(...newSparks);

    // Restart animation loop if it was idle (no sparks before this click)
    if (!this.animationId && !this._paused) {
      this.animationId = requestAnimationFrame((ts) => this._animateLoop(ts));
    }
  }
  
  easeFunc(t) {
    switch (this.easing) {
      case 'linear':
        return t;
      case 'ease-in':
        return t * t;
      case 'ease-in-out':
        return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      default: // ease-out
        return t * (2 - t);
    }
  }
  
  draw(timestamp) {
    if (!this.ctx || !this.canvas) return;
    
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.ctx.clearRect(0, 0, width, height);
    
    this.sparks = this.sparks.filter(spark => {
      const elapsed = timestamp - spark.startTime;
      if (elapsed >= this.duration) {
        return false;
      }
      
      const progress = elapsed / this.duration;
      const eased = this.easeFunc(progress);
      
      const distance = eased * this.sparkRadius * this.extraScale;
      const lineLength = this.sparkSize * (1 - eased);
      
      const x1 = spark.x + distance * Math.cos(spark.angle);
      const y1 = spark.y + distance * Math.sin(spark.angle);
      const x2 = spark.x + (distance + lineLength) * Math.cos(spark.angle);
      const y2 = spark.y + (distance + lineLength) * Math.sin(spark.angle);
      
      this.ctx.strokeStyle = this.sparkColor;
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(x1, y1);
      this.ctx.lineTo(x2, y2);
      this.ctx.stroke();
      
      return true;
    });
  }
  
  startAnimation() {
    this._paused = false;

    // Shared loop reference so handleClick can restart it
    this._animateLoop = (timestamp) => {
      if (this._paused) { this.animationId = null; return; }
      this.draw(timestamp);
      // Go idle when all sparks have expired — saves CPU between clicks
      if (this.sparks.length === 0) { this.animationId = null; return; }
      this.animationId = requestAnimationFrame(this._animateLoop);
    };

    // Pause / resume with Page Visibility API
    this._onVisChange = () => {
      if (document.hidden) {
        this._paused = true;
        if (this.animationId) { cancelAnimationFrame(this.animationId); this.animationId = null; }
      } else {
        this._paused = false;
        if (!this.animationId && this.sparks.length > 0) {
          this.animationId = requestAnimationFrame(this._animateLoop);
        }
      }
    };
    document.addEventListener('visibilitychange', this._onVisChange);
    
    // Don't start the loop until the first click (idle by default)
    this.animationId = null;
  }
  
  destroy() {
    if (this._onVisChange) {
      document.removeEventListener('visibilitychange', this._onVisChange);
    }
    if (this.cleanup) {
      this.cleanup();
    }
  }
}

// =============================================================================
// CLICK SPARK MANAGER
// =============================================================================
const ClickSparkManager = {
  instances: [],
  
  init() {
    // Add spark effect to the entire body only
    const bodySparkConfig = {
      sparkColor: '#89e6e3',
      sparkSize: 12,
      sparkRadius: 20,
      sparkCount: 8,
      duration: 500,
      easing: 'ease-out',
      extraScale: 1.2
    };
    
    const bodySpark = new ClickSpark(bodySparkConfig);
    bodySpark.init(document.body);
    this.instances.push(bodySpark);
    
    console.log('✨ Click Spark Effects Initialized');
  },
  
  destroy() {
    this.instances.forEach(instance => instance.destroy());
    this.instances = [];
  }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => ClickSparkManager.init());
} else {
  ClickSparkManager.init();
}
