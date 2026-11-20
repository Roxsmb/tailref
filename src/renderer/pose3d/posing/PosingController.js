import * as THREE from '../../vendor/three.module.js';
import { cleanName } from '../util/helpers.js';

/* Kemik seçimi, controller halkaları, FK/IK ve poz geçmişi. */
export class PosingController {
  constructor({ viewport, rig, gizmo, history, controllerScale = 0.15, visible = true }) {
    this.viewport = viewport;
    this.rig = rig;
    this.gizmo = gizmo;
    this.history = history;
    this.scene = viewport.scene;
    this.camera = viewport.camera;
    this.canvas = viewport.canvas;
    this.controllerScale = controllerScale;
    this.visible = visible;
    this.handles = [];
    this.dragged = null;
    this._dragBefore = null;
    this._poseTween = null;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this._onPointerDown = event => this.handlePointerDown(event);
    this.canvas.addEventListener('pointerdown', this._onPointerDown);

    this._onObjectChange = object => this.handleObjectChange(object);
    this._onDragging = value => this.handleDragging(value);

    viewport.onFrame(() => this.followBones());
    viewport.onFrame(() => this.tickPoseTween());
  }

  /* Mevcut rig için halka controller'ları üretir. */
  buildHandles(size) {
    this.clearHandles();
    const scale = size.y;
    /* Tüm controller'lar aynı boyutta: elde/parmakta farklı çaplar kafa karıştırıyordu. */
    const radius = scale * 0.0045;

    this.rig.rules.forEach(rule => {
      const bone = this.rig.findBone(rule.keys);
      if (!bone) return;
      const chain = rule.chainKeys ? rule.chainKeys.map(keys => this.rig.findBone(keys)).filter(Boolean) : null;
      const pole = rule.poleKeys ? this.rig.findBone(rule.poleKeys) : null;
      this.addHandle({
        bone, label: rule.label, chain, pole, color: rule.color, radius, renderOrder: 20,
      });
    });

    // Parmak tabanları.
    this.rig.bones.forEach(bone => {
      const name = cleanName(bone.name);
      const side = name.includes('right') ? 'R' : (name.includes('left') ? 'L' : '');
      if (!side) return;
      const finger = this.rig.fingerNames.find(([key]) => name.includes(key));
      if (!finger) return;
      this.addHandle({
        bone, label: `${finger[1]} ${side}`, color: side === 'R' ? 0xff7fb5 : 0xffc56b,
        radius, renderOrder: 21, finger: true,
      });
    });

    // Özel controller'ı olmayan her kemik.
    this.rig.bones.forEach(bone => {
      if (this.handles.some(handle => handle.userData.bone === bone)) return;
      const name = cleanName(bone.name);
      const side = name.includes('right') ? 'R' : (name.includes('left') ? 'L' : '');
      this.addHandle({
        bone, label: bone.name, color: side === 'R' ? 0xff8ab8 : (side === 'L' ? 0x72d6ff : 0xb8a6ff),
        radius, renderOrder: 19, generic: true,
      });
    });

    return this.handles;
  }

  addHandle({ bone, label, chain = null, pole = null, color, radius, renderOrder, finger = false, generic = false }) {
    const handle = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 16, 10),
      new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 })
    );
    handle.scale.setScalar(this.controllerScale);
    handle.renderOrder = renderOrder;
    handle.visible = this.visible;
    /* Sıkı çerçeve: nokta beyaz gövde/koyu arka planda kaybolmasın.
       Aynı küre %25 büyük, siyah ve arkada — nokta çevresine siluet
       çizgisi çizer (lineart mantığının ucuz formu). */
    const edge = new THREE.Mesh(
      handle.geometry,
      new THREE.MeshBasicMaterial({ color: 0x10141a, depthTest: false, depthWrite: false, transparent: true, opacity: 0.9 })
    );
    edge.scale.setScalar(1.25);
    edge.renderOrder = renderOrder - 1;
    /* Görünürlük ebeveynden izlensin: setVisible ile tekrar açıldığında
       kenar tali bayrağı takılı kalıp kaybolmasın. */
    handle.add(edge);
    handle.userData = {
      bone, label, chain, pole,
      offset: new THREE.Vector3(), target: null,
      finger, generic, edge,
    };
    handle.position.copy(bone.getWorldPosition(new THREE.Vector3()));
    this.scene.add(handle);
    this.handles.push(handle);
    return handle;
  }

  clearHandles() {
    /* Etkin karakter değişince eski karakterin halkaları gider; kopmuş
       gizmo referansı kalmayacağı için ayrık olağanüstü durum kapatılır. */
    if (this.gizmo?.object) this.gizmo.detach();
    this.handles.forEach(handle => {
      this.scene.remove(handle);
      /* Kenar (siluet) ayrı materyal kullanır; yalnız ana materyali
         bırakmak karakter değişiminde GPU materyali sızdırıyordu.
         Geometri iki mesh'te ortak: tek dispose yeterli. */
      handle.userData?.edge?.material?.dispose?.();
      handle.geometry.dispose();
      handle.material.dispose();
    });
    this.handles = [];
  }

  setVisible(visible) {
    this.visible = visible;
    this.handles.forEach(handle => { handle.visible = visible; });
    if (!visible) {
      /* Sürükleme ortasında gizlenme (panel kapanışı / karakter değişimi)
         yarım kalan hareketi kaydetmeden _dragBefore'ı takılı bırakıyordu. */
      if (this._dragBefore) this.handleDragging(false);
      this.gizmo.detach();
    }
  }

  setScale(scale) {
    this.controllerScale = scale;
    this.handles.forEach(handle => handle.scale.setScalar(scale));
  }

  followBones() {
    this.handles.forEach(handle => {
      /* Kontrolcü boyutu her karede sabitlenir: ölçekleme gizmosu (R)
         tutamacı şişirip "kontrolcünün kendisi büyüyor" regresyonunu
         bırakıyordu; kaydırıcı (#poseControllerSize) yegane kaynak. */
      if (Math.abs(handle.scale.x - this.controllerScale) > 1e-6) {
        handle.scale.setScalar(this.controllerScale);
      }
      if (this.gizmo.object === handle) {
        /* Gizmo local modda kontrolcünün kendi eksenlerini gösterir. Kemik
           IK/rotasyonla döndüğünde gizmo da onunla dönmeli; sürükleme
           sırasında ise kullanıcının tuttuğu yönü koru. */
        if (!this.gizmo.dragging) {
          /* Konum da takip etsin: bağlı tutamaç eskide hiç güncellenmiyordu;
             başka kontrolcüyle poz değiştirilince ya da undo/T-pose gelince
             tutamaç eski yerinde kalıp "karakterden kopuk" duruyordu. */
          const world = handle.userData.bone.getWorldPosition(new THREE.Vector3());
          handle.position.copy(world.add(handle.userData.offset || new THREE.Vector3()));
          this.syncHandleRotation(handle);
        }
        return;
      }
      const world = handle.userData.bone.getWorldPosition(new THREE.Vector3());
      handle.position.copy(world.add(handle.userData.offset || new THREE.Vector3()));
    });
  }

  /* Controller'ın dünya rotasyonunu halkaya kopyalar. TransformControls
     local modda gizmo eksenlerini ve sürükleme matematiğini bu quaternion
     üzerinden kurar. */
  syncHandleRotation(handle) {
    const bone = handle?.userData?.bone;
    if (!bone) return;
    handle.quaternion.copy(bone.getWorldQuaternion(new THREE.Quaternion()));
  }

  setPointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  pick(event) {
    this.setPointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(this.handles, false)[0] || null;
  }

  handlePointerDown(event) {
    if (event.altKey) return;
    const hit = this.pick(event);
    if (!hit) {
      if (!this.gizmo.object) this.gizmo.detach();
      return;
    }
    const handle = hit.object;
    this.gizmo.attach(handle);
    /* Her modda halkayı kemiğin dünya rotasyonuna hizala: local gizmo
       eksenleri (X/Y/Z whatever the controller points) doğru olsun. */
    this.syncHandleRotation(handle);
    return handle;
  }

  handleDragging(active) {
    if (active) this._dragBefore = this.rig.snapshot();
    else if (this._dragBefore) {
      const after = this.rig.snapshot();
      if (!this.samePose(this._dragBefore, after)) this.history.push(this._dragBefore);
      this._dragBefore = null;
    }
  }

  handleObjectChange(object) {
    if (!object) return;
    const data = object.userData;

    /* Ölçekleme gizmosu kemiklere uygulanamaz: tutamacı şişiren "kontrolcü
       kendisi büyüyor" regresyonu buydu (R tuşu, 12 Kasım). Kemik boyutu
       iskelet ölçeğiyle sabittir; kontrolcü boyutu kaydırıcıyla değişir. */
    if (this.gizmo.mode === 'scale') return;

    data.target = object.position.clone();

    if (this.gizmo.mode === 'rotate') {
      const targetBone = (data.chain && data.chain[data.chain.length - 1]) || data.bone;
      if (!targetBone) return;
      const quaternion = object.quaternion.clone();
      if (targetBone.parent) {
        quaternion.premultiply(targetBone.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
      }
      targetBone.quaternion.copy(quaternion);
      this.viewport.invalidate();
      return;
    }

    if (data.chain) {
      this.solveIK(data.chain, data.target, data.pole ? data.pole.getWorldPosition(new THREE.Vector3()) : null);
    } else {
      const limb = this.handles.find(handle => handle.userData.pole === data.bone);
      if (limb?.userData.chain) this.solveIK(limb.userData.chain, limb.userData.target || data.target, data.target);
      else if (data.bone.parent) data.bone.position.copy(data.bone.parent.worldToLocal(data.target));
    }
    this.viewport.invalidate();
  }

  samePose(a, b) {
    return a.length === b.length && a.every((entry, index) =>
      entry.p.distanceTo(b[index].p) < 0.0001 &&
      1 - Math.abs(entry.q.dot(b[index].q)) < 0.0001);
  }

  undo() {
    if (!this.history.canUndo) return false;
    this._poseTween = null;
    /* Sürükleme sırasında Ctrl+Z: yarım kalan hareketin başlangıç anlık
       görüntüsü pointerup'ta ikinci bir geçmiş maddesi yazmasın. */
    this._dragBefore = null;
    this.rig.restore(this.history.undo(this.rig.snapshot()));
    this.viewport.invalidate();
    return true;
  }

  redo() {
    if (!this.history.canRedo) return false;
    this._poseTween = null;
    this._dragBefore = null;
    this.rig.restore(this.history.redo(this.rig.snapshot()));
    this.viewport.invalidate();
    return true;
  }

  /* --- Poz kütüphanesi (P3) --- */

  /* Mevcut duruşu kütüphaneye yazılabilir kayda çevirir. */
  capturePose(name) {
    const id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `pose-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      id,
      name: String(name || '').trim() || 'Pose',
      createdAt: Date.now(),
      rigSignature: this.rig.signature,
      bones: this.rig.snapshotJSON(),
    };
  }

  /* Kayıtlı pozu uygular. animate=false testler ve toplu işler için.
     Güven kuralı: DÖNÜŞLER (q) her zaman uygulanır; EKLEM KONUMLARI (p)
     yalnızca poz bu rig'e AİTSE uygulanır (rig imzası eşsizse). Farklı
     rig'in eklem konumları bu rig'in kemik bağlarına uymaz → uzuvlar
     gövdeye çakılır (yeni Mixamo taban model olayında görüldü). */
  applyPose(pose, { animate = true } = {}) {
    if (!pose || !Array.isArray(pose.bones)) return { ok: false, reason: 'invalid', matched: 0, changed: false };
    const sameRig = !!pose.rigSignature && pose.rigSignature === this.rig.signature;
    const targets = pose.bones
      .map(entry => {
        const bone = this.rig.resolveBone(entry);
        if (!bone) return null;
        return {
          bone,
          /* Aynı rig'den gelen konum da onaylanır: tabandan sapmışsa
             (bozuk/yabancı kayıt) konum uygulanmaz — dönüş uygulanır,
             konum tabanda bırakılır. */
          p: sameRig ? this.rig.safeBasePosition(bone, entry.p) : null,
          q: new THREE.Quaternion().fromArray(entry.q || [0, 0, 0, 1]),
        };
      })
      .filter(Boolean);
    if (!targets.length) return { ok: false, reason: 'rig-mismatch', matched: 0, changed: false, mismatch: true };

    const mismatch = !!pose.rigSignature && !sameRig;
    const changed = targets.some(({ bone, p, q }) =>
      (p && bone.position.distanceTo(p) > 1e-4) || 1 - Math.abs(bone.quaternion.dot(q)) > 1e-4);
    if (!changed) {
      this.viewport.invalidate();
      return { ok: true, matched: targets.length, changed: false, mismatch };
    }

    this.history.push(this.rig.snapshot());
    this._poseTween = null;
    if (animate) {
      this._poseTween = {
        start: performance.now(),
        duration: 180,
        items: targets.map(({ bone, p, q }) => ({
          bone, p, q, fromP: bone.position.clone(), fromQ: bone.quaternion.clone(),
        })),
      };
    } else {
      this.applyEntries(targets);
    }
    this.viewport.invalidate();
    return { ok: true, matched: targets.length, changed: true, mismatch };
  }

  applyEntries(targets) {
    targets.forEach(({ bone, p, q }) => {
      if (p) bone.position.copy(p);
      bone.quaternion.copy(q);
    });
    this.rig.root?.updateMatrixWorld(true);
    this.viewport.invalidate();
  }

  tickPoseTween() {
    if (!this._poseTween) return;
    const tween = this._poseTween;
    const t = Math.min(1, (performance.now() - tween.start) / tween.duration);
    const eased = 1 - Math.pow(1 - t, 3);
    tween.items.forEach(item => {
      if (item.p) item.bone.position.lerpVectors(item.fromP, item.p, eased);
      item.bone.quaternion.copy(item.fromQ).slerp(item.q, eased);
    });
    this.rig.root?.updateMatrixWorld(true);
    this.viewport.invalidate();
    if (t >= 1) this._poseTween = null;
  }

  /* Temel duruşlar: 't-pose' | 'a-pose'. Geri alınabilir tek adım üretir. */
  resetTo(kind = 't-pose') {
    const before = this.rig.snapshot();
    this._poseTween = null;
    const ok = kind === 'a-pose' ? this.rig.toAPose() : this.rig.toTPose();
    this.rig.root?.updateMatrixWorld(true);
    const changed = !this.samePose(before, this.rig.snapshot());
    if (changed) this.history.push(before);
    this.viewport.invalidate();
    return { ok, changed };
  }

  /* ⟲ Sıfırla: bind duruşuna dön — dönüşler + ezilmiş eklem konumları. */
  resetBase() {
    const before = this.rig.snapshot();
    this._poseTween = null;
    this.rig.resetToBase();
    this.rig.root?.updateMatrixWorld(true);
    const changed = !this.samePose(before, this.rig.snapshot());
    if (changed) this.history.push(before);
    this.viewport.invalidate();
    return { ok: true, changed };
  }

  /* 2–3 kemikli zincir için FABRIK benzeri çözücü (mevcut davranış korunur). */
  solveIK(chain, target, poleTarget = null) {
    if (!chain || !this.rig.root) return;
    const end = chain[chain.length - 1];
    if (!end || chain.length < 2) return;
    this.rig.root.updateMatrixWorld(true);

    const start = chain[0].getWorldPosition(new THREE.Vector3());
    let reach = 0;
    for (let i = 0; i < chain.length - 1; i++) {
      reach += chain[i].getWorldPosition(new THREE.Vector3())
        .distanceTo(chain[i + 1].getWorldPosition(new THREE.Vector3()));
    }
    const safeTarget = target.clone();
    if (target.distanceTo(start) > reach * 0.985) {
      safeTarget.copy(start).add(target.clone().sub(start).normalize().multiplyScalar(reach * 0.985));
    }

    for (let iteration = 0; iteration < 10; iteration++) {
      this.rig.root.updateMatrixWorld(true);
      for (let i = chain.length - 2; i >= 0; i--) {
        const joint = chain[i];
        const jointPos = joint.getWorldPosition(new THREE.Vector3());
        const endPos = end.getWorldPosition(new THREE.Vector3());
        const toEnd = endPos.sub(jointPos).normalize();
        const toTarget = safeTarget.clone().sub(jointPos).normalize();
        if (!toEnd.length() || !toTarget.length()) continue;
        const delta = new THREE.Quaternion().setFromUnitVectors(toEnd, toTarget);
        const worldQuat = joint.getWorldQuaternion(new THREE.Quaternion());
        worldQuat.premultiply(delta);
        if (joint.parent) worldQuat.premultiply(joint.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
        joint.quaternion.copy(worldQuat);
        this.rig.root.updateMatrixWorld(true);
      }
      if (poleTarget && chain.length >= 3) this.applyPole(chain, poleTarget);
      if (end.getWorldPosition(new THREE.Vector3()).distanceTo(safeTarget) < 0.01) break;
    }
    return safeTarget;
  }

  applyPole(chain, poleTarget) {
    const start = chain[0].getWorldPosition(new THREE.Vector3());
    const end = chain[chain.length - 1].getWorldPosition(new THREE.Vector3());
    const middle = chain[1].getWorldPosition(new THREE.Vector3());
    const axis = end.clone().sub(start).normalize();
    const current = middle.clone().sub(start);
    current.sub(axis.clone().multiplyScalar(current.dot(axis))).normalize();
    const desired = poleTarget.clone().sub(start);
    desired.sub(axis.clone().multiplyScalar(desired.dot(axis))).normalize();
    if (!current.length() || !desired.length()) return;
    const angle = Math.atan2(axis.dot(current.clone().cross(desired)), current.dot(desired));
    const worldQuat = chain[0].getWorldQuaternion(new THREE.Quaternion());
    worldQuat.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
    if (chain[0].parent) worldQuat.premultiply(chain[0].parent.getWorldQuaternion(new THREE.Quaternion()).invert());
    chain[0].quaternion.copy(worldQuat);
    this.rig.root.updateMatrixWorld(true);
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    this.clearHandles();
  }
}
