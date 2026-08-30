import { timingSafeEqual } from 'node:crypto'

export type CronAuthorization = 'authorized' | 'unauthorized' | 'not_configured'

function equalSecret(supplied: string | null, expected: string | undefined): boolean {
  if (!supplied || !expected) return false
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  return suppliedBuf.length === expectedBuf.length && timingSafeEqual(suppliedBuf, expectedBuf)
}

/**
 * Accepts both supported schedulers without weakening the existing contract:
 *
 * - Vercel Cron automatically sends `Authorization: Bearer $CRON_SECRET`.
 * - Existing Docker/external schedulers send `x-cron-secret` matching
 *   `AUTOMATION_CRON_SECRET`.
 */
export function authorizeCronRequest(request: Request): CronAuthorization {
  const vercelSecret = process.env.CRON_SECRET
  const externalSecret = process.env.AUTOMATION_CRON_SECRET
  if (!vercelSecret && !externalSecret) return 'not_configured'

  if (equalSecret(request.headers.get('authorization'), vercelSecret ? `Bearer ${vercelSecret}` : undefined)) {
    return 'authorized'
  }
  if (equalSecret(request.headers.get('x-cron-secret'), externalSecret)) {
    return 'authorized'
  }
  return 'unauthorized'
}
