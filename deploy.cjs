const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Cargar variables de entorno del archivo .env si existe (evitando dependencias externas)
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        const val = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
        process.env[key.trim()] = val;
      }
    });
  }
} catch (e) {
  console.warn('Advertencia al cargar el archivo .env:', e.message);
}

const LOCAL_DIR = path.join(__dirname, 'dist');
const FTP_USER = process.env.FTP_USER || 'tu_usuario_ftp';
const FTP_PASS = process.env.FTP_PASS || 'tu_contraseña_ftp';
const FTP_HOST = process.env.FTP_HOST || 'tu_host_ftp';
const REMOTE_ROOTS = [
  'public_html/MangaSketch',
  'domains/pepeamoedo.com/public_html/MangaSketch'
];

function getFilesRecursively(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    if (file.startsWith('._') || file === '.DS_Store') return;
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(getFilesRecursively(fullPath));
    } else {
      results.push(fullPath);
    }
  });
  return results;
}

console.log('--- Iniciando Despliegue de MangaSketch por Antigravity ---');

if (FTP_USER === 'tu_usuario_ftp' || FTP_PASS === 'tu_contraseña_ftp' || FTP_HOST === 'tu_host_ftp') {
  console.error('Error: Por favor, configura tus credenciales FTP en un archivo local .env');
  process.exit(1);
}

const files = getFilesRecursively(LOCAL_DIR);
console.log(`Encontrados ${files.length} archivos de producción para subir.`);

files.forEach((file, index) => {
  const relPath = path.relative(LOCAL_DIR, file);
  
  REMOTE_ROOTS.forEach(root => {
    const remotePath = `${root}/${relPath.replace(/\\/g, '/')}`;
    console.log(`[${index + 1}/${files.length}] Subiendo ${relPath} -> ${remotePath}...`);
    const encodedRemotePath = remotePath.split('/').map(segment => encodeURIComponent(segment)).join('/');
    
    // Usar curl para subir por FTP
    const curlCmd = `curl -T "${file}" "ftp://${FTP_HOST}/${encodedRemotePath}" --user "${FTP_USER}:${FTP_PASS}" --ftp-create-dirs --silent --show-error`;
    try {
      execSync(curlCmd);
    } catch (err) {
      console.error(`Error subiendo ${relPath} a ${root}:`, err.message);
    }
  });
});

console.log('--- ¡Despliegue de MangaSketch Completado con Éxito en Ambos Destinos! ---');
