import * as THREE from '../../vendor/three.module.js';
import { CaptureModal } from './CaptureModal.js';

/* Panel DOM bağlantıları: aç/kapa, boyut, HUD, kontroller, kısayollar. */
export class PanelController {
  constructor({ panel, canvas, viewport, rig, posing, gizmo, camera, exporter, sceneGraph, environment, lighting, library, skeleton, hud, guides, pipeline, board = null, characters = null }) {
    this.panel = panel;
    this.canvas = canvas;
    this.viewport = viewport;
    this.rig = rig;
    this.posing = posing;
    this.gizmo = gizmo;
    this.camera = camera;
    this.exporter = exporter;
    this.board = board;
    this.sceneGraph = sceneGraph;
    this.environment = environment;
    this.lighting = lighting;
    this.library = library;
    this.skeleton = skeleton;
    this.hud = hud;
    this.guides = guides;
    this.pipeline = pipeline;
    /* Otomatik performans vitesi (11 Kasım): 'tailref-q3d-level' = 'auto'
       iken gözcü FPS'i izler; kısılma gerekince kaliteyi kendi düşürür,
       makine rahatlayınca yavaşça yükseltir. Elle kalite seçilirse
       otomatik o madde için köprüyü devre dışı bırakır (kullanıcı sözü). */
    this.perf = { level: String(localStorage.getItem('tailref-q3d-level') || 'auto'), win: [], last: 0, bad: 0, good: 0 };
    if (this.perf.level !== 'auto' && pipeline.quality !== this.perf.level) {
      try { pipeline.setQuality(this.perf.level); } catch { /* sessiz */ }
    }
    viewport.onRender(() => this._perfSample());
    /* Çoklu karakter (9 Kasım): manager verildiyse rig/posing/history/
       sceneGraph/skeleton okumaları ETKİN karaktere akar. posing tek
       örnektir; gizmo/kamera herkese ortaktır. */
    this.characters = characters || null;
    ['rig', 'history', 'sceneGraph', 'skeleton'].forEach(key => {
      const direct = this[key];
      Object.defineProperty(this, key, {
        get() {
          const char = typeof this.characters?.active === 'function'
            ? this.characters.active()
            : this.characters?.active;
          if (char?.ready) {
            if (key === 'rig') return char.rig;
            if (key === 'history') return char.history;
            if (key === 'sceneGraph') return char.graph;
            if (key === 'skeleton') return char.skeleton;
          }
          return direct ?? null;
        },
      });
    });
    this.activeLight = 'key';
    this.pointerInside = false;
    this.openButton = document.querySelector('#btnPose3d');
    this.modeTabButton = document.querySelector('#mode3dBtn');
    this.closeButton = document.querySelector('#btnPose3dClose');
    this.expandButton = document.querySelector('#btnPose3dExpand');
    this.fullscreenButton = document.querySelector('#btnPose3dFullscreen');
    this.fullscreenExitButton = document.querySelector('#poseFullscreenExit');
    this.settingsButton = document.querySelector('#poseFullscreenSettings');
    this.settingsCloseButton = document.querySelector('#poseFullscreenSettingsClose');
    this.settingsAccordion = panel.querySelector('.poseAccordion');
    this.settingsOpen = false;
    this._abort = new AbortController();
    this.signal = this._abort.signal;
    this._fullscreenWanted = false;
    this._windowWasFullscreen = false;
    this._hiddenObserver = new MutationObserver(() => {
      if (this.panel.hidden) {
        /* Sınıfı sakin biçimde kaldır; OS pencere tam ekranına karışma. */
        this._fullscreenWanted = false;
        this.setFullscreenState(false);
        this.setSettingsOpen(false);
      }
      this.syncModeTab();
    });
    this._hiddenObserver.observe(this.panel, { attributes: true, attributeFilter: ['hidden'] });
    document.addEventListener('fullscreenchange', () => this.syncFullscreen(), { signal: this.signal });
    /* Mod değişimi (Referans ↔ Çizim) 3D tam ekrandayken olursa panel tam
       ekrandan çıkar ve arkadaki modun üstünde yüzen küçük panel olarak kalır. */
    window.addEventListener('tailref-mode-changed', event => {
      const mod = event.detail?.mode;
      if (mod === '3d') return;
      if (mod === 'draw' || mod === 'reference') {
        if (!this.panel.hidden) {
          if (this.isFullscreen()) { this._fullscreenWanted = false; this.setFullscreenState(false); }
          this.setSettingsOpen(false);
          if (window.tailrefClosePanel) window.tailrefClosePanel(this.panel);
          else this.panel.hidden = true;
        }
      }
      this.syncModeTab();
    }, { signal: this.signal });
    /* 39-mode.js köprüsü: mod sistemi 3D panelin tam ekran durumunu yönetir. */
    window.pose3dFullscreenSet = on => {
      if (on) { if (!this.isFullscreen()) this.setFullscreenState(true); this.hud?.wake(); }
      else if (this.isFullscreen()) { this._fullscreenWanted = false; this.setFullscreenState(false); }
      this.syncModeTab();
    };
    this.bind();
    this.bindCamera();
    this.bindPose();
    this.bindLight();
    this.bindView();
    this.floatifyStack();
    this.captureModal = new CaptureModal({
      panel, exporter, board: this.board, hud, guides,
    });
    this.bindCapture();
    this.syncGizmoButtons();
    this.syncGizmoSpace();
    this.syncCameraPanel();
    this._offCameraChange = viewport.onCameraChange(() => this.syncCameraPanel());
    /* Panel geç hazırlanmış olabilir: 3D modu o anda açıksa tam ekran
       durumunu eşitle (modeEnter3d'in hook'u bu noktadan önce şaşsurdu). */
    if (document.body.classList.contains('mode-3d') && !this.isFullscreen()) {
      this.setFullscreenState(true);
      this.hud?.wake();
    }
  }

  /* =========================================================
     floatifyStack — YÜZEN 3D KARTLARI (Kamera · Poz · Görüntü)
     ---------------------------------------------------------
     Eski sabit 192px sağ sütun kalktı: kartlar artık sahne
     üzerinde yüzer, başlık (summary) şeridinden tutulup
     sürüklenir, alt alta dizilir; konum + açık/kapalı durumu
     localStorage'da ("tailref-pose-stack-v2") saklanır.
     v1 → v2: eski tuhaf kayıtlar (kartların ortada kalması,
     8 Kasım) yok sayılır; her boyut değişiminde y<66 (HUD
     altı) tekrar kepentilir; kart başlığına ÇİFT TIK varsayılan
     sağ hizaya geri dizer.
     ========================================================= */
  floatifyStack() {
    const host = this.panel.querySelector('.poseStack');
    if (!host || host.dataset.driftReady) return;
    host.dataset.driftReady = '1';
    const items = [...host.querySelectorAll('.poseStackItem')];
    const KEY = 'tailref-pose-stack-v2';
    const Y_MIN = 66; /* HUD çiplerinin (top 66) altı */
    const state = { saved: null, dirty: false };
    try { state.saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { state.saved = null; }

    /* Kayıt YALNIZ tam ekranda anlamlıdır: küçük pencerede kartlar
       akış düzenindedir; orada yazılan y(~0) / dx değerleri tam
       ekranda kartları HUD'un üstüne, ortaya yapıştırıyordu. */
    const isFullscreen = () => this.panel.classList.contains('pose3d-fullscreen');

    const save = () => {
      if (!state.dirty) return;
      state.dirty = false;
      if (!isFullscreen()) return;
      const box = host.getBoundingClientRect();
      if (!box.width) return;
      const data = {};
      for (const item of items) {
        const card = item.getBoundingClientRect();
        data[item.id] = {
          dx: Math.round(box.right - card.right),
          y: Math.round(card.top - box.top),
          open: item.open,
        };
      }
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* sessiz */ }
    };

    const clampXy = (item, dx, y) => {
      const box = host.getBoundingClientRect();
      const w = item.offsetWidth || 190;
      const h = item.offsetHeight || 180;
      const maxX = Math.max(8, box.width - w - 8);
      const maxY = Math.max(Y_MIN, box.height - h - 8);
      item.style.right = Math.min(Math.max(dx, 8), maxX) + 'px';
      item.style.top = Math.min(Math.max(y, Y_MIN), maxY) + 'px';
    };

    /* Kayıtlı konum varsa onu, yoksa sağ üstten alt alta kaskad. */
    const apply = () => {
      if (!isFullscreen()) return false;
      const box = host.getBoundingClientRect();
      if (!box.width) return false;
      let y = 104; /* üstteki HUD çiplerinin altından başlat */
      for (const item of items) {
        const st = state.saved && state.saved[item.id];
        if (st && typeof st.open === 'boolean') item.open = st.open;
        else if (item.id === 'poseStackView') item.open = false; /* ilk açılış: Görüntü kapalı */
        if (st && Number.isFinite(st.dx) && Number.isFinite(st.y) && st.y <= box.height - 60) {
          clampXy(item, st.dx, st.y);
        } else {
          clampXy(item, 12, y);
          y += item.offsetHeight + 10;
        }
      }
      return true;
    };

    /* Çift tık: bu kartı (ve diziye bağlı olarak hepsini) varsayılan
       sağ hizaya dizer — kullanıcı kartları tuhaf bir yere sürükledi
       ya da eski tuhaf kayıt kaldıysa tek kendine onarabilmesi için.
       AYARLAR penceresi de burayı kullanır: window.tailrefPoseStackReset
       (3D sütunundaki "Tümünü sıfırla" düğmesi, 8 Kasım). */
    const resetToRight = () => {
      try { localStorage.removeItem(KEY); } catch { /* sessiz */ }
      state.saved = null;
      apply();
      save();
    };
    window.tailrefPoseStackReset = () => { resetToRight(); return items.length; };

    for (const item of items) {
      const head = item.querySelector('summary');
      if (!head) continue;
      let pid = null, sx = 0, sy = 0, startDx = 12, startY = 104, moved = false, suppressClick = false;
      head.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        /* "?" yardım düğmesi sürüklemeyi tetiklemesin; aksi halde
           setPointerCapture tığı yutar. */
        if (e.target?.closest?.('.poseHelp')) return;
        pid = e.pointerId; sx = e.clientX; sy = e.clientY; moved = false;
        const card = item.getBoundingClientRect();
        const box = host.getBoundingClientRect();
        startDx = box.right - card.right;
        startY = card.top - box.top;
        try { head.setPointerCapture(pid); } catch { /* sessiz */ }
      }, { signal: this.signal });
      head.addEventListener('pointermove', e => {
        if (pid === null || e.pointerId !== pid) return;
        const ddx = e.clientX - sx, ddy = e.clientY - sy;
        if (!moved && Math.abs(ddx) < 6 && Math.abs(ddy) < 6) return;
        moved = true;
        clampXy(item, startDx - ddx, startY + ddy);
        e.preventDefault();
      }, { signal: this.signal });
      const finish = e => {
        if (e.pointerId !== undefined && e.pointerId !== pid) return;
        if (pid !== null && moved) {
          state.dirty = true;
          save();
          /* Sürükleme bitti: details'i açma (tık yut). */
          suppressClick = true;
        }
        pid = null; moved = false;
        setTimeout(() => { suppressClick = false; }, 0);
      };
      head.addEventListener('pointerup', finish, { signal: this.signal });
      head.addEventListener('pointercancel', finish, { signal: this.signal });
      head.addEventListener('click', e => {
        if (suppressClick) { e.preventDefault(); e.stopImmediatePropagation(); }
      }, { capture: true, signal: this.signal });
      head.addEventListener('dblclick', e => {
        e.preventDefault();
        e.stopPropagation();
        resetToRight();
      }, { signal: this.signal });
      /* kart başlığına ipucu */
      if (!head.dataset.tip) {
        head.dataset.tip = '1';
        head.title = __t('Hold and drag · Double-click: dock to the right side');
      }
      /* Aç/kapalı durumu da saklanır. */
      item.addEventListener('toggle', () => { state.dirty = true; save(); }, { signal: this.signal });
    }

    /* Pencere/p-boyut değişince kenarlara kepent. */
    window.addEventListener('resize', () => { if (isFullscreen()) apply(); }, { signal: this.signal });
    /* Panel her göründüğünde yerleşim tazelenir (açıldığında kutu boyu 0'dır). */
    new MutationObserver(() => {
      if (!this.panel.hidden) apply();
    }).observe(this.panel, { attributes: true, attributeFilter: ['hidden'] });
    /* Panel baştan açıksa ilk rAF'larla yerleşmeyi dene. */
    let tries = 0;
    const tick = () => { if (!apply() && ++tries < 60) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  bind() {
    const $ = selector => document.querySelector(selector);
    const panel = this.panel;
    if (this.openButton) {
      this.openButton.onclick = () => {
        if (this.panel.hidden) {
          /* Sekmeden açılış = tam ekran mod. Tam ekran sınıfı küçük yüzen
             boyuttan ÖNCE uygulanır: openPanel küçük boyutu kilitler,
             kullanıcı önce küçük pencereyi görüp büyümeyi izliyordu. */
          this._fullscreenWanted = true;
          this.setFullscreenState(true);
          if (window.tailrefOpenPanel) window.tailrefOpenPanel(panel);
          else panel.hidden = false;
          this.viewport.resize();
          this.hud?.wake();
          void this._requestBrowserFullscreen();
        } else {
          /* Sekme, panel açıkken basılırsa kapat (tam ekrandan da çıkar). */
          if (this.isFullscreen()) this.exitFullscreen();
          this.setSettingsOpen(false);
          if (window.tailrefClosePanel) window.tailrefClosePanel(panel);
          else panel.hidden = true;
        }
        this.syncModeTab();
      };
    }
    if (this.closeButton) {
      this.closeButton.onclick = () => {
        /* 3D tam ekran modunda X = moddan çık. Yalnız paneli gizlemek
           "mode-3d" sınıfını açık bırakıyordu; sekme pasifleşiyor ve
           modeEnter3d erken döndüğü için 3D bir daha açılamıyordu. */
        if (document.body.classList.contains('mode-3d') && typeof window.modeExit3d === 'function') {
          window.modeExit3d();
          return;
        }
        if (this.isFullscreen()) this.exitFullscreen();
        this.setSettingsOpen(false);
        if (window.tailrefClosePanel) window.tailrefClosePanel(panel);
        else panel.hidden = true;
        this.syncModeTab();
      };
    }
    if (this.expandButton) {
      this.expandButton.onclick = () => {
        /* 3D modu her zaman tam ekrandır; ⤢ küçültme artık yok. */
        if (this.isFullscreen()) return;
        const expanded = panel.classList.toggle('expanded');
        if (expanded) {
          panel.dataset.collapsedWidth = panel.getBoundingClientRect().width + 'px';
          panel.style.width = Math.min(1040, innerWidth - 16) + 'px';
          /* Büyütlmüş görünümde ayarlar alt alta aynı bölüm scan devam
             eder; ayrı popup yok. */
        } else {
          panel.style.width = panel.dataset.collapsedWidth || '340px';
        }
        this.expandButton.title = __t(expanded ? 'Minimize 3D window' : 'Maximize 3D window');
        this.expandButton.setAttribute('aria-pressed', String(expanded));
        if (window.tailrefPreparePanel) window.tailrefPreparePanel(panel);
        this.viewport.resize();
      };
    }

    if (this.settingsButton) {
      this.settingsButton.onclick = () => this.toggleSettings();
    }
    if (this.settingsCloseButton) {
      this.settingsCloseButton.onclick = () => this.setSettingsOpen(false);
    }
    this.bindSettingsDrag();

    /* Esc önce ayar popup'ını kapatır; sonraki Esc tam ekrandan çıkar.
       Ekrana tıklamak popup'ı KAPATMAZ: kullanıcı ayarları açık tutup
       sahneyle çalışabilmeli. Kapatma yalnızca ×, chip, Esc veya küçültme
       ile olur. */
    window.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (this.captureModal?.isOpen) return;
      /* Rehber açıkken Esc onu kapatır; tam ekrandan çıkarmaz. */
      const guide = document.getElementById('poseGuide');
      if (guide && !guide.hidden) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.closeGuide();
        return;
      }
      if (this.hud?.presentation) return;
      if (this.settingsOpen) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.setSettingsOpen(false);
        return;
      }
      if (this.isFullscreen()) {
        /* 3D modu her zaman tam ekran: Esc küçültmez, mod Crucabeg Read
           sekmesi veya Çık chip'i ile moddan çıkılır. */
        if (document.body.classList.contains('mode-3d')) return;
        event.preventDefault();
        this.exitFullscreen();
      }
    }, { capture: true, signal: this.signal });

    if (this.fullscreenButton) {
      this.fullscreenButton.onclick = () => this.toggleFullscreen();
    }

    const presentation = $('#btnPose3dPresentation');
    if (presentation && this.hud) presentation.onclick = () => this.hud.togglePresentation();

    const camChip = $('#poseCamChip');
    if (camChip) {
      camChip.onclick = () => {
        if (typeof this.switchPane === 'function') {
          this.switchPane('posePaneCamera');
          return;
        }
        const section = $('#poseSecCamera');
        if (!section) return;
        section.scrollIntoView({ block: 'nearest' });
      };
    }

    const fullscreenExit = this.fullscreenExitButton;
    if (fullscreenExit) {
      /* Çıkış chip'i iki yoldan da çalışır: click ve pointerup. HUD tıklaması
         bir katman tarafından yutulsa bile tam ekrandan çıkılabilsin. */
      let lastExitRequest = 0;
      const requestExit = event => {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }
        const now = Date.now();
        if (now - lastExitRequest < 600) return;
        lastExitRequest = now;
        /* 3D modunda her zaman tam ekran: Çık = moddan çık ( Referans'a dön,
           panel kapanır). Küçülte küçülte FS'den çıkma akışı kalktı. */
        if (document.body.classList.contains('mode-3d') && typeof window.modeExit3d === 'function') {
          window.modeExit3d();
          return;
        }
        this.exitFullscreen();
      };
      fullscreenExit.onclick = requestExit;
      fullscreenExit.addEventListener('pointerup', requestExit, { signal: this.signal });
    }

    const rigToggle = $('#poseRigToggle');
    if (rigToggle) {
      const syncRigUi = state => {
        rigToggle.setAttribute('aria-pressed', state ? 'true' : 'false');
        rigToggle.textContent = state ? '● ' + __t('Hide rig') : '◎ ' + __t('Show rig');
      };
      const readRigState = () => {
        if (this.characters && this.characters.getRigVisible) return this.characters.getRigVisible();
        return !!(this.skeleton && this.skeleton.visible);
      };
      syncRigUi(readRigState());
      rigToggle.onclick = () => {
        const target = !readRigState();
        if (this.characters && this.characters.setRigVisible) {
          this.characters.setRigVisible(target);
        } else if (this.skeleton) {
          this.skeleton.visible = target;
        }
        syncRigUi(target);
        this.viewport.invalidate();
      };
    }

    const controllersToggle = $('#poseControllersToggle');
    if (controllersToggle) {
      controllersToggle.onclick = () => {
        const visible = !this.posing.visible;
        this.posing.setVisible(visible);
        /* Solda şeritteki anahtar: metin sabit kalır, durum aria-pressed
           ile görünür. Fallback: eskisi gibi metni değiştir. */
        const textEl = controllersToggle.querySelector('.poseQuickSwitchText');
        if (textEl) {
          controllersToggle.setAttribute('aria-pressed', visible ? 'true' : 'false');
        } else {
          controllersToggle.setAttribute('aria-pressed', visible ? 'true' : 'false');
          controllersToggle.textContent = visible ? '● ' + __t('Hide controls') : '○ ' + __t('Show controls');
        }
        this.viewport.invalidate();
      };
    }

    const controllerSize = $('#poseControllerSize');
    if (controllerSize) {
      /* HTML varsayılanına göre başlangıç değeri uygulanır (yeni:
         Kontrol 150 = 1.5). Sadece oninput'a bıraksaydık açılışta
         küçük varsayılan kalırdı. */
      this.posing.setScale(Number(controllerSize.value) / 100);
      this.updateLabel('#poseControllerSizeVal', controllerSize.value);
      controllerSize.oninput = () => {
        this.posing.setScale(Number(controllerSize.value) / 100);
        this.updateLabel('#poseControllerSizeVal', controllerSize.value);
      };
    }

    const lineartSize = $('#poseLineartSize');
    if (lineartSize) {
      /* Kaydırıcı ile sahne değeri başlangıçta aynı olsun (0.004 ↔ 40).
         Aralık 0.0002–0.03: ince çizgiden kalın kontura kadar. */
      lineartSize.value = String(Math.round((this.sceneGraph?.lineartScale ?? 0.004) * 10000));
      this.updateLabel('#poseLineartSizeVal', lineartSize.value);
      lineartSize.oninput = () => {
        /* Kalınlık tüm karakter grafiklerine uygulanır. */
        if (this.characters?.setLineartScale) {
          this.characters.setLineartScale(Number(lineartSize.value) / 10000);
        } else if (this.sceneGraph?.setLineartScale) {
          this.sceneGraph.setLineartScale(Number(lineartSize.value) / 10000);
        }
        this.updateLabel('#poseLineartSizeVal', lineartSize.value);
        this.viewport.invalidate();
      };
    }

    const gizmoSize = $('#poseGizmoSize');
    if (gizmoSize) {
      this.gizmo.setSize(Number(gizmoSize.value) / 100);
      this.updateLabel('#poseGizmoSizeVal', gizmoSize.value);
      gizmoSize.oninput = () => {
        this.gizmo.setSize(Number(gizmoSize.value) / 100);
        this.updateLabel('#poseGizmoSizeVal', gizmoSize.value);
      };
    }

    const gizmoModeButton = $('#poseGizmoMode');
    if (gizmoModeButton) {
      gizmoModeButton.onclick = () => {
        this.setGizmoMode(this.gizmo.mode === 'rotate' ? 'translate' : 'rotate');
      };
    }

    ['translate', 'rotate'].forEach(mode => {
      const button = document.querySelector(`#poseGizmo${mode[0].toUpperCase()}${mode.slice(1)}`);
      if (button) button.onclick = () => this.setGizmoMode(mode);
    });
    /* Ölçek düğmesi artık kontrolcü boyutunu büyütür: kemik ölçekleme
       gizmosu tutamacı şişiriyordu (bkz. cycleControllerSize). */
    const scaleButton = document.querySelector('#poseGizmoScale');
    if (scaleButton) scaleButton.onclick = () => this.cycleControllerSize();

    /* Gizmo eksen uzayı: Yerel = seçili kontrolcünün kendi X/Y/Z'si. */
    [['#poseSpaceLocal', 'local'], ['#poseSpaceWorld', 'world']].forEach(([selector, space]) => {
      const button = document.querySelector(selector);
      if (button) button.onclick = () => this.setGizmoSpace(space);
    });

    const axisButtons = [...document.querySelectorAll('.poseAxes button')];
    axisButtons.forEach(button => {
      button.onclick = () => {
        this.gizmo.setAxis(button.dataset.axis);
        axisButtons.forEach(item => item.classList.toggle('active', item.dataset.axis === button.dataset.axis));
      };
    });

    const focusButton = $('#poseFocusBtn');
    if (focusButton) {
      focusButton.onclick = () => {
        const box = new THREE.Box3();
        const target = this.gizmo.object?.userData?.bone || this.sceneGraph.root;
        if (!target) return;
        box.setFromObject(target);
        if (box.isEmpty()) box.setFromCenterAndSize(target.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0.6, 0.6, 0.6));
        this.camera.frame(box);
        this.hud?.wake();
      };
    }

    const capture = $('#poseCaptureBtn');
    if (capture) capture.onclick = () => this.openCapture();

    /* "?" rehberi: şeritteki düğme + ilk açılışta bir kez otomatik. */
    const help = $('#poseQuickHelp');
    if (help) help.onclick = () => this.openGuide();
    const guideClose = $('#poseGuideClose');
    if (guideClose) guideClose.onclick = () => this.closeGuide();
    const guideDone = $('#poseGuideDone');
    if (guideDone) guideDone.onclick = () => this.closeGuide();
    this.watchFirstIntro();

    /* Tuş kapsamı: panel içine girince kısayollar etkinleşir (2D tuvalinki ezilmez). */
    this.panel.addEventListener('pointerenter', () => { this.pointerInside = true; }, { signal: this.signal });
    this.panel.addEventListener('pointerleave', () => { this.pointerInside = false; }, { signal: this.signal });
    this.panel.addEventListener('focusin', () => { this.pointerInside = true; }, { signal: this.signal });

    this.bindKeys();
  }

  /* --- Tam ekran: panel tüm ekranı kaplar, Esc ile geri döner. --- */

  /* Büyütülmüş görünüm: genişletilmiş panel veya tam ekran. Ayarlar bu
     durumda panelin altı yerine ayrı bir yüzen popup olarak gösterilir. */
  isEnlarged() {
    return this.panel.classList.contains('expanded') || this.isFullscreen();
  }

  /* Popup konumu panelin içinde tutulur; her açılışta sağ üstteki
     varsayılan yere döner, kullanıcı başlıktan sürükleyince taşınır. */
  resetSettingsPosition() {
    const accordion = this.settingsAccordion;
    if (!accordion) return;
    for (const prop of ['left', 'top', 'right', 'bottom', 'height']) {
      accordion.style.removeProperty(prop);
    }
  }

  bindSettingsDrag() {
    const accordion = this.settingsAccordion;
    const head = accordion?.querySelector('.poseSettingsHead');
    if (!accordion || !head) return;
    head.title = __t('Drag to move');

    head.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest('button')) return;

      const panelRect = this.panel.getBoundingClientRect();
      const rect = accordion.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const startLeft = rect.left - panelRect.left;
      const startTop = rect.top - panelRect.top;

      /* Sabit (fixed) yerleşimi bırak: sol/üst ile sürükle. Yükseklik de
         sabitlenir ki alt kenar zıplamasın. */
      accordion.style.left = `${startLeft}px`;
      accordion.style.top = `${startTop}px`;
      accordion.style.right = 'auto';
      accordion.style.bottom = 'auto';
      accordion.style.height = `${rect.height}px`;
      accordion.classList.add('is-dragging');
      event.preventDefault();
      event.stopPropagation();
      try { head.setPointerCapture(event.pointerId); } catch { /* yoksa pencere dinleyicileri yeter */ }

      const move = ev => {
        const bounds = this.panel.getBoundingClientRect();
        const width = accordion.offsetWidth;
        const height = accordion.offsetHeight;
        const maxLeft = Math.max(8, bounds.width - width - 8);
        const maxTop = Math.max(8, bounds.height - height - 8);
        const left = Math.min(Math.max(8, startLeft + ev.clientX - startX), maxLeft);
        const top = Math.min(Math.max(8, startTop + ev.clientY - startY), maxTop);
        accordion.style.left = `${left}px`;
        accordion.style.top = `${top}px`;
        ev.preventDefault();
      };
      const finish = ev => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        try { head.releasePointerCapture(ev?.pointerId); } catch { /* zaten bırakıldı */ }
        accordion.classList.remove('is-dragging');
      };
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', finish, { once: true });
      window.addEventListener('pointercancel', finish, { once: true });
    }, { signal: this.signal });
  }

  setSettingsOpen(on) {
    const next = !!(on && this.isEnlarged() && !this.panel.hidden);
    this.settingsOpen = next;
    /* Her açılışta ve mod değişiminde (genişlet ↔ tam ekran) varsayılan
       konuma dön; kullanıcı sürüklemesi oturum içinde kalır. */
    if (next) this.resetSettingsPosition();
    this.panel.classList.toggle('pose3d-settings-open', next);
    if (this.settingsButton) {
      this.settingsButton.setAttribute('aria-pressed', String(next));
      this.settingsButton.setAttribute('aria-expanded', String(next));
    }
    if (next) {
      this.hud?.wake();
      this.viewport.resize();
    }
  }

  toggleSettings() {
    /* Sınıf tek doğru kaynak: durum bir şekilde ayrışsa bile chip çalışır. */
    const open = this.panel.classList.contains('pose3d-settings-open');
    this.setSettingsOpen(!open);
  }

  isFullscreen() {
    return document.fullscreenElement === document.documentElement
      || this.panel.classList.contains('pose3d-fullscreen');
  }

  async toggleFullscreen() {
    /* 3D modu her zaman tam ekrandır: sekme/Çık ile moddan çıkılır. */
    if (document.body.classList.contains('mode-3d')) return;
    if (this.isFullscreen()) { await this.exitFullscreen(); return; }
    /* Sınıf hemen uygulanır: tam ekran isteği reddedilse bile panel ekranı kaplar. */
    this._fullscreenWanted = true;
    this.setFullscreenState(true);
    await this._requestBrowserFullscreen();
  }

  /* OS penceresine de tam ekran isteği: reddedilirse pencere içi tam
     ekran görünümü yeterli. Uygulama zaten F11'deyse çıkışta onu
     kapatmamak için durum önceden not alınır. */
  async _requestBrowserFullscreen() {
    try { this._windowWasFullscreen = await window.tailref?.isFullscreen?.() ?? false; }
    catch { this._windowWasFullscreen = false; }
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      if (!this._fullscreenWanted && document.fullscreenElement) {
        await document.exitFullscreen().catch(() => { /* zaten kapalı */ });
      }
    } catch {
      /* Tarayıcı tam ekranı reddetti: pencere içi tam ekran görünümü yeterli. */
    }
  }

  async exitFullscreen() {
    this._fullscreenWanted = false;
    /* Görünümü hemen geri al: düğme her koşulda çalışsın. */
    this.setFullscreenState(false);
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch { /* zaten kapalı */ }
    }
    /* Electron penceresi/kiosk 3D tam ekranla birlikte açıldıysa onu da bırak.
       Kullanıcı zaten uygulama tam ekranındaysa dokunma. */
    if (!this._windowWasFullscreen) {
      try { await window.tailref?.exitFullscreen?.(); } catch { /* tarayıcı */ }
    }
    this._windowWasFullscreen = false;
  }

  setFullscreenState(on) {
    this.panel.classList.toggle('pose3d-fullscreen', on);
    document.body.classList.toggle('pose3d-fullscreen-open', on);
    if (this.fullscreenButton) {
      const title = on ? __t('Exit full screen (Esc)') : __t('Full screen (Shift+F)');
      this.fullscreenButton.setAttribute('aria-pressed', String(on));
      this.fullscreenButton.setAttribute('aria-label', title);
      this.fullscreenButton.title = title;
      this.fullscreenButton.dataset.tooltip = title;
    }
    /* Tam ekranda da ayarlar panel içinde alt alta kalır; ayrı popup yok. */
    this.viewport.resize();
    if (on) this.hud?.wake();
  }

  /* Üst mod sekmesinin (3D Poz) seçili durumunu panel görünürlüğüne eşitler. */
  syncModeTab() {
    const tab = this.modeTabButton || this.openButton;
    if (!tab) return;
    const on = !this.panel.hidden;
    tab.classList.toggle('is-active', on);
    tab.setAttribute('aria-selected', String(on));
    tab.title = __t(on ? 'Exit 3D pose (Ctrl+3)' : '3D character pose (Ctrl+3)');
  }

  /* Esc ile çıkışta veya panel gizlenirken durumu eşitler. */
  syncFullscreen() {
    /* 3D modu her zaman tam ekran: pencere F11'i görünümü bozmasın. */
    const on = document.fullscreenElement === document.documentElement
      || document.body.classList.contains('mode-3d');
    if (!on) this._fullscreenWanted = false;
    this.setFullscreenState(on);
  }

  /* Kamera paneli: persp/ortho, lens, ortho ölçeği, preset, sığdır, kılavuz. */
  bindCamera() {
    const $ = selector => document.querySelector(selector);
    const camera = this.camera;

    const persp = $('#poseCamPersp');
    if (persp) persp.onclick = () => this.setCameraMode('perspective');
    const ortho = $('#poseCamOrtho');
    if (ortho) ortho.onclick = () => this.setCameraMode('orthographic');

    const lens = $('#poseLens');
    if (lens) {
      lens.value = String(Math.round(camera.lens));
      lens.addEventListener('input', () => {
        camera.setLens(Number(lens.value));
        this.syncCameraPanel();
      }, { signal: this.signal });
    }

    const orthoScale = $('#poseOrthoScale');
    if (orthoScale) {
      orthoScale.value = String(camera.orthoScale);
      orthoScale.addEventListener('input', () => {
        camera.setOrthoScale(Number(orthoScale.value));
        this.syncCameraPanel();
      }, { signal: this.signal });
    }

    document.querySelectorAll('[data-view]').forEach(button => {
      button.onclick = () => this.applyViewPreset(button.dataset.view);
    });

    const frameAll = $('#poseFrameAll');
    if (frameAll) frameAll.onclick = () => this.frameAll();

    const guides = $('#poseGuidesMode');
    if (guides) guides.onchange = () => this.applyGuide(guides.value);

    if (this.guides) this.applyGuide(this.guides.mode);
  }

  setCameraMode(mode) {
    this.camera.setMode(mode);
    this.syncCameraPanel();
    this.hud?.wake();
  }

  applyViewPreset(name) {
    this.camera.preset(name);
    this.hud?.wake();
  }

  frameAll() {
    const root = this.sceneGraph.root;
    if (!root) return;
    this.camera.frameAll(root);
    this.hud?.wake();
  }

  applyGuide(mode) {
    if (this.guides) this.guides.set(mode);
    const select = document.querySelector('#poseGuidesMode');
    if (select && select.value !== mode) select.value = mode;
    this.viewport.invalidate();
  }

  /* Kamera panelini ve HUD chip'ini mevcut duruma getirir. */
  syncCameraPanel() {
    const $ = selector => document.querySelector(selector);
    const camera = this.camera;
    const ortho = camera.mode === 'orthographic';

    const perspButton = $('#poseCamPersp');
    const orthoButton = $('#poseCamOrtho');
    if (perspButton) perspButton.setAttribute('aria-pressed', ortho ? 'false' : 'true');
    if (orthoButton) orthoButton.setAttribute('aria-pressed', ortho ? 'true' : 'false');

    const lensRow = $('#poseLensRow');
    const orthoRow = $('#poseOrthoRow');
    if (lensRow) lensRow.hidden = ortho;
    if (orthoRow) orthoRow.hidden = !ortho;

    const lens = $('#poseLens');
    if (lens && !ortho) lens.value = String(Math.round(camera.lens));
    const lensValue = $('#poseLensValue');
    if (lensValue) lensValue.textContent = `${Math.round(camera.lens)} mm`;

    const orthoScale = $('#poseOrthoScale');
    if (orthoScale) orthoScale.value = String(camera.orthoScale.toFixed(1));
    const orthoValue = $('#poseOrthoValue');
    if (orthoValue) orthoValue.textContent = `${camera.orthoScale.toFixed(1)} m`;

    const chip = $('#poseCamChip');
    if (chip) {
      chip.textContent = ortho
        ? `Ortho · ${camera.orthoScale.toFixed(1)}m`
        : `Persp · ${Math.round(camera.lens)}mm`;
    }
  }

  /* --- Capture suite (P5) --- */

  bindCapture() {
    /* Ctrl+Shift+S / Ctrl+Shift+Alt+S → app.js (22-init.js) tek noktadan yayınlar. */
    window.addEventListener('pose-capture-request', event => {
      if (event.detail?.quick) this.capture();
      else this.openCapture();
    }, { signal: this.signal });
  }

  openCapture() {
    this.hud?.wake();
    return this.captureModal?.open() || false;
  }

  /* --- "?" rehberi: ilk kez 3D kullananlar için basit 5 adım --- */

  openGuide() {
    const dlg = document.getElementById('poseGuide');
    if (!dlg) return false;
    dlg.hidden = false;
    this.hud?.wake();
    return true;
  }

  closeGuide() {
    const dlg = document.getElementById('poseGuide');
    if (dlg) dlg.hidden = true;
  }

  /* Panel ilk kez görünür olduğunda rehberi bir kez göster. */
  watchFirstIntro() {
    let key = null;
    try { key = 'tailref-pose3d-guide-seen'; } catch { }
    this._guideObserver = new MutationObserver(() => {
      if (this.panel.hidden) return;
      this._guideObserver.disconnect();
      let seen = false;
      try { seen = localStorage.getItem(key) === '1'; } catch { }
      if (seen) return;
      try { localStorage.setItem(key, '1'); } catch { }
      this.openGuide();
    });
    this._guideObserver.observe(this.panel, { attributes: true, attributeFilter: ['hidden'] });
  }

  /* Son ayarlarla hızlı yakalama: 2D tahtaya ekler. */
  async capture() {
    if (!this.captureModal) return { ok: false };
    return this.captureModal.quick();
  }

  /* --- Poz sistemi (P3): T/A-pose, poz kütüphanesi, sahne parçaları --- */

  bindPose() {
    const $ = selector => document.querySelector(selector);

    this.bindTabs();
    this.bindHelpButtons();
    const resetAll = $('#poseResetAll');
    if (resetAll) resetAll.onclick = () => this.applyResetAll();

    /* ⟳ Her şeyi sıfırla (Gelişmiş bölümünde): rig/bozuk poz durumunda
       tek dokunuşla fabrika görünümü. Poz kütüphanesi korunur. */
    const resetEverything = $('#poseResetEverything');
    if (resetEverything) resetEverything.onclick = () => this.applyResetEverything();
    const quickReset = $('#poseQuickReset');
    if (quickReset) quickReset.onclick = () => this.applyResetAll();

    const tPose = $('#poseTPose');
    if (tPose) tPose.onclick = () => this.applyStance('t-pose');
    const aPose = $('#poseAPose');
    if (aPose) aPose.onclick = () => this.applyStance('a-pose');

    const save = $('#poseSavePreset');
    if (save) save.onclick = () => this.savePreset();

    const exportButton = $('#poseExportPresets');
    if (exportButton) exportButton.onclick = () => this.exportPresets();

    const importButton = $('#poseImportPresets');
    const importFile = $('#poseImportFile');
    if (importButton && importFile) {
      importButton.onclick = () => importFile.click();
      importFile.onchange = () => this.importPresets(importFile);
    }

    const restore = $('#poseRestoreParts');
    if (restore) restore.onclick = () => this.restoreParts();

    this.refreshCharacterList();
    this.refreshPartList();
    this.refreshPresetList().catch(error => console.error('Poz kütüphanesi okunamadı', error));
  }

  /* --- Karakterler bölümü (9 Kasım: Kız + Erkek) --- */

  refreshCharacterList() {
    const list = document.querySelector('#poseCharList');
    if (!list || !this.characters) return;
    /* manager.list hem getter (dizideğer) hem metot olabilir; toleranslı oku. */
    const rawList = this.characters.list;
    const rows = typeof rawList === 'function' ? rawList() : (rawList || []);
    const activeId = this.characters.activeId;
    list.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'poseNote';
      empty.textContent = __t('Characters loading…');
      list.append(empty);
      return;
    }
    rows.forEach(entry => {
      /* Kart yapısı: üst katman (isim + göz), alt katman (boyut çubuğu).
         flex-wrap yerine açık iki satır: hizalama kaymaz, kaydırıcı
         isimden bağımsız tam genişlikte durur. */
      const row = document.createElement('div');
      row.className = 'poseListRow poseCharRow' +
        (activeId === entry.id ? ' is-active' : '');
      const head = document.createElement('div');
      head.className = 'poseCharHead';

      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'poseListName poseCharName';
      name.dataset.charId = entry.id;
      name.textContent = entry.ready ? __t(entry.label) : __t('{name} · loading…', { name: __t(entry.label) });
      name.title = __t('Set as pose target');
      if (!entry.ready) {
        name.disabled = true;
      } else {
        name.onclick = () => {
          if (this.characters.activate(entry.id)) {
            this.hud?.flash(__t('{name} active — controls are attached to this character', { name: __t(entry.label) }));
            this.refreshCharacterList();
            /* Parça listesi etkin karaktere bağlı: yenilenmezse eski
               karakterin satırları kalır ve tıklama yanlış indeksi yeni
               karaktere uygular. */
            this.refreshPartList();
            /* "≠ rig" rozeti etkin karakterin imzasına bakar. */
            this.refreshPresetList().catch(() => {});
          }
        };
      }

      const visibility = document.createElement('button');
      visibility.type = 'button';
      visibility.className = `poseListBtn${entry.visible ? '' : ' is-off'}`;
      visibility.dataset.charId = entry.id;
      visibility.dataset.action = 'visibility';
      visibility.setAttribute('aria-pressed', entry.visible ? 'true' : 'false');
      visibility.title = entry.visible ? __t('Hide {name} character', { name: __t(entry.label) }) : __t('Show {name} character', { name: __t(entry.label) });
      visibility.textContent = entry.visible ? '◉' : '◌';
      visibility.disabled = !entry.ready;
      visibility.onclick = () => {
        if (this.characters.setVisible(entry.id, !entry.visible)) {
          this.hud?.flash(entry.visible ? __t('{name} hidden', { name: __t(entry.label) }) : __t('{name} shown', { name: __t(entry.label) }));
          this.refreshCharacterList();
          this.refreshPartList();
          this.refreshPresetList().catch(() => {});
        }
      };

      head.append(name, visibility);
      row.append(head);

      /* Boyut katmanı: 0.2× (peri) … 5× (dev) çarpanı taban ölçekle
         çarpılır; etkin karakterin değişmesi kaydırıcıyı etkilemez ve
         değer pano kaydına yansır. */
      if (entry.ready) {
        const scaleWrap = document.createElement('div');
        scaleWrap.className = 'poseCharScale';
        scaleWrap.title = __t('{name} character size', { name: __t(entry.label) });
        const scaleText = document.createElement('span');
        scaleText.className = 'poseCharScaleLbl';
        scaleText.textContent = __t('Size');
        const scaleInput = document.createElement('input');
        scaleInput.type = 'range';
        scaleInput.min = '0.2';
        scaleInput.max = '5';
        scaleInput.step = '0.1';
        scaleInput.value = String(entry.scaleFactor ?? 1);
        scaleInput.dataset.charId = entry.id;
        const scaleVal = document.createElement('span');
        scaleVal.className = 'poseCharScaleVal';
        scaleVal.textContent = `${Number(entry.scaleFactor ?? 1).toFixed(1)}×`;
        const syncFill = () => {
          const percent = ((Number(scaleInput.value) - 0.2) / (5 - 0.2)) * 100;
          scaleInput.style.setProperty('--fill', `${percent}%`);
        };
        syncFill();
        scaleInput.oninput = () => {
          const next = this.characters.setScale(entry.id, Number(scaleInput.value));
          if (next != null) {
            scaleVal.textContent = `${next.toFixed(1)}×`;
            syncFill();
            /* Kamera burada oynatılır: boyut denemesi sırasında görüntü
               sabit kalmalı, kullanıcı kendi kaydırma hızını seçer. */
          }
        };
        scaleWrap.append(scaleText, scaleInput, scaleVal);
        row.append(scaleWrap);
      }

      list.append(row);
    });
  }

  applyStance(kind) {
    const result = this.posing.resetTo(kind);
    if (!result.ok) {
      this.hud?.flash(kind === 'a-pose' ? __t('No arm bone found for A-pose') : __t('T-pose could not be applied'));
      return result;
    }
    this.hud?.flash(kind === 'a-pose' ? __t('A-pose applied') : __t('T-pose applied'));
    /* Düzeltilmiş duruş hemen pano kaydına girsin: bozuk (ezilmiş konumlu)
       pozu taşıyan eski kayıtlar bir sonraki açılışta geri gelmesin. */
    if (typeof window.scheduleSave === 'function') window.scheduleSave();
    return result;
  }

  /* ⟲ Sıfırla: bind duruşuna dön — dönüşler + eklem konumları. */
  applyResetAll() {
    const result = this.posing.resetBase();
    this.hud?.flash(result.changed ? __t('Returned to bind pose') : __t('Pose is already bind pose'));
    if (typeof window.scheduleSave === 'function') window.scheduleSave();
    return result;
  }

  /* R: kontrolcileri büyüt — #poseControllerSize kaydırıcısını 50'er
     adımla yukarı çevirip 300'de başa sarar. Ölçekleme gizmosu iskelette
     anlamsız ve tutamacı şişiren regresyonun kaynağıydı; R artık
     kullanıcının istediği "büyült" işini görünür biçimde yapar. */
  cycleControllerSize() {
    const slider = document.querySelector('#poseControllerSize');
    if (!slider) return;
    const steps = [150, 200, 250, 300];
    const current = Number(slider.value) || 150;
    const next = steps.find(step => step > current) ?? steps[0];
    slider.value = String(next);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    this.hud?.flash(__t('Control size {n}', { n: next }));
    return next;
  }

  /* ⟳ Her şeyi sıfırla (kullanıcı isteği: "rigler falan bozulursa diye").
     Tüm karakterlerin posaları bağ duruşuna döner; poz geçmişleri,
     parça görünürlükleri, gizlenen karakterler ve kontrol boyutu
     sıfırlanır; kamera görünürlere yeniden çerçevelenir. Poz
     KÜTÜPHANESİNE dokunulmaz — kayıtlar kullanıcının malıdır. */
  applyResetEverything() {
    const rawList = this.characters?.list;
    const list = (typeof rawList === 'function' ? rawList() : rawList) || [];
    const result = { poses: 0 };

    for (const entry of list) {
      if (!entry?.ready) continue;
      try {
        entry.rig?.resetToBase();
        entry.rig?.root?.updateMatrixWorld(true);
        entry.history?.clear();
        entry.graph?.restoreVisibility?.();
        /* Boyut çarpanı (dev/peri) fabrika ölçeğine döner. noHistory:
           akabinde history.clear() temizlemesi yapılır; sıfırlama
           kendisi geri alınabilir adım üretmez. */
        this.characters?.setScale?.(entry.id, 1, { noHistory: true });
        result.poses++;
      } catch { /* tek karakter bozuk olsa bile geri kalanı sıfırlansın */ }
    }

    /* Etkin karakterin kontrolcüleri taze kurulsun (bağ duruşu + varsayılan boyut). */
    const activeId = this.characters?.activeId;
    if (activeId) this.characters.activate(activeId);

    /* Gizmo döndürme moduna ve tüm eksenlere döner. */
    this.setGizmoMode('rotate');
    this.gizmo?.setAxis?.('all');

    /* Kontrol boyutu varsayılana döner. */
    const ctrl = document.querySelector('#poseControllerSize');
    if (ctrl) {
      ctrl.value = '150';
      ctrl.dispatchEvent(new Event('input', { bubbles: true }));
    }

    /* Gizlenen karakterler geri gelsin.
       Görünürlük güncellemesi updateCameraTargetForVisible'ı da çağırır. */
    for (const entry of list) {
      if (entry?.ready && entry.visible === false) this.characters?.setVisible(entry.id, true);
    }
    this.refreshPartList?.();
    this.refreshCharacterList?.();

    /* Kamera: görünür karakterlerin birleşik kutusuna çerçevele. */
    const box = new THREE.Box3();
    for (const entry of list) {
      if (entry?.ready && entry.visible !== false && entry.graph?.root) box.expandByObject(entry.graph.root);
    }
    if (!box.isEmpty()) this.camera.frame(box);

    this.hud?.flash(__t('Everything reset · {n} characters in bind pose', { n: result.poses }));
    if (typeof window.scheduleSave === 'function') window.scheduleSave();
    return result;
  }

  /* --- Sekmeler: Kamera · Poz · Görüntü (son seçim hatırlanır) --- */
  bindTabs() {
    /* Sekmeler kaldırıldı: Kamera · Poz · Görüntü artık panelde alt alta
       katlanabilir bölümler (<details class="poseStackItem">). switchPane,
       eski çağrıcıları bozmasın diye bölümü bulup açmakla yetinir. */
    this.switchPane = name => {
      const section = document.getElementById(name);
      section?.scrollIntoView?.({ block: 'nearest' });
      return section || null;
    };
  }

  /* "?" yardım modu (Ayarlar'daki düzenin aynısı): her panelin sağ
     üstündeki düğme, bölüm içindeki data-help'li her satırın altına
     ne işe yaradığını basar. Kullanıcı 9 Kasım. */
  bindHelpButtons() {
    document.querySelectorAll('.poseStackItem').forEach(card => {
      const summary = card.querySelector(':scope > summary');
      if (!summary) return;
      let button = summary.querySelector(':scope > .poseHelp');
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'poseHelp';
        button.textContent = '?';
        summary.appendChild(button);
      }
      if (button.dataset.helpBound) return;
      button.dataset.helpBound = '1';
      button.title = __t('Show what each control does');
      button.setAttribute('aria-pressed', 'false');
      /* Başlık sürükleme işleyicisi pointerdown'dan itibaren pointer
         yakalar (setPointerCapture) ve tığı yutar: "?" düğmesi olayını
         başlığa SEÇMESİN, kendi olsun. dblclick de sağ kenara dizme
         tetiklemesin. */
      button.addEventListener('pointerdown', event => event.stopPropagation());
      button.addEventListener('dblclick', event => { event.stopPropagation(); event.preventDefault(); });
      button.addEventListener('click', event => {
        /* summary'i kapatma açma davranışını tetiklemesin. */
        event.preventDefault();
        event.stopPropagation();
        const on = card.classList.toggle('pose-help-on');
        button.setAttribute('aria-pressed', String(on));
        button.title = on ? __t('Hide descriptions') : __t('Show what each control does');
      });
    });
  }

  /* Çoklu karakter pozu (9 Kasım): KAYDET TÜM karakterleri TEK kayıtta
     toplar — "erkeği ve kızı ayrı ayrı kaydetmek" istemez. Aktif
     karakterin verisi üst düzey rigSignature/bones'ta da kalır: eski
     kayıtlar ve eski kod yolu bozulmadan çalışır. */
  capturePoseRecord(name) {
    const pose = this.posing.capturePose(name);
    const rawList = this.characters?.list;
    const rows = (typeof rawList === 'function' ? rawList() : rawList) || [];
    const characters = {};
    for (const entry of rows) {
      if (!entry?.ready || !entry.rig) continue;
      if (entry.rig === this.posing.rig) {
        characters[entry.id] = { label: entry.label || entry.id, rigSignature: pose.rigSignature, bones: pose.bones };
      } else {
        characters[entry.id] = { label: entry.label || entry.id, rigSignature: entry.rig.signature, bones: entry.rig.snapshotJSON() };
      }
    }
    if (Object.keys(characters).length > 1) pose.characters = characters;
    return pose;
  }

  /* Kayıttaki her karakterin duruşunu kendi rig'ine uygular. Tek
     karakterlik eski kayıtlar yalnız aktif karaktere gider. */
  applyPoseRecord(pose) {
    const multi = pose?.characters && Object.keys(pose.characters).length;
    if (!multi) {
      const result = this.posing.applyPose(pose, { animate: true });
      if (!result.ok) return { applied: 0, mismatch: !!result.mismatch };
      return { applied: 1, mismatch: !!result.mismatch };
    }
    const rawList = this.characters?.list;
    const rows = (typeof rawList === 'function' ? rawList() : rawList) || [];
    const prevRig = this.posing.rig;
    const prevHistory = this.posing.history;
    let applied = 0;
    let mismatch = false;
    try {
      for (const entry of rows) {
        const sub = pose.characters[entry.id];
        if (!entry?.ready || !entry.rig || !sub || !Array.isArray(sub.bones)) continue;
        /* PosingController'ı bu karaktere ödünç ver; kayıt sonrası
           geri al (etkin karakterin kontrolcileri bozulmasın). */
        this.posing.rig = entry.rig;
        this.posing.history = entry.history;
        const result = this.posing.applyPose(
          { ...pose, rigSignature: sub.rigSignature, bones: sub.bones },
          { animate: false });
        if (result.ok) applied++;
        if (result.mismatch) mismatch = true;
      }
    } finally {
      this.posing.rig = prevRig;
      this.posing.history = prevHistory;
      /* Tutamaçlar etkin rig'e bağlı: rig geri geldiği için yeniden
         kurulmasına gerek yok; followBones her karede konumları alır. */
    }
    return { applied, mismatch };
  }

  async savePreset() {
    if (!this.library) return null;
    const stripName = document.querySelector('#poseQuickName');
    const fullName = document.querySelector('#posePresetName');
    const pose = this.capturePoseRecord(stripName?.value || fullName?.value);
    try {
      await this.library.save(pose);
      if (stripName) stripName.value = '';
      if (fullName) fullName.value = '';
      await this.refreshPresetList();
      const count = pose.characters ? Object.keys(pose.characters).length : 1;
      this.hud?.flash(count > 1 ? __t('Pose saved: {name} ({n} characters)', { name: pose.name, n: count }) : __t('Pose saved: {name}', { name: pose.name }));
      return pose;
    } catch (error) {
      console.error('Poz kaydedilemedi', error);
      this.hud?.flash(__t('Pose could not be saved'));
      return null;
    }
  }

  async loadPreset(id) {
    if (!this.library) return false;
    const items = await this.library.load();
    const pose = items.find(item => item.id === id);
    if (!pose) return false;
    const result = this.applyPoseRecord(pose);
    if (!result.applied) {
      this.hud?.flash(__t('No bone mapping found'));
      return false;
    }
    const multi = result.applied > 1;
    if (result.mismatch) {
      this.hud?.flash(multi
        ? __t('Loaded ({n} characters) · partial mapping: {name}', { n: result.applied, name: pose.name })
        : __t('Partial mapping: {name}', { name: pose.name }));
    } else {
      this.hud?.flash(multi
        ? __t('Pose loaded ({n} characters): {name}', { n: result.applied, name: pose.name })
        : __t('Pose loaded: {name}', { name: pose.name }));
    }
    return true;
  }

  async removePreset(id) {
    if (!this.library) return false;
    try {
      await this.library.remove(id);
      await this.refreshPresetList();
      this.hud?.flash(__t('Pose deleted'));
      return true;
    } catch (error) {
      console.error('Poz silinemedi', error);
      this.hud?.flash(__t('Pose could not be deleted'));
      return false;
    }
  }

  async refreshPresetList() {
    const list = document.querySelector('#posePresetList');
    if (!list || !this.library) return;
    const items = await this.library.load();
    list.replaceChildren();

    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'poseNote';
      empty.textContent = __t('No saved poses yet. Adjust the pose, optionally name it above and press ○ Save.');
      list.append(empty);
      return;
    }

    items.forEach(pose => {
      const row = document.createElement('div');
      row.className = 'poseListRow';
      row.dataset.poseId = pose.id;

      const name = document.createElement('span');
      name.className = 'poseListName';
      name.textContent = pose.name;
      /* Çoklu karakter kaydında her karakterin kendi imzası var; rozet
         yalnız etkin rig hiçbir kayıtla eşleşmediğinde çıkmalı. Eskiden
         tek üst düzey imzaya bakıldığı için Erkek etkinken tüm pozlar
         yanlışlıkla "≠ rig" görünüyordu. */
      const signatures = pose.characters && typeof pose.characters === 'object'
        ? Object.values(pose.characters).map(entry => entry?.rigSignature).filter(Boolean)
        : [];
      if (!signatures.length && pose.rigSignature) signatures.push(pose.rigSignature);
      if (this.rig && signatures.length && !signatures.includes(this.rig.signature)) {
        const badge = document.createElement('span');
        badge.className = 'poseBadge';
        badge.textContent = '≠ rig';
        badge.title = __t('Pose was saved with a different rig signature; bones are matched by name.');
        name.append(badge);
      }

      const load = document.createElement('button');
      load.type = 'button';
      load.className = 'poseListBtn';
      load.dataset.action = 'load';
      load.textContent = __t('Load');
      load.title = __t('Apply pose {name}', { name: pose.name });
      load.onclick = () => this.loadPreset(pose.id);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'poseListBtn';
      remove.dataset.action = 'remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', __t('Delete pose {name}', { name: pose.name }));
      remove.title = __t('Delete pose {name}', { name: pose.name });
      remove.onclick = () => this.removePreset(pose.id);

      row.append(name, load, remove);
      list.append(row);
    });
  }

  async exportPresets() {
    if (!this.library) return;
    try {
      const json = await this.library.exportJSON();
      const count = this.library.items.length;
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `tailref-poses-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      this.hud?.flash(__t('{n} poses exported', { n: count }));
    } catch (error) {
      console.error('Pozlar dışa aktarılamadı', error);
      this.hud?.flash(__t('Poses could not be exported'));
    }
  }

  async importPresets(input) {
    const file = input?.files?.[0];
    if (!file || !this.library) return 0;
    try {
      const total = await this.library.importJSON(await file.text());
      await this.refreshPresetList();
      this.hud?.flash(__t('{n} poses imported', { n: total }));
      return total;
    } catch (error) {
      console.error('Pozlar içe aktarılamadı', error);
      this.hud?.flash(__t('Poses could not be imported'));
      return 0;
    } finally {
      input.value = '';
    }
  }

  /* --- Sahne parçaları --- */

  refreshPartList() {
    const list = document.querySelector('#posePartList');
    if (!list || !this.sceneGraph) return;
    const states = this.sceneGraph.partStates;
    list.replaceChildren();

    if (!states.length) {
      const empty = document.createElement('p');
      empty.className = 'poseNote';
      empty.textContent = __t('No scene parts found.');
      list.append(empty);
      this.syncPartsRestore();
      return;
    }

    states.forEach(part => {
      const row = document.createElement('div');
      row.className = 'poseListRow';

      const name = document.createElement('span');
      name.className = 'poseListName';
      name.textContent = `${part.name}${part.materials > 1 ? ` · ${part.materials} slot` : ''}`;

      const visibility = document.createElement('button');
      visibility.type = 'button';
      visibility.className = `poseListBtn${part.visible ? '' : ' is-off'}`;
      visibility.dataset.action = 'visibility';
      visibility.dataset.index = String(part.index);
      visibility.setAttribute('aria-pressed', part.visible ? 'true' : 'false');
      visibility.title = part.visible ? __t('Hide part') : __t('Show part');
      visibility.textContent = part.visible ? '◉' : '◌';
      visibility.onclick = () => this.togglePart(part.index);

      const isolate = document.createElement('button');
      isolate.type = 'button';
      isolate.className = 'poseListBtn';
      isolate.dataset.action = 'isolate';
      isolate.dataset.index = String(part.index);
      isolate.title = __t('Show only this part');
      isolate.textContent = '⛶';
      isolate.onclick = () => this.isolatePart(part.index);

      row.append(name, visibility, isolate);
      list.append(row);
    });

    this.syncPartsRestore();
  }

  togglePart(index) {
    const part = this.sceneGraph?.partStates[index];
    if (!part) return;
    this.sceneGraph.setPartVisible(index, !part.visible);
    this.sceneGraph.isolatedIndex = null;
    this.refreshPartList();
    this.hud?.flash(part.visible ? __t('{name} hidden', { name: part.name }) : __t('{name} shown', { name: part.name }));
  }

  isolatePart(index) {
    const part = this.sceneGraph?.partStates[index];
    if (!part) return;
    this.sceneGraph.isolatePart(index);
    this.refreshPartList();
    this.hud?.flash(__t('{name} isolated · Esc to undo', { name: part.name }));
  }

  restoreParts() {
    if (!this.sceneGraph) return;
    this.sceneGraph.restoreVisibility();
    this.refreshPartList();
    this.hud?.flash('Tüm parçalar görünür');
  }

  syncPartsRestore() {
    const button = document.querySelector('#poseRestoreParts');
    if (button) button.hidden = this.sceneGraph?.isolatedIndex == null;
  }

  /* --- Işık & ortam (P4) --- */

  bindLight() {
    const $ = selector => document.querySelector(selector);
    const lighting = this.lighting;
    const environment = this.environment;

    [...document.querySelectorAll('[data-light]')].forEach(button => {
      button.onclick = () => {
        this.activeLight = button.dataset.light;
        this.syncLightPanel();
      };
    });

    const intensity = $('#poseLightIntensity');
    if (intensity && lighting) {
      intensity.oninput = () => {
        lighting.setIntensity(this.activeLight, Number(intensity.value));
        this.updateLabel('#poseLightIntensityValue', Number(intensity.value).toFixed(1));
      };
    }

    const temperature = $('#poseLightTemp');
    if (temperature && lighting) {
      temperature.oninput = () => {
        lighting.setTemperature(this.activeLight, Number(temperature.value));
        this.updateLabel('#poseLightTempValue', `${Math.round(Number(temperature.value))} K`);
      };
    }

    const azimuth = $('#poseLightAzimuth');
    if (azimuth && lighting) {
      azimuth.oninput = () => {
        lighting.setAzimuth(this.activeLight, Number(azimuth.value));
        this.updateLabel('#poseLightAzimuthValue', `${Math.round(Number(azimuth.value))}°`);
      };
    }

    const elevation = $('#poseLightElevation');
    if (elevation && lighting) {
      elevation.oninput = () => {
        lighting.setElevation(this.activeLight, Number(elevation.value));
        this.updateLabel('#poseLightElevationValue', `${Math.round(Number(elevation.value))}°`);
      };
    }

    const shadows = $('#poseShadows');
    if (shadows && lighting) {
      shadows.onchange = () => lighting.setShadows(shadows.checked);
    }

    const shadowQuality = $('#poseShadowQuality');
    if (shadowQuality) shadowQuality.onchange = () => this.applyQuality(shadowQuality.value);

    const opacity = $('#poseShadowOpacity');
    if (opacity && lighting) {
      opacity.oninput = () => {
        const percent = Math.round(Number(opacity.value));
        lighting.setFloorOpacity(percent / 100);
        this.updateLabel('#poseShadowOpacityValue', `${percent}%`);
      };
    }

    const grid = $('#poseGrid');
    if (grid && lighting) grid.onchange = () => lighting.setGridVisible(grid.checked);

    const mode = $('#poseEnvMode');
    if (mode && environment) {
      mode.onchange = () => {
        environment.setBackgroundMode(mode.value);
        this.syncEnvPanel();
      };
    }

    const load = $('#poseEnvLoad');
    const file = $('#poseEnvFile');
    if (load && file) {
      load.onclick = () => file.click();
      file.onchange = async () => {
        const selected = file.files?.[0];
        if (!selected || !environment) return;
        try {
          await environment.loadHDRI(selected);
          const select = $('#poseEnvMode');
          if (select) select.value = 'hdri';
          this.syncEnvPanel();
          this.hud?.flash(__t('HDRI loaded: {name}', { name: selected.name }));
        } catch (error) {
          console.error('HDRI yüklenemedi', error);
          this.hud?.flash(__t('HDRI could not be loaded'));
        } finally {
          file.value = '';
        }
      };
    }

    const clear = $('#poseEnvClear');
    if (clear && environment) {
      clear.onclick = () => {
        environment.clearHDRI();
        const select = $('#poseEnvMode');
        if (select) select.value = environment.mode;
        this.syncEnvPanel();
        this.hud?.flash(__t('HDRI removed'));
      };
    }

    const rotation = $('#poseEnvRotation');
    if (rotation && environment) {
      rotation.oninput = () => {
        environment.setRotation(Number(rotation.value));
        this.updateLabel('#poseEnvRotationValue', `${Math.round(Number(rotation.value))}°`);
      };
    }

    const blur = $('#poseEnvBlur');
    if (blur && environment) {
      blur.oninput = () => {
        const percent = Math.round(Number(blur.value));
        environment.setBlur(percent / 100);
        this.updateLabel('#poseEnvBlurValue', `${percent}%`);
      };
    }

    const envIntensity = $('#poseEnvIntensity');
    if (envIntensity && environment) {
      envIntensity.oninput = () => {
        environment.setIntensity(Number(envIntensity.value));
        this.updateLabel('#poseEnvIntensityValue', Number(envIntensity.value).toFixed(1));
      };
    }

    this.syncLightPanel();
  }

  syncLightPanel() {
    if (!this.lighting) return;
    const state = this.lighting.getLight(this.activeLight);
    if (state) {
      [...document.querySelectorAll('[data-light]')].forEach(button => {
        button.setAttribute('aria-pressed', button.dataset.light === this.activeLight ? 'true' : 'false');
      });
      this.setSlider('#poseLightIntensity', state.intensity.toFixed(1), state.intensity.toFixed(1));
      this.setSlider('#poseLightTemp', state.kelvin, `${Math.round(state.kelvin)} K`);
      this.setSlider('#poseLightAzimuth', state.azimuth, `${Math.round(state.azimuth)}°`);
      this.setSlider('#poseLightElevation', state.elevation, `${Math.round(state.elevation)}°`);
    }
    this.syncShadowPanel();
    this.syncEnvPanel();
  }

  syncShadowPanel() {
    if (!this.lighting) return;
    const shadows = document.querySelector('#poseShadows');
    if (shadows) shadows.checked = this.lighting.shadowEnabled;
    const quality = document.querySelector('#poseShadowQuality');
    if (quality) quality.value = this.lighting.quality;
    const opacity = document.querySelector('#poseShadowOpacity');
    if (opacity) opacity.value = String(Math.round(this.lighting.floorOpacity * 100));
    this.updateLabel('#poseShadowOpacityValue', `${Math.round(this.lighting.floorOpacity * 100)}%`);
    const grid = document.querySelector('#poseGrid');
    if (grid) grid.checked = this.lighting.gridVisible;
  }

  syncEnvPanel() {
    if (!this.environment) return;
    const environment = this.environment;
    const select = document.querySelector('#poseEnvMode');
    if (select && select.value !== environment.mode) select.value = environment.mode;

    const active = environment.mode === 'hdri' && environment.hasHDRI;
    ['#poseEnvRotation', '#poseEnvBlur', '#poseEnvIntensity'].forEach(selector => {
      const input = document.querySelector(selector);
      if (input) input.disabled = !active;
    });
    const clear = document.querySelector('#poseEnvClear');
    if (clear) clear.disabled = !environment.hasHDRI;

    this.setSlider('#poseEnvRotation', environment.rotation, `${Math.round(environment.rotation)}°`);
    const blurPercent = Math.round(environment.blur * 100);
    this.setSlider('#poseEnvBlur', blurPercent, `${blurPercent}%`);
    this.setSlider('#poseEnvIntensity', environment.intensity.toFixed(2), environment.intensity.toFixed(1));
  }

  /* --- Görünüm & render (P4) --- */

  bindView() {
    const $ = selector => document.querySelector(selector);
    const pipeline = this.pipeline;

    const tone = $('#poseToneMapping');
    if (tone && pipeline) {
      tone.value = pipeline.toneMappingName;
      tone.onchange = () => {
        pipeline.setToneMapping(tone.value);
        this.hud?.flash(`Tone mapping: ${tone.options[tone.selectedIndex]?.textContent || tone.value}`);
      };
    }

    const exposure = $('#poseExposure');
    if (exposure && pipeline) {
      exposure.value = String(pipeline.exposure);
      exposure.oninput = () => {
        pipeline.setExposure(Number(exposure.value));
        this.updateLabel('#poseExposureValue', pipeline.exposure.toFixed(2));
      };
    }

    const contrast = $('#poseContrast');
    if (contrast && pipeline) {
      contrast.value = String(pipeline.grade.contrast);
      contrast.oninput = () => {
        pipeline.setGrade({ contrast: Number(contrast.value) });
        this.updateLabel('#poseContrastValue', pipeline.grade.contrast.toFixed(2));
      };
    }

    const vignette = $('#poseVignette');
    if (vignette && pipeline) {
      vignette.oninput = () => {
        const percent = Math.round(Number(vignette.value));
        pipeline.setGrade({ vignette: percent / 100 });
        this.updateLabel('#poseVignetteValue', `${percent}%`);
      };
    }

    const dof = $('#poseDof');
    if (dof && pipeline) {
      dof.onchange = () => {
        pipeline.setDoF({ enabled: dof.checked });
        this.hud?.flash(dof.checked ? __t('Depth of field on') : __t('Depth of field off'));
      };
    }

    const focus = $('#poseDofFocus');
    if (focus && pipeline) {
      focus.value = String(pipeline.focus);
      focus.oninput = () => {
        pipeline.setFocus(Number(focus.value));
        this.updateLabel('#poseDofFocusValue', `${pipeline.focus.toFixed(1)} m`);
      };
    }

    const fstop = $('#poseDofFstop');
    if (fstop && pipeline) {
      fstop.value = String(pipeline.fstop);
      fstop.oninput = () => {
        pipeline.setFStop(Number(fstop.value));
        this.updateLabel('#poseDofFstopValue', `f/${pipeline.fstop.toFixed(1)}`);
      };
    }

    const focusTarget = $('#poseDofFocusTarget');
    if (focusTarget && pipeline) {
      focusTarget.onclick = () => {
        const target = this.camera.target;
        const distance = this.viewport.camera.position.distanceTo(target);
        pipeline.setFocus(distance);
        const slider = $('#poseDofFocus');
        if (slider) slider.value = String(pipeline.focus);
        this.updateLabel('#poseDofFocusValue', `${pipeline.focus.toFixed(1)} m`);
        this.hud?.flash(__t('Focus: {n} m', { n: pipeline.focus.toFixed(1) }));
      };
    }

    const ssao = $('#poseSSAO');
    if (ssao && pipeline) {
      ssao.onchange = () => {
        const active = pipeline.setSSAO(ssao.checked);
        if (ssao.checked && !active) {
          this.hud?.flash(pipeline.lineart ? __t('SSAO requires lineart off') : __t('SSAO requires at least medium quality'));
        }
        this.syncViewPanel();
      };
    }

    const quality = $('#poseQuality');
    if (quality) quality.onchange = () => this.applyQuality(quality.value);

    const lineart = $('#poseLineart');
    if (lineart && pipeline) {
      lineart.onchange = () => {
        pipeline.setLineart(lineart.checked);
        this.syncViewPanel();
        this.syncLightPanel();
        this.hud?.flash(lineart.checked ? __t('Lineart on') : __t('Lineart off'));
      };
    }

    this.syncViewPanel();
  }

  syncViewPanel() {
    const pipeline = this.pipeline;
    if (!pipeline) return;

    const lineart = document.querySelector('#poseLineart');
    if (lineart) lineart.checked = pipeline.lineart;

    const tone = document.querySelector('#poseToneMapping');
    if (tone && tone.value !== pipeline.toneMappingName) tone.value = pipeline.toneMappingName;

    const ssao = document.querySelector('#poseSSAO');
    if (ssao) {
      const allowed = !pipeline.lineart && pipeline.quality !== 'low';
      ssao.disabled = !allowed;
      ssao.checked = allowed && pipeline.ssaoActive;
      ssao.title = allowed
        ? __t('Screen-space ambient occlusion')
        : (pipeline.quality === 'low' ? __t('Requires medium quality or higher') : __t('Available when lineart is off'));
    }

    const quality = document.querySelector('#poseQuality');
    if (quality && quality.value !== pipeline.quality) quality.value = pipeline.quality;
    const shadowQuality = document.querySelector('#poseShadowQuality');
    if (shadowQuality && shadowQuality.value !== pipeline.quality) shadowQuality.value = pipeline.quality;

    this.setSlider('#poseExposure', pipeline.exposure.toFixed(2), pipeline.exposure.toFixed(2));
    this.setSlider('#poseContrast', pipeline.grade.contrast.toFixed(2), pipeline.grade.contrast.toFixed(2));
    this.setSlider('#poseVignette', Math.round(pipeline.grade.vignette * 100), `${Math.round(pipeline.grade.vignette * 100)}%`);
    this.setSlider('#poseDofFocus', pipeline.focus.toFixed(1), `${pipeline.focus.toFixed(1)} m`);
    this.setSlider('#poseDofFstop', pipeline.fstop.toFixed(1), `f/${pipeline.fstop.toFixed(1)}`);

    const dof = document.querySelector('#poseDof');
    if (dof) dof.checked = pipeline.dofEnabled;
  }

  applyQuality(level, from = 'ui') {
    if (!this.pipeline) return level;
    const next = this.pipeline.setQuality(level);
    const labels = { low: __t('low'), medium: __t('medium'), high: __t('high') };
    /* Kullanıcı 3D panelinden elle kalite seçtiyse bu bir sözü: otomatik
       vites bunun için kapanır ve seçim kalıcı yazılır ("Otomatik'e dön"
       düğmesine kadar program dokunmaz). */
    if (from === 'ui') this.perf.level === 'auto' ? this.perfSetManual(next) : this.perfWrite(next);
    this.syncViewPanel();
    this.syncShadowPanel();
    this.hud?.flash(from === 'perf'
      ? __t('Performance: auto throttle kicked in — quality {q}', { q: labels[next] || next })
      : __t('Quality: {q}', { q: labels[next] || next }));
    return next;
  }

  /* ---- Otomatik kalite vitesi ---- */
  perfLevelLabel(level) {
    return { low: __t('Low'), medium: __t('Medium'), high: __t('High') }[level] || level;
  }

  perfWrite(level) {
    try { localStorage.setItem('tailref-q3d-level', level); } catch { /* sessiz */ }
    this.perf.level = level;
    try { window.dispatchEvent(new CustomEvent('tailref-perf-changed')); } catch { /* sessiz */ }
  }

  perfSetManual(level, byPanel = false) {
    this.perfWrite(level);
    this.perf.win = [];
    this.perf.bad = this.perf.good = 0;
    if (byPanel) console.info('[perf] 3D kalite elle seçildi, otomatik kapandı:', level);
  }

  perfSetAuto() {
    this.perfWrite('auto');
    this.perf.win = [];
    this.perf.bad = this.perf.good = 0;
    this.perf.last = performance.now() + 2500;   // değişiklikten sonra nefes payı
    console.info('[perf] otomatik vites yeniden açık');
  }

  /** "Bu bilgisayar için yeniden ölç": 1.2 sn boyunca kareleri sayıp
      bu makineye uyan kaliteyi oturtur. FPS sayısı döner (3D yoksa null). */
  perfRemeasure() {
    if (!this.viewport || !this.pipeline) return Promise.resolve(null);
    try { localStorage.removeItem('tailref-ink-tile-auto'); } catch { /* sessiz */ }
    const vp = this.viewport;
    let rendered = 0;
    const off = vp.onRender(() => { rendered++; });
    const iv = setInterval(() => vp.invalidate(), 15);
    return new Promise(resolve => {
      setTimeout(() => {
        clearInterval(iv);
        off();
        const fps = rendered / 1.2;
        const next = fps > 55 ? 'high' : fps > 26 ? 'medium' : 'low';
        try { this.pipeline.setQuality(next); } catch { /* sessiz */ }
        this.perf.win = [];
        this.perf.bad = this.perf.good = 0;
        this.syncViewPanel();
        this.syncShadowPanel();
        try { window.dispatchEvent(new CustomEvent('tailref-perf-changed')); } catch { /* sessiz */ }
        console.info('[perf] yeniden ölçüm:', Math.round(fps), 'FPS →', next);
        resolve(fps);
      }, 1300);
    });
  }

  /** Çizilen her karede çalışır; 3 sn kayan pencerede FPS tahmini eder. */
  _perfSample() {
    const p = this.perf;
    if (p.level !== 'auto') return;
    const now = performance.now();
    if (now < p.last) return;                    // soğuma süresi
    p.win.push(now);
    while (p.win.length && now - p.win[0] > 3000) p.win.shift();
    if (p.win.length < 30) return;               // yeterli örnek yok → sakın
    const span = now - p.win[0];
    const fps = (p.win.length - 1) / (span / 1000);
    if (span < 2000) return;                     // kısa patlamayla karar verme
    // takılma: iki ardışık pencere <22 FPS → bir kademe in
    if (fps < 22) {
      p.bad++; p.good = 0;
      if (p.bad >= 2) {
        const q = this.pipeline.quality;
        if (q !== 'low') { p.bad = 0; p.last = now + 3500; p.win = []; this.applyQuality(q === 'high' ? 'medium' : 'low', 'perf'); }
      }
    } else if (fps > 52) {
      // rahatlama: iki ardışık pencere >52 FPS → bir kademe yukarı
      p.good++; p.bad = 0;
      if (p.good >= 2) {
        const q = this.pipeline.quality;
        if (q !== 'high') { p.good = 0; p.last = now + 3500; p.win = []; this.applyQuality(q === 'low' ? 'medium' : 'high', 'perf'); }
      }
    } else {
      p.bad = 0; p.good = 0;
    }
  }

  setSlider(selector, value, text) {
    const input = document.querySelector(selector);
    if (input) input.value = String(value);
    if (text !== undefined) this.updateLabel(`${selector}Value`, text);
  }

  updateLabel(selector, text) {
    const label = document.querySelector(selector);
    if (label) label.textContent = text;
  }

  setGizmoMode(mode) {
    if (mode === 'hidden') { this.gizmo.detach(); return; }
    this.gizmo.setMode(mode);
    this.syncGizmoButtons();
  }

  setGizmoSpace(space) {
    const value = this.gizmo.setSpace(space);
    this.syncGizmoSpace();
    this.hud?.flash(value === 'local' ? 'Gizmo: yerel eksen' : 'Gizmo: global eksen');
    return value;
  }

  syncGizmoSpace() {
    const space = this.gizmo.space || 'local';
    [['#poseSpaceLocal', 'local'], ['#poseSpaceWorld', 'world']].forEach(([selector, value]) => {
      const button = document.querySelector(selector);
      if (button) button.setAttribute('aria-pressed', String(space === value));
    });
  }

  syncGizmoButtons() {
    const mode = this.gizmo.mode;
    ['translate', 'rotate'].forEach(name => {
      const button = document.querySelector(`#poseGizmo${name[0].toUpperCase()}${name.slice(1)}`);
      if (button) button.setAttribute('aria-pressed', name === mode ? 'true' : 'false');
    });
    /* Ölçek düğmesi artık kontrolcü boyutu için; basılı durumu taşımaz. */
    const scaleButton = document.querySelector('#poseGizmoScale');
    if (scaleButton) scaleButton.setAttribute('aria-pressed', 'false');
    const label = document.querySelector('#poseGizmoMode');
    if (label) {
      label.textContent = mode === 'translate' ? '↔ ' + __t('Move gizmo')
        : mode === 'scale' ? '⤢ ' + __t('Scale gizmo')
          : '⟳ ' + __t('Rotate gizmo');
    }
  }

  keysActive(event) {
    if (this.panel.hidden) return false;
    if (this.pointerInside) return true;
    const focusEl = document.activeElement;
    if (focusEl && this.panel.contains(focusEl)) return true;
    /* event.target Node olmayabilir (window'a gönderilen sentetik olaylar);
       contains bu durumda TypeError fırlatır — korumalı bak. */
    return !!event && event.target instanceof Node && this.panel.contains(event.target);
  }

  bindKeys() {
    window.addEventListener('keydown', event => {
      if (!this.keysActive(event)) return;
      const target = event.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT'
        || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      const key = event.key.toLowerCase();
      const code = event.code || '';
      const mod = event.ctrlKey || event.metaKey;

      /* Tam ekran isteği reddedilmişse (pencere içi görünüm) Esc ile çık. */
      if (key === 'escape' && this.isFullscreen() && !document.fullscreenElement && !this.captureModal?.isOpen) {
        /* 3D modunda her zaman tam ekran: Esc küçültmez. */
        if (document.body.classList.contains('mode-3d')) return;
        event.preventDefault();
        this.exitFullscreen();
        return;
      }

      /* İzolasyonu Esc ile geri al (sunum modu Esc'i Hud yönetir). */
      if (key === 'escape' && this.sceneGraph?.isolatedIndex != null) {
        event.preventDefault();
        this.restoreParts();
        return;
      }

      /* Numpad görünüm presetleri: 1/3/7, Ctrl ile karşıt yön, 5 mod, 0 sığdır. */
      if (code.startsWith('Numpad')) {
        const views = { Numpad1: ['front', 'back'], Numpad3: ['right', 'left'], Numpad7: ['top', 'bottom'] };
        if (views[code]) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.applyViewPreset(views[code][event.ctrlKey ? 1 : 0]);
          return;
        }
        if (code === 'Numpad5') {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.setCameraMode(this.camera.mode === 'orthographic' ? 'perspective' : 'orthographic');
          return;
        }
        if (code === 'Numpad0') {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.frameAll();
          return;
        }
        if (code === 'NumpadMultiply') {
          event.preventDefault();
          event.stopImmediatePropagation();
          document.querySelector('#poseFocusBtn')?.click();
          return;
        }
      }

      /* FAZ 2: tek tuşlar + Ctrl kombinasyonları keymap tablosundan
         çözülür (pose3d grubu, tailref-keymap kalıcılığı). Yükleme
         sırasına karşı eski zincir fallback olarak kalır. */
      if (event.altKey) return;
      const km = window.tailrefKeymap;
      if (km) {
        const sig = km.signatureFromEvent(event);
        const id = sig ? km.actionFor(sig, 'pose3d') : '';
        if (id) {
          event.preventDefault();
          switch (id) {
            case 'pose3d.detach': this.gizmo.detach(); break;
            case 'pose3d.move': this.setGizmoMode('translate'); break;
            case 'pose3d.rotate': this.setGizmoMode('rotate'); break;
            case 'pose3d.grow': this.cycleControllerSize(); break;
            case 'pose3d.axisX': this.gizmo.setAxis('X'); break;
            case 'pose3d.axisY': this.gizmo.setAxis('Y'); break;
            case 'pose3d.axisZ': this.gizmo.setAxis('Z'); break;
            case 'pose3d.axisAll': this.gizmo.setAxis('all'); break;
            case 'pose3d.focus': document.querySelector('#poseFocusBtn')?.click(); break;
            case 'pose3d.cameraMode':
              this.setCameraMode(this.camera.mode === 'orthographic' ? 'perspective' : 'orthographic');
              break;
            case 'pose3d.frameAll': this.frameAll(); break;
            case 'pose3d.undo':
              /* Ctrl+Shift+Z paritesi: imza motoru shift'i ctrl+X
                 imzasında yutar ('ctrl+z'); eski davranışta Shift'li
                 basış redo'ydu. */
              event.stopImmediatePropagation();
              mod && event.shiftKey ? this.posing.redo() : this.posing.undo();
              break;
            case 'pose3d.redo':
              event.stopImmediatePropagation();
              this.posing.redo();
              break;
          }
          return;
        }
        /* keymap'e bağlanmamış mod kombinasyonları (ctrl+a, ctrl+s…)
           yutulur — eski zincirdeki `if (mod) return` paritesi. */
        if (mod) return;
        /* Shift+F tam ekran sabittir: imza motoru shift kombinasyonunu
           temsil edemez (KEYMAP kuralı). */
        if (key === 'f' && event.shiftKey) {
          event.preventDefault();
          this.toggleFullscreen();
        }
        return;
      }

      if (mod) {
        if (event.altKey) return;
        if (key === 'z') {
          event.preventDefault();
          event.stopImmediatePropagation();
          event.shiftKey ? this.posing.redo() : this.posing.undo();
        } else if (key === 'y') {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.posing.redo();
        }
        return;
      }

      if (event.altKey) return;
      if (key === 'q') { event.preventDefault(); this.gizmo.detach(); }
      else if (key === 'w') { event.preventDefault(); this.setGizmoMode('translate'); }
      else if (key === 'e') { event.preventDefault(); this.setGizmoMode('rotate'); }
      else if (key === 'r') {
        /* R: kontrolcileri büyüt. Eskiden ölçekleme gizmosunu seçiyordu;
           ölçek iskelette anlamsızdı ve tutamacı şişirip kontrolcünün
           kendisini devasa yapmıştı (kullanıcı bildirimi, 12 Kasım). */
        event.preventDefault();
        this.cycleControllerSize();
      }
      else if (key === 'x' || key === 'y' || key === 'z') {
        event.preventDefault();
        this.gizmo.setAxis(key.toUpperCase());
      } else if (key === 'a') {
        event.preventDefault();
        this.gizmo.setAxis('all');
      } else if (key === 'f' && event.shiftKey) {
        event.preventDefault();
        this.toggleFullscreen();
      } else if (key === 'f') {
        event.preventDefault();
        document.querySelector('#poseFocusBtn')?.click();
      } else if (key === '5') {
        event.preventDefault();
        this.setCameraMode(this.camera.mode === 'orthographic' ? 'perspective' : 'orthographic');
      } else if (key === '0') {
        event.preventDefault();
        this.frameAll();
      }
    }, { capture: true, signal: this.signal });
  }

  /* Panel kapanırken/uygulama boşaltılırken tüm dinleyicileri bırakır. */
  dispose() {
    this._hiddenObserver?.disconnect();
    this._hiddenObserver = null;
    if (this.isFullscreen()) {
      this.setFullscreenState(false);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => { /* zaten kapalı */ });
    }
    this.settingsOpen = false;
    this.panel.classList.remove('pose3d-settings-open');
    this._abort?.abort();
    this._abort = null;
    this._offCameraChange?.();
    this._offCameraChange = null;
    this.captureModal?.dispose();
    this.captureModal = null;
    [this.openButton, this.closeButton, this.expandButton, this.fullscreenButton,
      this.fullscreenExitButton, this.settingsButton, this.settingsCloseButton].forEach(button => {
      if (button) button.onclick = null;
    });
    this.panel.removeAttribute('data-capture');
    this.panel.classList.remove('expanded');
  }
}
