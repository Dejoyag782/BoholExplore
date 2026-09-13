import type { UnitState, UnitTeam } from "./rts";

export type RtsAudioFrame = {
  movingUnits: number;
  aliveUnits: number;
  shots: Record<UnitTeam, number>;
  impacts: number;
  destructions: number;
};

export const getRtsAudioFrame = (
  previousUnits: UnitState[],
  nextUnits: UnitState[]
): RtsAudioFrame => {
  const previousById = new Map(previousUnits.map((unit) => [unit.id, unit]));
  const frame: RtsAudioFrame = {
    movingUnits: 0,
    aliveUnits: 0,
    shots: { player: 0, enemy: 0 },
    impacts: 0,
    destructions: 0,
  };

  for (const unit of nextUnits) {
    if (unit.alive) frame.aliveUnits += 1;
    const previous = previousById.get(unit.id);
    if (!previous) continue;

    if (
      unit.alive &&
      (Math.abs(unit.position[0] - previous.position[0]) > 1e-10 ||
        Math.abs(unit.position[1] - previous.position[1]) > 1e-10)
    ) {
      frame.movingUnits += 1;
    }
    if (unit.cooldown > previous.cooldown + 0.25) frame.shots[unit.team] += 1;
    if (unit.hp < previous.hp) frame.impacts += 1;
    if (previous.alive && !unit.alive) frame.destructions += 1;
  }

  return frame;
};
