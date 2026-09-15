import { describe, expect, it } from "vitest";
import { distanceMeters, offsetMeters } from "./rts";
import {
  createTankPlayer,
  IDLE_TANK_INPUT,
  stepTankBattle,
  TANK_GEAR_SPEEDS,
  TANK_MAX_HP,
  TANK_PROJECTILE_MIN_FLIGHT_SECONDS,
  TANK_SPEED_METERS,
  TANK_TURRET_TURN_SPEED,
  type TankInput,
} from "./tankPvp";

const origin: [number, number] = [123.9, 9.8];

describe("tank PvP simulation", () => {
  it("moves and turns a tank from player input", () => {
    const player = createTankPlayer("host", "Host", origin, 0);
    const input: TankInput = {
      forward: 1,
      turn: 1,
      firing: false,
      gear: 3,
      aimHeading: null,
    };
    const next = stepTankBattle([player], new Map([[player.id, input]]), 0.05)[0];
    expect(next.position).not.toEqual(player.position);
    expect(next.heading).not.toBe(player.heading);
  });

  it("deals damage only when the projectile reaches a tank in the firing cone", () => {
    const shooter = {
      ...createTankPlayer("a", "A", origin, 0),
      position: origin,
      heading: 0,
      turretHeading: 0,
    };
    const target = { ...createTankPlayer("b", "B", origin, 1), position: offsetMeters(origin, 40, 0) };
    const inputs = new Map([
      [shooter.id, { ...IDLE_TANK_INPUT, firing: true }],
      [target.id, IDLE_TANK_INPUT],
    ]);
    let next = stepTankBattle([shooter, target], inputs, 0.01);
    expect(next.find((player) => player.id === target.id)?.hp).toBe(TANK_MAX_HP);
    expect(next.find((player) => player.id === shooter.id)?.shotSequence).toBe(1);
    expect(next.find((player) => player.id === shooter.id)?.lastShot?.to).toEqual(target.position);

    const idleInputs = new Map(next.map((player) => [player.id, IDLE_TANK_INPUT]));
    for (let elapsed = 0; elapsed < TANK_PROJECTILE_MIN_FLIGHT_SECONDS; elapsed += 0.05) {
      next = stepTankBattle(next, idleInputs, 0.05);
    }
    expect(next.find((player) => player.id === target.id)?.hp).toBe(TANK_MAX_HP - 34);
  });

  it("can hit targets at the extended projectile range", () => {
    const shooter = {
      ...createTankPlayer("a", "A", origin, 0),
      position: origin,
      heading: 0,
      turretHeading: 0,
    };
    const target = {
      ...createTankPlayer("b", "B", origin, 1),
      position: offsetMeters(origin, 160, 0),
    };
    let next = stepTankBattle(
      [shooter, target],
      new Map([
        [shooter.id, { ...IDLE_TANK_INPUT, firing: true }],
        [target.id, IDLE_TANK_INPUT],
      ]),
      0.01
    );

    expect(next.find((player) => player.id === target.id)?.hp).toBe(TANK_MAX_HP);
    const idleInputs = new Map(next.map((player) => [player.id, IDLE_TANK_INPUT]));
    for (let elapsed = 0; elapsed < 0.7; elapsed += 0.05) {
      next = stepTankBattle(next, idleInputs, 0.05);
    }
    expect(next.find((player) => player.id === target.id)?.hp).toBe(TANK_MAX_HP - 34);
  });

  it("misses when target leaves projectile impact point", () => {
    const shooter = {
      ...createTankPlayer("a", "A", origin, 0),
      position: origin,
      heading: 0,
      turretHeading: 0,
    };
    const target = { ...createTankPlayer("b", "B", origin, 1), position: offsetMeters(origin, 40, 0) };
    let next = stepTankBattle(
      [shooter, target],
      new Map([
        [shooter.id, { ...IDLE_TANK_INPUT, firing: true }],
        [target.id, IDLE_TANK_INPUT],
      ]),
      0.01
    );
    next = next.map((player) =>
      player.id === target.id
        ? { ...player, position: offsetMeters(player.position, 20, 0) }
        : player
    );
    const idleInputs = new Map(next.map((player) => [player.id, IDLE_TANK_INPUT]));
    for (let elapsed = 0; elapsed < TANK_PROJECTILE_MIN_FLIGHT_SECONDS; elapsed += 0.05) {
      next = stepTankBattle(next, idleInputs, 0.05);
    }
    expect(next.find((player) => player.id === target.id)?.hp).toBe(TANK_MAX_HP);
  });

  it("lets tanks travel beyond the former host arena", () => {
    const player = {
      ...createTankPlayer("host", "Host", origin, 0),
      position: offsetMeters(origin, 239.9, 0),
      heading: 0,
    };
    const next = stepTankBattle(
      [player],
      new Map([[player.id, { ...IDLE_TANK_INPUT, forward: 1, gear: 3 }]]),
      0.05
    )[0];
    expect(next.position).not.toEqual(player.position);
  });

  it("uses roam-style takeoff and preserves momentum during airtime", () => {
    const player = {
      ...createTankPlayer("host", "Host", origin, 0),
      position: origin,
      heading: 0,
      terrainSlope: 0.2,
    };
    const terrainElevation = () => 10;
    const launched = stepTankBattle(
      [player],
      new Map([[player.id, { ...IDLE_TANK_INPUT, forward: 1, gear: 3 }]]),
      0.05,
      terrainElevation
    )[0];

    expect(launched.airborne).toBe(true);
    expect(launched.airborneSpeed).toBe(TANK_SPEED_METERS);

    const coasting = stepTankBattle(
      [launched],
      new Map([[player.id, IDLE_TANK_INPUT]]),
      0.05,
      terrainElevation
    )[0];
    expect(coasting.position).not.toEqual(launched.position);
  });

  it("moves farther in each higher gear", () => {
    const player = {
      ...createTankPlayer("host", "Host", origin, 0),
      position: origin,
      heading: 0,
    };

    const distances = ([1, 2, 3] as const).map((gear) => {
      const next = stepTankBattle(
        [player],
        new Map([[player.id, { ...IDLE_TANK_INPUT, forward: 1, gear }]]),
        0.05
      )[0];
      return distanceMeters(player.position, next.position);
    });

    expect(distances[0]).toBeCloseTo(TANK_GEAR_SPEEDS[1] * 0.05, 4);
    expect(distances[0]).toBeLessThan(distances[1]);
    expect(distances[1]).toBeLessThan(distances[2]);
  });

  it("clears transient firing state when a tank respawns", () => {
    const player = {
      ...createTankPlayer("host", "Host", origin, 0),
      hp: 0,
      respawnIn: 0.01,
      cooldown: 0.75,
      shotSequence: 8,
      projectile: {
        id: 8,
        from: origin,
        to: offsetMeters(origin, 40, 0),
        remainingSeconds: 0.2,
      },
      lastShot: { from: origin, to: offsetMeters(origin, 40, 0) },
    };

    const respawned = stepTankBattle(
      [player],
      new Map([[player.id, IDLE_TANK_INPUT]]),
      0.05
    )[0];

    expect(respawned.hp).toBe(TANK_MAX_HP);
    expect(respawned.cooldown).toBe(0);
    expect(respawned.projectile).toBeNull();
    expect(respawned.lastShot).toBeNull();
    expect(respawned.turretHeading).toBe(respawned.heading);
  });

  it("turns turret by shortest path at limited speed", () => {
    const player = {
      ...createTankPlayer("host", "Host", origin, 0),
      heading: Math.PI - 0.05,
      turretHeading: Math.PI - 0.05,
    };
    const targetHeading = -Math.PI + 0.2;
    const next = stepTankBattle(
      [player],
      new Map([[player.id, { ...IDLE_TANK_INPUT, aimHeading: targetHeading }]]),
      0.05
    )[0];

    const turn = Math.atan2(
      Math.sin(next.turretHeading - player.turretHeading),
      Math.cos(next.turretHeading - player.turretHeading)
    );
    expect(turn).toBeCloseTo(TANK_TURRET_TURN_SPEED * 0.05, 6);
  });

  it("keeps aimed turret direction while hull turns", () => {
    const player = {
      ...createTankPlayer("host", "Host", origin, 0),
      heading: 0,
      turretHeading: Math.PI / 2,
    };
    const next = stepTankBattle(
      [player],
      new Map([[
        player.id,
        { ...IDLE_TANK_INPUT, turn: 1, aimHeading: Math.PI / 2 },
      ]]),
      0.05
    )[0];

    expect(next.heading).not.toBe(player.heading);
    expect(next.turretHeading).toBeCloseTo(Math.PI / 2, 6);
  });

  it("fires along turret heading instead of hull heading", () => {
    const shooter = {
      ...createTankPlayer("a", "A", origin, 0),
      position: origin,
      heading: 0,
      turretHeading: Math.PI / 2,
    };
    const eastTarget = {
      ...createTankPlayer("b", "B", origin, 1),
      position: offsetMeters(origin, 40, 0),
    };
    const northTarget = {
      ...createTankPlayer("c", "C", origin, 2),
      position: offsetMeters(origin, 0, 40),
    };
    const next = stepTankBattle(
      [shooter, eastTarget, northTarget],
      new Map([[shooter.id, { ...IDLE_TANK_INPUT, firing: true, aimHeading: Math.PI / 2 }]]),
      0.01
    );

    expect(next.find((player) => player.id === shooter.id)?.lastShot?.to).toEqual(
      northTarget.position
    );
  });
});
