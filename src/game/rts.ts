export type GameMode = "roam" | "command" | "pvp";
export type UnitTeam = "player" | "enemy";
export type MatchResult = "victory" | "defeat" | null;

export type UnitCommand =
  | { type: "idle" }
  | { type: "move"; target: [number, number] }
  | { type: "attack"; targetId: string }
  | { type: "return" };

export type UnitState = {
  id: string;
  team: UnitTeam;
  position: [number, number];
  spawnPosition: [number, number];
  heading: number;
  hp: number;
  maxHp: number;
  cooldown: number;
  command: UnitCommand;
  alive: boolean;
};

export const UNIT_MAX_HP = 100;
export const UNIT_DAMAGE = 10;
export const UNIT_ATTACK_COOLDOWN = 0.75;
export const UNIT_ATTACK_RANGE_METERS = 30;
export const UNIT_MOVE_SPEED_METERS = 18;
export const ENEMY_AGGRO_RANGE_METERS = 120;
export const ENEMY_LEASH_METERS = 250;

const METERS_PER_DEGREE_LATITUDE = 111_320;

export const distanceMeters = (a: [number, number], b: [number, number]) => {
  const latitude = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * METERS_PER_DEGREE_LATITUDE * Math.cos(latitude);
  const dy = (b[1] - a[1]) * METERS_PER_DEGREE_LATITUDE;
  return Math.hypot(dx, dy);
};

export const offsetMeters = (
  origin: [number, number],
  eastMeters: number,
  northMeters: number
): [number, number] => {
  const longitudeScale = Math.max(
    1,
    METERS_PER_DEGREE_LATITUDE * Math.cos(origin[1] * (Math.PI / 180))
  );
  return [
    origin[0] + eastMeters / longitudeScale,
    origin[1] + northMeters / METERS_PER_DEGREE_LATITUDE,
  ];
};

const createUnit = (
  id: string,
  team: UnitTeam,
  position: [number, number]
): UnitState => ({
  id,
  team,
  position,
  spawnPosition: position,
  heading: team === "player" ? 0 : Math.PI,
  hp: UNIT_MAX_HP,
  maxHp: UNIT_MAX_HP,
  cooldown: 0,
  command: { type: "idle" },
  alive: true,
});

export const createSkirmish = (origin: [number, number]): UnitState[] => {
  const formation = [-28, 0, 28];
  return [
    ...formation.map((north, index) =>
      createUnit(`player-${index + 1}`, "player", offsetMeters(origin, -75, north))
    ),
    ...formation.map((north, index) =>
      createUnit(`enemy-${index + 1}`, "enemy", offsetMeters(origin, 75, north))
    ),
  ];
};

export const formationTargets = (
  center: [number, number],
  count: number,
  spacingMeters = 22
): [number, number][] => {
  if (count <= 1) return [center];
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  return Array.from({ length: count }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return offsetMeters(
      center,
      (column - (columns - 1) / 2) * spacingMeters,
      (row - (rows - 1) / 2) * spacingMeters
    );
  });
};

export const issueMoveCommand = (
  units: UnitState[],
  selectedIds: ReadonlySet<string>,
  target: [number, number]
) => {
  const selected = units.filter((unit) => unit.alive && selectedIds.has(unit.id));
  const targets = formationTargets(target, selected.length);
  let targetIndex = 0;
  return units.map((unit) =>
    selectedIds.has(unit.id) && unit.alive
      ? { ...unit, command: { type: "move", target: targets[targetIndex++] } as UnitCommand }
      : unit
  );
};

export const issueAttackCommand = (
  units: UnitState[],
  selectedIds: ReadonlySet<string>,
  targetId: string
) =>
  units.map((unit) =>
    selectedIds.has(unit.id) && unit.alive
      ? { ...unit, command: { type: "attack", targetId } as UnitCommand }
      : unit
  );

const moveToward = (
  unit: UnitState,
  target: [number, number],
  deltaSeconds: number,
  stopDistance = 1.5
) => {
  const distance = distanceMeters(unit.position, target);
  if (distance <= stopDistance) return { unit, reached: true };
  const heading = Math.atan2(target[1] - unit.position[1], target[0] - unit.position[0]);
  const travel = Math.min(distance - stopDistance, UNIT_MOVE_SPEED_METERS * deltaSeconds);
  return {
    unit: {
      ...unit,
      heading,
      position: offsetMeters(unit.position, Math.cos(heading) * travel, Math.sin(heading) * travel),
    },
    reached: false,
  };
};

const nearestTarget = (unit: UnitState, units: UnitState[]) => {
  let nearest: UnitState | undefined;
  let nearestDistance = Infinity;
  for (const candidate of units) {
    if (!candidate.alive || candidate.team === unit.team) continue;
    const distance = distanceMeters(unit.position, candidate.position);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return { target: nearest, distance: nearestDistance };
};

const applyEnemyAi = (units: UnitState[]) =>
  units.map((unit) => {
    if (!unit.alive || unit.team !== "enemy") return unit;
    const spawnDistance = distanceMeters(unit.position, unit.spawnPosition);
    if (spawnDistance > ENEMY_LEASH_METERS) {
      return { ...unit, command: { type: "return" } as UnitCommand };
    }
    const nearest = nearestTarget(unit, units);
    if (nearest.target && nearest.distance <= ENEMY_AGGRO_RANGE_METERS) {
      return {
        ...unit,
        command: { type: "attack", targetId: nearest.target.id } as UnitCommand,
      };
    }
    if (unit.command.type === "attack" || spawnDistance > 3) {
      return { ...unit, command: { type: "return" } as UnitCommand };
    }
    return { ...unit, command: { type: "idle" } as UnitCommand };
  });

export const stepRtsSimulation = (sourceUnits: UnitState[], deltaSeconds: number) => {
  const units = applyEnemyAi(
    sourceUnits.map((unit) => ({
      ...unit,
      cooldown: Math.max(0, unit.cooldown - deltaSeconds),
    }))
  );
  const damage = new Map<string, number>();

  const moved = units.map((unit) => {
    if (!unit.alive) return unit;

    if (unit.command.type === "move") {
      const result = moveToward(unit, unit.command.target, deltaSeconds);
      return result.reached
        ? { ...result.unit, command: { type: "idle" } as UnitCommand }
        : result.unit;
    }

    if (unit.command.type === "return") {
      const result = moveToward(unit, unit.spawnPosition, deltaSeconds);
      return result.reached
        ? { ...result.unit, command: { type: "idle" } as UnitCommand }
        : result.unit;
    }

    if (unit.command.type === "attack") {
      const targetId = unit.command.targetId;
      const target = units.find(
        (candidate) => candidate.id === targetId && candidate.alive
      );
      if (!target) return { ...unit, command: { type: "idle" } as UnitCommand };
      const distance = distanceMeters(unit.position, target.position);
      if (distance > UNIT_ATTACK_RANGE_METERS) {
        return moveToward(
          unit,
          target.position,
          deltaSeconds,
          UNIT_ATTACK_RANGE_METERS * 0.8
        ).unit;
      }
      const heading = Math.atan2(
        target.position[1] - unit.position[1],
        target.position[0] - unit.position[0]
      );
      if (unit.cooldown <= 0) {
        damage.set(target.id, (damage.get(target.id) ?? 0) + UNIT_DAMAGE);
        return { ...unit, heading, cooldown: UNIT_ATTACK_COOLDOWN };
      }
      return { ...unit, heading };
    }

    return unit;
  });

  return moved.map((unit) => {
    const nextHp = Math.max(0, unit.hp - (damage.get(unit.id) ?? 0));
    return nextHp === unit.hp
      ? unit
      : {
          ...unit,
          hp: nextHp,
          alive: nextHp > 0,
          command: nextHp > 0 ? unit.command : ({ type: "idle" } as UnitCommand),
        };
  });
};

export const getMatchResult = (units: UnitState[]): MatchResult => {
  const playerAlive = units.some((unit) => unit.team === "player" && unit.alive);
  const enemyAlive = units.some((unit) => unit.team === "enemy" && unit.alive);
  if (!enemyAlive) return "victory";
  if (!playerAlive) return "defeat";
  return null;
};

export const selectUnitIdsInScreenBox = (
  units: UnitState[],
  project: (position: [number, number]) => { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number }
) => {
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  return units
    .filter((unit) => {
      if (!unit.alive || unit.team !== "player") return false;
      const point = project(unit.position);
      return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
    })
    .map((unit) => unit.id);
};
