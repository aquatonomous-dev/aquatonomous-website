// ArduPilot's Location helpers: metres per 1e-7 degrees of latitude.
const LATLON_TO_M = 0.011131884502145034;

export interface GeoPoint {
  lat: number;
  lon: number;
}

/** GPS fix for a point east/north of the SITL home, as ArduPilot (and MAVROS) would report it. */
export function localToGps(east: number, north: number, home: GeoPoint): GeoPoint {
  const lat = home.lat + (north / LATLON_TO_M) * 1e-7;
  const scale = Math.max(Math.cos((home.lat * Math.PI) / 180), 0.01);
  const lon = home.lon + (east / LATLON_TO_M / scale) * 1e-7;
  return { lat, lon };
}

/** Compass heading in degrees (0 = north, 90 = east) for a yaw measured counter-clockwise from east. */
export function compassHeading(yaw: number): number {
  const degrees = 90 - (yaw * 180) / Math.PI;
  return ((degrees % 360) + 360) % 360;
}

const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function cardinal(heading: number): string {
  return CARDINALS[Math.round(heading / 45) % 8];
}
