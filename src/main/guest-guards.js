'use strict';

/* Uygulama içi konuk <webview> panelleri (Pinterest, ArtStation) için ortak
   güvenlik katmanı.

   Her panel kendi kalıcı oturumunda (partition) çalışır. Bu modül:
   • yeni pencere isteklerini yalnızca o sitenin giriş sağlayıcılarına açar,
   • konuk sayfanın kendi alan adı dışına gezmesini engeller,
   • giriş penceresini sağlayıcı + site adresleriyle sınırlar ve giriş bitince
     kendiliğinden kapatır.

   Paneller kendilerini registerGuestSite() ile tanıtır; böylece tek bir
   web-contents-created dinleyicisi tüm konukları yönetir (iki ayrı dinleyici
   birbirinin pencere açma kuralını ezmiyordu). */

const { app, session, BrowserWindow } = require('electron');

const sites = new Map();

function registerGuestSite(site) {
  if (!site || !site.partition) throw new Error('Konuk site tanımı eksik: partition');
  const entry = {
    name: site.name || site.partition,
    partition: site.partition,
    isAllowed: typeof site.isAllowed === 'function' ? site.isAllowed : () => false,
    isAuthPopup: typeof site.isAuthPopup === 'function' ? site.isAuthPopup : () => false,
  };
  sites.set(entry.partition, entry);
  return entry;
}

/* Bir webContents'in hangi panele ait olduğunu oturumundan bulur.
   session.fromPartition() aynı bölüm için aynı nesneyi döndürür. */
function siteFor(contents) {
  for (const site of sites.values()) {
    try {
      if (contents.session === session.fromPartition(site.partition)) return site;
    } catch { /* oturum henüz hazır değil */ }
  }
  return null;
}

function installGuestGuards({ isTest = false } = {}) {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      const site = contents.getType() === 'webview' ? siteFor(contents) : null;
      if (!site || !site.isAuthPopup(url, isTest)) return { action: 'deny' };
      const parent = BrowserWindow.fromWebContents(contents.hostWebContents || contents);
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 500,
          height: 700,
          parent: parent || undefined,
          autoHideMenuBar: true,
          backgroundColor: '#ffffff',
          webPreferences: {
            partition: site.partition,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webviewTag: false,
          },
        },
      };
    });

    if (contents.getType() !== 'webview') return;

    const site = siteFor(contents);
    const allow = url => !!site && site.isAllowed(url, isTest);
    const guard = label => (event, url) => {
      if (allow(url)) return;
      event.preventDefault();
      console.warn(`${site ? site.name : 'Bilinmeyen panel'}: ${label} engellendi → ${url}`);
    };
    contents.on('will-navigate', guard('gezinme'));
    contents.on('will-redirect', guard('yönlendirme'));

    /* Giriş penceresi: yalnızca sağlayıcı ve sitenin kendi adreslerinde
       gezinsin; giriş bitip siteye dönüldüğünde kendiliğinden kapansın. */
    contents.on('did-create-window', child => {
      const childContents = child.webContents;
      childContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      const allowChild = url => !!site
        && (site.isAuthPopup(url, isTest) || site.isAllowed(url, isTest));
      const childGuard = (event, url) => {
        if (allowChild(url)) return;
        event.preventDefault();
      };
      childContents.on('will-navigate', childGuard);
      childContents.on('will-redirect', childGuard);
      childContents.on('did-navigate', (_e, url) => {
        if (!allow(url)) return;
        setTimeout(() => {
          try { if (!child.isDestroyed()) child.close(); } catch { /* kapandı */ }
        }, 1200);
      });
    });
  });
}

module.exports = { registerGuestSite, installGuestGuards };
