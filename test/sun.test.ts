import { describe, expect, it } from 'vitest';
import { isDaytime, sunTimes, themeFor } from '../src/core/sun';

const at = (iso: string) => Date.parse(iso);
const near = (ms: number, iso: string, minutes = 6) => expect(Math.abs(ms - at(iso)) / 60_000).toBeLessThan(minutes);

describe('sunrise and sunset', () => {
  it('matches published times', () => {
    const london = sunTimes('2026-12-21', 51.5074, -0.1278);
    if ('polar' in london) throw new Error();
    near(london.sunrise, '2026-12-21T08:04Z');
    near(london.sunset, '2026-12-21T15:54Z');

    const taipei = sunTimes('2026-06-21', 25.033, 121.5654); // UTC+8
    if ('polar' in taipei) throw new Error();
    near(taipei.sunrise, '2026-06-20T21:05Z');
    near(taipei.sunset, '2026-06-21T10:47Z');

    const reykjavik = sunTimes('2027-03-01', 64.1466, -21.9426); // high latitude, where errors grow
    if ('polar' in reykjavik) throw new Error();
    near(reykjavik.sunrise, '2027-03-01T08:36Z');
    near(reykjavik.sunset, '2027-03-01T18:45Z');
  });

  it('handles midnight sun and polar night', () => {
    expect(sunTimes('2026-06-21', 78.22, 15.65)).toEqual({ polar: 'day' }); // Svalbard
    expect(sunTimes('2026-12-21', 78.22, 15.65)).toEqual({ polar: 'night' });
  });

  it('decides day or night at the destination, not at home', () => {
    const tokyo = { lat: 35.68, lng: 139.77 };
    expect(isDaytime(at('2027-03-01T03:00Z'), tokyo.lat, tokyo.lng)).toBe(true); // 12:00 in Tokyo
    expect(isDaytime(at('2027-03-01T12:00Z'), tokyo.lat, tokyo.lng)).toBe(false); // 21:00
    expect(isDaytime(at('2027-03-01T21:00Z'), tokyo.lat, tokyo.lng)).toBe(false); // 06:00, before sunrise
    const ny = { lat: 40.71, lng: -74.0 };
    expect(isDaytime(at('2027-03-01T17:00Z'), ny.lat, ny.lng)).toBe(true); // 12:00 in New York
    expect(isDaytime(at('2027-03-02T03:00Z'), ny.lat, ny.lng)).toBe(false); // 22:00
  });

  it('fixed settings ignore the sun; auto without a place leaves it to the phone', () => {
    expect(themeFor('night', at('2027-03-01T03:00Z'), { lat: 35.68, lng: 139.77 })).toBe('night');
    expect(themeFor('day', 0)).toBe('day');
    expect(themeFor('auto', 0)).toBeUndefined();
  });
});
