import * as THREE from '../../vendor/three.module.js';
import { FBXLoader } from '../../vendor/FBXLoader.js';
import { OBJLoader } from '../../vendor/OBJLoader.js';
import { cleanName, disposeObject, lutGradient } from '../util/helpers.js';

/* Model yükleme, malzeme normalizasyonu, toon + lineart. */
export class SceneGraph {
  constructor({ viewport, lineartScale = 0.005 }) {
    this.viewport = viewport;
    this.scene = viewport.scene;
    this.root = null;
    this.meshes = [];
    this.lineartScale = lineartScale;
    this.toonEnabled = true;
    /* 8 kademeli toon rampa: 4 kademe yüz malzemesinde sert çokgen
       bantları telaffuz ediyordu (kullanıcı şotunda faceted görünüm);
       kademe sayısını artırınca bantlar incelip pürüzsüzleşir. */
    this.toonGradient = lutGradient([110, 142, 172, 198, 220, 236, 246, 255]);
    this.isolatedIndex = null;
    this.lineartVisible = true;
    this._fbx = new FBXLoader();
    this._obj = new OBJLoader();
  }

  load(url) {
    return new Promise((resolve, reject) => {
      this._fbx.load(encodeURI(url), root => {
        /* FBX'te normal kayıt edilmemiş olabilir (Mixamo bazı ihracatlarda
           normal yazmaz): normal yokken MeshToonMaterial ışığı sıfır
           çarpım yapar → model sipsiyah görünür. Normal eksikse
           geometriden hesaplanır (toon/lineart normalli mesh bekler). */
        root.traverse(obj => {
          if (!obj.isMesh && !obj.isSkinnedMesh) return;
          const geo = obj.geometry;
          if (!geo) return;
          if (!geo.attributes.normal) geo.computeVertexNormals();
          /* Non-indexed Mixamo FBX: yüz-başına normal → toon facet/
             kara bant. Konum-weld yumuşatma faceted görünümü bitirir. */
          this.weldVertexNormals(geo);
        });
        resolve(this.install(root));
      }, undefined, reject);
    });
  }

  /* Konum-weld'li normal yumuşatma (facet düzeltmesi). Mixamo FBX
     non-indexed çıkar: computeVertexNormals yüz başına normal yazdığı
     için toon bantları çokgen görünümde sert dilimler (facet) üretir.
     Aynı konumdaki köşelerin normalleri ortalarsa silüet pürüzsüz
     kalır, lineart da düzgün çizgi döner. Dönüş: yumuşatıldıysa true. */
  weldVertexNormals(geometry) {
    const pos = geometry.attributes.position;
    const norm = geometry.attributes.normal;
    if (!pos || !norm || geometry.index || !pos.count) return false;
    const buckets = new Map();
    for (let i = 0; i < pos.count; i++) {
      const key = pos.getX(i).toFixed(4) + '_' + pos.getY(i).toFixed(4) + '_' + pos.getZ(i).toFixed(4);
      let bucket = buckets.get(key);
      if (!bucket) { bucket = { nx: 0, ny: 0, nz: 0, list: [] }; buckets.set(key, bucket); }
      bucket.nx += norm.getX(i);
      bucket.ny += norm.getY(i);
      bucket.nz += norm.getZ(i);
      bucket.list.push(i);
    }
    buckets.forEach(bucket => {
      const len = Math.hypot(bucket.nx, bucket.ny, bucket.nz) || 1;
      if (!Number.isFinite(len) || len < 1e-9) return;
      const nx = bucket.nx / len, ny = bucket.ny / len, nz = bucket.nz / len;
      bucket.list.forEach(i => norm.setXYZ(i, nx, ny, nz));
    });
    norm.needsUpdate = true;
    return true;
  }

  /* Statik OBJ taban modeli (yerel statik sunucudan metin):
     ZBrush çıktısı — malzeme/UV yok. OBJLoader varsayılan MeshPhongMaterial
     üretir; normal verisi OBJ'de yoksa geometri normalleri hesaplanır
     (toon/lineart normalli geometri bekler). */
  loadOBJ(url) {
    return new Promise((resolve, reject) => {
      fetch(url)
        .then(r => { if (!r.ok) throw new Error('OBJ HTTP ' + r.status); return r.text(); })
        .then(text => {
          const root = this._obj.parse(text);
          root.traverse(obj => {
            if (!obj.isMesh) return;
            const geo = obj.geometry;
            if (!geo) return;
            if (!geo.attributes.normal) geo.computeVertexNormals();
            this.weldVertexNormals(geo);
          });
          resolve(this.install(root));
        })
        .catch(reject);
    });
  }

  install(root) {
    this.uninstall();
    this.root = root;
    this.meshes = [];

    root.traverse(obj => {
      if (!obj.isMesh) return;
      this.meshes.push(obj);
      obj.castShadow = true;
      obj.receiveShadow = true;
      obj.frustumCulled = false;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach(mat => {
        if (!mat) return;
        mat.side = THREE.DoubleSide;
        mat.needsUpdate = true;
        if (mat.color) {
          const lum = mat.color.r * 0.2126 + mat.color.g * 0.7152 + mat.color.b * 0.0722;
          if (lum < 0.06) mat.color.setHex(0x777b82);
          else mat.color.multiplyScalar(1.35);
        }
        if ('roughness' in mat) mat.roughness = 0.62;
        if ('metalness' in mat) mat.metalness = 0.05;
        if ('emissive' in mat) { mat.emissive.setHex(0x202830); mat.emissiveIntensity = 0.32; }
      });
    });

    const rawBox = new THREE.Box3().setFromObject(root);
    const rawSize = rawBox.getSize(new THREE.Vector3());
    const rawMax = Math.max(rawSize.x, rawSize.y, rawSize.z) || 1;
    /* Sahne birimlerini normalize et: ışık, grid, gizmo ve ortho ölçeği
       modelin gerçek FBX ölçeğinden bağımsız çalışsın (hedef ~2 birim). */
    root.scale.multiplyScalar(2 / rawMax);
    root.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    root.position.y -= box.min.y + size.y / 2;
    root.updateMatrixWorld(true);

    this.scene.add(root);
    if (this.toonEnabled) this.setToonStyle(true);

    return {
      root,
      box: new THREE.Box3().setFromObject(root),
      size,
      center: new THREE.Vector3(center.x, 0, center.z),
    };
  }

  uninstall() {
    if (!this.root) return;
    disposeObject(this.root);
    this.scene.remove(this.root);
    this.root = null;
    this.meshes = [];
    this.isolatedIndex = null;
  }

  /* Model, toon kopyaları ve paylaşılan gradyan dokusunu serbest bırakır. */
  dispose() {
    const originals = new Set();
    this.root?.traverse(obj => {
      const source = obj.userData?.poseOriginalMaterial;
      if (!source) return;
      (Array.isArray(source) ? source : [source]).forEach(mat => mat && originals.add(mat));
    });
    this.uninstall();
    originals.forEach(mat => mat.dispose());
    this.toonGradient?.dispose();
    this.toonGradient = null;
  }

  makeToonMaterial(source) {
    const hasMap = !!source.map;
    const color = hasMap ? 0xffffff : (source.color ? source.color.getHex() : 0xffffff);
    const mat = new THREE.MeshToonMaterial({
      color,
      map: source.map || null,
      gradientMap: this.toonGradient,
      normalMap: source.normalMap || null,
      alphaMap: source.alphaMap || null,
      transparent: !!source.transparent,
      opacity: source.opacity ?? 1,
      side: THREE.DoubleSide,
    });
    if (source.normalScale && mat.normalScale) mat.normalScale.copy(source.normalScale);
    if (mat.emissive) { mat.emissive.setHex(0xffffff); mat.emissiveIntensity = 0.05; }
    mat.userData.outlineParameters = { thickness: this.lineartScale, color: [0, 0, 0], alpha: 1, keepAlive: true };
    return mat;
  }

  addToonOutline(obj) {
    if (!obj.isMesh || obj.userData.poseToonOutline) return;
    const outlineMaterial = new THREE.MeshBasicMaterial({
      color: 0x050608, side: THREE.BackSide, depthTest: true, depthWrite: false, toneMapped: false,
    });
    const outline = obj.isSkinnedMesh
      ? new THREE.SkinnedMesh(obj.geometry, outlineMaterial)
      : new THREE.Mesh(obj.geometry, outlineMaterial);
    outline.name = `${obj.name || 'mesh'}_toon_outline`;
    outline.userData.poseToonOutline = true;
    outline.renderOrder = 0;
    outline.frustumCulled = false;
    outline.visible = this.lineartVisible && obj.visible !== false;
    outline.scale.copy(obj.scale).multiplyScalar(1 + this.lineartScale);
    outline.position.copy(obj.position);
    outline.quaternion.copy(obj.quaternion);
    if (obj.isSkinnedMesh) {
      outline.bindMode = obj.bindMode;
      outline.bindMatrix.copy(obj.bindMatrix);
      outline.bind(obj.skeleton, obj.bindMatrix);
      outline.updateMatrixWorld(true);
    }
    obj.parent?.add(outline);
    obj.userData.poseToonOutline = outline;
  }

  removeToonOutline(obj) {
    const outline = obj.userData.poseToonOutline;
    if (!outline) return;
    outline.parent?.remove(outline);
    outline.material.dispose();
    obj.userData.poseToonOutline = null;
  }

  setToonStyle(enabled) {
    this.toonEnabled = enabled;
    if (!this.root) return;
    this.root.traverse(obj => {
      if (!obj.isMesh || obj.userData.poseToonOutline) return;
      if (enabled) {
        if (!obj.userData.poseOriginalMaterial) obj.userData.poseOriginalMaterial = obj.material;
        const source = Array.isArray(obj.userData.poseOriginalMaterial)
          ? obj.userData.poseOriginalMaterial
          : [obj.userData.poseOriginalMaterial];
        const converted = source.map(mat => this.makeToonMaterial(mat));
        obj.material = Array.isArray(obj.userData.poseOriginalMaterial) ? converted : converted[0];
      } else {
        if (obj.userData.poseOriginalMaterial) {
          if (obj.material !== obj.userData.poseOriginalMaterial) {
            (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(mat => mat?.dispose());
          }
          obj.material = obj.userData.poseOriginalMaterial;
        }
        this.removeToonOutline(obj);
      }
    });
  }

  /* Lineart aç/kapa: OutlineEffect ile birlikte toon outline nesnelerini de gizler. */
  setLineartVisible(visible) {
    this.lineartVisible = !!visible;
    if (!this.root) return this.lineartVisible;
    this.meshes.forEach(mesh => {
      const outline = mesh.userData?.poseToonOutline;
      if (outline) outline.visible = this.lineartVisible && mesh.visible !== false;
    });
    this.viewport.invalidate();
    return this.lineartVisible;
  }

  setLineartScale(scale) {
    this.lineartScale = scale;
    if (!this.root) return;
    this.root.traverse(obj => {
      const outline = obj.userData?.poseToonOutline;
      if (outline?.isObject3D) outline.scale.copy(obj.scale).multiplyScalar(1 + this.lineartScale);
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach(mat => {
        if (mat?.userData?.outlineParameters) mat.userData.outlineParameters.thickness = this.lineartScale;
      });
    });
  }

  /* Alt parçalar (materyal slotu / gizleme paneli için). */
  get parts() {
    return this.meshes.map((mesh, index) => ({
      index,
      name: mesh.name || `mesh_${index}`,
      mesh,
      materials: Array.isArray(mesh.material) ? mesh.material : [mesh.material],
    }));
  }

  /* --- Parça görünürlüğü ve izolasyon (P3) --- */

  get partStates() {
    return this.meshes.map((mesh, index) => ({
      index,
      name: mesh.name || `mesh_${index}`,
      visible: mesh.visible !== false,
      materials: Array.isArray(mesh.material) ? mesh.material.length : 1,
    }));
  }

  get hiddenParts() {
    return this.partStates.filter(part => !part.visible);
  }

  setPartVisible(index, visible) {
    const mesh = this.meshes[index];
    if (!mesh) return false;
    mesh.visible = !!visible;
    /* Toon outline ayrı bir nesne: görünürlüğü mesh'i takip etmezse hayalet çizgi kalır. */
    const outline = mesh.userData?.poseToonOutline;
    if (outline) outline.visible = mesh.visible && this.lineartVisible;
    this.viewport.invalidate();
    return true;
  }

  isolatePart(index) {
    if (!this.meshes[index]) return false;
    this.meshes.forEach((mesh, current) => this.setPartVisible(current, current === index));
    this.isolatedIndex = index;
    this.viewport.invalidate();
    return true;
  }

  restoreVisibility() {
    this.meshes.forEach((mesh, index) => this.setPartVisible(index, true));
    this.isolatedIndex = null;
    this.viewport.invalidate();
  }

  findMeshBySkeleton(bone) {
    return this.meshes.find(mesh => mesh.skeleton?.bones?.includes(bone)) || null;
  }

  cleanName(name) { return cleanName(name); }
}
