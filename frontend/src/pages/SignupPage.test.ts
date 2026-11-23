import { describe, expect, it } from 'vitest'
import { inboxFor, normalizeWhatsApp, slugPreview } from './SignupPage'

describe('sign-up helpers', () => {
  it('previews the store address like the server does', () => {
    expect(slugPreview('Flores de Ána & Cía.')).toBe('flores-de-ana-y-cia')
    expect(slugPreview('  MUY PARCERO  ')).toBe('muy-parcero')
  })

  it('accepts Colombian numbers without the country code and keeps the optional field optional', () => {
    expect(normalizeWhatsApp('300 123 4567')).toBe('+573001234567')
    expect(normalizeWhatsApp('573001234567')).toBe('+573001234567')
    expect(normalizeWhatsApp('+1 (305) 555-0100')).toBe('+13055550100')
    expect(normalizeWhatsApp('')).toBe('')
    expect(normalizeWhatsApp('12345')).toBeNull()
  })

  it('offers a shortcut to the web inbox of common providers only', () => {
    expect(inboxFor('ana@gmail.com')?.label).toBe('Abrir Gmail')
    expect(inboxFor('ana@hotmail.com')?.label).toBe('Abrir Outlook')
    expect(inboxFor('ana@mitienda.co')).toBeNull()
  })
})
