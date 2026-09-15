import { distanceMeters, offsetMeters } from "./rts";

export type TankInput = {
  forward: number;
  turn: number;
  firing: boolean;
  gear: TankGear;
  aimHeading: number | null;
};

export type TankGear = 1 | 2 | 3;

export type TankProjectile = {
  id: number;
  from: [number, number];
  to: [number, number];
  remainingSeconds: number;
};

export type TankPlayer = {
  id: string;
  name: string;
  color: string;
  position: [number, number];
  spawnPosition: [number, number];
  heading: number;
  turretHeading: number;
  hp: number;
  score: number;
  deaths: number;
  cooldown: number;
  respawnIn: number;
  airborne: boolean;
  altitude: number | null;
  groundAltitude: number | null;
  airtime: number;
  verticalVelocity: number;
  airborneSpeed: number;
  terrainSlope: number;
  shotSequence: number;
  projectile: TankProjectile | null;
  lastShot: {
    from: [number, number];
    to: [number, number];
  } | null;
};

export const IDLE_TANK_INPUT: TankInput = {
  forward: 0,
  turn: 0,
  firing: false,
  gear: 2,
  aimHeading: null,
};
export const TANK_MAX_HP = 100;
export const TANK_SPEED_METERS = 60;
export const TANK_GEAR_SPEEDS: Record<TankGear, number> = {
  1: 30,
  2: 45,
  3: TANK_SPEED_METERS,
};
export const TANK_TURN_SPEED = 1.8;
export const TANK_TURRET_TURN_SPEED = 2.4;
export const TANK_FIRE_RANGE_METERS = 180;
export const TANK_FIRE_COOLDOWN = 1;
export const TANK_SPAWN_RADIUS_METERS = 100;
export const TANK_DAMAGE = 34;
export const TANK_PROJECTILE_SPEED_METERS_PER_SECOND = 260;
export const TANK_PROJECTILE_MIN_FLIGHT_SECONDS = 0.42;
export const TANK_PROJECTILE_HIT_RADIUS_METERS = 8;
export const TANK_RESPAWN_SECONDS = 3;
export const TANK_GRAVITY = 22;
export const TANK_TERRAIN_LOOKAHEAD_METERS = 8;
export const TANK_RAMP_TAKEOFF_SLOPE = 0.08;
export const TANK_DROP_TAKEOFF_SLOPE = -0.15;
export const TANK_MAX_AIRTIME_SECONDS = 2;
export const TANK_MAX_AIR_HEIGHT_METERS = 3;

export type TankTerrainElevation = (position: [number, number]) => number | null | undefined;

const PLAYER_COLORS = ["#22d3ee", "#fb7185", "#fbbf24", "#a78bfa", "#4ade80", "#f97316"];
export const normalizeAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

export const bearingRadians = (from: [number, number], to: [number, number]) => {
  const latitude = ((from[1] + to[1]) / 2) * (Math.PI / 180);
  const east = (to[0] - from[0]) * Math.cos(latitude);
  const north = to[1] - from[1];
  return Math.atan2(north, east);
};

const rotateToward = (current: number, target: number, maxStep: number) => {
  const delta = normalizeAngle(target - current);
  return normalizeAngle(current + Math.max(-maxStep, Math.min(maxStep, delta)));
};

export const createTankPlayer = (
  id: string,
  name: string,
  origin: [number, number],
  index: number
): TankPlayer => {
  const angle = Math.random() * Math.PI * 2;
  const distance = Math.sqrt(Math.random()) * TANK_SPAWN_RADIUS_METERS;
  const position = offsetMeters(
    origin,
    Math.cos(angle) * distance,
    Math.sin(angle) * distance
  );
  const heading = normalizeAngle(angle + Math.PI);
  return {
    id,
    name: name.trim().slice(0, 18) || `Tank ${index + 1}`,
    color: PLAYER_COLORS[index % PLAYER_COLORS.length],
    position,
    spawnPosition: position,
    heading,
    turretHeading: heading,
    hp: TANK_MAX_HP,
    score: 0,
    deaths: 0,
    cooldown: 0,
    respawnIn: 0,
    airborne: false,
    altitude: null,
    groundAltitude: null,
    airtime: 0,
    verticalVelocity: 0,
    airborneSpeed: 0,
    terrainSlope: 0,
    shotSequence: 0,
    projectile: null,
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
    const bearing = bearingRadians(shooter.position, candidate.position);
    if (Math.abs(normalizeAngle(bearing - shooter.turretHeading)) > 0.2) continue;
    target = candidate;
    nearestDistance = distance;
  }
  return target;
};

export const getTankShotEnd = (
  shooter: TankPlayer,
  candidates: TankPlayer[]
): [number, number] => {
  const target = targetInSight(shooter, candidates);
  return target?.position ?? offsetMeters(
    shooter.position,
    Math.cos(shooter.turretHeading) * TANK_FIRE_RANGE_METERS,
    Math.sin(shooter.turretHeading) * TANK_FIRE_RANGE_METERS
  );
};

export const stepTankBattle = (
  sourcePlayers: TankPlayer[],
  inputs: ReadonlyMap<string, TankInput>,
  deltaSeconds: number,
  terrainElevation?: TankTerrainElevation
) => {
  const delta = Math.max(0, Math.min(deltaSeconds, 0.05));
  const moved = sourcePlayers.map((player) => {
    if (player.hp <= 0) {
      const respawnIn = Math.max(0, player.respawnIn - delta);
      return respawnIn === 0
        ? {
            ...player,
            position: player.spawnPosition,
            hp: TANK_MAX_HP,
            respawnIn: 0,
            airborne: false,
            altitude: null,
            groundAltitude: null,
            airtime: 0,
            verticalVelocity: 0,
            airborneSpeed: 0,
            terrainSlope: 0,
            turretHeading: player.heading,
            cooldown: 0,
            projectile: null,
            lastShot: null,
          }
        : { ...player, respawnIn };
    }

    const input = inputs.get(player.id) ?? IDLE_TANK_INPUT;
    const heading = normalizeAngle(player.heading + input.turn * TANK_TURN_SPEED * delta);
    const requestedAim = input.aimHeading != null && Number.isFinite(input.aimHeading)
      ? normalizeAngle(input.aimHeading)
      : heading;
    const turretHeading = rotateToward(
      player.turretHeading,
      requestedAim,
      TANK_TURRET_TURN_SPEED * delta
    );
    const inputSpeed = input.forward * TANK_GEAR_SPEEDS[input.gear];
    const travelSpeed = player.airborne ? player.airborneSpeed : inputSpeed;
    const travel = travelSpeed * delta;
    const position = offsetMeters(
      player.position,
      Math.cos(heading) * travel,
      Math.sin(heading) * travel
    );
    let airborne = player.airborne;
    let altitude = player.altitude;
    let groundAltitude = player.groundAltitude;
    let airtime = player.airtime;
    let verticalVelocity = player.verticalVelocity;
    let airborneSpeed = player.airborneSpeed;
    let terrainSlope = player.terrainSlope;

    if (terrainElevation && travelSpeed !== 0) {
      const terrainHere = terrainElevation(position);
      if (terrainHere != null) groundAltitude = terrainHere;
      const lookahead = offsetMeters(
        position,
        Math.cos(heading) * input.forward * TANK_TERRAIN_LOOKAHEAD_METERS,
        Math.sin(heading) * input.forward * TANK_TERRAIN_LOOKAHEAD_METERS
      );
      const terrainAhead = terrainElevation(lookahead);
      if (terrainHere != null && terrainAhead != null) {
        const slope = Math.max(
          -2,
          Math.min(2, (terrainAhead - terrainHere) / TANK_TERRAIN_LOOKAHEAD_METERS)
        );
        const leftRampCrest =
          terrainSlope > TANK_RAMP_TAKEOFF_SLOPE && slope < terrainSlope - 0.04;
        const reachedDrop =
          slope < TANK_DROP_TAKEOFF_SLOPE && terrainSlope >= TANK_DROP_TAKEOFF_SLOPE;
        if (!airborne && input.forward > 0 && (leftRampCrest || reachedDrop)) {
          airborne = true;
          airborneSpeed = travelSpeed;
          altitude = terrainHere;
          airtime = 0;
          verticalVelocity = Math.max(
            3,
            Math.min(18, Math.abs(travelSpeed) * Math.max(terrainSlope, 0.1) * 0.75)
          );
        }
        terrainSlope = slope;
      }
    }

    if (airborne && terrainElevation) {
      const sampledGroundAltitude = terrainElevation(position);
      if (sampledGroundAltitude != null) groundAltitude = sampledGroundAltitude;
      const safeGroundAltitude = groundAltitude ?? altitude ?? 0;
      const unconstrainedAltitude =
        (altitude ?? safeGroundAltitude) + verticalVelocity * delta;
      const nextAltitude = Math.min(
        unconstrainedAltitude,
        safeGroundAltitude + TANK_MAX_AIR_HEIGHT_METERS
      );
      if (unconstrainedAltitude > nextAltitude) verticalVelocity = Math.min(0, verticalVelocity);
      verticalVelocity -= TANK_GRAVITY * delta;
      airtime += delta;
      if (
        (nextAltitude <= safeGroundAltitude && verticalVelocity <= 0) ||
        airtime >= TANK_MAX_AIRTIME_SECONDS
      ) {
        airborne = false;
        altitude = null;
        airtime = 0;
        verticalVelocity = 0;
        airborneSpeed = 0;
      } else {
        altitude = nextAltitude;
      }
    }

    return {
      ...player,
      heading,
      turretHeading,
      position,
      cooldown: Math.max(0, player.cooldown - delta),
      airborne,
      altitude,
      groundAltitude,
      airtime,
      verticalVelocity,
      airborneSpeed,
      terrainSlope,
    };
  });

  const damage = new Map<string, { amount: number; attackerId: string }>();
  const advanced = moved.map((player) => {
    if (!player.projectile) return player;
    const remainingSeconds = player.projectile.remainingSeconds - delta;
    if (remainingSeconds > 0) {
      return {
        ...player,
        projectile: { ...player.projectile, remainingSeconds },
      };
    }

    let hitTarget: TankPlayer | undefined;
    let nearestDistance = TANK_PROJECTILE_HIT_RADIUS_METERS;
    for (const candidate of moved) {
      if (candidate.id === player.id || candidate.hp <= 0) continue;
      const distance = distanceMeters(player.projectile.to, candidate.position);
      if (distance > nearestDistance) continue;
      hitTarget = candidate;
      nearestDistance = distance;
    }
    if (hitTarget) {
      const hit = damage.get(hitTarget.id) ?? { amount: 0, attackerId: player.id };
      damage.set(hitTarget.id, { amount: hit.amount + TANK_DAMAGE, attackerId: player.id });
    }
    return { ...player, projectile: null };
  });

  const fired = advanced.map((player) => {
    const input = inputs.get(player.id) ?? IDLE_TANK_INPUT;
    if (player.hp <= 0 || !input.firing || player.cooldown > 0) return player;
    const shotEnd = getTankShotEnd(player, advanced);
    const shotDistance = distanceMeters(player.position, shotEnd);
    const shotSequence = player.shotSequence + 1;
    return {
      ...player,
      cooldown: TANK_FIRE_COOLDOWN,
      shotSequence,
      projectile: {
        id: shotSequence,
        from: player.position,
        to: shotEnd,
        remainingSeconds: Math.max(
          TANK_PROJECTILE_MIN_FLIGHT_SECONDS,
          shotDistance / TANK_PROJECTILE_SPEED_METERS_PER_SECOND
        ),
      },
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
