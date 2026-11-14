import { describe, expect, it } from 'vitest'
import { timeLeft } from './WhatsAppLinkCard'

describe('Vincular WhatsApp: cuenta regresiva del código', () => {
  const now = Date.parse('2026-11-12T03:00:00Z')
  it('muestra minutos y segundos restantes', () => {
    expect(timeLeft('2026-11-12T03:15:00Z', now)).toBe('15:00')
    expect(timeLeft('2026-11-12T03:00:09.200Z', now)).toBe('0:10')
  })
  it('un código vencido o con fecha inválida ya no se muestra', () => {
    expect(timeLeft('2026-11-12T03:00:00Z', now)).toBeNull()
    expect(timeLeft('2026-11-12T02:59:00Z', now)).toBeNull()
    expect(timeLeft('no-es-fecha', now)).toBeNull()
  })
})
