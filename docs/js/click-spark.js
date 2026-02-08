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
      position: absolute;
      top: 0;
      left: 0;
      pointer-events: none;
      z-index: 9999;
    `;
    
    container.style.position = 'relative';
    container.appendChild(this.canvas);
    
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
    
    const parent = this.canvas.parentElement;
    if (!parent) return;
    
    const rect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    // Set display size (CSS)
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    
    // Set actual canvas size (accounting for device pixel ratio)
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    
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
    
    // Handle clicks
    container.addEventListener('click', (e) => this.handleClick(e));
    
    // Store cleanup function
    this.cleanup = () => {
      window.removeEventListener('resize', handleResize);
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
    
    const rect = this.canvas.getBoundingClientRect();
    // Get coordinates relative to the displayed canvas size (not internal resolution)
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const now = performance.now();
    const newSparks = Array.from({ length: this.sparkCount }, (_, i) => ({
      x,
      y,
      angle: (2 * Math.PI * i) / this.sparkCount,
      startTime: now
    }));
    
    this.sparks.push(...newSparks);
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
    
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, rect.width, rect.height);
    
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
    const animate = (timestamp) => {
      this.draw(timestamp);
      this.animationId = requestAnimationFrame(animate);
    };
    
    this.animationId = requestAnimationFrame(animate);
  }
  
  destroy() {
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
