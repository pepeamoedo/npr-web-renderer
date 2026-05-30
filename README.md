# 🎨 NPR Web Renderer — WebGPU Multi-Pass Post-Processing

> **Arquitectura de renderizado de múltiples pasadas en WebGPU para aplicar técnicas de Renderizado No Fotorrealista (NPR), emulando estilos de dibujo tradicional en tiempo real.**

🔗 **[Ver Demo en Vivo](https://pepeamoedo.com/MangaSketch/)**

<img width="1024" height="924" alt="image" src="https://github.com/user-attachments/assets/d04dc407-a831-4d2f-969f-a719f2573b65" />

## 🖌️ Visión General

Este proyecto fusiona conceptos académicos de las Bellas Artes con la programación gráfica a bajo nivel. El objetivo es alejarse de la saturación del fotorrealismo en la web, implementando un motor capaz de tomar geometría 3D pura y procesarla para que parezca ilustrada a mano (estilo grabado, cómic o tinta).

Para lograr esto de forma eficiente y modular, el motor abandona el renderizado directo (Forward Rendering) en favor de una arquitectura de **Multi-Pass Rendering** (Renderizado en Múltiples Pasadas) utilizando WebGPU.

## ⚙️ Arquitectura Técnica (Multi-Pass & Post-Processing)

El *pipeline* gráfico se divide en pasadas secuenciales, utilizando texturas intermedias (*Render Targets*) en lugar de dibujar directamente en el lienzo del navegador.

### 1. Fase de Renderizado Base (Pass 1)
* **Framebuffers & Depth Textures:** La geometría de la escena (SDFs o mallas estáticas) se renderiza primero en una textura de color oculta (`texture_2d<f32>`) y se guarda su información espacial en un buffer de profundidad.
* **Geometría Pura:** En esta fase no se aplican luces complejas ni materiales fotorealistas, optimizando el cálculo de los vértices y preparando el lienzo digital.

### 2. Fase de Post-Procesado NPR (Pass 2)
Se dibuja un *Full-Screen Quad* (un plano que ocupa toda la pantalla) y el *Fragment Shader* toma las texturas de la fase anterior para aplicar filtros matemáticos:
* **Detección de Bordes (Sobel Filter):** Análisis matricial de los píxeles adyacentes para detectar cambios bruscos en la profundidad o el color, trazando contornos oscuros que simulan entintado tradicional.
* **Cel-Shading (Cuantización de Color):** Compresión del rango dinámico de la luz en "bandas" duras y estilizadas, eliminando los degradados suaves de la iluminación digital de Lambert o Phong.
* **Procedural Hatching (Tramado):** Algoritmos trigonométricos basados en las coordenadas de pantalla (`gl_FragCoord`) que dibujan patrones de líneas paralelas en las áreas de sombra, imitando el sombreado a bolígrafo o aguafuerte.

## 💻 Instalación y Desarrollo Local

Proyecto modular construido con **Vite** para garantizar un entorno de desarrollo ultraligero.

1.  **Clona el repositorio:**
    ```bash
    git clone [https://github.com/pepeamoedo/npr-web-renderer.git](https://github.com/pepeamoedo/npr-web-renderer.git)
    cd npr-web-renderer
    ```

2.  **Instala las dependencias:**
    ```bash
    npm install
    ```

3.  **Inicia
