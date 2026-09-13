import { describe, expect, it } from "vitest";
import { createSkirmish, offsetMeters, type UnitState } from "./rts";
import { getRtsAudioFrame } from "./rtsAudio";

describe("RTS audio events", () => {
  it("detects vehicle movement and weapon fire", () => {
    const previous = createSkirmish([123.9, 9.8]);
    const next = previous.map((unit, index) =>
      index === 0
        ? {
            ...unit,
            position: offsetMeters(unit.position, 1, 0),
            cooldown: 0.75,
          }
        : unit
    );

    const frame = getRtsAudioFrame(previous, next);
    expect(frame.movingUnits).toBe(1);
    expect(frame.aliveUnits).toBe(6);
    expect(frame.shots.player).toBe(1);
  });

  it("detects impacts and destruction", () => {
    const previous = createSkirmish([123.9, 9.8]);
    const destroyed: UnitState = { ...previous[3], hp: 0, alive: false };
    const next = previous.map((unit) => unit.id === destroyed.id ? destroyed : unit);

    const frame = getRtsAudioFrame(previous, next);
    expect(frame.impacts).toBe(1);
    expect(frame.destructions).toBe(1);
    expect(frame.aliveUnits).toBe(5);
  });
});
