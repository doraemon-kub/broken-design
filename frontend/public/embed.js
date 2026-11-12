// Lixyte — <vm-model> Custom Element wrapping <model-viewer>
// Supports: model-id, key, cdn-base, auto-rotate, camera-controls, background, exposure, shadow-intensity, poster, loading
// Falls back to preview.glb + notice banner when embed_key is invalid/revoked (never crashes).
if (!customElements.get('model-viewer')) {
  const script = document.createElement('script');
  script.type = 'module';
  script.src = 'https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js';
  document.head.appendChild(script);
}

class VmModelElement extends HTMLElement {
  static get observedAttributes() {
    return [
      'model-id',
      'key',
      'cdn-base',
      'auto-rotate',
      'camera-controls',
      'background',
      'exposure',
      'shadow-intensity',
      'poster',
      'loading',
    ];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  render() {
    const modelId = this.getAttribute('model-id');
    if (!modelId) return;

    const key = (this.getAttribute('key') || '').trim();
    const cdnBase = (this.getAttribute('cdn-base') || 'http://localhost:4001').replace(/\/+$/, '');
    const previewSrc = `${cdnBase}/cdn/models/${encodeURIComponent(modelId)}/preview.glb`;
    const fullSrc = `${cdnBase}/cdn/models/${encodeURIComponent(modelId)}/file.glb?key=${encodeURIComponent(key)}`;
    const defaultPoster = `${cdnBase}/cdn/models/${encodeURIComponent(modelId)}/poster.webp`;

    this.style.display = 'block';
    this.style.position = 'relative';

    const viewer = document.createElement('model-viewer');
    viewer.setAttribute('src', key ? fullSrc : previewSrc);
    viewer.setAttribute('loading', this.getAttribute('loading') || 'lazy');
    viewer.setAttribute('poster', this.getAttribute('poster') || defaultPoster);
    viewer.setAttribute('crossorigin', 'anonymous');
    viewer.style.width = 'var(--vm-width, 100%)';
    viewer.style.height = 'var(--vm-height, 400px)';
    viewer.style.backgroundColor = this.getAttribute('background') || 'var(--vm-bg, transparent)';

    ['auto-rotate', 'camera-controls', 'exposure', 'shadow-intensity'].forEach((attr) => {
      if (this.hasAttribute(attr)) {
        viewer.setAttribute(attr, this.getAttribute(attr) || '');
      }
    });

    // If a paid key fails (401/403), fall back to preview.glb and show a non-crashing notice
    if (key) {
      let fellBack = false;
      viewer.addEventListener('error', () => {
        if (fellBack) return;
        fellBack = true;
        viewer.setAttribute('src', previewSrc);

        const banner = document.createElement('div');
        banner.setAttribute('role', 'status');
        banner.textContent = 'ต้องซื้อเพื่อใช้งาน ·แสดงไฟล์ตัวอย่าง (Preview)';
        Object.assign(banner.style, {
          position: 'absolute',
          left: '12px',
          bottom: '12px',
          padding: '6px 10px',
          borderRadius: '6px',
          background: 'rgba(0, 0, 0, 0.78)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          color: '#fbbf24',
          fontFamily: 'monospace',
          fontSize: '12px',
          pointerEvents: 'none',
          zIndex: '10',
        });
        this.appendChild(banner);
      });
    }

    this.innerHTML = '';
    this.appendChild(viewer);
  }
}

if (!customElements.get('vm-model')) {
  customElements.define('vm-model', VmModelElement);
}
