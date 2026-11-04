import { describe, expect, it } from 'vitest'
import { applyPreviewOverride, parsePreviewOverride } from './previewOverride'
import { TEMPLATE_LAYOUTS, templateLayout } from './templateLayouts'
import { DEFAULT_THEME, THEME_PRESETS } from '../types/theme'

const LEGIBLE = 'F7F5F1-FFFFFF-252321-626870-E4DED4-1F3675-E7E3DD-824D35-1F3675-FFFFFF'

describe('unsaved preview from the assistant', () => {
  it('reads a legible palette and a known template', () => {
    const override = parsePreviewOverride(`?palette=${LEGIBLE}&template=editorial`)
    expect(override?.template).toBe('editorial')
    expect(override?.palette?.primary).toBe('#1F3675')
    expect(override?.palette?.buttonText).toBe('#FFFFFF')
  })

  it('ignores illegible, malformed or unknown values', () => {
    expect(parsePreviewOverride('?palette=FFFFFF-FFFFFF-EEEEEE-DDDDDD-EEEEEE-FAFAFA-FFFFFF-FFFFFF-FFFF00-FFFFFF')).toBeNull()
    expect(parsePreviewOverride('?palette=javascript:alert(1)')).toBeNull()
    expect(parsePreviewOverride('?template=<script>')).toBeNull()
    expect(parsePreviewOverride('')).toBeNull()
  })

  it('keeps the store colors when only the template changes, and switches dark mode by background', () => {
    const theme = { ...DEFAULT_THEME, template: 'moderno' }
    const withTemplate = applyPreviewOverride(theme, { template: 'luxury' })
    expect(withTemplate.template).toBe('luxury')
    expect(withTemplate.style.palette).toEqual(theme.style.palette)
    expect(withTemplate.style.typography.fontDisplay).toBe('Playfair Display')
    expect(withTemplate.style.darkMode).toBe(false)
    expect(withTemplate.hero).toEqual(theme.hero)

    const dark = applyPreviewOverride(theme, { palette: { ...theme.style.palette, background: '#111317', text: '#F7F8FA' } })
    expect(dark.style.darkMode).toBe(true)
  })
})

describe('template families', () => {
  it('gives every template a layout and makes the families structurally different', () => {
    const templates = THEME_PRESETS.map((preset) => preset.template)
    expect(templates).toHaveLength(13)
    for (const template of templates) expect(TEMPLATE_LAYOUTS[template], template).toBeDefined()
    const signatures = new Set(templates.map((template) => {
      const layout = templateLayout(template)
      return `${layout.header}|${layout.hero}|${layout.card}|${layout.ratio}|${layout.upperTitles}`
    }))
    // personalizado intentionally mirrors the default composition; every other family is unique.
    expect(signatures.size).toBeGreaterThanOrEqual(12)
    expect(new Set(templates.map((template) => templateLayout(template).hero)).size).toBe(5)
    expect(new Set(templates.map((template) => templateLayout(template).card)).size).toBe(5)
    expect(templateLayout('desconocida')).toEqual(TEMPLATE_LAYOUTS.personalizado)
  })
})
