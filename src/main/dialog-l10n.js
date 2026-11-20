'use strict';

/* TailRef — ana-süreç diyalog yerelleştirmesi
   ==========================================
   Renderer'daki 01b-l10n.js'in ana-süreç karşılığı: Electron'un yerel
   diyalogları (kaydet/aç, kapatma uyarısı, kurtarma kutuları) kullanıcı
   seçili dilde gösterilir.

   · Kaynak metinler EN literaller (gettext-tarzı; EN = kimlik anahtar).
   · Dil kaynağı: renderer her açılışta ve dil değişiminde
     'app-language' kanalıyla ana sürece bildirir (preload: sendAppLanguage).
     Renderer donduğunda (kurtarma yolu) ana süreç en son bilinen dili
     kullanır — çoğu durumda doğru dildir.
   · t() öncelik sırası: seçili dil → EN (anahtarın kendisi). Ham anahtar
     asla görünmez; sözlükte eksik olan anahtar EN'e düşer.
   · Çoğul ekleme arabirimli dizelerle (":" kalıpları) bilinçli
     kaçınıldı; böylece tek form × 10 dil yeterlidir. */

/* {ad} interpolasyonu: t('{n} öğe', { n: 3 }) → '3 öğe'. */
function interpolate(str, params) {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (m, ad) =>
    Object.prototype.hasOwnProperty.call(params, ad) ? String(params[ad]) : m);
}

/* Dil → yerel biçim etiketi (tarih/saat için toLocaleString). */
const LOCALE_TAGS = {
  en: 'en-US', tr: 'tr-TR', de: 'de-DE', fr: 'fr-FR', es: 'es-ES',
  ja: 'ja-JP', ko: 'ko-KR', 'zh-CN': 'zh-CN', 'pt-BR': 'pt-BR', ru: 'ru-RU',
};

/* Anahtar → dil → metin. 'en' girişi yoktur: EN = anahtar (kimlik).
   Her dil paketi AYNI anahtar kümesini içermelidir (packsCheck() ile
   test edilir). */
const PACKS = {
  tr: {
    'Unsaved changes will be lost.': 'Kaydetmediğin değişiklikler kaybolacak.',
    'Save your work as a .tail file?': '.tail dosyası olarak kaydetmek ister misin?',
    'Save and quit': 'Kaydet ve çık',
    'Quit without saving': 'Kaydetmeden çık',
    'Cancel': 'Vazgeç',
    'Save image': 'Görüntüyü kaydet',
    'Save preferences': "Tercihleri kaydet",
    'Choose save folder': 'Kayıt klasörünü seç',
    'Select this folder': 'Bu klasörü seç',
    'Export photo': 'Fotoğrafı dışa aktar',
    'Export brush as .abr': 'Fırçayı .abr olarak dışa aktar',
    '.abr brush': '.abr fırçası',
    'Save board as .tail': 'Tahtayı .tail olarak kaydet',
    'TailRef board': 'TailRef tahta',
    'Open .tail board': '.tail tahta aç',
    'Continue': 'Devam et',
    'This is not a valid .tail file.': 'Bu geçerli bir .tail dosyası değil.',
    'Unsupported .tail version ({n}).': 'Desteklenmeyen .tail sürümü ({n}).',
    'Backups tried in this session: {n} — the problem was not fixed.':
      'Bu oturumda denenen yedek: {n} — sorun çözülmedi.',
    'Healthy backups among the {n} scanned: none (too large / too many items).':
      'Taranan {n} yedek arasında sağlıklı olan: yok (çok büyük / çok öğeli).',
    'No backup that could be considered healthy was found.':
      'Sağlıklı sayılabilecek bir yedek bulunamadı.',
    'No backup files exist. Backups are created only while Settings → "Auto backup" is enabled.':
      'Hiç yedek dosyası yok. Yedekler yalnızca Ayarlar → "Otomatik yedekleme" açıkken oluşturulur.',
    'If "Clean start" is chosen, the current (corrupted) data is NOT deleted: it is moved to the Archive folder and the app opens with a single empty board.':
      '"Temiz başlat" seçilirse mevcut (bozuk) veriler SİLİNMEZ: Arşiv klasörüne taşınır ve uygulama tek boş panoyla açılır.',
    'TailRef Studio is not responding': 'TailRef Studio yanıt vermiyor',
    'No healthy backup was found to recover from.': 'Kurtarılabilecek sağlıklı bir yedek bulunamadı.',
    'Clean start': 'Temiz başlat',
    'Wait': 'Bekle',
    'Which option would you like?': 'Hangi seçeneği istersin?',
    'Selected healthy backup: {name}': 'Seçilen sağlıklı yedek: {name}',
    'Items: {items} · Images: {images} · Size: {size}':
      'Öğe: {items} · Görsel: {images} · Boyut: {size}',
    '(Backups skipped as unhealthy: {n} — too large / too many items)':
      '(Sağlıksız olarak atlanan yedek: {n} — çok büyük / çok öğeli)',
    '"Return to last healthy save": the app restarts and loads this backup. Changes made after that save will be lost.':
      '"Son sağlıklı kayda dön": uygulama yeniden başlar ve bu yedek yüklenir. Son kayıttan sonraki değişiklikler kaybolur.',
    '"Clean start": current data is moved to the Archive folder and the app opens with a single empty board.':
      '"Temiz başlat": mevcut veriler Arşiv klasörüne taşınır, uygulama tek boş panoyla açılır.',
    'The app is overloaded and not responding.': 'Uygulama aşırı yüklendi ve yanıt vermiyor.',
    'Return to last healthy save': 'Son sağlıklı kayda dön',
    'Save canvas as PNG': 'Tuvali PNG olarak kaydet',
    'PNG image': 'PNG görüntü',
    'Invalid PNG.': 'Geçersiz PNG.',
    'Invalid image.': 'Geçersiz görüntü.',
    'Invalid image size.': 'Geçersiz görüntü boyutu.',
    'Folder not found.': 'Klasör bulunamadı.',
    'Invalid brush.': 'Geçersiz fırça.',
    'Invalid brush size.': 'Geçersiz fırça boyutu.',
    'photo': 'fotograf',
    'brush': 'firca',
    'board': 'tahta',
    'canvas': 'tuval',
    'Archive: {dir}': 'Arşiv: {dir}',
    'Port {n} is already in use.\n\nTailRef may still be open in another user session or in the background.\nClose the remaining "TailRef Studio" process from Task Manager and try again.\n\n(We do not change the port: board data is tied to this recorded port.)':
      'Port {n} kullanımda.\n\nTailRef başka bir kullanıcı oturumunda veya arka planda açık kalmış olabilir.\nGörev Yöneticisi\'nden kalan "TailRef Studio" sürecini kapatıp tekrar dene.\n\n(Port değiştirmiyoruz: tahta verisi bu porta bağlı kayıtlı.)',
    'Could not start the local server: {msg}': 'Yerel sunucu başlatılamadı: {msg}',
    'Unknown error': 'Bilinmeyen hata',
    'Could not save.': 'Kaydedilemedi.',
  },

  de: {
    'Unsaved changes will be lost.': 'Nicht gespeicherte Änderungen gehen verloren.',
    'Save your work as a .tail file?': 'Deine Arbeit als .tail-Datei speichern?',
    'Save and quit': 'Speichern und beenden',
    'Quit without saving': 'Beenden, ohne zu speichern',
    'Cancel': 'Abbrechen',
    'Save image': 'Bild speichern',
    'Save preferences': "Einstellungen speichern",
    'Choose save folder': 'Speicherordner wählen',
    'Select this folder': 'Diesen Ordner auswählen',
    'Export photo': 'Foto exportieren',
    'Export brush as .abr': 'Pinsel als .abr exportieren',
    '.abr brush': '.abr-Pinsel',
    'Save board as .tail': 'Tafel als .tail speichern',
    'TailRef board': 'TailRef-Tafel',
    'Open .tail board': '.tail-Tafel öffnen',
    'Continue': 'Fortfahren',
    'This is not a valid .tail file.': 'Dies ist keine gültige .tail-Datei.',
    'Unsupported .tail version ({n}).': 'Nicht unterstützte .tail-Version ({n}).',
    'Backups tried in this session: {n} — the problem was not fixed.':
      'In dieser Sitzung getestete Sicherungen: {n} — das Problem wurde nicht behoben.',
    'Healthy backups among the {n} scanned: none (too large / too many items).':
      'Gesunde Sicherungen von {n} gescannten: keine (zu groß / zu viele Elemente).',
    'No backup that could be considered healthy was found.':
      'Keine Sicherung gefunden, die als gesund gelten könnte.',
    'No backup files exist. Backups are created only while Settings → "Auto backup" is enabled.':
      'Es gibt keine Sicherungsdateien. Sicherungen werden nur erstellt, wenn Einstellungen → "Automatisches Backup" aktiv ist.',
    'If "Clean start" is chosen, the current (corrupted) data is NOT deleted: it is moved to the Archive folder and the app opens with a single empty board.':
      'Bei "Neu anfangen" werden die aktuellen (beschädigten) Daten NICHT gelöscht: Sie werden in den Archivordner verschoben und die App öffnet mit einer einzelnen leeren Tafel.',
    'TailRef Studio is not responding': 'TailRef Studio antwortet nicht',
    'No healthy backup was found to recover from.': 'Keine gesunde Sicherung zur Wiederherstellung gefunden.',
    'Clean start': 'Neu anfangen',
    'Wait': 'Warten',
    'Which option would you like?': 'Welche Option möchtest du?',
    'Selected healthy backup: {name}': 'Ausgewählte gesunde Sicherung: {name}',
    'Items: {items} · Images: {images} · Size: {size}':
      'Elemente: {items} · Bilder: {images} · Größe: {size}',
    '(Backups skipped as unhealthy: {n} — too large / too many items)':
      '(Als ungesund übersprungene Sicherungen: {n} — zu groß / zu viele Elemente)',
    '"Return to last healthy save": the app restarts and loads this backup. Changes made after that save will be lost.':
      '"Zur letzten gesunden Sicherung zurückkehren": Die App startet neu und lädt diese Sicherung. Nach dieser Sicherung gemachte Änderungen gehen verloren.',
    '"Clean start": current data is moved to the Archive folder and the app opens with a single empty board.':
      '"Neu anfangen": Die aktuellen Daten werden in den Archivordner verschoben und die App öffnet mit einer einzelnen leeren Tafel.',
    'The app is overloaded and not responding.': 'Die App ist überlastet und antwortet nicht.',
    'Return to last healthy save': 'Zur letzten gesunden Sicherung zurückkehren',
    'Save canvas as PNG': 'Leinwand als PNG speichern',
    'PNG image': 'PNG-Bild',
    'Invalid PNG.': 'Ungültiges PNG.',
    'Invalid image.': 'Ungültiges Bild.',
    'Invalid image size.': 'Ungültige Bildgröße.',
    'Folder not found.': 'Ordner nicht gefunden.',
    'Invalid brush.': 'Ungültiger Pinsel.',
    'Invalid brush size.': 'Ungültige Pinselgröße.',
    'photo': 'Foto',
    'brush': 'Pinsel',
    'board': 'Tafel',
    'canvas': 'Leinwand',
    'Archive: {dir}': 'Archiv: {dir}',
    'Port {n} is already in use.\n\nTailRef may still be open in another user session or in the background.\nClose the remaining "TailRef Studio" process from Task Manager and try again.\n\n(We do not change the port: board data is tied to this recorded port.)':
      'Port {n} ist bereits in Verwendung.\n\nTailRef läuft möglicherweise noch in einer anderen Benutzersitzung oder im Hintergrund.\nBeende den verbleibenden Prozess "TailRef Studio" im Task-Manager und versuche es erneut.\n\n(Wir ändern den Port nicht: Die Tafel-Daten sind an diesen gespeicherten Port gebunden.)',
    'Could not start the local server: {msg}': 'Lokaler Server konnte nicht gestartet werden: {msg}',
    'Unknown error': 'Unbekannter Fehler',
    'Could not save.': 'Speichern fehlgeschlagen.',
  },

  fr: {
    'Unsaved changes will be lost.': 'Les modifications non enregistrées seront perdues.',
    'Save your work as a .tail file?': 'Enregistrer votre travail dans un fichier .tail ?',
    'Save and quit': 'Enregistrer et quitter',
    'Quit without saving': 'Quitter sans enregistrer',
    'Cancel': 'Annuler',
    'Save image': 'Enregistrer l’image',
    'Save preferences': "Enregistrer les préférences",
    'Choose save folder': 'Choisir le dossier d’enregistrement',
    'Select this folder': 'Choisir ce dossier',
    'Export photo': 'Exporter la photo',
    'Export brush as .abr': 'Exporter la brosse en .abr',
    '.abr brush': 'Brosse .abr',
    'Save board as .tail': 'Enregistrer le tableau en .tail',
    'TailRef board': 'Tableau TailRef',
    'Open .tail board': 'Ouvrir un tableau .tail',
    'Continue': 'Continuer',
    'This is not a valid .tail file.': 'Ce fichier .tail n’est pas valide.',
    'Unsupported .tail version ({n}).': 'Version .tail non prise en charge ({n}).',
    'Backups tried in this session: {n} — the problem was not fixed.':
      'Sauvegardes essayées dans cette session : {n} — le problème n’a pas été résolu.',
    'Healthy backups among the {n} scanned: none (too large / too many items).':
      'Sauvegardes saines parmi {n} analysées : aucune (trop grande / trop d’éléments).',
    'No backup that could be considered healthy was found.':
      'Aucune sauvegarde pouvant être considérée comme saine n’a été trouvée.',
    'No backup files exist. Backups are created only while Settings → "Auto backup" is enabled.':
      'Il n’existe aucun fichier de sauvegarde. Les sauvegardes sont créées uniquement lorsque Réglages → « Sauvegarde automatique » est activé.',
    'If "Clean start" is chosen, the current (corrupted) data is NOT deleted: it is moved to the Archive folder and the app opens with a single empty board.':
      'Si « Démarrage propre » est choisi, les données actuelles (corrompues) ne sont PAS supprimées : elles sont déplacées vers le dossier d’archive et l’app s’ouvre avec un seul tableau vide.',
    'TailRef Studio is not responding': 'TailRef Studio ne répond plus',
    'No healthy backup was found to recover from.': 'Aucune sauvegarde saine n’a été trouvée pour la récupération.',
    'Clean start': 'Démarrage propre',
    'Wait': 'Attendre',
    'Which option would you like?': 'Quelle option souhaitez-vous ?',
    'Selected healthy backup: {name}': 'Sauvegarde saine sélectionnée : {name}',
    'Items: {items} · Images: {images} · Size: {size}':
      'Éléments : {items} · Images : {images} · Taille : {size}',
    '(Backups skipped as unhealthy: {n} — too large / too many items)':
      '(Sauvegardes ignorées comme non saines : {n} — trop grandes / trop d’éléments)',
    '"Return to last healthy save": the app restarts and loads this backup. Changes made after that save will be lost.':
      '« Revenir à la dernière sauvegarde saine » : l’app redémarre et charge cette sauvegarde. Les modifications effectuées après cette sauvegarde seront perdues.',
    '"Clean start": current data is moved to the Archive folder and the app opens with a single empty board.':
      '« Démarrage propre » : les données actuelles sont déplacées vers le dossier d’archive et l’app s’ouvre avec un seul tableau vide.',
    'The app is overloaded and not responding.': 'L’app est surchargée et ne répond plus.',
    'Return to last healthy save': 'Revenir à la dernière sauvegarde saine',
    'Save canvas as PNG': 'Enregistrer la toile en PNG',
    'PNG image': 'Image PNG',
    'Invalid PNG.': 'PNG non valide.',
    'Invalid image.': 'Image non valide.',
    'Invalid image size.': 'Taille d’image non valide.',
    'Folder not found.': 'Dossier introuvable.',
    'Invalid brush.': 'Brosse non valide.',
    'Invalid brush size.': 'Taille de brosse non valide.',
    'photo': 'photo',
    'brush': 'brosse',
    'board': 'tableau',
    'canvas': 'toile',
    'Archive: {dir}': 'Archive : {dir}',
    'Port {n} is already in use.\n\nTailRef may still be open in another user session or in the background.\nClose the remaining "TailRef Studio" process from Task Manager and try again.\n\n(We do not change the port: board data is tied to this recorded port.)':
      'Le port {n} est déjà utilisé.\n\nTailRef est peut-être encore ouvert dans une autre session utilisateur ou en arrière-plan.\nFermez le processus « TailRef Studio » restant dans le Gestionnaire des tâches et réessayez.\n\n(Nous ne changeons pas le port : les données du tableau sont liées à ce port enregistré.)',
    'Could not start the local server: {msg}': 'Impossible de démarrer le serveur local : {msg}',
    'Unknown error': 'Erreur inconnue',
    'Could not save.': 'Échec de l’enregistrement.',
  },

  es: {
    'Unsaved changes will be lost.': 'Los cambios no guardados se perderán.',
    'Save your work as a .tail file?': '¿Guardar tu trabajo en un archivo .tail?',
    'Save and quit': 'Guardar y salir',
    'Quit without saving': 'Salir sin guardar',
    'Cancel': 'Cancelar',
    'Save image': 'Guardar imagen',
    'Save preferences': "Guardar preferencias",
    'Choose save folder': 'Elegir carpeta de guardado',
    'Select this folder': 'Elegir esta carpeta',
    'Export photo': 'Exportar foto',
    'Export brush as .abr': 'Exportar pincel como .abr',
    '.abr brush': 'Pincel .abr',
    'Save board as .tail': 'Guardar tablero como .tail',
    'TailRef board': 'Tablero TailRef',
    'Open .tail board': 'Abrir tablero .tail',
    'Continue': 'Continuar',
    'This is not a valid .tail file.': 'Este archivo .tail no es válido.',
    'Unsupported .tail version ({n}).': 'Versión de .tail no compatible ({n}).',
    'Backups tried in this session: {n} — the problem was not fixed.':
      'Copias de seguridad probadas en esta sesión: {n} — el problema no se solucionó.',
    'Healthy backups among the {n} scanned: none (too large / too many items).':
      'Copias de seguridad sanas entre las {n} analizadas: ninguna (demasiado grandes / demasiados elementos).',
    'No backup that could be considered healthy was found.':
      'No se encontró ninguna copia de seguridad que pueda considerarse sana.',
    'No backup files exist. Backups are created only while Settings → "Auto backup" is enabled.':
      'No hay archivos de copia de seguridad. Solo se crean con Ajustes → "Copia de seguridad automática" activado.',
    'If "Clean start" is chosen, the current (corrupted) data is NOT deleted: it is moved to the Archive folder and the app opens with a single empty board.':
      'Si se elige "Inicio limpio", los datos actuales (dañados) NO se eliminan: se mueven a la carpeta de archivo y la app se abre con un solo tablero vacío.',
    'TailRef Studio is not responding': 'TailRef Studio no responde',
    'No healthy backup was found to recover from.': 'No se encontró ninguna copia de seguridad sana de la que recuperar.',
    'Clean start': 'Inicio limpio',
    'Wait': 'Esperar',
    'Which option would you like?': '¿Qué opción prefieres?',
    'Selected healthy backup: {name}': 'Copia de seguridad sana seleccionada: {name}',
    'Items: {items} · Images: {images} · Size: {size}':
      'Elementos: {items} · Imágenes: {images} · Tamaño: {size}',
    '(Backups skipped as unhealthy: {n} — too large / too many items)':
      '(Copias de seguridad omitidas por no ser sanas: {n} — demasiado grandes / demasiados elementos)',
    '"Return to last healthy save": the app restarts and loads this backup. Changes made after that save will be lost.':
      '"Volver a la última copia sana": la app se reinicia y carga esta copia. Los cambios posteriores a esa copia se perderán.',
    '"Clean start": current data is moved to the Archive folder and the app opens with a single empty board.':
      '"Inicio limpio": los datos actuales se mueven a la carpeta de archivo y la app se abre con un solo tablero vacío.',
    'The app is overloaded and not responding.': 'La app está sobrecargada y no responde.',
    'Return to last healthy save': 'Volver a la última copia sana',
    'Save canvas as PNG': 'Guardar lienzo como PNG',
    'PNG image': 'Imagen PNG',
    'Invalid PNG.': 'PNG no válido.',
    'Invalid image.': 'Imagen no válida.',
    'Invalid image size.': 'Tamaño de imagen no válido.',
    'Folder not found.': 'Carpeta no encontrada.',
    'Invalid brush.': 'Pincel no válido.',
    'Invalid brush size.': 'Tamaño de pincel no válido.',
    'photo': 'foto',
    'brush': 'pincel',
    'board': 'tablero',
    'canvas': 'lienzo',
    'Archive: {dir}': 'Archivo: {dir}',
    'Port {n} is already in use.\n\nTailRef may still be open in another user session or in the background.\nClose the remaining "TailRef Studio" process from Task Manager and try again.\n\n(We do not change the port: board data is tied to this recorded port.)':
      'El puerto {n} ya está en uso.\n\nTailRef puede seguir abierto en otra sesión de usuario o en segundo plano.\nCierra el proceso "TailRef Studio" restante desde el Administrador de tareas e inténtalo de nuevo.\n\n(No cambiamos el puerto: los datos del tablero están vinculados a este puerto guardado.)',
    'Could not start the local server: {msg}': 'No se pudo iniciar el servidor local: {msg}',
    'Unknown error': 'Error desconocido',
    'Could not save.': 'No se pudo guardar.',
  },

  ja: {
    'Unsaved changes will be lost.': '保存されていない変更は失われます。',
    'Save your work as a .tail file?': '.tail ファイルとして保存しますか？',
    'Save and quit': '保存して終了',
    'Quit without saving': '保存せずに終了',
    'Cancel': 'キャンセル',
    'Save image': '画像を保存',
    'Save preferences': "設定を保存",
    'Choose save folder': '保存フォルダーを選択',
    'Select this folder': 'このフォルダーを選択',
    'Export photo': '写真を書き出す',
    'Export brush as .abr': 'ブラシを .abr として書き出す',
    '.abr brush': '.abr ブラシ',
    'Save board as .tail': 'ボードを .tail として保存',
    'TailRef board': 'TailRef ボード',
    'Open .tail board': '.tail ボードを開く',
    'Continue': '続行',
    'This is not a valid .tail file.': '有効な .tail ファイルではありません。',
    'Unsupported .tail version ({n}).': 'サポートされていない .tail バージョン（{n}）。',
    'Backups tried in this session: {n} — the problem was not fixed.':
      'このセッションで試したバックアップ: {n} 件 — 問題は解決しませんでした。',
    'Healthy backups among the {n} scanned: none (too large / too many items).':
      '走査した {n} 件のバックアップのうち正常なもの: なし（大きすぎる / 要素が多すぎる）。',
    'No backup that could be considered healthy was found.':
      '正常と見なせるバックアップが見つかりませんでした。',
    'No backup files exist. Backups are created only while Settings → "Auto backup" is enabled.':
      'バックアップファイルがありません。バックアップは設定 →「自動バックアップ」が有効なときにのみ作成されます。',
    'If "Clean start" is chosen, the current (corrupted) data is NOT deleted: it is moved to the Archive folder and the app opens with a single empty board.':
      '「クリーンスタート」を選ぶと、現在の（壊れた）データは削除されません：アーカイブフォルダーに移動され、アプリは空のボード 1 枚で開きます。',
    'TailRef Studio is not responding': 'TailRef Studio が応答しません',
    'No healthy backup was found to recover from.': '復元できる正常なバックアップが見つかりませんでした。',
    'Clean start': 'クリーンスタート',
    'Wait': '待機',
    'Which option would you like?': 'どのオプションにしますか？',
    'Selected healthy backup: {name}': '選択された正常なバックアップ: {name}',
    'Items: {items} · Images: {images} · Size: {size}':
      '要素: {items} · 画像: {images} · サイズ: {size}',
    '(Backups skipped as unhealthy: {n} — too large / too many items)':
      '（不健康としてスキップされたバックアップ: {n} 件 — 大きすぎる / 要素が多すぎる）',
    '"Return to last healthy save": the app restarts and loads this backup. Changes made after that save will be lost.':
      '「最後の正常な保存に戻る」：アプリが再起動しこのバックアップを読み込みます。その保存以降の変更は失われます。',
    '"Clean start": current data is moved to the Archive folder and the app opens with a single empty board.':
      '「クリーンスタート」：現在のデータはアーカイブフォルダーに移動され、アプリは空のボード 1 枚で開きます。',
    'The app is overloaded and not responding.': 'アプリが過負荷になり、応答していません。',
    'Return to last healthy save': '最後の正常な保存に戻る',
    'Save canvas as PNG': 'キャンバスを PNG として保存',
    'PNG image': 'PNG 画像',
    'Invalid PNG.': '無効な PNG です。',
    'Invalid image.': '無効な画像です。',
    'Invalid image size.': '無効な画像サイズです。',
    'Folder not found.': 'フォルダーが見つかりません。',
    'Invalid brush.': '無効なブラシです。',
    'Invalid brush size.': '無効なブラシサイズです。',
    'photo': 'photo',
    'brush': 'brush',
    'board': 'board',
    'canvas': 'キャンバス',
    'Archive: {dir}': 'アーカイブ: {dir}',
    'Port {n} is already in use.\n\nTailRef may still be open in another user session or in the background.\nClose the remaining "TailRef Studio" process from Task Manager and try again.\n\n(We do not change the port: board data is tied to this recorded port.)':
      'ポート {n} は使用中です。\n\nTailRef が別のユーザーセッションまたはバックグラウンドで開いたままかもしれません。\nタスクマネージャーで残っている「TailRef Studio」プロセスを終了してから、もう一度お試しください。\n\n（ポートは変更しません：ボードデータはこの保存されたポートに紐づいています。）',
    'Could not start the local server: {msg}': 'ローカルサーバーを起動できませんでした: {msg}',
    'Unknown error': '不明なエラー',
    'Could not save.': '保存できませんでした。',
  },

  ko: {
    'Unsaved changes will be lost.': '저장하지 않은 변경 사항은 사라집니다.',
    'Save your work as a .tail file?': '.tail 파일로 저장하시겠습니까?',
    'Save and quit': '저장 후 종료',
    'Quit without saving': '저장하지 않고 종료',
    'Cancel': '취소',
    'Save image': '이미지 저장',
    'Save preferences': "설정 저장",
    'Choose save folder': '저장 폴더 선택',
    'Select this folder': '이 폴더 선택',
    'Export photo': '사진 내보내기',
    'Export brush as .abr': '브러시를 .abr로 내보내기',
    '.abr brush': '.abr 브러시',
    'Save board as .tail': '보드를 .tail로 저장',
    'TailRef board': 'TailRef 보드',
    'Open .tail board': '.tail 보드 열기',
    'Continue': '계속',
    'This is not a valid .tail file.': '유효한 .tail 파일이 아닙니다.',
    'Unsupported .tail version ({n}).': '지원되지 않는 .tail 버전({n}).',
    'Backups tried in this session: {n} — the problem was not fixed.':
      '이 세션에서 시도한 백업: {n}개 — 문제가 해결되지 않았습니다.',
    'Healthy backups among the {n} scanned: none (too large / too many items).':
      '스캔한 {n}개의 백업 중 정상인 것: 없음(너무 큼 / 항목이 너무 많음).',
    'No backup that could be considered healthy was found.':
      '정상으로 볼 수 있는 백업을 찾지 못했습니다.',
    'No backup files exist. Backups are created only while Settings → "Auto backup" is enabled.':
      '백업 파일이 없습니다. 백업은 설정 → "자동 백업"이 켜져 있을 때만 생성됩니다.',
    'If "Clean start" is chosen, the current (corrupted) data is NOT deleted: it is moved to the Archive folder and the app opens with a single empty board.':
      '"클린 시작"을 선택하면 현재(손상된) 데이터는 삭제되지 않습니다: 보관 폴더로 이동되며 앱은 빈 보드 하나로 열립니다.',
    'TailRef Studio is not responding': 'TailRef Studio가 응답하지 않습니다',
    'No healthy backup was found to recover from.': '복구할 수 있는 정상 백업을 찾지 못했습니다.',
    'Clean start': '클린 시작',
    'Wait': '대기',
    'Which option would you like?': '어떤 옵션을 원하시나요?',
    'Selected healthy backup: {name}': '선택된 정상 백업: {name}',
    'Items: {items} · Images: {images} · Size: {size}':
      '항목: {items} · 이미지: {images} · 크기: {size}',
    '(Backups skipped as unhealthy: {n} — too large / too many items)':
      '(비정상으로 건너뛴 백업: {n}개 — 너무 큼 / 항목이 너무 많음)',
    '"Return to last healthy save": the app restarts and loads this backup. Changes made after that save will be lost.':
      '"마지막 정상 저장으로 돌아가기": 앱이 다시 시작되어 이 백업을 불러옵니다. 해당 저장 이후의 변경 사항은 사라집니다.',
    '"Clean start": current data is moved to the Archive folder and the app opens with a single empty board.':
      '"클린 시작": 현재 데이터는 보관 폴더로 이동되며, 앱은 빈 보드 하나로 열립니다.',
    'The app is overloaded and not responding.': '앱이 과부하로 응답하지 않습니다.',
    'Return to last healthy save': '마지막 정상 저장으로 돌아가기',
    'Save canvas as PNG': '캔버스를 PNG로 저장',
    'PNG image': 'PNG 이미지',
    'Invalid PNG.': '잘못된 PNG입니다.',
    'Invalid image.': '잘못된 이미지입니다.',
    'Invalid image size.': '잘못된 이미지 크기입니다.',
    'Folder not found.': '폴더를 찾을 수 없습니다.',
    'Invalid brush.': '잘못된 브러시입니다.',
    'Invalid brush size.': '잘못된 브러시 크기입니다.',
    'photo': 'photo',
    'brush': 'brush',
    'board': 'board',
    'canvas': '캔버스',
    'Archive: {dir}': '보관: {dir}',
    'Port {n} is already in use.\n\nTailRef may still be open in another user session or in the background.\nClose the remaining "TailRef Studio" process from Task Manager and try again.\n\n(We do not change the port: board data is tied to this recorded port.)':
      '포트 {n}은(는) 이미 사용 중입니다.\n\nTailRef가 다른 사용자 세션이나 백그라운드에 남아 있을 수 있습니다.\n작업 관리자에서 남아 있는 "TailRef Studio" 프로세스를 종료한 후 다시 시도하세요.\n\n(포트는 변경하지 않습니다: 보드 데이터는 이 저장된 포트에 연결되어 있습니다.)',
    'Could not start the local server: {msg}': '로컬 서버를 시작할 수 없습니다: {msg}',
    'Unknown error': '알 수 없는 오류',
    'Could not save.': '저장할 수 없습니다.',
  },

  'zh-CN': {
    'Unsaved changes will be lost.': '未保存的更改将会丢失。',
    'Save your work as a .tail file?': '要将作品保存为 .tail 文件吗？',
    'Save and quit': '保存并退出',
    'Quit without saving': '不保存退出',
    'Cancel': '取消',
    'Save image': '保存图像',
    'Save preferences': "保存设置",
    'Choose save folder': '选择保存文件夹',
    'Select this folder': '选择此文件夹',
    'Export photo': '导出照片',
    'Export brush as .abr': '将笔刷导出为 .abr',
    '.abr brush': '.abr 笔刷',
    'Save board as .tail': '将画板保存为 .tail',
    'TailRef board': 'TailRef 画板',
    'canvas': '画布',
    'Archive: {dir}': '归档：{dir}',
    'Port {n} is already in use.\n\nTailRef may still be open in another user session or in the background.\nClose the remaining "TailRef Studio" process from Task Manager and try again.\n\n(We do not change the port: board data is tied to this recorded port.)':
      '端口 {n} 已被占用。\n\nTailRef 可能仍在其他用户会话或后台运行。\n请在任务管理器中关闭残留的“TailRef Studio”进程后重试。\n\n（我们不更换端口：画板数据绑定在此已保存的端口上。）',
    'Could not start the local server: {msg}': '无法启动本地服务器：{msg}',
    'Unknown error': '未知错误',
    'Could not save.': '无法保存。',
    'Open .tail board': '打开 .tail 画板',
    'Continue': '继续',
    'This is not a valid .tail file.': '这不是有效的 .tail 文件。',
    'Unsupported .tail version ({n}).': '不支持的 .tail 版本（{n}）。',
    'Backups tried in this session: {n} — the problem was not fixed.':
      '本次会话尝试的备份：{n} 个 — 问题未解决。',
    'Healthy backups among the {n} scanned: none (too large / too many items).':
      '扫描的 {n} 个备份中健康的：无（过大 / 项目过多）。',
    'No backup that could be considered healthy was found.':
      '未找到可以视为健康的备份。',
    'No backup files exist. Backups are created only while Settings → "Auto backup" is enabled.':
      '没有任何备份文件。仅当设置 → “自动备份”开启时才会创建备份。',
    'If "Clean start" is chosen, the current (corrupted) data is NOT deleted: it is moved to the Archive folder and the app opens with a single empty board.':
      '选择“干净启动”后，当前（损坏的）数据不会被删除：将移至归档文件夹，应用以单个空白画板打开。',
    'TailRef Studio is not responding': 'TailRef Studio 无响应',
    'No healthy backup was found to recover from.': '未找到可用于恢复的健康备份。',
    'Clean start': '干净启动',
    'Wait': '等待',
    'Which option would you like?': '您想选择哪个选项？',
    'Selected healthy backup: {name}': '所选的健康备份：{name}',
    'Items: {items} · Images: {images} · Size: {size}':
      '项目：{items} · 图像：{images} · 大小：{size}',
    '(Backups skipped as unhealthy: {n} — too large / too many items)':
      '（因不健康而跳过的备份：{n} 个 — 过大 / 项目过多）',
    '"Return to last healthy save": the app restarts and loads this backup. Changes made after that save will be lost.':
      '“返回上次健康保存”：应用将重启并加载此备份。该保存之后的更改将会丢失。',
    '"Clean start": current data is moved to the Archive folder and the app opens with a single empty board.':
      '“干净启动”：当前数据将移至归档文件夹，应用以单个空白画板打开。',
    'The app is overloaded and not responding.': '应用过载，无响应。',
    'Return to last healthy save': '返回上次健康保存',
    'Save canvas as PNG': '将画布保存为 PNG',
    'PNG image': 'PNG 图像',
    'Invalid PNG.': '无效的 PNG。',
    'Invalid image.': '无效的图像。',
    'Invalid image size.': '无效的图像大小。',
    'Folder not found.': '未找到文件夹。',
    'Invalid brush.': '无效的笔刷。',
    'Invalid brush size.': '无效的笔刷大小。',
    'photo': 'photo',
    'brush': 'brush',
    'board': 'board',
  },

  'pt-BR': {
    'Unsaved changes will be lost.': 'As alterações não salvas serão perdidas.',
    'Save your work as a .tail file?': 'Salvar seu trabalho como um arquivo .tail?',
    'Save and quit': 'Salvar e sair',
    'Quit without saving': 'Sair sem salvar',
    'Cancel': 'Cancelar',
    'Save image': 'Salvar imagem',
    'Save preferences': "Salvar preferências",
    'Choose save folder': 'Escolher pasta de salvamento',
    'Select this folder': 'Escolher esta pasta',
    'Export photo': 'Exportar foto',
    'Export brush as .abr': 'Exportar pincel como .abr',
    '.abr brush': 'Pincel .abr',
    'Save board as .tail': 'Salvar quadro como .tail',
    'TailRef board': 'Quadro TailRef',
    'Open .tail board': 'Abrir quadro .tail',
    'Continue': 'Continuar',
    'This is not a valid .tail file.': 'Este não é um arquivo .tail válido.',
    'Unsupported .tail version ({n}).': 'Versão .tail não compatível ({n}).',
    'Backups tried in this session: {n} — the problem was not fixed.':
      'Backups tentados nesta sessão: {n} — o problema não foi corrigido.',
    'Healthy backups among the {n} scanned: none (too large / too many items).':
      'Backups saudáveis entre os {n} analisados: nenhum (grande demais / itens demais).',
    'No backup that could be considered healthy was found.':
      'Nenhum backup considerado saudável foi encontrado.',
    'No backup files exist. Backups are created only while Settings → "Auto backup" is enabled.':
      'Não há arquivos de backup. Os backups são criados apenas com Ajustes → "Backup automático" ativado.',
    'If "Clean start" is chosen, the current (corrupted) data is NOT deleted: it is moved to the Archive folder and the app opens with a single empty board.':
      'Se "Início limpo" for escolhido, os dados atuais (corrompidos) NÃO são excluídos: eles são movidos para a pasta de arquivo e o app abre com um único quadro vazio.',
    'TailRef Studio is not responding': 'TailRef Studio não está respondendo',
    'No healthy backup was found to recover from.': 'Nenhum backup saudável foi encontrado para recuperação.',
    'Clean start': 'Início limpo',
    'Wait': 'Aguardar',
    'Which option would you like?': 'Qual opção você prefere?',
    'Selected healthy backup: {name}': 'Backup saudável selecionado: {name}',
    'Items: {items} · Images: {images} · Size: {size}':
      'Itens: {items} · Imagens: {images} · Tamanho: {size}',
    '(Backups skipped as unhealthy: {n} — too large / too many items)':
      '(Backups ignorados por não saudáveis: {n} — grande demais / itens demais)',
    '"Return to last healthy save": the app restarts and loads this backup. Changes made after that save will be lost.':
      '"Voltar à última gravação saudável": o app reinicia e carrega este backup. As alterações feitas depois dessa gravação serão perdidas.',
    '"Clean start": current data is moved to the Archive folder and the app opens with a single empty board.':
      '"Início limpo": os dados atuais são movidos para a pasta de arquivo e o app abre com um único quadro vazio.',
    'The app is overloaded and not responding.': 'O app está sobrecarregado e não está respondendo.',
    'Return to last healthy save': 'Voltar à última gravação saudável',
    'Save canvas as PNG': 'Salvar tela como PNG',
    'PNG image': 'Imagem PNG',
    'Invalid PNG.': 'PNG inválido.',
    'Invalid image.': 'Imagem inválida.',
    'Invalid image size.': 'Tamanho de imagem inválido.',
    'Folder not found.': 'Pasta não encontrada.',
    'Invalid brush.': 'Pincel inválido.',
    'Invalid brush size.': 'Tamanho de pincel inválido.',
    'photo': 'foto',
    'brush': 'pincel',
    'board': 'quadro',
    'canvas': 'tela',
    'Archive: {dir}': 'Arquivo: {dir}',
    'Port {n} is already in use.\n\nTailRef may still be open in another user session or in the background.\nClose the remaining "TailRef Studio" process from Task Manager and try again.\n\n(We do not change the port: board data is tied to this recorded port.)':
      'A porta {n} já está em uso.\n\nO TailRef pode ainda estar aberto em outra sessão de usuário ou em segundo plano.\nFeche o processo restante "TailRef Studio" no Gerenciador de Tarefas e tente novamente.\n\n(Não mudamos a porta: os dados do quadro estão vinculados a esta porta salva.)',
    'Could not start the local server: {msg}': 'Não foi possível iniciar o servidor local: {msg}',
    'Unknown error': 'Erro desconhecido',
    'Could not save.': 'Não foi possível salvar.',
  },

  ru: {
    'Unsaved changes will be lost.': 'Несохранённые изменения будут потеряны.',
    'Save your work as a .tail file?': 'Сохранить работу в файл .tail?',
    'Save and quit': 'Сохранить и выйти',
    'Quit without saving': 'Выйти без сохранения',
    'Cancel': 'Отмена',
    'Save image': 'Сохранить изображение',
    'Save preferences': "Сохранить настройки",
    'Choose save folder': 'Выбрать папку сохранения',
    'Select this folder': 'Выбрать эту папку',
    'Export photo': 'Экспортировать фото',
    'Export brush as .abr': 'Экспортировать кисть как .abr',
    '.abr brush': 'Кисть .abr',
    'Save board as .tail': 'Сохранить доску как .tail',
    'TailRef board': 'Доска TailRef',
    'Open .tail board': 'Открыть доску .tail',
    'Continue': 'Продолжить',
    'This is not a valid .tail file.': 'Это недействительный файл .tail.',
    'Unsupported .tail version ({n}).': 'Неподдерживаемая версия .tail ({n}).',
    'Backups tried in this session: {n} — the problem was not fixed.':
      'Попыток восстановления в этом сеансе: {n} — проблема не устранена.',
    'Healthy backups among the {n} scanned: none (too large / too many items).':
      'Здоровых копий среди {n} проверенных: нет (слишком большие / слишком много элементов).',
    'No backup that could be considered healthy was found.':
      'Не найдено копий, которые можно считать здоровыми.',
    'No backup files exist. Backups are created only while Settings → "Auto backup" is enabled.':
      'Файлов резервных копий нет. Копии создаются только при включённом пункте Настройки → «Автоматическое резервное копирование».',
    'If "Clean start" is chosen, the current (corrupted) data is NOT deleted: it is moved to the Archive folder and the app opens with a single empty board.':
      'Если выбран «Чистый запуск», текущие (повреждённые) данные НЕ удаляются: они перемещаются в папку архива, и приложение откроется с одной пустой доской.',
    'TailRef Studio is not responding': 'TailRef Studio не отвечает',
    'No healthy backup was found to recover from.': 'Не найдено здоровой резервной копии для восстановления.',
    'Clean start': 'Чистый запуск',
    'Wait': 'Подождать',
    'Which option would you like?': 'Какой вариант вы выбираете?',
    'Selected healthy backup: {name}': 'Выбранная здоровая копия: {name}',
    'Items: {items} · Images: {images} · Size: {size}':
      'Элементы: {items} · Изображения: {images} · Размер: {size}',
    '(Backups skipped as unhealthy: {n} — too large / too many items)':
      '(Пропущено нездоровых копий: {n} — слишком большие / слишком много элементов)',
    '"Return to last healthy save": the app restarts and loads this backup. Changes made after that save will be lost.':
      '«Вернуться к последней здоровой копии»: приложение перезапустится и загрузит эту копию. Изменения после этого сохранения будут потеряны.',
    '"Clean start": current data is moved to the Archive folder and the app opens with a single empty board.':
      '«Чистый запуск»: текущие данные перемещаются в папку архива, приложение откроется с одной пустой доской.',
    'The app is overloaded and not responding.': 'Приложение перегружено и не отвечает.',
    'Return to last healthy save': 'Вернуться к последней здоровой копии',
    'Save canvas as PNG': 'Сохранить холст как PNG',
    'PNG image': 'Изображение PNG',
    'Invalid PNG.': 'Недопустимый PNG.',
    'Invalid image.': 'Недопустимое изображение.',
    'Invalid image size.': 'Недопустимый размер изображения.',
    'Folder not found.': 'Папка не найдена.',
    'Invalid brush.': 'Недопустимая кисть.',
    'Invalid brush size.': 'Недопустимый размер кисти.',
    'photo': 'photo',
    'brush': 'brush',
    'board': 'board',
    'canvas': 'холст',
    'Archive: {dir}': 'Архив: {dir}',
    'Port {n} is already in use.\n\nTailRef may still be open in another user session or in the background.\nClose the remaining "TailRef Studio" process from Task Manager and try again.\n\n(We do not change the port: board data is tied to this recorded port.)':
      'Порт {n} уже занят.\n\nTailRef может остаться открытым в другом сеансе пользователя или в фоне.\nЗакройте оставшийся процесс «TailRef Studio» в диспетчере задач и попробуйте снова.\n\n(Порт не меняется: данные доски привязаны к этому сохранённому порту.)',
    'Could not start the local server: {msg}': 'Не удалось запустить локальный сервер: {msg}',
    'Unknown error': 'Неизвестная ошибка',
    'Could not save.': 'Не удалось сохранить.',
  },
};

/* Henüz çevrilmemiş diller (ör. yeni dil eklendiğinde) için boş paket
   tanımlamaya gerek yok: t() EN'e düşer, packsCheck() eksikleri sayar. */

let current = 'en';

/** Dil seçimi (renderer'dan 'app-language' kanalıyla gelir).
 *  Bilinmeyen kod sessizce EN'e düşer. */
function setLanguage(code) {
  current = (code && PACKS[code]) ? String(code) : 'en';
  return current;
}

function getLanguage() { return current; }

/** Tarih/saat biçimlendirmesi için yerel etiket. */
function localeTag() { return LOCALE_TAGS[current] || 'en-US'; }

/** Diyalog metni. Önce seçili dil paketi, yoksa EN (anahtarın kendisi). */
function t(key, params) {
  const pack = PACKS[current];
  const v = pack ? pack[key] : undefined;
  const text = (typeof v === 'string' && v.length) ? v : key;
  return interpolate(text, params);
}

/** Test yardımcıları: tüm paketler aynı anahtar kümesini mi içeriyor,
 *  hangi anahtarlar hangi dilde eksik? */
function keys(langCode) {
  return Object.keys(PACKS[langCode] || {});
}
function missing(langCode) {
  const ref = keys('tr');
  const pack = PACKS[langCode];
  if (!pack) return ref.slice();
  return ref.filter(k => !(typeof pack[k] === 'string' && pack[k].length));
}

module.exports = { setLanguage, getLanguage, localeTag, t, keys, missing };

