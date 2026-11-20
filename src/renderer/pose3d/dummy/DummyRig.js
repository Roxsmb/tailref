import * as THREE from '../../vendor/three.module.js';

/* TailRef ölçek referansı iskeleti — TAMAMEN BU DEPODA üretildi (MIT).
   Üçüncü taraf FBX yerine geçer: aynı isim hiyerarşisi anatomik düzdeş,
   tipik insan oranları (~1,7 m), T-pozuna yakın hafif A-pozu.
   Kemik adları Rig kurallarıyla (hips/spine1/leftarm/…) uyumludur.
   Görsel kaplıklama kapsül/kutu primer katmanlardır; SceneGraph.install()
   toon/lineart da dahil normalizasyonu tek noktadan uygular. */

const MATERIAL = () => new THREE.MeshStandardMaterial({
  color: 0x9aa2ab,
  roughness: 0.62,
  metalness: 0.05,
  emissive: 0x202830,
  emissiveIntensity: 0.32,
});

function bone(name, x = 0, y = 0, z = 0) {
  const b = new THREE.Bone();
  b.name = name;
  b.position.set(x, y, z);
  return b;
}

/* Segment kapsülü: bu kemiğin ORİJİNİNDEN `childPos`'a (çocuk eklem) uzar.
   Kemik lokal uzayında kurulur; poz değişince ebeveyn kemikle döner. */
function capsuleBetween(boneObj, radius, childPos) {
  const dir = new THREE.Vector3().copy(childPos);
  const length = Math.max(dir.length(), 0.02);
  const geo = new THREE.CapsuleGeometry(radius, Math.max(length - radius * 2, 0.04), 6, 12);
  const mesh = new THREE.Mesh(geo, MATERIAL());
  mesh.name = `${boneObj.name}_mesh`;
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  mesh.position.copy(dir.clone().multiplyScalar(0.5));
  boneObj.add(mesh);
  return mesh;
}

function box(boneObj, w, h, d, x = 0, y = 0, z = 0, name = '') {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), MATERIAL());
  mesh.name = name || `${boneObj.name}_mesh`;
  mesh.position.set(x, y, z);
  boneObj.add(mesh);
  return mesh;
}

/* Kollar X ekseni boyunca, bacaklar/omurga Y ekseni boyunca uzanır. */
export function buildScaleReferenceDummy() {
  const root = new THREE.Group();
  root.name = 'tailrefScaleDummy';

  const hips = bone('hips');
  const spine1 = bone('spine1', 0, 0.12, 0);
  const head = bone('head', 0, 0.28, 0);
  const headend = bone('headend', 0, 0.18, 0);

  const leftShoulder = bone('leftshoulder', -0.09, 0.17, 0);
  const leftArm = bone('leftarm', -0.16, 0, 0);
  const leftForearm = bone('leftforearm', -0.24, 0, 0);
  const leftHand = bone('lefthand', -0.23, 0, 0);

  const rightShoulder = bone('rightshoulder', 0.09, 0.17, 0);
  const rightArm = bone('rightarm', 0.16, 0, 0);
  const rightForearm = bone('rightforearm', 0.24, 0, 0);
  const rightHand = bone('righthand', 0.23, 0, 0);

  const leftThigh = bone('leftthigh', -0.11, -0.03, 0);
  const leftShin = bone('leftshin', 0, -0.44, 0);
  const leftFoot = bone('leftfoot', 0, -0.42, 0.02);

  const rightThigh = bone('rightthigh', 0.11, -0.03, 0);
  const rightShin = bone('rightshin', 0, -0.44, 0);
  const rightFoot = bone('rightfoot', 0, -0.42, 0.02);

  hips.add(spine1, leftThigh, rightThigh);
  spine1.add(head, leftShoulder, rightShoulder);
  head.add(headend);
  leftShoulder.add(leftArm); leftArm.add(leftForearm); leftForearm.add(leftHand);
  rightShoulder.add(rightArm); rightArm.add(rightForearm); rightForearm.add(rightHand);
  leftThigh.add(leftShin); leftShin.add(leftFoot);
  rightThigh.add(rightShin); rightShin.add(rightFoot);

  /* Gövde: pelvis→omuz hattı (spine1 lokalinde yukarı) */
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.22, 6, 14), MATERIAL());
  torso.name = 'refTorso';
  torso.position.set(0, 0.16, 0);
  spine1.add(torso);

  /* Baş kafası: görsel ağırlığı head kemikte */
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.095, 16, 14), MATERIAL());
  skull.name = 'refHead';
  skull.position.set(0, 0.09, 0.01);
  head.add(skull);

  /* Kollar: omuz→dirsek / dirsek→bilek segmentleri (X ekseni) */
  capsuleBetween(leftArm, 0.045, leftForearm.position);
  capsuleBetween(leftForearm, 0.038, leftHand.position);
  const handL = box(leftHand, 0.07, 0.04, 0.19, -0.09, 0, 0.02, 'refHandL');
  handL.rotation.y = Math.PI / 2;
  capsuleBetween(rightArm, 0.045, rightForearm.position);
  capsuleBetween(rightForearm, 0.038, rightHand.position);
  const handR = box(rightHand, 0.07, 0.04, 0.19, 0.09, 0, 0.02, 'refHandR');
  handR.rotation.y = Math.PI / 2;

  /* Bacaklar: kalça→diz / diz→ayak (Y ekseni) */
  capsuleBetween(leftThigh, 0.07, leftShin.position);
  capsuleBetween(leftShin, 0.055, leftFoot.position);
  const footL = box(leftFoot, 0.09, 0.06, 0.24, 0, -0.028, 0.09, 'refFootL');
  footL.rotation.x = 0.06;
  capsuleBetween(rightThigh, 0.07, rightShin.position);
  capsuleBetween(rightShin, 0.055, rightFoot.position);
  const footR = box(rightFoot, 0.09, 0.06, 0.24, 0, -0.028, 0.09, 'refFootR');
  footR.rotation.x = 0.06;

  root.add(hips);
  return root;
}
