import { describe, expect, it } from "vitest";
import { offsetMeters } from "./rts";
import {
  createTankPlayer,
  IDLE_TANK_INPUT,
  stepTankBattle,
  TANK_MAX_HP,
  type TankInput,
} from "./tankPvp";

const origin: [number, number] = [123.9, 9.8];

describe("tank PvP simulation", () => {
  it("moves and turns a tank from player input", () => {
    const player = createTankPlayer("host", "Host", origin, 0);
    const input: TankInput = { forward: 1, turn: 1, firing: false };
    const next = stepTankBattle([player], new Map([[player.id, input]]), origin, 0.05)[0];
    expect(next.position).not.toEqual(player.position);
    expect(next.heading).not.toBe(player.heading);
  });

  it("lets only a tank in the firing cone take damage", () => {
    const shooter = { ...createTankPlayer("a", "A", origin, 0), position: origin, heading: 0 };
    const target = { ...createTankPlayer("b", "B", origin, 1), position: offsetMeters(origin, 40, 0) };
    const inputs = new Map([
      [shooter.id, { ...IDLE_TANK_INPUT, firing: true }],
      [target.id, IDLE_TANK_INPUT],
    ]);
    const next = stepTankBattle([shooter, target], inputs, origin, 0.01);
    expect(next.find((player) => player.id === target.id)?.hp).toBe(TANK_MAX_HP - 34);
    expect(next.find((player) => player.id === shooter.id)?.shotSequence).toBe(1);
    expect(next.find((player) => player.id === shooter.id)?.lastShot?.to).toEqual(target.position);
  });

  it("keeps tanks inside the host arena", () => {
    const player = {
      ...createTankPlayer("host", "Host", origin, 0),
      position: offsetMeters(origin, 239.9, 0),
      heading: 0,
    };
    const next = stepTankBattle(
      [player],
      new Map([[player.id, { forward: 1, turn: 0, firing: false }]]),
      origin,
      0.05
    )[0];
    expect(next.position).toEqual(player.position);
  });
});
