// PMIS service worker (vite-plugin-pwa, injectManifest).
//
// 1. App-shell caching — the same behaviour the generated worker had:
//    precache the build, serve index.html for navigations, take over
//    immediately on update (registerType: 'autoUpdate').
// 2. Web Push — show a desktop pop-up for a new PMIS notification even
//    when no PMIS tab is open (see src/lib/pushSubscription.js and the
//    send-push edge function), and open PMIS on the right page on click.

import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { clientsClaim } from "workbox-core";
import { DESKTOP_BADGE, DESKTOP_ICON, buildDesktopPayload, eventKey, notificationTag } from "./lib/desktopNotificationPayload";

self.skipWaiting();
clientsClaim();

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")));

async function windowClients() {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true });
}

async function showFromPush(row) {
  const key = eventKey(row);
  // Tell open PMIS tabs this event is handled, so their live path doesn't
  // pop it a second time.
  for (const client of await windowClients()) client.postMessage({ type: "pmis-push-shown", key });

  // Every push must show a pop-up — Safari/iOS revokes push permission for
  // sites that receive pushes without showing one. If a tab already showed
  // this same event, replace it quietly (same tag, no second alert).
  const open = await self.registration.getNotifications({ tag: notificationTag(row) });
  const { title, options } = buildDesktopPayload(row);
  if (open.some((n) => n.data?.key === key)) options.renotify = false;
  await self.registration.showNotification(title, options);
}

self.addEventListener("push", (event) => {
  let row = null;
  try {
    row = event.data ? event.data.json() : null;
  } catch {
    row = null;
  }
  if (!row?.id) {
    // Still show something (see showFromPush) rather than nothing.
    event.waitUntil(self.registration.showNotification("AFC PMIS", { body: "You have a new notification.", icon: DESKTOP_ICON, badge: DESKTOP_BADGE, data: { link: "/home" } }));
    return;
  }
  event.waitUntil(showFromPush(row));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { id, link } = event.notification.data || {};
  event.waitUntil(
    (async () => {
      const all = await windowClients();
      const client = all.find((c) => c.focused) || all.find((c) => c.visibilityState === "visible") || all[0];
      if (client) {
        // An open PMIS tab: bring it forward and let the app navigate there
        // (router navigation, no reload) and mark the notification read.
        await client.focus();
        client.postMessage({ type: "pmis-notification-click", id, link });
        return;
      }
      // No PMIS tab: open one; the app marks it read from the URL.
      const url = new URL(link || "/home", self.location.origin);
      if (id != null) url.searchParams.set("pmis_notification", String(id));
      await self.clients.openWindow(url.href);
    })()
  );
});
