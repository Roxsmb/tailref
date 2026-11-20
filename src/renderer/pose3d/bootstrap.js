import * as THREE from '../vendor/three.module.js';
import { Viewport } from './core/Viewport.js';
import { CameraManager } from './core/CameraManager.js';
import { SceneGraph } from './core/SceneGraph.js';
import { RenderPipeline } from './core/RenderPipeline.js';
import { Environment } from './environment/Environment.js';
import { LightingRig } from './environment/LightingRig.js';
import { Rig } from './posing/Rig.js';
import { PosingController } from './posing/PosingController.js';
import { GizmoManager } from './posing/GizmoManager.js';
import { PoseHistory } from './posing/PoseHistory.js';
import { PoseLibrary } from './posing/PoseLibrary.js';
import { RenderExporter } from './capture/RenderExporter.js';
import { BoardBridge } from './bridge/BoardBridge.js';
import { buildScaleReferenceDummy } from './dummy/DummyRig.js';
import { PanelController } from './ui/PanelController.js';
import { Hud } from './ui/Hud.js';
import { Guides } from './ui/Guides.js';

/* Uygulama girişi: modülleri kurar ve modeli yükler. */
export async function boot() {
  const panel = document.querySelector('#pose3dPanel');
  const canvas = document.querySelector('#pose3dCanvas');
  if (!panel || !canvas) throw new Error('3D Pose panel bulunamadı');

  const viewport = new Viewport({ canvas });
  const environment = new Environment({ viewport });
  const lighting = new LightingRig({ viewport });
  const camera = new CameraManager({ viewport });
  const sceneGraph = new SceneGraph({ viewport });
  const pipeline = new RenderPipeline({ viewport, sceneGraph, lighting });
  /* Çoklu karakter: pipeline lineart anahtarı tüm karakter grafiklerine
     uygulanır (karakter manager aşağıda doldurulur). */
  pipeline.getGraphs = () => characters.filter(c => c.ready).map(c => c.graph);
  viewport.pipeline = pipeline;
  viewport.onResize((width, height) => pipeline.resize(width, height));
  pipeline.resize(viewport.canvas.clientWidth || 320, viewport.canvas.clientHeight || 260);
  /* --- Çoklu karakter (9 Kasım): Kız + Erkek ---
     Her karakter kendi SceneGraph'ına (toon + lineart + parça listesi),
     kendi Rig ve PoseHistory'sine sahiptir. Poza koyma kontrolleri
     (posing + gizmo + halkalar) ETKİN karaktere bağlanır; sol menüdeki
     "Karakterler" bölümünden etkinlik ve görünürlük seçilir. Kız
     merkezde kalır, Erkek sağına dizilir. */
  const rig = new Rig();      // Kız karakterin iskeleti (geriye uyumlu ad)
  const history = new PoseHistory(); // Kız karakterin poz geçmişi
  const library = new PoseLibrary();
  const characters = [];
  let activeChar = null;

  let posing = null;
  const gizmo = new GizmoManager({
    viewport,
    camera: viewport.camera,
    onChange: object => posing?.handleObjectChange(object),
    onDragging: active => posing?.handleDragging(active),
  });

  posing = new PosingController({ viewport, rig, gizmo, history });

  /* Kamera değişince gizmo ve controller aynı kamerayı kullanmalı. */
  viewport.onCameraChange(next => {
    gizmo.controls.camera = next;
    posing.camera = next;
  });

  const hud = new Hud({ panel, canvas });
  const guides = new Guides({ container: canvas.parentElement });
  const exporter = new RenderExporter({
    viewport, pipeline, sceneGraph, lighting, posing, gizmo, skeleton: null, guides,
    getGraphs: () => characters.filter(c => c.ready && c.visible).map(c => c.graph),
  });
  const board = new BoardBridge();
  viewport.start();

  let panelController = null;

  /* --- Karakter yükleyici (Kız + Erkek ortak) ---
     Zincir: FBX (kemikli/skin'li — poza koyma çalışır) → OBJ (statik
     referans) → programatik iskelet (portatif paket dayanıklılığı).
     install() her yolda toon/lineart/ölçek normalizasyonunu aynen uygular. */
  const CHARACTERS = [
    { id: 'female', label: 'Girl', url: 'assets/models/female-base.fbx', objUrl: 'assets/models/female-base.obj', offsetX: 0 },
    { id: 'male', label: 'Boy', url: 'assets/models/male-base.fbx', offsetX: 0.9 },
  ];

  async function loadCharacter(def) {
    const graph = new SceneGraph({ viewport });
    let info;
    try {
      info = await graph.load(def.url);
    } catch (errorFbx) {
      console.warn(`${def.label} FBX yüklenemedi; OBJ deneniyor`, errorFbx);
      try {
        info = await graph.loadOBJ(def.objUrl);
      } catch (errorObj) {
        console.warn(`${def.label} OBJ da yüklenemedi; programatik iskelet`, errorObj);
        info = graph.install(buildScaleReferenceDummy());
      }
    }
    if (def.offsetX) {
      graph.root.position.x += def.offsetX;
      graph.root.updateMatrixWorld(true);
    }
    /* Karakter boyutu: yükteki yerleşik ölçek taban alınır; slider çarpanı
       bununla çarpılır (12 Kasım: "erkeği dev, kızı peri yap" isteği). */
    const baseScale = Math.max(0.0001, graph.root.scale.x || 1);
    /* Kız, yukarıda kurulan (poser/singleton geçmelerine uyumlu) rig ve
       pose geçmişini devam ettirir; Erkek kendi örneklerini alır. */
    const isFemale = def.id === 'female';
    const characterRig = isFemale ? rig : new Rig();
    const characterHistory = isFemale ? history : new PoseHistory();
    characterRig.build(graph.root);

    const skeletonHelper = new THREE.SkeletonHelper(graph.root);
    skeletonHelper.visible = false;
    skeletonHelper.material.depthTest = false;
    skeletonHelper.material.transparent = true;
    skeletonHelper.material.opacity = 0.82;
    viewport.scene.add(skeletonHelper);

    const char = {
      id: def.id, label: def.label, graph,
      rig: characterRig, history: characterHistory,
      info, skeleton: skeletonHelper,
      ready: true, visible: true,
      scaleFactor: 1, baseScale,
      pendingVisible: null, pendingBones: null, pendingParts: null, pendingScale: null,
    };
    characters.push(char);
    /* Ctrl+Z/redo ölçek köprüsü: geçmiş maddesindeki oran buraya
       bildirilir; scaleFactor + kök ölçek + kaydırıcı arayüzü güncellenir. */
    char.rig.onScaleRatio = factor => {
      const next = Math.round(Math.min(5, Math.max(0.2, Number(factor) || 1)) * 10) / 10;
      if (next === (char.scaleFactor ?? 1)) return;
      char.scaleFactor = next;
      applyCharacterScale(char);
      /* Yeni bir ölçek hamlesi yeniden "ilk adım" sayılsın. */
      char._scalePushAt = null;
      contractSave();
      charactersManager.refreshUI();
      viewport.invalidate();
    };
    return char;
  }

  /* Karakter boyutunu kök ölçeğine uygula: taban ölçek savılır, slider
     çarpanı üstüne gelir. Hedef kutusu/kamera merkez etiketi yer güncel. */
  function applyCharacterScale(char) {
    if (!char?.ready || !char.graph?.root) return;
    char.graph.root.scale.setScalar((char.baseScale || 1) * (char.scaleFactor ?? 1));
    /* Rig de oranı bilsin: undo/redo snapshot'ları ölçek taşır. */
    if (char.rig) char.rig.scaleRatio = char.scaleFactor ?? 1;
    char.graph.root.updateMatrixWorld(true);
  }

  /* Etkin karakterde poza koyma kontrollerini yeniden bağla. */
  function activateCharacter(id) {
    const char = characters.find(c => c.id === id && c.ready);
    if (!char) return false;
    activeChar = char;
    posing.rig = char.rig;
    posing.history = char.history;
    posing.clearHandles();
    posing.buildHandles(char.info.size);
    if (exporter && 'skeleton' in exporter) exporter.skeleton = char.skeleton;
    hud?.setStatus(
      __t('{name} · {bones} bones · {controls} controls', { name: char.label, bones: char.rig.bones.length, controls: posing.handles.length }));
    viewport.invalidate();
    return true;
  }

  /* Kamera hedefini görünür karakterlerin ortasına kaydır. */
  function updateCameraTargetForVisible() {
    if (!camera) return;
    const visible = characters.filter(c => c.ready && c.visible && c.graph.root);
    if (!visible.length) return;
    const box = new THREE.Box3();
    for (const entry of visible) box.expandByObject(entry.graph.root);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    camera.setTarget(center.x, center.y, center.z);
    viewport.invalidate();
  }

  /* Panel / kayıt / geri yükleme köprüsü. */
  const charactersManager = {
    get list() { return characters.slice(); },
    get active() { return activeChar; },
    get activeId() { return activeChar?.id || null; },
    get(id) { return characters.find(c => c.id === id) || null; },
    activate: id => activateCharacter(id),
    setVisible(id, visible) {
      const char = characters.find(c => c.id === id);
      if (!char) return false;
      const want = !!visible;
      if (!char.ready) { char.pendingVisible = want; return true; }
      char.pendingVisible = null;
      char.visible = want;
      if (char.graph.root) char.graph.root.visible = want;
      /* Etkin karakter gizleniyorsa görünen bir karaktere devret. */
      if (!want && activeChar === char) {
        const next = characters.find(c => c.ready && c.visible && c.id !== id);
        if (next) activateCharacter(next.id);
      }
      updateCameraTargetForVisible();
      charactersManager.refreshUI();
      contractSave();
      viewport.invalidate();
      return true;
    },
    /* Rigi göster/gizle: tüm karakterler birlikte. */
    setRigVisible(show) {
      characters.forEach(char => {
        if (char.skeleton) char.skeleton.visible = !!show && char.visible;
      });
      viewport.invalidate();
    },
    getRigVisible() {
      return characters.some(char => char.ready && char.skeleton?.visible && char.visible);
    },
    /* Lineart kalınlığı tüm karakter grafiklerinde ortak tutulur. */
    setLineartScale(scale) {
      characters.forEach(char => {
        if (char.ready && char.graph?.setLineartScale) char.graph.setLineartScale(scale);
      });
    },
    /* Karakter boyutu: taban ölçek × çarpan (0.2× peri … 5× dev).
       Değişiklik bu karakterin poz geçmişine de girer: Ctrl+Z büyütme/
       küçültme adımlarını geri alır (kullanıcı, 9 Kasım). */
    setScale(id, factor, opts = {}) {
      const char = characters.find(c => c.id === id);
      if (!char) return null;
      const next = Math.round(Math.min(5, Math.max(0.2, Number(factor) || 1)) * 10) / 10;
      if (!char.ready) { char.pendingScale = next; return next; }
      char.pendingScale = null;
      const prevFactor = char.scaleFactor ?? 1;
      if (next !== prevFactor && opts.noHistory !== true) {
        /* Sürükleme 0.1'lik adımlarla sık gelir: 500 ms içindeki
           adımlar tek geri-al adımı olur (ön-madde yalnız ilk adımda). */
        const now = performance.now();
        const coalesce = char._scalePushAt != null && (now - char._scalePushAt) < 500;
        char._scalePushAt = now;
        if (!coalesce) {
          const pre = char.rig.snapshot(); // .scale = önceki oran taşınır
          char.history?.push(pre);
        }
      } else if (next !== prevFactor) {
        char._scalePushAt = performance.now();
      }
      char.scaleFactor = next;
      applyCharacterScale(char);
      /* KAMERAYA DOKUNMA: boyut değiştirirken kamera kendi halinde
         kalmalı (kullanıcı: "kamera garip hareketler yapıyor"). Etiket
         yenileme yalnız görünür/geri yükleme akışında yapılır. */
      contractSave();
      viewport.invalidate();
      return next;
    },
    getScale(id) {
      const char = characters.find(c => c.id === id);
      return char ? (char.scaleFactor ?? 1) : null;
    },
    restoreCharacter(rec) {
      if (!rec || typeof rec !== 'object') return false;
      const char = characters.find(c => c.id === rec.id)
        || characters.find(c => c.ready)
        || null;
      if (!char) return false;
      this.setVisible(char.id, rec.visible !== false);
      if (!char.ready) {
        /* Karakter hâlâ yükleniyor: kayıtlar yükleyici botça uygular. */
        char.pendingVisible = rec.visible !== false;
        char.pendingBones = rec.bones || null;
        char.pendingParts = rec.parts || null;
        char.pendingScale = Number.isFinite(rec.scale) && rec.scale > 0
          ? Math.round(Math.min(5, Math.max(0.2, rec.scale)) * 10) / 10
          : null;
        viewport.invalidate();
        return true;
      }
      if (Array.isArray(rec.bones) && char.rig) char.rig.restoreJSON(rec.bones);
      if (Array.isArray(rec.parts) && char.graph) {
        rec.parts.forEach(part => {
          if (Number.isInteger(part?.index)) {
            char.graph.setPartVisible(part.index, part.visible !== false);
          }
        });
      }
      if (Number.isFinite(rec.scale) && rec.scale > 0) {
        char.scaleFactor = Math.round(Math.min(5, Math.max(0.2, rec.scale)) * 10) / 10;
        applyCharacterScale(char);
        updateCameraTargetForVisible();
      }
      viewport.invalidate();
      return true;
    },
    /* Kayıt için serileştirilebilir liste (26-projects capturePose3d). */
    listForSave() {
      return characters.map(char => ({
        id: char.id,
        label: char.label,
        ready: !!char.ready,
        visible: !!char.visible,
        modelName: char.graph.root?.name || char.label,
        rigSignature: char.rig?.signature || null,
        scale: char.scaleFactor ?? 1,
        bones: char.ready && char.rig ? char.rig.snapshotJSON() : null,
        parts: char.ready && char.graph
          ? char.graph.partStates.map(part => ({
            index: part.index, name: part.name, visible: part.visible !== false,
          }))
          : null,
      }));
    },
    refreshUI() {
      if (panelController?.refreshCharacterList) panelController.refreshCharacterList();
    },
    /* Kamera hedefini görünen karakterlerin merkezine yeniden oturt. */
    retarget() {
      updateCameraTargetForVisible();
      viewport.invalidate();
    },
  };

  /* 3D değişiklikte 2D pano kaydına yansıt (poser/panel ile aynı kural). */
  const contractSave = () => {
    if (typeof window.scheduleSave === 'function') window.scheduleSave();
  };

  try {
    let info = null;
    const female = await loadCharacter(CHARACTERS[0]);
    info = female.info;
    activateCharacter('female');
    exporter.skeleton = female.skeleton;
    camera.setTarget(info.center.x - CHARACTERS[0].offsetX, info.center.y, info.center.z);
    viewport.camera.position.set(info.size.y * 0.9, info.size.y * 0.55, info.size.y * 1.5);
    viewport.camera.near = Math.max(0.01, info.size.y / 100);
    viewport.camera.far = info.size.y * 20;
    viewport.camera.updateProjectionMatrix();
    lighting.fit(info.size);
    pipeline.setFocus(viewport.camera.position.distanceTo(camera.target));
    viewport.invalidate();
  } catch (error) {
    console.error('taban model kurulumu başarısız', error);
  }

  panelController = new PanelController({
    panel, canvas, viewport, rig, posing, gizmo, camera, exporter, sceneGraph, environment, lighting, library, skeleton: charactersManager.get('female')?.skeleton || null, hud, guides, pipeline, board,
    characters: charactersManager,
  });

  /* Ayarlar penceresi 3D sütunundaki "Her şeyi sıfırla" düğmesi bu
     köprüyü kullanır; 3D hiç açılmadıysa köprü yoktur, düğme o zaman
     "sıfırlanacak sahne yok" bildirimi verir. */
  window.tailrefPose3dEverything = () => {
    try { return panelController?.applyResetEverything() || null; } catch (error) { console.warn('3D sıfırlama başarısız', error); return null; }
  };

  /* Ayarlar penceresi "Hız ve Performans" bölümünün 3D ayağı: elle kalite,
     otomatik'e dönüş ve yeniden ölçüm. 3D hiç açılmadıysa bu köprü yoktur;
     Ayarlar seçimi localStorage'a yazılır, 3D açılışında oturtulur. */
  window.tailrefPose3dPerf = {
    level: () => pipeline.quality,
    setManual: level => { try { return panelController?.applyQuality(level, 'ui'); } catch (error) { return null; } },
    setAuto: () => panelController?.perfSetAuto(),
    remeasure: () => panelController?.perfRemeasure() ?? null,
  };

  /* Kemik yok (statik mesh taban) → durum satırı bunu açıkça söylesin.
     Dil değişiminde satır yeniden çözülür (açılışta bir kez yazılır). */
  function refreshStatus() {
    if (!hud) return;
    const char = activeChar || characters.find(c => c.ready);
    if (char?.rig?.bones?.length) {
      hud.setStatus(
        __t('{name} · {bones} bones · {controls} controls', { name: __t(char.label), bones: char.rig.bones.length, controls: posing.handles.length }));
      return;
    }
    hud.setStatus(
      __t('static base model · {n} meshes · {controls} controls', { n: charactersManager.get('female')?.graph?.meshes?.length ?? 0, controls: posing.handles.length }));
  }
  refreshStatus();
  if (window.L10N && typeof window.L10N.onChange === 'function') {
    window.L10N.onChange(() => { try { refreshStatus(); } catch { /* durum yenileme hatası önemsiz */ } });
  }

  /* Erkek karakter arka planda yüklenir (Kız hemen hazır). */
  loadCharacter(CHARACTERS[1]).then(char => {
    if (char.pendingVisible !== null || char.pendingBones || char.pendingParts || char.pendingScale) {
      charactersManager.restoreCharacter({
        id: char.id, visible: char.pendingVisible !== null ? char.pendingVisible : char.visible,
        bones: char.pendingBones || null, parts: char.pendingParts || null,
        scale: char.pendingScale ?? undefined,
      });
      char.pendingBones = null;
      char.pendingParts = null;
      char.pendingScale = null;
      contractSave();
    }
    charactersManager.refreshUI();
    updateCameraTargetForVisible();
    viewport.invalidate();
  }).catch(error => console.error('erkek karakter yüklenemedi', error));

  /* Tek noktadan kapatma: testler ve sayfa boşaltma aynı sırayı kullanır. */
  let disposed = false;
  const teardown = () => {
    if (disposed) return false;
    disposed = true;
    const steps = [
      () => panelController?.dispose(),
      () => hud.dispose(),
      () => guides.dispose(),
      () => posing?.dispose(),
      () => gizmo.dispose(),
      () => exporter.dispose(),
      () => board.dispose(),
      () => library.dispose(),
      /* Çoklu karakter: her karakterin tarihçesi, rig'i, iskelet
         yardımcısı ve kendi sahne grafiği ayrı ayrı serbest bırakılır. */
      () => characters.forEach(char => { char.history?.dispose?.(); }),
      () => characters.forEach(char => { char.rig?.dispose?.(); }),
      () => characters.forEach(char => {
        const helper = char.skeleton;
        if (!helper) return;
        helper.parent?.remove(helper);
        helper.geometry?.dispose?.();
        helper.material?.dispose?.();
        char.skeleton = null;
      }),
      () => lighting.dispose(),
      () => environment.dispose(),
      () => characters.forEach(char => {
        try { char.graph?.dispose?.(); } catch (e) { console.warn('karakter grafiği bırakılamadı', e); }
      }),
      () => sceneGraph.dispose?.(),
      () => pipeline.dispose(),
      () => camera.dispose(),
      () => viewport.dispose(),
    ];
    const stats = [];
    steps.forEach((step, index) => {
      try { step(); } catch (error) { console.warn('3D kapatma adımı atlandı', error); }
      const memory = viewport.renderer.info.memory;
      stats.push([index, memory.geometries, memory.textures]);
    });
    window.__pose3dTeardownStats = stats;
    window.__pose3dReady = false;
    window.__pose3dDebug = null;
    window.tailrefPose3dEverything = null;
    if (typeof window.tailrefPose3dPerf !== 'undefined') window.tailrefPose3dPerf = null;
    return true;
  };
  window.tailrefDispose3d = teardown;
  window.addEventListener('pagehide', teardown, { once: true });

  /* Test / hata ayıklama köprüsü. Çoklu karakterde `character/bones/parts/
     rig/sceneGraph/history` ETKİN karakteri izler. */
  window.__pose3dDebug = {
    revision: THREE.REVISION,
    viewport,
    renderer: viewport.renderer,
    scene: viewport.scene,
    camera: viewport.camera,
    get cameraManager() { return camera; },
    controls: camera.controls,
    gizmo: gizmo.controls,
    gizmoHelper: gizmo.helper,
    get character() { return activeChar?.graph?.root || null; },
    get bones() { return activeChar?.rig?.bones || []; },
    get controllers() { return posing.handles; },
    get parts() { return activeChar?.graph?.partStates || []; },
    get rig() { return activeChar?.rig || rig; },
    get history() { return activeChar?.history || history; },
    get sceneGraph() { return activeChar?.graph || sceneGraph; },
    get characterManager() { return charactersManager; },
    get activeCharacterId() { return activeChar?.id || null; },
    get characterList() {
      return () => charactersManager.listForSave();
    },
    posing, library, environment, lighting, pipeline, panelController, hud, guides, cameraManager: camera,
    exporter, board,
    get captureModal() { return panelController?.captureModal || null; },
  };
  window.__pose3dReady = true;

  /* 3D değişiklikleri (kamera/poz) 2D pano kaydına da yansısın. */
  const queue3dSave = () => {
    if (typeof window.scheduleSave === 'function') window.scheduleSave();
  };
  viewport.canvas.addEventListener('pointerup', queue3dSave);
  viewport.canvas.addEventListener('wheel', queue3dSave, { passive: true });

  /* Pano yöneticisi bu olaydan sonra kayıtlı kamera/pozu uygular. */
  window.dispatchEvent(new CustomEvent('tailref-3d-ready'));
  return { teardown };
}
