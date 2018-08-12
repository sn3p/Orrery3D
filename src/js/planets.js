// https://www.classe.cornell.edu/~seb/celestia/orbital-parameters.html
// http://nssdc.gsfc.nasa.gov/planetary/factsheet/
// http://www.eightplanetsfacts.com
// https://en.wikipedia.org/wiki/Orbital_elements
// http://spaceflight.nasa.gov/realdata/elements/
// http://astronomy.swin.edu.au/cosmos/O/orbital+elements

// epoch = noon UTC on 1 January 2000 (Julian date 2451545)
// a     = Semi-major axis (AU)
// e     = Orbital eccentricity (0..1)
// i     = Inclination to the ecliptic (degrees)
// W     = Longitude of the ascending node (degrees, Ω)
// w     = Argument of perihelion (degrees, ω)
// wbar  = Longitude of perihelion (degrees, ϖ = Ω + ω)
// L     = Mean longitude (degrees, M + ϖ)
// M     = Mean anomaly (degrees, L - ϖ)
// P     = Period to complete one orbit

export default [
  {
    name: "Mercury",
    size: 1.6,
    color: 0xeccd9e,
    ephemeris: {
      epoch: 2451545.0,
      a: 0.38709893,
      e: 0.20563069,
      i: 7.00487,
      W: 48.33167,
      w: 29.124,
      wbar: 77.45645,
      L: 252.25084, // never used?
      M: 174.79439,
      P: 87.969
    }
  },
  {
    name: "Venus",
    size: 1.8,
    color: 0xeccd9e,
    ephemeris: {
      epoch: 2451545.0,
      a: 0.72333199,
      e: 0.00677323,
      i: 3.39471,
      W: 76.68069,
      w: 29.124,
      wbar: 131.53298,
      L: 181.97973,
      M: 50.44675,
      P: 224.701
    }
  },
  {
    name: "Earth",
    size: 2.8,
    color: 0x98c0ff,
    ephemeris: {
      epoch: 2451545.0,
      a: 1.00000011,
      e: 0.01671022,
      i: 0.00005,
      W: -11.26064,
      w: 114.20783,
      wbar: 102.94719,
      L: 100.46435,
      M: -2.47311027,
      P: 365.256
    }
  },
  {
    name: "Mars",
    size: 2.2,
    color: 0xffbc83,
    ephemeris: {
      epoch: 2451545.0,
      a: 1.52366231,
      e: 0.09341233,
      i: 1.85061,
      W: 49.57854,
      w: 286.537,
      wbar: 336.04084,
      L: 355.45332,
      M: 19.41248,
      P: 686.98
    }
  },
  {
    name: "Jupiter",
    size: 4,
    color: 0xc5c3bd,
    ephemeris: {
      epoch: 2451545.0,
      a: 5.20336301,
      e: 0.04839266,
      i: 1.3053,
      W: 100.55615,
      w: 275.066,
      wbar: 14.75385,
      L: 34.40438,
      M: 19.65053,
      P: 4332.589
    }
  },
  {
    name: "Saturn",
    size: 3.2,
    color: 0xeccd9e,
    ephemeris: {
      epoch: 2451545.0,
      a: 9.53707032,
      e: 0.0541506,
      i: 2.48446,
      W: 113.71504,
      w: 336.013862,
      wbar: 92.43194,
      L: 49.94432,
      M: 42.48762,
      P: 10759.22
    }
  }
];

// // Calculate Mean Anomalies
// planetData.forEach(planet => {
//   planet.ephemeris.M = planet.ephemeris.L - planet.ephemeris.wbar;
// });
