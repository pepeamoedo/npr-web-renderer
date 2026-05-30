/**
 * MangaSketch Geometry Generators
 * Calculates high-precision coordinates, analytical normals, and mapping UVs
 * and uploads them to interleaved WebGPU buffers.
 */

// Helper to normalize a 3D vector
function normalize(v) {
  const len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
  if (len === 0) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

// Helper to cross-product two 3D vectors
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

/**
 * Generates a Torus Knot mesh
 */
export function generateTorusKnot(radialSegments = 160, tubularSegments = 32, p = 2, q = 3, radius = 1.3, tubeRadius = 0.4) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  // Helper to get center curve point of the knot at phi
  function getKnotPosition(phi) {
    const r = radius * (0.5 * Math.cos(q * phi) + 1.2);
    const x = r * Math.cos(p * phi);
    const y = r * Math.sin(p * phi);
    const z = -0.5 * radius * Math.sin(q * phi);
    return [x, y, z];
  }

  // Generate vertices
  for (let i = 0; i <= radialSegments; i++) {
    const phi = (i / radialSegments) * 2 * Math.PI;
    
    // Sample points around phi to compute analytical tangent
    const p1 = getKnotPosition(phi - 0.001);
    const p2 = getKnotPosition(phi + 0.001);
    const pCenter = getKnotPosition(phi);
    
    const T = normalize([p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]]);
    
    // Create orthogonal frame using parallel transport reference
    let up = [0, 0, 1];
    if (Math.abs(T[2]) > 0.9) {
      up = [0, 1, 0];
    }
    const B = normalize(cross(T, up));
    const N = cross(B, T); // already normalized since T and B are perpendicular

    for (let j = 0; j <= tubularSegments; j++) {
      const theta = (j / tubularSegments) * 2 * Math.PI;
      
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);
      
      // Vertex normal on the tube surface
      const nx = cosTheta * N[0] + sinTheta * B[0];
      const ny = cosTheta * N[1] + sinTheta * B[1];
      const nz = cosTheta * N[2] + sinTheta * B[2];
      const normal = normalize([nx, ny, nz]);
      
      // Position
      const px = pCenter[0] + tubeRadius * normal[0];
      const py = pCenter[1] + tubeRadius * normal[1];
      const pz = pCenter[2] + tubeRadius * normal[2];
      
      positions.push(px, py, pz);
      normals.push(normal[0], normal[1], normal[2]);
      uvs.push(i / radialSegments, j / tubularSegments);
    }
  }

  // Generate indices
  for (let i = 0; i < radialSegments; i++) {
    for (let j = 0; j < tubularSegments; j++) {
      const nextTubular = j + 1;
      
      const a = i * (tubularSegments + 1) + j;
      const b = i * (tubularSegments + 1) + nextTubular;
      const c = (i + 1) * (tubularSegments + 1) + nextTubular;
      const d = (i + 1) * (tubularSegments + 1) + j;
      
      // First triangle of quad
      indices.push(a, d, c);
      // Second triangle of quad
      indices.push(a, c, b);
    }
  }

  return { positions, normals, uvs, indices };
}

/**
 * Generates a standard Torus mesh
 */
export function generateTorus(radialSegments = 96, tubularSegments = 48, radius = 1.4, tubeRadius = 0.5) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= radialSegments; i++) {
    const phi = (i / radialSegments) * 2 * Math.PI;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);

    for (let j = 0; j <= tubularSegments; j++) {
      const theta = (j / tubularSegments) * 2 * Math.PI;
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);

      // Position
      const px = (radius + tubeRadius * cosTheta) * cosPhi;
      const py = (radius + tubeRadius * cosTheta) * sinPhi;
      const pz = tubeRadius * sinTheta;

      // Center of the tube slice at this angle phi
      const cx = radius * cosPhi;
      const cy = radius * sinPhi;
      const cz = 0;

      // Outward-pointing normal: vector from the slice center to the vertex, normalized
      const normal = normalize([px - cx, py - cy, pz - cz]);

      positions.push(px, py, pz);
      normals.push(normal[0], normal[1], normal[2]);
      uvs.push(i / radialSegments, j / tubularSegments);
    }
  }

  for (let i = 0; i < radialSegments; i++) {
    for (let j = 0; j < tubularSegments; j++) {
      const a = i * (tubularSegments + 1) + j;
      const b = i * (tubularSegments + 1) + (j + 1);
      const c = (i + 1) * (tubularSegments + 1) + (j + 1);
      const d = (i + 1) * (tubularSegments + 1) + j;

      indices.push(a, d, c);
      indices.push(a, c, b);
    }
  }

  return { positions, normals, uvs, indices };
}

/**
 * Generates a Sphere mesh
 */
export function generateSphere(latSegments = 48, lonSegments = 96, radius = 1.5) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= latSegments; i++) {
    const theta = (i / latSegments) * Math.PI;
    const cosTheta = Math.cos(theta);
    const sinTheta = Math.sin(theta);

    for (let j = 0; j <= lonSegments; j++) {
      const phi = (j / lonSegments) * 2 * Math.PI;
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);

      // Unit vector normal
      const nx = sinTheta * cosPhi;
      const ny = cosTheta;
      const nz = sinTheta * sinPhi;

      // Position
      const px = radius * nx;
      const py = radius * ny;
      const pz = radius * nz;

      positions.push(px, py, pz);
      normals.push(nx, ny, nz);
      uvs.push(j / lonSegments, i / latSegments);
    }
  }

  for (let i = 0; i < latSegments; i++) {
    for (let j = 0; j < lonSegments; j++) {
      const a = i * (lonSegments + 1) + j;
      const b = i * (lonSegments + 1) + (j + 1);
      const c = (i + 1) * (lonSegments + 1) + (j + 1);
      const d = (i + 1) * (lonSegments + 1) + j;

      indices.push(a, d, c);
      indices.push(a, c, b);
    }
  }

  return { positions, normals, uvs, indices };
}

/**
 * Interleaves position, normal, and UV data and uploads them to WebGPU buffers.
 * Structure of each vertex (32 bytes):
 * - Position (Float32x3) -> Bytes 0..11
 * - Normal (Float32x3)   -> Bytes 12..23
 * - UV (Float32x2)       -> Bytes 24..31
 */
export function createGPUGeometry(device, shapeData) {
  const { positions, normals, uvs, indices } = shapeData;
  const vertexCount = positions.length / 3;
  
  // Interleave buffers
  const vertexData = new Float32Array(vertexCount * 8);
  for (let i = 0; i < vertexCount; i++) {
    const idx8 = i * 8;
    const idx3 = i * 3;
    const idx2 = i * 2;
    
    // Position
    vertexData[idx8 + 0] = positions[idx3 + 0];
    vertexData[idx8 + 1] = positions[idx3 + 1];
    vertexData[idx8 + 2] = positions[idx3 + 2];
    
    // Normal
    vertexData[idx8 + 3] = normals[idx3 + 0];
    vertexData[idx8 + 4] = normals[idx3 + 1];
    vertexData[idx8 + 5] = normals[idx3 + 2];
    
    // UV
    vertexData[idx8 + 6] = uvs[idx2 + 0];
    vertexData[idx8 + 7] = uvs[idx2 + 1];
  }

  // Create GPU vertex buffer
  const vertexBuffer = device.createBuffer({
    label: 'Procedural Mesh Vertex Buffer',
    size: vertexData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true
  });
  new Float32Array(vertexBuffer.getMappedRange()).set(vertexData);
  vertexBuffer.unmap();

  // Create GPU index buffer
  const indexData = new Uint32Array(indices);
  const indexBuffer = device.createBuffer({
    label: 'Procedural Mesh Index Buffer',
    size: indexData.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true
  });
  new Uint32Array(indexBuffer.getMappedRange()).set(indexData);
  indexBuffer.unmap();

  return {
    vertexBuffer,
    indexBuffer,
    indexCount: indices.length,
    vertexCount
  };
}
