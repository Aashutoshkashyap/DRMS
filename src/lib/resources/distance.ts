export interface Coordinates { latitude: number; longitude: number }

/** Great-circle distance in kilometres; adequate for local coordinator ranking. */
export function distanceKm(from: Coordinates, to: Coordinates): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const earthRadiusKm = 6371
  const deltaLat = radians(to.latitude - from.latitude)
  const deltaLon = radians(to.longitude - from.longitude)
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(deltaLon / 2) ** 2
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function nearestAvailable<T extends Coordinates & { availability: string }>(
  origin: Coordinates,
  candidates: T[],
): (T & { distanceKm: number }) | null {
  return candidates
    .filter((candidate) => candidate.availability === 'available')
    .map((candidate) => ({ ...candidate, distanceKm: distanceKm(origin, candidate) }))
    .sort((left, right) => left.distanceKm - right.distanceKm)[0] ?? null
}
