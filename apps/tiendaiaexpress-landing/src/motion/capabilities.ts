/** True when the device can comfortably render the WebGL phone. Conservative on purpose. */
export function canUse3D(): boolean {
  if (typeof window === 'undefined') return false
  if (!document.documentElement.classList.contains('motion')) return false
  const params = new URLSearchParams(location.search)
  if (params.has('no3d')) return false
  const force = params.has('force3d') // QA only: skip the performance heuristics.
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number }
  if (!force && nav.connection?.saveData) return false
  if (!force && typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency < 4) return false
  if (!force && typeof nav.deviceMemory === 'number' && nav.deviceMemory < 4) return false
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: !force })
    if (!gl) return false
    // Software rasterisers (SwiftShader, llvmpipe…) compile and draw on the CPU: use the CSS phone.
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = `${info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ''} ${String(gl.getParameter(gl.RENDERER))}`
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    if (!force && /swiftshader|llvmpipe|software|basic render/i.test(renderer)) return false
    return true
  } catch {
    return false
  }
}
