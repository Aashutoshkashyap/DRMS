/** Extract the coordinates appended to CRM location messages and make a
 * safe map link. Meta and OpenWA both persist the same human-readable text. */
export function mapUrlFromLocationText(value: string | null | undefined): string | null {
  if (!value) return null;
  const matches = value.matchAll(/(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/g);
  let coordinates: [number, number] | null = null;
  for (const match of matches) {
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
      coordinates = [latitude, longitude];
    }
  }
  if (!coordinates) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${coordinates[0]},${coordinates[1]}`)}`;
}
