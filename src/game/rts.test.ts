import { describe, expect, it } from "vitest";
import {
  createSkirmish,
  distanceMeters,
  formationTargets,
  getMatchResult,
  issueAttackCommand,
  issueMoveCommand,
  offsetMeters,
  selectUnitIdsInScreenBox,
  stepRtsSimulation,
} from "./rts";

const origin: [number, number] = [123.9, 9.8];

describe("RTS skirmish", () => {
  it("spawns balanced three-unit squads", () => {
    const units = createSkirmish(origin);
    expect(units.filter((unit) => unit.team === "player")).toHaveLength(3);
    expect(units.filter((unit) => unit.team === "enemy")).toHaveLength(3);
    expect(units.every((unit) => unit.hp === 100 && unit.alive)).toBe(true);
  });

  it("builds distinct formation slots and assigns them to selected units", () => {
    const center = offsetMeters(origin, 40, 20);
    const targets = formationTargets(center, 3);
    expect(targets).toHaveLength(3);
    expect(new Set(targets.map((target) => target.join(","))).size).toBe(3);

    const moved = issueMoveCommand(
      createSkirmish(origin),
      new Set(["player-1", "player-2", "player-3"]),
      center
    );
    expect(moved.slice(0, 3).every((unit) => unit.command.type === "move")).toBe(true);
  });

  it("assigns attack targets and enforces the damage cooldown", () => {
    let units = createSkirmish(origin);
    const player = units.find((unit) => unit.id === "player-1")!;
    units = units.map((unit) =>
      unit.id === "enemy-1"
        ? { ...unit, position: offsetMeters(player.position, 10, 0), spawnPosition: offsetMeters(player.position, 10, 0) }
        : unit
    );
    units = issueAttackCommand(units, new Set(["player-1"]), "enemy-1");

    units = stepRtsSimulation(units, 0.01);
    expect(units.find((unit) => unit.id === "enemy-1")!.hp).toBe(90);
    units = stepRtsSimulation(units, 0.5);
    expect(units.find((unit) => unit.id === "enemy-1")!.hp).toBe(90);
    units = stepRtsSimulation(units, 0.25);
    expect(units.find((unit) => unit.id === "enemy-1")!.hp).toBe(80);
  });

  it("makes enemies acquire nearby targets and return beyond their leash", () => {
    let units = createSkirmish(origin);
    const enemy = units.find((unit) => unit.id === "enemy-1")!;
    units = units.map((unit) =>
      unit.id === "player-1"
        ? { ...unit, position: offsetMeters(enemy.position, 50, 0) }
        : unit.team === "player"
          ? { ...unit, alive: false, hp: 0 }
          : unit
    );
    units = stepRtsSimulation(units, 0.01);
    expect(units.find((unit) => unit.id === "enemy-1")!.command).toEqual({
      type: "attack",
      targetId: "player-1",
    });

    units = units.map((unit) =>
      unit.id === "enemy-1"
        ? { ...unit, position: offsetMeters(unit.spawnPosition, 260, 0) }
        : unit
    );
    units = stepRtsSimulation(units, 0.01);
    expect(units.find((unit) => unit.id === "enemy-1")!.command.type).toBe("return");
  });

  it("selects only living friendly units inside a screen rectangle", () => {
    const units = createSkirmish(origin).map((unit, index) =>
      index === 1 ? { ...unit, alive: false } : unit
    );
    const ids = selectUnitIdsInScreenBox(
      units,
      (position) => ({
        x: distanceMeters(origin, [position[0], origin[1]]),
        y: distanceMeters(origin, [origin[0], position[1]]),
      }),
      { x: 0, y: 0 },
      { x: 200, y: 200 }
    );
    expect(ids).toContain("player-1");
    expect(ids).not.toContain("player-2");
    expect(ids.every((id) => id.startsWith("player-"))).toBe(true);
  });

  it("detects victory and defeat", () => {
    const units = createSkirmish(origin);
    expect(getMatchResult(units)).toBeNull();
    expect(getMatchResult(units.map((unit) => unit.team === "enemy" ? { ...unit, alive: false } : unit))).toBe("victory");
    expect(getMatchResult(units.map((unit) => unit.team === "player" ? { ...unit, alive: false } : unit))).toBe("defeat");
  });
});
