// Sunrise and sunset from coordinates and date, worked out on the phone (no network).
// Sunrise equation as used by NOAA, accurate to a few minutes, which is plenty to switch a theme.

const rad = Math.PI / 180;
const J2000 = 2451545.0;
const toJulian = (ms: number) => ms / 86_400_000 + 2440587.5;
const fromJulian = (j: number) => (j - 2440587.5) * 86_400_000;

export type SunTimes = { sunrise: number; sunset: number } | { polar: 'day' | 'night' };

/** `date` is the local date at the place, YYYY-MM-DD; times come back as UTC milliseconds. */
export function sunTimes(date: string, lat: number, lng: number): SunTimes {
  const [y, m, d] = date.split('-').map(Number);
  const n = Math.round(toJulian(Date.UTC(y, m - 1, d, 12)) - J2000 + 0.0008);
  const meanNoon = n - lng / 360;
  const anomaly = (357.5291 + 0.98560028 * meanNoon) % 360;
  const center = 1.9148 * Math.sin(anomaly * rad) + 0.02 * Math.sin(2 * anomaly * rad) + 0.0003 * Math.sin(3 * anomaly * rad);
  const longitude = (anomaly + center + 180 + 102.9372) % 360;
  const transit = J2000 + meanNoon + 0.0053 * Math.sin(anomaly * rad) - 0.0069 * Math.sin(2 * longitude * rad);
  const declination = Math.asin(Math.sin(longitude * rad) * Math.sin(23.4397 * rad));
  const cosHour = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(declination)) / (Math.cos(lat * rad) * Math.cos(declination));
  if (cosHour > 1) return { polar: 'night' };
  if (cosHour < -1) return { polar: 'day' };
  const hour = Math.acos(cosHour) / rad / 360;
  return { sunrise: fromJulian(transit - hour), sunset: fromJulian(transit + hour) };
}

export function isDaytime(now: number, lat: number, lng: number): boolean {
  const localDate = new Date(now + (lng / 15) * 3_600_000).toISOString().slice(0, 10); // solar date at the place
  const sun = sunTimes(localDate, lat, lng);
  return 'polar' in sun ? sun.polar === 'day' : now >= sun.sunrise && now < sun.sunset;
}

export type ThemeSetting = 'auto' | 'day' | 'night';

/** Day or night for the chosen setting; undefined when "auto" has no place yet (the app then follows the phone). */
export function themeFor(setting: ThemeSetting, now: number, place?: { lat: number; lng: number }): 'day' | 'night' | undefined {
  if (setting !== 'auto') return setting;
  if (!place) return undefined;
  return isDaytime(now, place.lat, place.lng) ? 'day' : 'night';
}
