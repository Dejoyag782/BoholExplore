import { distanceMeters, offsetMeters } from "./rts";

export type TankInput = {
  forward: number;
  turn: number;
  firing: boolean;
};

export type TankPlayer = {
  id: string;
  name: string;
  color: string;
  position: [number, number];
  spawnPosition: [number, number];
  heading: number;
  hp: number;
  score: number;
  deaths: number;
  cooldown: number;
  respawnIn: number;
  shotSequence: number;
  lastShot: {
    from: [number, number];
    to: [number, number];
  } | null;
};

export const IDLE_TANK_INPUT: TankInput = { forward: 0, turn: 0, firing: false };
export const TANK_MAX_HP = 100;
export const TANK_SPEED_METERS = 24;
export const TANK_TURN_SPEED = 1.65;
export const TANK_FIRE_RANGE_METERS = 180;
export const TANK_FIRE_COOLDOWN = 0.7;
export const TANK_DAMAGE = 34;
export const TANK_RESPAWN_SECONDS = 3;

const PLAYER_COLORS = ["#22d3ee", "#fb7185", "#fbbf24", "#a78bfa", "#4ade80", "#f97316"];
const normalizeAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

export const createTankPlayer = (
  id: string,
  name: string,
  origin: [number, number],
  index: number
): TankPlayer => {
  const angle = (index * Math.PI * 2) / 6;
  const position = offsetMeters(origin, Math.cos(angle) * 75, Math.sin(angle) * 75);
  return {
    id,
    name: name.trim().slice(0, 18) || `Tank ${index + 1}`,
    color: PLAYER_COLORS[index % PLAYER_COLORS.length],
    position,
    spawnPosition: position,
    heading: normalizeAngle(angle + Math.PI),
    hp: TANK_MAX_HP,
    score: 0,
    deaths: 0,
    cooldown: 0,
    respawnIn: 0,
    shotSequence: 0,
    lastShot: null,
  };
};

const targetInSight = (shooter: TankPlayer, candidates: TankPlayer[]) => {
  let target: TankPlayer | undefined;
  let nearestDistance = Infinity;
  for (const candidate of candidates) {
    if (candidate.id === shooter.id || candidate.hp <= 0) continue;
    const distance = distanceMeters(shooter.position, candidate.position);
    if (distance > TANK_FIRE_RANGE_METERS || distance >= nearestDistance) continue;
    const bearing = Math.atan2(
      candidate.position[1] - shooter.position[1],
      candidate.position[0] - shooter.position[0]
    );
    if (Math.abs(normalizeAngle(bearing - shooter.heading)) > 0.2) continue;
    target = candidate;
    nearestDistance = distance;
  }
  return target;
};

export const stepTankBattle = (
  sourcePlayers: TankPlayer[],
  inputs: ReadonlyMap<string, TankInput>,
  deltaSeconds: number
) => {
  const delta = Math.max(0, Math.min(deltaSeconds, 0.05));
  const moved = sourcePlayers.map((player) => {
    if (player.hp <= 0) {
      const respawnIn = Math.max(0, player.respawnIn - delta);
      return respawnIn === 0
        ? { ...player, position: player.spawnPosition, hp: TANK_MAX_HP, respawnIn: 0 }
        : { ...player, respawnIn };
    }

    const input = inputs.get(player.id) ?? IDLE_TANK_INPUT;
    const heading = normalizeAngle(player.heading + input.turn * TANK_TURN_SPEED * delta);
    const travel = input.forward * TANK_SPEED_METERS * delta;
    const position = offsetMeters(
      player.position,
      Math.cos(heading) * travel,
      Math.sin(heading) * travel
    );
    return { ...player, heading, position, cooldown: Math.max(0, player.cooldown - delta) };
  });

  const damage = new Map<string, { amount: number; attackerId: string }>();
  const fired = moved.map((player) => {
    const input = inputs.get(player.id) ?? IDLE_TANK_INPUT;
    if (player.hp <= 0 || !input.firing || player.cooldown > 0) return player;
    const target = targetInSight(player, moved);
    const shotEnd = target?.position ?? offsetMeters(
      player.position,
      Math.cos(player.heading) * TANK_FIRE_RANGE_METERS,
      Math.sin(player.heading) * TANK_FIRE_RANGE_METERS
    );
    if (target) {
      const hit = damage.get(target.id) ?? { amount: 0, attackerId: player.id };
      damage.set(target.id, { amount: hit.amount + TANK_DAMAGE, attackerId: player.id });
    }
    return {
      ...player,
      cooldown: TANK_FIRE_COOLDOWN,
      shotSequence: player.shotSequence + 1,
      lastShot: { from: player.position, to: shotEnd },
    };
  });

  const killedBy = new Map<string, string>();
  const damaged = fired.map((player) => {
    const hit = damage.get(player.id);
    if (!hit) return player;
    const hp = Math.max(0, player.hp - hit.amount);
    if (player.hp > 0 && hp === 0) killedBy.set(player.id, hit.attackerId);
    return hp === 0
      ? { ...player, hp, deaths: player.deaths + 1, respawnIn: TANK_RESPAWN_SECONDS }
      : { ...player, hp };
  });

  return damaged.map((player) => {
    const score = Array.from(killedBy.values()).filter((id) => id === player.id).length;
    return score ? { ...player, score: player.score + score } : player;
  });
};
