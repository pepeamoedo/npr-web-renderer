# 🌪️ GPGPU Organic Swarm — WebGPU Compute Shaders

> **Simulación masiva de fluidos y partículas gestionada al 100% en la GPU mediante Compute Shaders y campos vectoriales (Curl Noise).**

🔗 **[Ver Demo en Vivo](https://pepeamoedo.com/MangaSketch/)**

![Organic Swarm Cover](<img width="1024" height="924" alt="image" src="https://github.com/user-attachments/assets/d04dc407-a831-4d2f-969f-a719f2573b65" />)

## 🔬 Visión General

Este proyecto es una demostración de rendimiento bruto y matemáticas aplicadas utilizando el estándar **WebGPU**. El objetivo es mover +100,000 partículas simultáneamente a 60 FPS constantes en el navegador, descargando por completo a la CPU (JavaScript) y utilizando la GPU para el cálculo de físicas complejas.

En lugar de movimientos lineales básicos, la simulación implementa **Curl Noise** para generar un campo vectorial dinámico, provocando que las partículas se comporten como un fluido orgánico que muta en el tiempo y reacciona a la interacción del usuario.

## ⚙️ Arquitectura Técnica (GPGPU)

La simulación se divide en dos *pipelines* independientes ejecutados secuencialmente en cada fotograma:

### 1. Compute Pipeline (Cálculo Físico)
* **Storage Buffers:** Uso de buffers alineados en memoria (`std140`) para almacenar posiciones y velocidades (`vec4<f32>`), permitiendo el acceso de lectura y escritura directo desde la GPU.
* **WGSL Compute Shader:** Ejecución paralela utilizando grupos de trabajo (`@workgroup_size(64)`).
* **Matemáticas Orgánicas:** Implementación algorítmica de ruido 3D y *Curl Noise* dentro del shader. Al inyectar la variable de tiempo (`u_time`), el campo magnético evoluciona, creando vórtices y remolinos fluidos sin necesidad de keyframes.
* **Físicas de Interacción:** Cálculo de vectores de repulsión entre las coordenadas proyectadas del ratón y la posición 3D de cada partícula.

### 2. Render Pipeline (Visualización)
* **Vertex Fetching:** El *Render Shader* toma el buffer modificado por el *Compute Shader* directamente como datos de vértices, evitando costosas transferencias de memoria entre RAM y VRAM.
* **Topología Eficiente:** Renderizado mediante `point-list` para maximizar los *draw calls*.
* **Sombreado Dinámico:** La intensidad emisiva y el color de cada partícula se calculan en el *Fragment Shader* basándose en su velocidad actual (transferida desde el *Vertex Shader*), iluminando los vórtices más rápidos.

## 💻 Instalación y Desarrollo Local

Proyecto construido sobre **Vite** para una compilación estática rápida y ligera.

1.  **Clona el repositorio:**
    ```bash
    git clone [https://github.com/pepeamoedo/gpgpu-organic-swarm.git](https://github.com/pepeamoedo/gpgpu-organic-swarm.git)
    cd gpgpu-organic-swarm
    ```

2.  **Instala las dependencias:**
    ```bash
    npm install
    ```

3.  **Inicia el servidor de desarrollo:**
    ```bash
    npm run dev
    ```
    *(Nota: WebGPU debe estar soportado y habilitado en tu navegador. Actualmente compatible con versiones recientes de Chrome, Edge y navegadores basados en Chromium).*

## 🧠 Sobre el Autor

**Pepe Amoedo** — *Technical 3D Artist & Frontend Developer*

Aplicando una sólida formación en Bellas Artes a la arquitectura de software gráfico. Especializado en exprimir el rendimiento de la GPU en la web, la generación procedimental y el desarrollo de sistemas visuales donde el código actúa como un servicio para la estética y la experiencia interactiva.

[Portafolio](https://pepeamoedo.com/) | [LinkedIn](https://www.linkedin.com/in/tu-perfil-aqui/)
