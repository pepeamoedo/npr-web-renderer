/**
 * MangaSketch WGSL Shaders
 * Contains:
 * 1. Base Scene Shader (Pass 1 offscreen renderer)
 * 2. NPR Post-processing Shader (Pass 2 screen-space Sobel + Cel + Hatching)
 */

export const baseShader = `
struct SceneUniforms {
  mvpMatrix: mat4x4<f32>,
  modelMatrix: mat4x4<f32>,
  normalMatrix: mat4x4<f32>,
  lightDirection: vec4<f32>, // w component is padding
};

@group(0) @binding(0) var<uniform> uniforms: SceneUniforms;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) viewNormal: vec3<f32>,
  @location(3) lightDir: vec3<f32>,
};

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  
  // Transform vertex position to clip space
  out.position = uniforms.mvpMatrix * vec4<f32>(input.position, 1.0);
  
  // Transform normal to world space
  let worldNormal = normalize((uniforms.normalMatrix * vec4<f32>(input.normal, 0.0)).xyz);
  out.normal = worldNormal;
  
  // Transform normal to view space (extremely useful for depth/normal edge detection)
  // Here we approximate it via standard normal
  out.viewNormal = worldNormal;
  
  out.uv = input.uv;
  out.lightDir = normalize(uniforms.lightDirection.xyz);
  
  return out;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let N = normalize(input.normal);
  let L = normalize(input.lightDir);
  
  // Main Diffuse Lambertian term
  let diffuse = max(dot(N, L), 0.0);
  
  // Antipodal Backlight (Secondary light source located at the exact antipodes of the main light)
  let L_back = -L;
  let diffuse_back = max(dot(N, L_back), 0.0) * uniforms.lightDirection.w;
  
  // Concentrated Blinn-Phong Specular for sharp, small highlight dots
  let V = vec3<f32>(0.0, 0.0, 1.0);
  let H = normalize(L + V);
  let specular = pow(max(dot(N, H), 0.0), 80.0) * 0.55;
  
  // Material base color (a high-quality clean gray/white canvas color)
  let materialColor = vec3<f32>(0.92, 0.90, 0.88);
  
  // Render with high-gradient shading to allow post-process to quantize smoothly
  let ambient = 0.08;
  let litIntensity = diffuse + diffuse_back + specular + ambient;
  let finalColor = materialColor * litIntensity;
  
  return vec4<f32>(finalColor, 1.0);
}
`;

export const nprShader = `
struct NPRParams {
  edgeDepthSensitivity: f32,
  edgeColorSensitivity: f32,
  edgeThickness: f32,
  celBandsCount: f32,
  celSmoothing: f32,
  hatchingEnabled: f32,
  hatchFrequency: f32,
  hatchWeight: f32,
  shadowThreshold: f32,
  crossHatchEnabled: f32,
  screenSize: vec2<f32>,
};

@group(0) @binding(0) var s_sampler: sampler;
@group(0) @binding(1) var t_color: texture_2d<f32>;
@group(0) @binding(2) var t_depth: texture_depth_2d;
@group(0) @binding(3) var<uniform> params: NPRParams;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var out: VertexOutput;
  let uv = vec2<f32>(
    f32((vertexIndex << 1u) & 2u),
    f32(vertexIndex & 2u)
  );
  out.position = vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2<f32>(uv.x, 1.0 - uv.y); // Flip Y for WebGPU UV coordinates
  return out;
}

// Converts standard rgb color to luminance
fn getLuminance(c: vec3<f32>) -> f32 {
  return dot(c, vec3<f32>(0.299, 0.587, 0.114));
}

// Linearizes depth for more robust distance-invariant Sobel edge detection
fn linearizeDepth(dVal: f32) -> f32 {
  let near = 0.1;
  let far = 10.0;
  return (2.0 * near) / (far + near - dVal * (far - near));
}

// Custom Cel-shading quantization with smoothstep transitions to avoid aliasing
fn quantizeCel(val: f32, bands: f32, smoothing: f32) -> f32 {
  if (bands <= 1.0) { return val; }
  
  let scale = bands - 1.0;
  let scaled = val * scale;
  let i = floor(scaled);
  let f = fract(scaled);
  
  // Smoothly interpolate between levels if smoothing > 0.0
  var transition = 0.0;
  if (smoothing > 0.0) {
    transition = smoothstep(0.5 - smoothing * 0.5, 0.5 + smoothing * 0.5, f);
  } else {
    transition = step(0.5, f);
  }
  
  return (i + transition) / scale;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let texelSize = 1.0 / params.screenSize;
  let uv = input.uv;
  
  // 1. SOBEL EDGE DETECTION (COLOR AND DEPTH)
  // Dynamic offset based on edgeThickness setting
  let offset = texelSize * params.edgeThickness;
  
  // Sample 3x3 surrounding depths
  let d00 = linearizeDepth(textureSample(t_depth, s_sampler, uv + vec2<f32>(-offset.x, -offset.y)));
  let d10 = linearizeDepth(textureSample(t_depth, s_sampler, uv + vec2<f32>(0.0,       -offset.y)));
  let d20 = linearizeDepth(textureSample(t_depth, s_sampler, uv + vec2<f32>(offset.x,  -offset.y)));
  
  let d01 = linearizeDepth(textureSample(t_depth, s_sampler, uv + vec2<f32>(-offset.x, 0.0)));
  let d21 = linearizeDepth(textureSample(t_depth, s_sampler, uv + vec2<f32>(offset.x,  0.0)));
  
  let d02 = linearizeDepth(textureSample(t_depth, s_sampler, uv + vec2<f32>(-offset.x, offset.y)));
  let d12 = linearizeDepth(textureSample(t_depth, s_sampler, uv + vec2<f32>(0.0,       offset.y)));
  let d22 = linearizeDepth(textureSample(t_depth, s_sampler, uv + vec2<f32>(offset.x,  offset.y)));

  // Sobel Depth Gradients
  let depthG_x = (d20 + 2.0 * d21 + d22) - (d00 + 2.0 * d01 + d02);
  let depthG_y = (d02 + 2.0 * d12 + d22) - (d00 + 2.0 * d10 + d20);
  let edgeDepth = sqrt(depthG_x * depthG_x + depthG_y * depthG_y);

  // Sample 3x3 surrounding colors (converting to luminance)
  let c00 = getLuminance(textureSample(t_color, s_sampler, uv + vec2<f32>(-offset.x, -offset.y)).rgb);
  let c10 = getLuminance(textureSample(t_color, s_sampler, uv + vec2<f32>(0.0,       -offset.y)).rgb);
  let c20 = getLuminance(textureSample(t_color, s_sampler, uv + vec2<f32>(offset.x,  -offset.y)).rgb);
  
  let c01 = getLuminance(textureSample(t_color, s_sampler, uv + vec2<f32>(-offset.x, 0.0)).rgb);
  let c21 = getLuminance(textureSample(t_color, s_sampler, uv + vec2<f32>(offset.x,  0.0)).rgb);
  
  let c02 = getLuminance(textureSample(t_color, s_sampler, uv + vec2<f32>(-offset.x, offset.y)).rgb);
  let c12 = getLuminance(textureSample(t_color, s_sampler, uv + vec2<f32>(0.0,       offset.y)).rgb);
  let c22 = getLuminance(textureSample(t_color, s_sampler, uv + vec2<f32>(offset.x,  offset.y)).rgb);

  // Sobel Color Gradients
  let colorG_x = (c20 + 2.0 * c21 + c22) - (c00 + 2.0 * c01 + c02);
  let colorG_y = (c02 + 2.0 * c12 + c22) - (c00 + 2.0 * c10 + c20);
  let edgeColor = sqrt(colorG_x * colorG_x + colorG_y * colorG_y);

  // Combine both Edge weights based on user sensitivity
  // Apply amplification factors to make sliders intuitive
  let totalEdgeVal = (edgeDepth * params.edgeDepthSensitivity * 12.0) + (edgeColor * params.edgeColorSensitivity * 4.0);
  
  // Crisp ink thresholding
  let threshold = 0.08;
  let isInkOutline = totalEdgeVal > threshold;

  // 2. CEL-SHADING QUANTIZATION
  let originalColor = textureSample(t_color, s_sampler, uv).rgb;
  let rawLuminance = getLuminance(originalColor);
  
  // Pure White specular shine threshold (extremely bright concentrated region)
  let isPureSpecular = rawLuminance > 1.12;
  
  // Quantize color tone
  let quantizedLuminance = quantizeCel(rawLuminance, params.celBandsCount, params.celSmoothing);
  
  // Map quantized luminance back to a beautiful vintage paper palette
  // Light, medium-shadow, and deep-shadow tones
  let paperWhite = vec3<f32>(0.96, 0.94, 0.90);
  let halftoneGray = vec3<f32>(0.50, 0.49, 0.47);
  let inkShadow = vec3<f32>(0.12, 0.11, 0.14);
  
  // Blend between the tones based on quantized value
  var celColor = vec3<f32>(0.0);
  if (isPureSpecular) {
    celColor = vec3<f32>(1.0); // Pure White highlight
  } else if (quantizedLuminance > 0.65) {
    celColor = paperWhite;
  } else if (quantizedLuminance > 0.28) {
    celColor = mix(halftoneGray, paperWhite, (quantizedLuminance - 0.28) / (0.65 - 0.28));
  } else {
    celColor = mix(inkShadow, halftoneGray, quantizedLuminance / 0.28);
  }

  // 3. MATHEMATICAL HATCHING (IN PEN-AND-INK STYLE)
  var hatchIntensity = 1.0;
  
  // Only apply hatching if enabled and we are below the shadow threshold
  if (params.hatchingEnabled > 0.5 && rawLuminance < params.shadowThreshold) {
    // Coordinate-based diagonal lines math
    let screenPos = input.position.xy;
    
    // Scale density based on screen size so it stays consistent
    let densityScale = params.hatchFrequency * 0.01;
    let diagonalPattern1 = sin((screenPos.x + screenPos.y) * densityScale);
    
    // Adjust line thickness dynamically: darker pixels -> thicker hatching lines
    let shadowFactor = 1.0 - (rawLuminance / params.shadowThreshold);
    let lineWeight = params.hatchWeight * shadowFactor;
    
    // Smooth step for ink stroke simulation
    let hatch1 = smoothstep(lineWeight - 0.15, lineWeight + 0.15, diagonalPattern1);
    
    if (hatch1 > 0.5) {
      hatchIntensity = 0.0;
    }
    
    // 4. CROSS-HATCHING FOR EXTREME SHADOWS
    // Triggers in deepest shadow areas (luminance < half of shadowThreshold)
    if (params.crossHatchEnabled > 0.5 && rawLuminance < (params.shadowThreshold * 0.5)) {
      let diagonalPattern2 = sin((screenPos.x - screenPos.y) * densityScale);
      
      let deepShadowFactor = 1.0 - (rawLuminance / (params.shadowThreshold * 0.5));
      let lineWeight2 = params.hatchWeight * deepShadowFactor * 0.85;
      
      let hatch2 = smoothstep(lineWeight2 - 0.15, lineWeight2 + 0.15, diagonalPattern2);
      
      if (hatch2 > 0.5) {
        hatchIntensity = 0.0;
      }
    }
  }

  // 5. MERGE AND COMPOSE FINAL PIXEL
  var finalResultColor = celColor;
  
  // Apply hatching shadow as black ink (protect pure white specular highlights)
  if (hatchIntensity == 0.0 && !isPureSpecular) {
    finalResultColor = inkShadow;
  }
  
  // Overlay Sobel ink silhouette (protect pure white specular highlights)
  if (isInkOutline && !isPureSpecular) {
    finalResultColor = inkShadow;
  }
  
  return vec4<f32>(finalResultColor, 1.0);
}
`;
