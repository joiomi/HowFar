// Shared fixtures for the directions specs: a long public-transport trip whose chips
// wrap onto several rows (the tallest directions sheet a check can meet), and a box
// overlap test for the layout checks.

// The rides a long trip cycles through, each with its line.
const RIDES: ReadonlyArray<readonly [string, string]> = [
  ["BUS", "243"],
  ["TRAM", "1"],
  ["SUBWAY", "M2"],
  ["BUS", "131"],
  ["TRAM", "41"],
];

// A reachable /api/reach plan of `legCount` legs (odd, so it starts and ends on foot):
// walks alternate with rides cycling through RIDES, every leg 6 min, each with a
// drawable path heading north-west from Piața Unirii.
export function longTrip(legCount: number) {
  const at = (i: number) => ({ lat: 44.4268 + i * 0.002, lng: 26.1025 - i * 0.001 });
  const legs = Array.from({ length: legCount }, (_, i) => {
    const ride = i % 2 === 1 ? RIDES[((i - 1) / 2) % RIDES.length] : null;
    return {
      mode: ride ? ride[0] : "WALK",
      ...(ride ? { line: ride[1], headsign: "Nord" } : {}),
      fromName: i === 0 ? "START" : `Stația ${i}`,
      toName: i === legCount - 1 ? "END" : `Stația ${i + 1}`,
      minutes: 6,
      from: at(i),
      to: at(i + 1),
      path: [
        [at(i).lng, at(i).lat],
        [at(i + 1).lng, at(i + 1).lat],
      ],
    };
  });
  const rides = Math.floor(legCount / 2);
  return { reachable: true, totalMinutes: 6 * legCount, transfers: Math.max(0, rides - 1), legs };
}

export type Box = { x: number; y: number; width: number; height: number };

// True when the two boxes share any area.
export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
