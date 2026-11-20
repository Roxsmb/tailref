/* Kompozisyon kılavuzları: rule of thirds, golden ratio, merkez artı. */
export class Guides {
  constructor({ container }) {
    this.container = container;
    this.mode = 'off';
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'poseGuides');
    this.svg.setAttribute('viewBox', '0 0 100 100');
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.svg.setAttribute('aria-hidden', 'true');
    container.insertBefore(this.svg, container.querySelector('.poseHud'));
    this.set('off');
  }

  line(x1, y1, x2, y2, strong = false) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    el.setAttribute('x1', x1); el.setAttribute('y1', y1);
    el.setAttribute('x2', x2); el.setAttribute('y2', y2);
    el.setAttribute('vector-effect', 'non-scaling-stroke');
    if (strong) el.setAttribute('class', 'strong');
    this.svg.appendChild(el);
  }

  set(mode) {
    this.mode = mode;
    this.svg.replaceChildren();
    this.svg.dataset.guide = mode;
    if (mode === 'off') {
      this.svg.style.display = 'none';
      return;
    }
    this.svg.style.display = 'block';

    if (mode === 'thirds') {
      [100 / 3, 200 / 3].forEach(value => {
        this.line(value, 0, value, 100);
        this.line(0, value, 100, value);
      });
    } else if (mode === 'golden') {
      const a = 38.2;
      const b = 61.8;
      [a, b].forEach(value => {
        this.line(value, 0, value, 100, true);
        this.line(0, value, 100, value, true);
      });
      this.line(0, 0, a, a);
      this.line(100, 0, b, a);
      this.line(0, 100, a, b);
      this.line(100, 100, b, b);
    } else if (mode === 'crosshair') {
      this.line(50, 0, 50, 100, true);
      this.line(0, 50, 100, 50, true);
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', 50); circle.setAttribute('cy', 50); circle.setAttribute('r', 6);
      circle.setAttribute('vector-effect', 'non-scaling-stroke');
      this.svg.appendChild(circle);
    }
  }

  dispose() {
    this.svg.remove();
    this.mode = 'off';
    this.container = null;
  }
}
