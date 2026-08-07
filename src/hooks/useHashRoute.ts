import { useSyncExternalStore } from 'react'

/**
 * Minimal hash-based routing. The app is served as a static SPA behind a
 * reverse proxy that we can't assume rewrites unknown paths back to
 * `index.html`, so real path routes (e.g. `/schedule`) would 404 on refresh.
 * Hash routes (`#/schedule`) live entirely client-side: they're linkable and
 * survive a reload on any host, with no server config and no router dependency.
 *
 * The current route is the hash without its leading `#`, normalized to start
 * with `/` and defaulting to `/`. Navigate with plain `<a href="#/schedule">`
 * anchors — they stay real links (middle-click, open-in-new-tab) and the
 * browser updates the hash for us; this hook just re-renders on the change.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function getSnapshot(): string {
  const raw = window.location.hash.replace(/^#/, '')
  if (!raw) return '/'
  return raw.startsWith('/') ? raw : `/${raw}`
}

export function useHashRoute(): string {
  return useSyncExternalStore(subscribe, getSnapshot, () => '/')
}
