// Plus Codes (Open Location Code), the "XQVP+W2 京都市" line Google Maps shows for every place.
// Decoding is pure arithmetic, so it works offline. A short code (4 letters before "+") is completed
// from a reference point within about 50 km, e.g. another place in the same trip.

const ALPHABET = '23456789CFGHJMPQRVWX';
const PAIR_RES = [20, 1, 0.05, 0.0025, 0.000125];
const CODE = /(?:^|[^0-9A-Z])((?:[23456789CFGHJMPQRVWX]{2}){1,4}\+[23456789CFGHJMPQRVWX]{0,7})(?![0-9A-Z])/i;

export interface LatLng {
  lat: number;
  lng: number;
}

export type PlusCode = { full: true; code: string } | { full: false; code: string };

/** Finds a Plus Code in text such as "XQVP+W2 京都市東山区" or "8Q6QXQVP+W2". */
export function findPlusCode(text: string): PlusCode | undefined {
  const m = CODE.exec(text.toUpperCase());
  if (!m) return undefined;
  const code = m[1];
  return { full: code.indexOf('+') === 8, code };
}

/** The centre of the area a full code stands for. */
export function decodeFull(code: string): LatLng | undefined {
  const digits = code.replace('+', '').toUpperCase();
  if (digits.length < 8 || /[^23456789CFGHJMPQRVWX]/.test(digits)) return undefined;
  let lat = -90;
  let lng = -180;
  let latRes = 400;
  let lngRes = 400;
  for (let i = 0; i < Math.min(digits.length, 10); i += 2) {
    latRes = lngRes = PAIR_RES[i / 2];
    lat += ALPHABET.indexOf(digits[i]) * latRes;
    lng += ALPHABET.indexOf(digits[i + 1] ?? '2') * lngRes;
  }
  for (const c of digits.slice(10, 15)) {
    // grid refinement: 4 rows × 5 columns per extra character
    const n = ALPHABET.indexOf(c);
    latRes /= 5;
    lngRes /= 4;
    lat += Math.floor(n / 4) * latRes;
    lng += (n % 4) * lngRes;
  }
  return { lat: round(lat + latRes / 2), lng: round(lng + lngRes / 2) };
}

/** Completes a short code from a nearby reference point, as the Open Location Code reference does. */
export function decodeShort(code: string, near: LatLng): LatLng | undefined {
  const pad = 8 - code.indexOf('+');
  const prefix = encodePrefix(near, pad);
  const area = decodeFull(prefix + code);
  if (!area) return undefined;
  const res = 20 ** (2 - pad / 2);
  const half = res / 2;
  let { lat, lng } = area;
  if (near.lat + half < lat && lat - res >= -90) lat -= res;
  else if (near.lat - half > lat && lat + res <= 90) lat += res;
  if (near.lng + half < lng) lng -= res;
  else if (near.lng - half > lng) lng += res;
  return { lat: round(lat), lng: round(((lng + 540) % 360) - 180) };
}

function encodePrefix(p: LatLng, length: number): string {
  let lat = Math.min(Math.max(p.lat, -90), 89.9999999) + 90;
  let lng = ((((p.lng + 180) % 360) + 360) % 360);
  let out = '';
  for (let i = 0; out.length < length; i++) {
    const res = PAIR_RES[i];
    const a = Math.floor(lat / res);
    const b = Math.floor(lng / res);
    lat -= a * res;
    lng -= b * res;
    out += ALPHABET[a] + ALPHABET[b];
  }
  return out.slice(0, length);
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;
