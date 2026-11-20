import * as THREE from '../../vendor/three.module.js';
import { EffectComposer } from '../../vendor/postprocessing/EffectComposer.js';
import { Pass } from '../../vendor/postprocessing/Pass.js';
import { ShaderPass } from '../../vendor/postprocessing/ShaderPass.js';
import { SSAOPass } from '../../vendor/postprocessing/SSAOPass.js';
import { BokehPass } from '../../vendor/postprocessing/BokehPass.js';
import { OutputPass } from '../../vendor/postprocessing/OutputPass.js';

/* Sahneyi mevcut LineartEffect ile hedef dokuya çizen pass.
   OutlineEffect renderer'ın aktif render target'ına yazar; bu yüzden
   EffectComposer zincirine doğrudan girebilir. */
class OutlineRenderPass extends Pass {
  constructor({ viewport }) {
    super();
    this.viewport = viewport;
    this.clear = true;
    this.needsSwap = false;
  }

  render(renderer, writeBuffer, readBuffer) {
    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    if (this.clear) renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
    renderer.autoClear = previousAutoClear;

    if (this.viewport.outline.enabled) {
      this.viewport.outline.render(this.viewport.scene, this.viewport.camera);
    } else {
      renderer.render(this.viewport.scene, this.viewport.camera);
    }
  }
}

/* Kontrast + vinyet. Tone mapping'den sonra, ekran uzayında çalışır. */
const GradeShader = {
  name: 'PoseGradeShader',
  uniforms: {
    tDiffuse: { value: null },
    contrast: { value: 1 },
    vignette: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float contrast;
    uniform float vignette;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 color = (texel.rgb - 0.5) * contrast + 0.5;
      float falloff = smoothstep(0.18, 0.72, length(vUv - 0.5) * 1.41421356);
      color *= 1.0 - vignette * falloff;
      gl_FragColor = vec4(clamp(color, 0.0, 1.0), texel.a);
    }
  `,
};

const TONE_MAPPINGS = {
  none: THREE.NoToneMapping,
  linear: THREE.LinearToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  cineon: THREE.CineonToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
};

/* Post-process hattı: lineart → (SSAO) → (DoF) → tone mapping → grade.
   SSAO, lineart açıkken kapalıdır (normal pass outline mesh'lerini de çizer). */
export class RenderPipeline {
  constructor({ viewport, sceneGraph = null, lighting = null }) {
    this.viewport = viewport;
    this.renderer = viewport.renderer;
    this.scene = viewport.scene;
    this.sceneGraph = sceneGraph;
    this.lighting = lighting;

    this.enabled = true;
    this.lineart = true;
    this.quality = 'high';
    this.ssaoRequested = false;
    this.ssaoActive = false;
    this.dofEnabled = false;
    this.focus = 3;
    this.fstop = 4;
    this.exposure = this.renderer.toneMappingExposure;
    this.toneMappingName = 'aces';
    this.grade = { contrast: 1, vignette: 0 };

    this.width = Math.max(1, viewport.canvas.clientWidth || 320);
    this.height = Math.max(1, viewport.canvas.clientHeight || 260);

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(this.width, this.height);

    this.outlinePass = new OutlineRenderPass({ viewport });
    this.composer.addPass(this.outlinePass);

    this.ssaoPass = new SSAOPass(this.scene, viewport.camera, this.width, this.height);
    this.ssaoPass.kernelRadius = 8;
    this.ssaoPass.minDistance = 0.001;
    this.ssaoPass.maxDistance = 0.05;
    this.ssaoPass.output = SSAOPass.OUTPUT.Default;
    /* SSAO karışımı alfa'yı da çarpıyordu (gövde yarı saydam görünüyordu).
       Yalnızca RGB karart, hedef alfa'yı koru. */
    this.ssaoPass.copyMaterial.blendSrcAlpha = THREE.ZeroFactor;
    this.ssaoPass.copyMaterial.blendDstAlpha = THREE.OneFactor;
    this.ssaoPass.copyMaterial.blendEquationAlpha = THREE.AddEquation;
    this.ssaoPass.copyMaterial.needsUpdate = true;
    this.ssaoPass.enabled = false;
    this.composer.addPass(this.ssaoPass);

    this.bokehPass = new BokehPass(this.scene, viewport.camera, {
      focus: this.focus,
      aperture: 0.00135,
      maxblur: 0.01,
    });
    /* BokehShader alfa'yı 1'e sabitliyor; saydam arka planda alfayı koru. */
    this.bokehPass.materialBokeh.fragmentShader = this.bokehPass.materialBokeh.fragmentShader.replace(
      'gl_FragColor.a = 1.0;',
      'gl_FragColor.a = texture2D( tColor, vUv ).a;',
    );
    this.bokehPass.materialBokeh.needsUpdate = true;
    this.bokehPass.enabled = false;
    this.composer.addPass(this.bokehPass);

    this.outputPass = new OutputPass();
    /* Saydam arka planda alfa korunsun: tam ekran dörtgen doğrudan yazsın. */
    this.outputPass.material.blending = THREE.NoBlending;
    this.outputPass.material.needsUpdate = true;
    this.composer.addPass(this.outputPass);

    this.gradePass = new ShaderPass(GradeShader);
    this.setGrade(this.grade);
    this.composer.addPass(this.gradePass);

    this.setToneMapping('aces');
    this.setFStop(this.fstop);
    this.setFocus(this.focus);

    this._offCamera = viewport.onCameraChange(next => {
      this.ssaoPass.camera = next;
      this.bokehPass.camera = next;
      this.viewport.invalidate();
    });
  }

  render() {
    if (!this.enabled) {
      this.viewport.outline.render(this.scene, this.viewport.camera);
      return;
    }
    this.composer.render();
  }

  resize(width, height) {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.composer.setSize(this.width, this.height);
  }

  setLineart(enabled) {
    this.lineart = !!enabled;
    this.viewport.outline.enabled = this.lineart;
    /* Çoklu karakter: her karakterin kendi grafiği var; hepsine uygulanır. */
    const graphs = typeof this.getGraphs === 'function'
      ? this.getGraphs().filter(Boolean)
      : [this.sceneGraph].filter(Boolean);
    graphs.forEach(graph => graph?.setLineartVisible(this.lineart));
    this.syncSSAO();
    this.viewport.invalidate();
    return this.lineart;
  }

  setSSAO(enabled) {
    this.ssaoRequested = !!enabled;
    this.syncSSAO();
    return this.ssaoActive;
  }

  syncSSAO() {
    this.ssaoActive = this.ssaoRequested && !this.lineart && this.quality !== 'low';
    this.ssaoPass.enabled = this.ssaoActive;
    this.viewport.invalidate();
  }

  setDoF(options = {}) {
    const next = typeof options === 'boolean' ? { enabled: options } : options;
    if (next.enabled !== undefined) this.dofEnabled = !!next.enabled;
    if (next.focus !== undefined) this.setFocus(next.focus);
    if (next.fstop !== undefined) this.setFStop(next.fstop);
    if (next.maxblur !== undefined) {
      this.bokehPass.uniforms.maxblur.value = THREE.MathUtils.clamp(Number(next.maxblur) || 0, 0, 0.02);
    }
    this.bokehPass.enabled = this.dofEnabled;
    this.viewport.invalidate();
    return this.dofEnabled;
  }

  setFocus(distance) {
    this.focus = THREE.MathUtils.clamp(Number(distance) || 0.1, 0.05, 50);
    this.bokehPass.uniforms.focus.value = this.focus;
    this.viewport.invalidate();
    return this.focus;
  }

  setFStop(fstop) {
    this.fstop = THREE.MathUtils.clamp(Number(fstop) || 4, 1.4, 22);
    this.bokehPass.uniforms.aperture.value = 0.0001 + 0.02 / (this.fstop * this.fstop);
    this.viewport.invalidate();
    return this.fstop;
  }

  setGrade(patch = {}) {
    if (patch.contrast !== undefined) this.grade.contrast = THREE.MathUtils.clamp(Number(patch.contrast) || 1, 0.1, 4);
    if (patch.vignette !== undefined) this.grade.vignette = THREE.MathUtils.clamp(Number(patch.vignette) || 0, 0, 1);
    this.gradePass.uniforms.contrast.value = this.grade.contrast;
    this.gradePass.uniforms.vignette.value = this.grade.vignette;
    this.viewport.invalidate();
    return { ...this.grade };
  }

  setToneMapping(name) {
    const key = TONE_MAPPINGS[name] === undefined ? 'aces' : name;
    this.toneMappingName = key;
    this.renderer.toneMapping = TONE_MAPPINGS[key];
    this.viewport.invalidate();
    return this.toneMappingName;
  }

  setExposure(value) {
    this.exposure = THREE.MathUtils.clamp(Number(value) || 1, 0.1, 4);
    this.renderer.toneMappingExposure = this.exposure;
    this.viewport.invalidate();
    return this.exposure;
  }

  setQuality(level) {
    const next = ['low', 'medium', 'high'].includes(level) ? level : 'high';
    this.quality = next;
    if (next === 'low') this.ssaoRequested = false;

    const ratio = Math.min(window.devicePixelRatio || 1, next === 'low' ? 1.5 : 2);
    this.renderer.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);

    this.lighting?.setShadowQuality(next);
    this.syncSSAO();
    this.viewport.resize();
    return next;
  }

  dispose() {
    this._offCamera?.();
    /* Dispose sonrası rAF loop'u composer'a tekrar dokunmasın: dispose
       edilmiş hedeflerin yeniden yüklenmesi (zombi GPU kopyaları) sayaç
       sızıntısı gibi görünür ve kullanıcı modunu boşa çizer. */
    this.enabled = false;
    this.composer.dispose();
    this.ssaoPass.dispose();
    this.bokehPass.dispose();
    this.outputPass.dispose();
    this.gradePass.dispose();
  }
}
