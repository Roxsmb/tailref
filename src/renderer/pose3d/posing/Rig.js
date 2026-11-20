import * as THREE from '../../vendor/three.module.js';
import { cleanName } from '../util/helpers.js';

/* Kemik envanteri, isim eşleme ve pozdan bağımsız temel duruş. */
export class Rig {
  constructor() {
    this.root = null;
    this.bones = [];
    this.baseRotations = new Map();
    this.basePositions = new Map();
  }

  /* Dummy-era poza kayıtlarındaki isimler ↔ Mixamo adları köprüsü
     (cleanName sonrası küçük harf alfasayısal yazımlar). Ek adları
     için zaten alt-dizi eşleşmesi çalışır (findBone ikinci-pass);
     yazımı farklı olanlar (thigh→upleg, shin→leg) burada eşlenir. */
  static ALIASES = {
    leftthigh: 'leftupleg',
    rightthigh: 'rightupleg',
    leftshin: 'leftleg',
    rightshin: 'rightleg',
    thighl: 'leftupleg',
    thighr: 'rightupleg',
    shinl: 'leftleg',
    shinr: 'rightleg',
  };

  static expandName(key) {
    const k = cleanName(key);
    const alias = Rig.ALIASES[k];
    return alias ? [k, alias] : [k];
  }

  build(root) {
    this.root = root;
    this.bones = [];
    this.baseRotations.clear();
    this.basePositions.clear();
    root.traverse(obj => { if (obj.isBone) this.bones.push(obj); });
    this.bones.forEach(bone => this.baseRotations.set(bone.uuid, bone.rotation.clone()));
    /* T-poz reseti eklem konumlarını da toparlayabilsin: farklı rig'in
       eklem konumu bir kez ezildiyse yalnız dönüş reseti modeli
       kurtarmaz. */
    this.bones.forEach(bone => this.basePositions.set(bone.uuid, bone.position.clone()));
    return this;
  }

  get size() { return this.bones.length; }

  /* İlk 8 kemik adı: kütüphanedeki pozun bu rig'e ait olup olmadığını anlamak için. */
  get signature() {
    return this.bones.slice(0, 8).map(bone => cleanName(bone.name)).join('|');
  }

  findBone(keys) {
    const wanted = [];
    keys.forEach(key => {
      Rig.expandName(key).forEach(expanded => {
        if (!wanted.includes(expanded)) wanted.push(expanded);
      });
    });
    return this.bones.find(bone => wanted.includes(cleanName(bone.name)))
      || this.bones.find(bone => wanted.some(key => cleanName(bone.name).includes(key)))
      || null;
  }

  /* Omuz/kol bacak gibi zincirleri role göre çözer. */
  chain(keys) {
    return keys.map(list => this.findBone(list)).filter(Boolean);
  }

  get rules() {
    return [
      { keys: ['clavicle.L', 'leftshoulder', 'shoulder.l', 'leftclavicle', 'mixamorigleftshoulder'], label: 'Omuz L', color: 0xffcf68 },
      { keys: ['clavicle.R', 'rightshoulder', 'shoulder.r', 'rightclavicle', 'mixamorigrightshoulder'], label: 'Omuz R', color: 0xffcf68 },
      { keys: ['armstretch.L', 'leftforearm', 'leftelbow', 'lowerarm.l', 'mixamorigleftforearm'], label: 'Dirsek L', color: 0xff9b77 },
      { keys: ['armstretch.R', 'rightforearm', 'rightelbow', 'lowerarm.r', 'mixamorigrightforearm'], label: 'Dirsek R', color: 0xff9b77 },
      {
        keys: ['hand.L', 'lefthand', 'hand.l', 'mixamoriglefthand'], label: 'El L', color: 0xff8ab8,
        chainKeys: [['upperarm.l', 'leftarm', 'leftupperarm', 'mixamorigleftarm'], ['lowerarm.l', 'leftforearm', 'mixamorigleftforearm'], ['hand.l', 'lefthand', 'mixamoriglefthand']],
        poleKeys: ['armstretch.l', 'leftelbow'],
      },
      {
        keys: ['hand.R', 'righthand', 'hand.r', 'mixamogrighthand'], label: 'El R', color: 0xff8ab8,
        chainKeys: [['upperarm.r', 'rightarm', 'rightupperarm', 'mixamorigrightarm'], ['lowerarm.r', 'rightforearm', 'mixamorigrightforearm'], ['hand.r', 'righthand', 'mixamogrighthand']],
        poleKeys: ['armstretch.r', 'rightelbow'],
      },
      {
        keys: ['footcontroller.L', 'leftfootcontroller', 'leftankle', 'leftfoot', 'lefttoe', 'foot.l'], label: 'Ayak L', color: 0x72d6ff,
        chainKeys: [['thigh.l', 'leftthigh', 'leftupleg'], ['shin.l', 'leftshin', 'leftcalf', 'leftleg'], ['foot.l', 'leftfoot', 'leftankle']],
        poleKeys: ['legpole.l', 'leftknee', 'kneel', 'leftleg', 'leftshin'],
      },
      {
        keys: ['footcontroller.R', 'rightfootcontroller', 'rightankle', 'rightfoot', 'righttoe', 'foot.r'], label: 'Ayak R', color: 0x72d6ff,
        chainKeys: [['thigh.r', 'rightthigh', 'rightupleg'], ['shin.r', 'rightshin', 'rightcalf', 'rightleg'], ['foot.r', 'rightfoot', 'rightankle']],
        poleKeys: ['legpole.r', 'rightknee', 'kneer', 'rightleg', 'rightshin'],
      },
      { keys: ['legpole.L', 'leftknee', 'kneel', 'leftleg', 'leftshin'], label: 'Knee L', color: 0xa98cff },
      { keys: ['legpole.R', 'rightknee', 'kneer', 'rightleg', 'rightshin'], label: 'Knee R', color: 0xa98cff },
      { keys: ['head', 'headend', 'neckhead'], label: 'Head', color: 0xffd36e },
      {
        /* Bel: yalnız omurga kemikleri (Hips hariç). Hips zincire
           alınırsa sürükleme tüm gövdeyi çeviriyor ve bel BÜKÜLMÜYORDU.
           Üç omurga FABRIK zinciri beli doğal kıvrımla bükür. */
        keys: ['spine1', 'spine2', 'waist', 'mixamorigspine1'], label: 'Waist', color: 0xffa86b,
        chainKeys: [['spine', 'mixamorigspine'], ['spine1', 'mixamorigspine1'], ['spine2', 'mixamorigspine2']],
      },
      { keys: ['pelvis', 'hips', 'hip', 'mixamorighips'], label: 'Pelvis', color: 0x8dffae },
    ];
  }

  get fingerNames() {
    return [['thumb1', 'Thumb'], ['index1', 'Index'], ['middle1', 'Middle'], ['ring1', 'Ring'], ['pinky1', 'Pinky']];
  }

  resetToBase() {
    this.bones.forEach(bone => {
      const rotation = this.baseRotations.get(bone.uuid);
      if (rotation) bone.rotation.copy(rotation);
      /* Eklem konumu de ezilmişse (farklı rig'in pozu gibi) T-poz reset
         konumları da geri getirir. */
      const position = this.basePositions.get(bone.uuid);
      if (position) bone.position.copy(position);
    });
    this.root?.updateMatrixWorld(true);
  }

  snapshot() {
    /* Ölçek oranı da geçmişe taşınır: büyüt/küçült (dev/peri)
       Ctrl+Z ile geri alınabilsin (kullanıcı, 9 Kasım). */
    const snap = this.bones.map(bone => ({ id: bone.uuid, p: bone.position.clone(), q: bone.quaternion.clone() }));
    snap.scale = Number.isFinite(this.scaleRatio) ? this.scaleRatio : 1;
    return snap;
  }

  restore(snapshot) {
    /* Geri alınan maddede ölçek bilgisi varsa uygula: ham snapshot'lar
       dizi nesnesi, .scale özelliği taşıyabilir. Rig dış dünyayla köprü
       onScaleRatio ile kurulur (bootstrap) — köprü yoksa kemikler
       yine de geri gelir. */
    if (snapshot && Number.isFinite(snapshot.scale)
      && typeof this.onScaleRatio === 'function'
      && snapshot.scale !== (this.scaleRatio ?? 1)) {
      this.onScaleRatio(snapshot.scale);
    }
    if (!Array.isArray(snapshot)) return;
    snapshot.forEach(entry => {
      const bone = this.bones.find(item => item.uuid === entry.id);
      if (!bone) return;
      bone.position.copy(entry.p);
      bone.quaternion.copy(entry.q);
    });
    this.root?.updateMatrixWorld(true);
  }

  /* Poz kütüphanesi için düz JSON (Vector3/Quaternion yerine sayı dizileri). */
  snapshotJSON() {
    return this.bones.map(bone => ({
      id: bone.uuid,
      name: bone.name,
      p: bone.position.toArray(),
      q: bone.quaternion.toArray(),
    }));
  }

  /* Kayıttaki kemiği önce uuid, sonra tam ad, en son normalize adla bulur:
     aynı rig'in yeniden yüklenmiş hâlinde de eşleşir. Eski dummy
     kayıtları için genişletilmiş adlar (ALIASES) ve alt-dizi eşleşmesi
     de düşüş katılır (mixamorig önekiyle gelen FBX kemiklerine bağlanır). */
  resolveBone(entry) {
    if (!entry) return null;
    if (entry.id) {
      const byId = this.bones.find(bone => bone.uuid === entry.id);
      if (byId) return byId;
    }
    if (!entry.name) return null;
    const wanted = Rig.expandName(entry.name);
    const want = cleanName(entry.name);
    return this.bones.find(bone => bone.name === entry.name)
      || this.bones.find(bone => wanted.includes(cleanName(bone.name)))
      || this.bones.find(bone => cleanName(bone.name) === want)
      || this.bones.find(bone => wanted.some(key =>
        cleanName(bone.name).endsWith(key) || cleanName(bone.name).includes(key)))
      || null;
  }

  /* Kayıttaki eklem konumu güvenli mi? Pozlama yalnızca dönüşle çalışır:
     sağlıklı kayıtta p taban konUMA denktir. Tabandan sapmış p (ezilmiş,
     [0,0,0] ya da başka rig'in konumları) kaydı bozmuş demektir — bu
     kemiğin konumu EZİLMESİN, tabanda kalsın (dönüş yine uygulanır). */
  safeBasePosition(bone, pArray) {
    const base = this.basePositions.get(bone.uuid);
    if (!base || !Array.isArray(pArray) || pArray.length < 3) return null;
    const dx = pArray[0] - base.x;
    const dy = pArray[1] - base.y;
    const dz = pArray[2] - base.z;
    const sapma = Math.hypot(dx, dy, dz);
    return sapma <= Math.max(1e-3, base.length() * 0.05) ? new THREE.Vector3().fromArray(pArray) : null;
  }

  restoreJSON(entries) {
    if (!Array.isArray(entries)) return 0;
    const resolved = [];
    entries.forEach(entry => {
      const bone = this.resolveBone(entry);
      if (!bone || !Array.isArray(entry.q)) return;
      resolved.push({ bone, entry });
    });
    if (!resolved.length) return 0;
    /* Aynı rig'de poza koyma yalnızca DÖNÜŞ değiştirir: eklem konumu
       tabandan asla sapmaz. Herhangi bir konum sapmışsa kayıt bozuk veya
       yabancıdır — HİÇ uygulanmaz; açılış temiz bağ duruşuyla gelir
       (kullanıcı talebi: "poz sıfırlanmış olarak açılmalı"). */
    const bozuk = resolved.some(({ bone, entry }) =>
      !this.safeBasePosition(bone, entry.p));
    if (bozuk) return 0;
    resolved.forEach(({ bone, entry }) => {
      const pSafe = this.safeBasePosition(bone, entry.p);
      if (pSafe) bone.position.copy(pSafe);
      bone.quaternion.fromArray(entry.q);
    });
    this.root?.updateMatrixWorld(true);
    return resolved.length;
  }

  /* T-pose: kollar yatay. FBX'in bind duruşu A-pose olabildiği için yalnızca
     temel rotasyona dönmek yetmez; kolları dünya uzayında yataya çeker. */
  toTPose() {
    return this.aimArms(0);
  }

  /* A-pose: kollar yataydan 45° aşağı (mutlak açı). Eski sürüm mevcut
     duruşa 35° eklediği için bind A-pose ise kollar neredeyse gövdeye yapışıyordu. */
  toAPose({ angle = 45 } = {}) {
    return this.aimArms(angle);
  }

  /* Kolları verilen açıyla (yataydan aşağı, derece) dünya uzayında hedefler.
     Yön tabanlı çalışır: bind pozisyonu T veya A olsa da mutlak sonucu verir. */
  aimArms(downDegrees = 0) {
    this.resetToBase();
    if (!this.root) return false;
    this.root.updateMatrixWorld(true);

    const sides = [
      {
        sign: 1,
        upper: ['leftarm', 'mixamorigleftarm', 'upperarm.l', 'leftupperarm'],
        fore: ['leftforearm', 'mixamorigleftforearm', 'lowerarm.l', 'leftelbow'],
      },
      {
        sign: -1,
        upper: ['rightarm', 'mixamorigrightarm', 'upperarm.r', 'rightupperarm'],
        fore: ['rightforearm', 'mixamorigrightforearm', 'lowerarm.r', 'rightelbow'],
      },
    ];
    const start = new THREE.Vector3();
    const end = new THREE.Vector3();
    const desired = new THREE.Vector3();
    const angle = THREE.MathUtils.degToRad(Math.max(0, Math.min(90, downDegrees)));
    let applied = 0;

    sides.forEach(side => {
      const upper = this.findBone(side.upper);
      const fore = this.findBone(side.fore);
      if (!upper || !fore) return;
      upper.getWorldPosition(start);
      fore.getWorldPosition(end);
      const direction = end.sub(start).normalize();
      if (direction.lengthSq() < 1e-6) return;

      /* Dışa doğru yön: işaret kemik adından değil, mevcut kol yönünden gelir;
         böylece aynası dönük rig'lerde de doğru tarafa açılır. */
      const sign = Math.abs(direction.x) > 1e-4 ? Math.sign(direction.x) : side.sign;
      desired.set(sign * Math.cos(angle), -Math.sin(angle), 0).normalize();

      const delta = new THREE.Quaternion().setFromUnitVectors(direction, desired);
      const world = upper.getWorldQuaternion(new THREE.Quaternion());
      const parentWorld = upper.parent
        ? upper.parent.getWorldQuaternion(new THREE.Quaternion())
        : new THREE.Quaternion();
      upper.quaternion.copy(parentWorld.invert().multiply(delta.multiply(world)));
      this.root.updateMatrixWorld(true);
      applied++;
    });

    return applied > 0;
  }

  /* Referansları bırakır; kemik düğümleri SceneGraph tarafından yok edilir. */
  dispose() {
    this.bones = [];
    this.baseRotations.clear();
    this.root = null;
  }
}
