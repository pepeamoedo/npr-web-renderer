/**
 * MangaSketch Entry Point & Main Application State
 * Coordinates DOM binding, real-time uniform syncing,
 * FPS counter math, window resizing, and the WebGPU render loop.
 */

import { NPRRenderer } from './renderer.js';

window.addEventListener('DOMContentLoaded', async () => {
  const canvas = document.getElementById('webgpu-canvas');
  const controlPanel = document.getElementById('control-panel');
  const toggleHudBtn = document.getElementById('toggle-hud-btn');
  const restoreHudBtn = document.getElementById('restore-hud-btn');
  
  // Performance counters
  const fpsCounter = document.getElementById('fps-counter');
  const frameTimeVal = document.getElementById('frame-time');
  const gpuInfo = document.getElementById('gpu-info');

  let renderer = null;

  try {
    // 1. INITIALIZE WEB COUNTERPARTS AND RENDERER
    renderer = new NPRRenderer(canvas);
    const limits = await renderer.init();
    

    
    // Display actual GPU Adapter Name
    if (navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      const info = await adapter?.requestAdapterInfo?.() || {};
      const gpuName = info.description || info.device || 'Tarjeta Gráfica Genérica';
      gpuInfo.textContent = gpuName;
    }

  } catch (err) {
    console.warn('WebGPU Init Warning:', err);
    // Keep controls active but update status for manual sandbox tests
    gpuInfo.textContent = 'Modo Pruebas (Sin GPU)';
    fpsCounter.textContent = 'TESTING';
    frameTimeVal.textContent = 'N/A';
  }

  // -------------------------------------------------------------
  // 2. DOM INTERACTION & SYNC LISTENERS
  // -------------------------------------------------------------

  // Custom mapping function for slider values and badges
  const controls = [
    { id: 'rotation-speed', key: 'rotationSpeed', badgeId: 'rotation-val', suffix: 'x' },
    { id: 'light-yaw', key: 'lightYaw', badgeId: 'light-yaw-val', suffix: '°' },
    { id: 'light-pitch', key: 'lightPitch', badgeId: 'light-pitch-val', suffix: '°' },
    { id: 'backlight-intensity', key: 'backlightIntensity', badgeId: 'backlight-val', step: 2 },
    { id: 'edge-depth', key: 'edgeDepthSensitivity', badgeId: 'edge-depth-val', step: 2 },
    { id: 'edge-color', key: 'edgeColorSensitivity', badgeId: 'edge-color-val', step: 2 },
    { id: 'edge-thickness', key: 'edgeThickness', badgeId: 'edge-thickness-val', suffix: 'px' },
    { id: 'cel-bands', key: 'celBandsCount', badgeId: 'cel-bands-val' },
    { id: 'cel-smoothing', key: 'celSmoothing', badgeId: 'cel-smoothing-val', step: 2 },
    { id: 'hatch-freq', key: 'hatchFrequency', badgeId: 'hatch-freq-val' },
    { id: 'hatch-weight', key: 'hatchWeight', badgeId: 'hatch-weight-val', step: 2 },
    { id: 'shadow-threshold', key: 'shadowThreshold', badgeId: 'shadow-threshold-val', step: 2 }
  ];

  // Sync each interactive slider
  controls.forEach(control => {
    const el = document.getElementById(control.id);
    const badge = document.getElementById(control.badgeId);
    
    if (el && badge) {
      el.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        renderer.settings[control.key] = val;
        
        // Update visual badge text
        let displayVal = val;
        if (control.step === 2) displayVal = val.toFixed(2);
        badge.textContent = `${displayVal}${control.suffix || ''}`;
      });
    }
  });

  // Sync checkboxes
  const hatchCheckbox = document.getElementById('hatching-enabled');
  const crossCheckbox = document.getElementById('crosshatch-enabled');
  const hatchControls = document.getElementById('hatching-controls');

  if (hatchCheckbox) {
    hatchCheckbox.addEventListener('change', (e) => {
      const active = e.target.checked;
      renderer.settings.hatchingEnabled = active ? 1.0 : 0.0;
      
      // Greyscale hatch adjustments if disabled to keep UX premium
      if (hatchControls) {
        hatchControls.style.opacity = active ? '1' : '0.4';
        hatchControls.style.pointerEvents = active ? 'auto' : 'none';
      }
    });
  }

  if (crossCheckbox) {
    crossCheckbox.addEventListener('change', (e) => {
      renderer.settings.crossHatchEnabled = e.target.checked ? 1.0 : 0.0;
    });
  }

  // Geometry selector button hooks
  const shapeBtns = document.querySelectorAll('.shape-btn');
  shapeBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      // Find closest shape button container
      const targetBtn = e.target.closest('.shape-btn');
      if (!targetBtn) return;
      
      shapeBtns.forEach(b => b.classList.remove('active'));
      targetBtn.classList.add('active');
      
      const shapeName = targetBtn.getAttribute('data-shape');
      renderer.setShape(shapeName);
    });
  });

  // -------------------------------------------------------------
  // 3. COLLAPSIBLE HUD HANDLERS
  // -------------------------------------------------------------
  toggleHudBtn.addEventListener('click', () => {
    controlPanel.classList.add('collapsed');
    // Reveal small floating expand button
    setTimeout(() => {
      restoreHudBtn.removeAttribute('hidden');
    }, 250);
  });

  restoreHudBtn.addEventListener('click', () => {
    restoreHudBtn.setAttribute('hidden', 'true');
    controlPanel.classList.remove('collapsed');
  });

  // -------------------------------------------------------------
  // 4. WINDOW RESIZE EVENTS
  // -------------------------------------------------------------
  let resizeTimeout;
  window.addEventListener('resize', () => {
    // Debounce resize slightly to prevent WebGPU texture spamming
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      renderer.resize();
    }, 60);
  });

  // -------------------------------------------------------------
  // 5. ANIMATION & RENDER TICK LOOP
  // -------------------------------------------------------------
  let lastTime = performance.now();
  let frameCount = 0;
  let fpsTimer = 0;
  let accumulatedTime = 0;

  function tick(currentTime) {
    const dt = (currentTime - lastTime) / 1000.0;
    lastTime = currentTime;
    
    // Protect against background tab pause spikes
    const clampedDt = Math.min(dt, 0.1);

    // Track frame rendering start time
    const startGPU = performance.now();

    // Fire actual WebGPU Dual Pass render queues
    renderer.render(clampedDt);

    // Track frame rendering end time (CPU instruction queueing)
    const endGPU = performance.now();
    accumulatedTime += (endGPU - startGPU);

    // FPS Calculations
    frameCount++;
    fpsTimer += dt;
    
    // Update stats once every 20 frames (avoids CPU layout thrashing)
    if (frameCount >= 20) {
      const calculatedFps = Math.round(frameCount / fpsTimer);
      const avgFrameTime = (accumulatedTime / frameCount).toFixed(1);
      
      fpsCounter.textContent = `${calculatedFps} FPS`;
      frameTimeVal.textContent = `${avgFrameTime} ms`;
      
      // Update text glow color if FPS drops slightly (premium touch)
      if (calculatedFps < 45) {
        fpsCounter.className = 'stat-value text-glow';
        fpsCounter.style.textShadow = '0 0 10px rgba(239, 68, 68, 0.4)';
        fpsCounter.style.color = '#ef4444';
      } else {
        fpsCounter.className = 'stat-value text-glow';
        fpsCounter.style.textShadow = '';
        fpsCounter.style.color = '';
      }
      
      frameCount = 0;
      fpsTimer = 0;
      accumulatedTime = 0;
    }

    requestAnimationFrame(tick);
  }

  // Trigger main animation thread
  requestAnimationFrame(tick);
});
