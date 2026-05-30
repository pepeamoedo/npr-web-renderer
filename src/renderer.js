/**
 * MangaSketch WebGPU NPR Orchestrator
 * Manages offscreen textures, render pipelines, uniform uploads,
 * lightweight 3D matrix math, and multi-pass command encoding.
 */

import { baseShader, nprShader } from './shaders.js';
import { generateTorusKnot, generateTorus, generateSphere, createGPUGeometry } from './geometry.js';

// --- LIGHTWEIGHT MATRIX MATH SYSTEM (avoiding external dependencies) ---
const mat4 = {
  identity() {
    const m = new Float32Array(16);
    m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
    return m;
  },
  
  perspective(fovYRad, aspect, near, far) {
    const f = 1.0 / Math.tan(fovYRad / 2.0);
    const nf = 1.0 / (near - far);
    const m = new Float32Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = far * nf; // WebGPU: far / (near - far)
    m[11] = -1.0;
    m[14] = far * near * nf; // WebGPU: (far * near) / (near - far)
    m[15] = 0.0;
    return m;
  },
  
  lookAt(eye, center, up) {
    const eyex = eye[0], eyey = eye[1], eyez = eye[2];
    const upx = up[0], upy = up[1], upz = up[2];
    
    // z = normalize(eye - center)
    let zx = eyex - center[0];
    let zy = eyey - center[1];
    let zz = eyez - center[2];
    const lenz = Math.sqrt(zx*zx + zy*zy + zz*zz);
    zx /= lenz; zy /= lenz; zz /= lenz;
    
    // x = normalize(up x z)
    let xx = upy * zz - upz * zy;
    let xy = upz * zx - upx * zz;
    let xz = upx * zy - upy * zx;
    const lenx = Math.sqrt(xx*xx + xy*xy + xz*xz);
    xx /= lenx; xy /= lenx; xz /= lenx;
    
    // y = z x x
    const yx = zz * xy - zy * xz;
    const yy = zx * xz - zz * xx;
    const yz = zy * xx - zx * xy;
    
    const m = new Float32Array(16);
    m[0] = xx; m[4] = xy; m[8] = xz;
    m[1] = yx; m[5] = yy; m[9] = yz;
    m[2] = zx; m[6] = zy; m[10] = zz;
    m[12] = -(xx * eyex + xy * eyey + xz * eyez);
    m[13] = -(yx * eyex + yy * eyey + yz * eyez);
    m[14] = -(zx * eyex + zy * eyey + zz * eyez);
    m[15] = 1.0;
    return m;
  },
  
  rotateY(m, rad) {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const out = new Float32Array(m);
    
    const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3];
    const m8 = m[8], m9 = m[9], m10 = m[10], m11 = m[11];
    
    out[0] = m0 * c - m8 * s;
    out[1] = m1 * c - m9 * s;
    out[2] = m2 * c - m10 * s;
    out[3] = m3 * c - m11 * s;
    
    out[8] = m0 * s + m8 * c;
    out[9] = m1 * s + m9 * c;
    out[10] = m2 * s + m10 * c;
    out[11] = m3 * s + m11 * c;
    return out;
  },
  
  rotateX(m, rad) {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const out = new Float32Array(m);
    
    const m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7];
    const m8 = m[8], m9 = m[9], m10 = m[10], m11 = m[11];
    
    out[4] = m4 * c + m8 * s;
    out[5] = m5 * c + m9 * s;
    out[6] = m6 * c + m10 * s;
    out[7] = m7 * c + m11 * s;
    
    out[8] = -m4 * s + m8 * c;
    out[9] = -m5 * s + m9 * c;
    out[10] = -m6 * s + m10 * c;
    out[11] = -m7 * s + m11 * c;
    return out;
  },
  
  multiply(a, b) {
    const out = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      const b0 = b[i*4 + 0], b1 = b[i*4 + 1], b2 = b[i*4 + 2], b3 = b[i*4 + 3];
      out[i*4 + 0] = b0 * a[0] + b1 * a[4] + b2 * a[8] + b3 * a[12];
      out[i*4 + 1] = b0 * a[1] + b1 * a[5] + b2 * a[9] + b3 * a[13];
      out[i*4 + 2] = b0 * a[2] + b1 * a[6] + b2 * a[10] + b3 * a[14];
      out[i*4 + 3] = b0 * a[3] + b1 * a[7] + b2 * a[11] + b3 * a[15];
    }
    return out;
  }
};

export class NPRRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    
    // Core GPU state
    this.device = null;
    this.gpuContext = null;
    this.canvasFormat = 'rgba8unorm';
    
    // Offscreen rendering targets (Pass 1 targets)
    this.colorTexture = null;
    this.depthTexture = null;
    
    // Geometry models
    this.geometries = {};
    this.activeShape = 'torusKnot';
    
    // Pass 1 resources
    this.basePipeline = null;
    this.sceneUniformBuffer = null;
    this.sceneBindGroup = null;
    
    // Pass 2 resources
    this.postPipeline = null;
    this.nprUniformBuffer = null;
    this.postBindGroup = null;
    this.sharedSampler = null;
    
    // Interaction configuration (syncs with DOM sliders)
    this.settings = {
      rotationSpeed: 1.0,
      lightYaw: 45,
      lightPitch: 45,
      backlightIntensity: 0.28,
      edgeDepthSensitivity: 0.30,
      edgeColorSensitivity: 0.25,
      edgeThickness: 1.5,
      celBandsCount: 3,
      celSmoothing: 0.05,
      hatchingEnabled: 1.0,
      hatchFrequency: 180.0,
      hatchWeight: 0.45,
      shadowThreshold: 0.35,
      crossHatchEnabled: 1.0,
    };
    
    this.angleY = 0;
    this.angleX = 0.2; // slight tilt to showcase 3D form
  }

  /**
   * Initializes the WebGPU context
   */
  async init() {
    if (!navigator.gpu) {
      throw new Error('WebGPU no está soportado en este navegador.');
    }
    
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance'
    });
    
    if (!adapter) {
      throw new Error('No se encontró un adaptador GPU compatible.');
    }
    
    this.device = await adapter.requestDevice();
    this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    
    // Configure HTML5 Canvas Context for WebGPU
    this.gpuContext = this.canvas.getContext('webgpu');
    this.gpuContext.configure({
      device: this.device,
      format: this.canvasFormat,
      alphaMode: 'opaque'
    });
    
    // Compile WGSL Shaders
    const baseShaderModule = this.device.createShaderModule({
      label: 'Offscreen Base Pass Shaders',
      code: baseShader
    });
    
    const nprShaderModule = this.device.createShaderModule({
      label: 'Screen Space NPR Shaders',
      code: nprShader
    });

    // -------------------------------------------------------------
    // PASS 1 SETUP: Base 3D Mesh -> Offscreen Color & Depth Texture
    // -------------------------------------------------------------
    
    // Allocate Scene Uniform Buffer (MVP matrix, Model matrix, Normal Matrix, Light direction)
    // 64 + 64 + 64 + 16 = 208 bytes -> padded to 256 bytes for hardware compliance
    this.sceneUniformBuffer = this.device.createBuffer({
      label: 'Scene Uniforms Buffer',
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    
    // Pass 1 Bind Group Layout (just 1 uniform buffer at binding 0)
    const baseBindGroupLayout = this.device.createBindGroupLayout({
      label: 'Base Pass Bind Group Layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' }
        }
      ]
    });
    
    this.sceneBindGroup = this.device.createBindGroup({
      label: 'Base Pass Bind Group',
      layout: baseBindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.sceneUniformBuffer }
        }
      ]
    });
    
    // Interleaved layout details (Stride of 32 bytes):
    // float32x3 position at offset 0
    // float32x3 normal at offset 12
    // float32x2 uv at offset 24
    const vertexBufferLayout = {
      arrayStride: 32,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' }, // position
        { shaderLocation: 1, offset: 12, format: 'float32x3' }, // normal
        { shaderLocation: 2, offset: 24, format: 'float32x2' }  // uv
      ]
    };
    
    // Build Base Render Pipeline
    this.basePipeline = this.device.createRenderPipeline({
      label: 'Base Scene Rendering Pipeline',
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [baseBindGroupLayout]
      }),
      vertex: {
        module: baseShaderModule,
        entryPoint: 'vs_main',
        buffers: [vertexBufferLayout]
      },
      fragment: {
        module: baseShaderModule,
        entryPoint: 'fs_main',
        targets: [
          { format: 'rgba8unorm' } // Renders to intermediate color texture
        ]
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'back'
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less'
      }
    });

    // -------------------------------------------------------------
    // PASS 2 SETUP: Full Screen Quad + Intermediary sampling
    // -------------------------------------------------------------
    
    // Non-filtering Sampler for universal depth texture compatibility
    this.sharedSampler = this.device.createSampler({
      label: 'Post Sampler Nearest',
      magFilter: 'nearest',
      minFilter: 'nearest',
      mipmapFilter: 'nearest',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    });
    
    // Allocate NPR Settings Uniform Buffer
    // 10 variables (f32) + vec2 screen size = 48 bytes -> padded to 256 bytes
    this.nprUniformBuffer = this.device.createBuffer({
      label: 'NPR Params Buffer',
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    
    // Bind Group Layout for NPR Post processing
    const postBindGroupLayout = this.device.createBindGroupLayout({
      label: 'Post Process Bind Group Layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'non-filtering' }
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d', multisampled: false }
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'depth', viewDimension: '2d', multisampled: false }
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' }
        }
      ]
    });
    
    // Build Post process pipeline
    this.postPipeline = this.device.createRenderPipeline({
      label: 'Post-Process NPR Pipeline',
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [postBindGroupLayout]
      }),
      vertex: {
        module: nprShaderModule,
        entryPoint: 'vs_main'
        // No vertex buffer layouts needed! Full screen triangle is procedural
      },
      fragment: {
        module: nprShaderModule,
        entryPoint: 'fs_main',
        targets: [
          { format: this.canvasFormat } // Renders directly to canvas
        ]
      },
      primitive: {
        topology: 'triangle-list'
      }
    });

    // Generate shapes and hold GPU buffers
    this.geometries = {
      torusKnot: createGPUGeometry(this.device, generateTorusKnot(160, 32, 2, 3, 1.3, 0.35)),
      torus: createGPUGeometry(this.device, generateTorus(96, 48, 1.4, 0.45)),
      sphere: createGPUGeometry(this.device, generateSphere(48, 96, 1.5))
    };
    
    // Initialize intermediary offscreen textures
    this.resize();
    
    return adapter.limits;
  }

  /**
   * Reallocates color and depth textures when window scales
   */
  resize() {
    if (!this.device) return;
    
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    
    // Update canvas size
    this.canvas.width = width;
    this.canvas.height = height;
    
    // Release previous textures
    if (this.colorTexture) this.colorTexture.destroy();
    if (this.depthTexture) this.depthTexture.destroy();
    
    // Allocate Pass 1 Target: Intermediary color texture
    this.colorTexture = this.device.createTexture({
      label: 'Offscreen Color Texture Target',
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    
    // Allocate Pass 1 Target: Depth texture
    this.depthTexture = this.device.createTexture({
      label: 'Offscreen Depth Texture Target',
      size: [width, height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    
    // Update the post processing bind group to reference new texture views
    const postBindGroupLayout = this.postPipeline.getBindGroupLayout(0);
    this.postBindGroup = this.device.createBindGroup({
      label: 'Post-Process Dynamic Bind Group',
      layout: postBindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: this.sharedSampler
        },
        {
          binding: 1,
          resource: this.colorTexture.createView()
        },
        {
          binding: 2,
          resource: this.depthTexture.createView()
        },
        {
          binding: 3,
          resource: { buffer: this.nprUniformBuffer }
        }
      ]
    });
  }

  /**
   * Triggers geometry swap
   */
  setShape(shapeName) {
    if (this.geometries[shapeName]) {
      this.activeShape = shapeName;
    }
  }

  /**
   * Main loops tick rendering routine
   */
  render(deltaTimeSeconds) {
    if (!this.device) return;
    
    // 1. UPDATE ANIMATION ROTATIONS
    if (this.settings.rotationSpeed !== 0) {
      this.angleY += deltaTimeSeconds * 0.45 * this.settings.rotationSpeed;
      // loop cleanly
      if (this.angleY > Math.PI * 2) this.angleY -= Math.PI * 2;
    }

    // 2. MATRIX TRANSLATIONS & SCALING
    const fov = (45 * Math.PI) / 180;
    const aspect = this.canvas.width / this.canvas.height;
    
    // Viewport matrix transforms
    const projectionMat = mat4.perspective(fov, aspect, 0.1, 10.0);
    const viewMat = mat4.lookAt([0, 0, 6.5], [0, 0, 0], [0, 1, 0]);
    
    // Model Matrix: Rotate X then Rotate Y
    let modelMat = mat4.identity();
    modelMat = mat4.rotateX(modelMat, this.angleX);
    modelMat = mat4.rotateY(modelMat, this.angleY);
    
    // MVP Matrix
    const viewProjMat = mat4.multiply(projectionMat, viewMat);
    const mvpMat = mat4.multiply(viewProjMat, modelMat);
    
    // Calculate light direction from interactive spherical angles
    const yawRad = (this.settings.lightYaw * Math.PI) / 180;
    const pitchRad = (this.settings.lightPitch * Math.PI) / 180;
    
    const lx = Math.cos(pitchRad) * Math.sin(yawRad);
    const ly = Math.sin(pitchRad);
    const lz = Math.cos(pitchRad) * Math.cos(yawRad);
    const lightDir = [lx, ly, lz, this.settings.backlightIntensity]; // w component holds backlight intensity

    // 3. UPLOAD PASS 1 UNIFORMS (Scene)
    // Structure offset: 0 MVP(64B), 64 Model(64B), 128 Model(used as Normal Matrix - 64B), 192 light(16B)
    const sceneUniformData = new Float32Array(16 * 3 + 4);
    sceneUniformData.set(mvpMat, 0);
    sceneUniformData.set(modelMat, 16);
    sceneUniformData.set(modelMat, 32); // Using model matrix directly for pure rotation normals
    sceneUniformData.set(lightDir, 48);
    this.device.queue.writeBuffer(this.sceneUniformBuffer, 0, sceneUniformData);

    // 4. UPLOAD PASS 2 UNIFORMS (NPR Params)
    const nprParamsData = new Float32Array(12);
    nprParamsData[0] = this.settings.edgeDepthSensitivity;
    nprParamsData[1] = this.settings.edgeColorSensitivity;
    nprParamsData[2] = this.settings.edgeThickness;
    nprParamsData[3] = this.settings.celBandsCount;
    nprParamsData[4] = this.settings.celSmoothing;
    nprParamsData[5] = this.settings.hatchingEnabled ? 1.0 : 0.0;
    nprParamsData[6] = this.settings.hatchFrequency;
    nprParamsData[7] = this.settings.hatchWeight;
    nprParamsData[8] = this.settings.shadowThreshold;
    nprParamsData[9] = this.settings.crossHatchEnabled ? 1.0 : 0.0;
    nprParamsData[10] = this.canvas.width;  // Screen dimensions
    nprParamsData[11] = this.canvas.height;
    this.device.queue.writeBuffer(this.nprUniformBuffer, 0, nprParamsData);

    // 5. COMMAND ENCODER INITIALIZATION
    const commandEncoder = this.device.createCommandEncoder({
      label: 'MangaSketch Render Dispatcher'
    });

    // 6. ENCODE RENDER PASS 1 (Mesh Base Lighting -> Offscreen Target)
    const baseRenderPassDesc = {
      label: 'Pass 1 Render Encoder',
      colorAttachments: [
        {
          view: this.colorTexture.createView(),
          clearValue: { r: 0.1, g: 0.1, b: 0.14, a: 1.0 }, // clear color
          loadOp: 'clear',
          storeOp: 'store'
        }
      ],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store'
      }
    };
    
    const activeGeo = this.geometries[this.activeShape];
    const pass1 = commandEncoder.beginRenderPass(baseRenderPassDesc);
    pass1.setPipeline(this.basePipeline);
    pass1.setBindGroup(0, this.sceneBindGroup);
    pass1.setVertexBuffer(0, activeGeo.vertexBuffer);
    pass1.setIndexBuffer(activeGeo.indexBuffer, 'uint32');
    pass1.drawIndexed(activeGeo.indexCount);
    pass1.end();

    // 7. ENCODE RENDER PASS 2 (NPR Post Processing -> Screen)
    const canvasTexture = this.gpuContext.getCurrentTexture();
    const postRenderPassDesc = {
      label: 'Pass 2 Render Encoder',
      colorAttachments: [
        {
          view: canvasTexture.createView(),
          clearValue: { r: 0.05, g: 0.05, b: 0.07, a: 1.0 }, // clear backdrop
          loadOp: 'clear',
          storeOp: 'store'
        }
      ]
    };
    
    const pass2 = commandEncoder.beginRenderPass(postRenderPassDesc);
    pass2.setPipeline(this.postPipeline);
    pass2.setBindGroup(0, this.postBindGroup);
    // Draw 3 vertices for full-screen procedural triangle
    pass2.draw(3);
    pass2.end();

    // 8. SUBMIT COMMANDS
    this.device.queue.submit([commandEncoder.finish()]);
  }
}
