// Frontend Worker of Catálogo Digital IA (Workers Static Assets).
// Static files (index.html, JS, CSS, images, fonts) are served directly from
// Cloudflare's asset storage without running this script; unknown navigation
// paths fall back to index.html (single-page application).
// Only /api/* reaches this script: it forwards to the backend Worker through a
// service binding (replaces the old Netlify /api/assets redirect, no public hop).
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      if (!env.API) return new Response('API binding not configured', { status: 503 })
      return env.API.fetch(request)
    }
    return env.ASSETS.fetch(request)
  },
}
