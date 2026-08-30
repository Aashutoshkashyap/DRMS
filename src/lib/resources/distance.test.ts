import { describe, expect, it } from 'vitest'
import { distanceKm, nearestAvailable } from './distance'

describe('resource distance ranking', () => {
  it('calculates a local great-circle distance', () => {
    expect(distanceKm({ latitude: 27.7172, longitude: 85.324 }, { latitude: 27.72, longitude: 85.33 })).toBeCloseTo(0.67, 1)
  })

  it('returns only the nearest available resource', () => {
    expect(nearestAvailable({ latitude: 27.7172, longitude: 85.324 }, [
      { id: 'unavailable', latitude: 27.718, longitude: 85.325, availability: 'unavailable' },
      { id: 'near', latitude: 27.72, longitude: 85.33, availability: 'available' },
      { id: 'far', latitude: 27.75, longitude: 85.36, availability: 'available' },
    ])?.id).toBe('near')
  })
})
