import { afterEach, describe, expect, it, vi } from 'vitest'

import { authorizeCronRequest } from './cron-auth'

describe('authorizeCronRequest', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('accepts Vercel Cron authorization', () => {
    vi.stubEnv('CRON_SECRET', 'vercel-test-secret')
    const request = new Request('https://example.test/api/flows/cron', {
      headers: { authorization: 'Bearer vercel-test-secret' },
    })
    expect(authorizeCronRequest(request)).toBe('authorized')
  })

  it('keeps the existing external scheduler header working', () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', 'legacy-test-secret')
    const request = new Request('https://example.test/api/automations/cron', {
      headers: { 'x-cron-secret': 'legacy-test-secret' },
    })
    expect(authorizeCronRequest(request)).toBe('authorized')
  })

  it('fails closed for missing and invalid credentials', () => {
    expect(authorizeCronRequest(new Request('https://example.test/api/flows/cron'))).toBe('not_configured')
    vi.stubEnv('CRON_SECRET', 'vercel-test-secret')
    expect(authorizeCronRequest(new Request('https://example.test/api/flows/cron'))).toBe('unauthorized')
  })
})
