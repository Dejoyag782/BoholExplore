import { useState } from "react";
import {
  TANK_SPAWN_RADIUS_METERS,
  type TankInput,
  type TankPlayer,
} from "../../../game/tankPvp";
import MobileTankControls from "./MobileTankControls";

type TankPvpHudProps = {
  status: "idle" | "downloading" | "connecting" | "hosting" | "joined" | "error";
  partyCode: string;
  localPeerId: string | null;
  players: TankPlayer[];
  error: string | null;
  isHost: boolean;
  spawnAreaSelected: boolean;
  isSelectingSpawnArea: boolean;
  isMenuOpen: boolean;
  onHost: (name: string) => void;
  onBeginSpawnSelection: () => void;
  onCancelSpawnSelection: () => void;
  onJoin: (code: string, name: string) => void;
  onLeave: () => void;
  onChangeMode: () => void;
  onOpenMenu: () => void;
  onCloseMenu: () => void;
  onInputChange: (input: Omit<TankInput, "aimHeading">) => void;
};

const TankPvpHud = ({
  status,
  partyCode,
  localPeerId,
  players,
  error,
  isHost,
  spawnAreaSelected,
  isSelectingSpawnArea,
  isMenuOpen,
  onHost,
  onBeginSpawnSelection,
  onCancelSpawnSelection,
  onJoin,
  onLeave,
  onChangeMode,
  onOpenMenu,
  onCloseMenu,
  onInputChange,
}: TankPvpHudProps) => {
  const [name, setName] = useState(() => `Player ${Math.floor(Math.random() * 900 + 100)}`);
  const [code, setCode] = useState("");
  const connected = status === "hosting" || status === "joined";
  const busy = status === "downloading" || status === "connecting";
  const localPlayer = players.find((player) => player.id === localPeerId);

  if (!connected && isSelectingSpawnArea) {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-3 z-40 flex justify-center px-3 sm:top-5">
        <section className="pointer-events-auto max-w-md border border-amber-300/60 bg-slate-950/94 px-4 py-3 text-center text-slate-100 shadow-2xl backdrop-blur-md">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-amber-300">Place spawn area</p>
          <p className="mt-1 text-xs text-slate-300">Drag to move around, then place the {TANK_SPAWN_RADIUS_METERS}m circle with a click or tap.</p>
          <button type="button" onClick={onCancelSpawnSelection} className="mt-3 border border-slate-600 px-3 py-1.5 font-mono text-[9px] uppercase text-slate-300">Cancel</button>
        </section>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="absolute inset-0 z-40 grid place-items-center bg-slate-950/75 px-4 backdrop-blur-sm">
        <section className="w-full max-w-lg border border-amber-300/50 bg-slate-950/95 p-6 text-slate-100 shadow-2xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-amber-300">PeerJS Tank PvP</p>
          <h2 className="mt-2 text-2xl font-black uppercase tracking-wider">Party uplink</h2>
          <label className="mt-5 block text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Callsign
            <input value={name} maxLength={18} onChange={(event) => setName(event.target.value)} className="mt-2 w-full border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-300" />
          </label>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button type="button" disabled={busy} onClick={() => spawnAreaSelected ? onHost(name) : onBeginSpawnSelection()} className="border border-emerald-300 bg-emerald-300 px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-950 disabled:opacity-50">
              {spawnAreaSelected ? "Host party" : "Select spawn area"}
            </button>
            <button type="button" onClick={onChangeMode} className="border border-slate-600 bg-slate-900 px-4 py-3 text-xs font-black uppercase tracking-widest">Modes</button>
          </div>
          {spawnAreaSelected && (
            <div className="mt-3 flex items-center justify-between border border-emerald-300/25 bg-emerald-300/10 px-3 py-2">
              <span className="font-mono text-[9px] uppercase tracking-wider text-emerald-200">Spawn area ready · {TANK_SPAWN_RADIUS_METERS}m radius</span>
              <button type="button" onClick={onBeginSpawnSelection} className="ml-3 text-[9px] font-bold uppercase text-amber-200 underline underline-offset-2">Change</button>
            </div>
          )}
          <div className="my-5 flex items-center gap-3 text-[9px] uppercase tracking-widest text-slate-600"><span className="h-px flex-1 bg-slate-800" />or join host<span className="h-px flex-1 bg-slate-800" /></div>
          <div className="flex gap-2">
            <input aria-label="Party code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="6-character code" autoCapitalize="characters" autoComplete="off" spellCheck={false} className="min-w-0 flex-1 border border-slate-700 bg-slate-900 px-3 py-2.5 font-mono text-xs uppercase tracking-widest text-white outline-none focus:border-cyan-300" />
            <button type="button" disabled={!code.trim() || busy} onClick={() => onJoin(code, name)} className="border border-cyan-300 bg-cyan-300 px-4 text-xs font-black uppercase text-slate-950 disabled:opacity-40">Join</button>
          </div>
          {status === "downloading" && <p className="mt-3 animate-pulse font-mono text-xs uppercase tracking-widest text-amber-300 motion-reduce:animate-none">Downloading Resources…</p>}
          {status === "connecting" && <p className="mt-3 font-mono text-xs text-cyan-300">Establishing peer connection…</p>}
          {error && <p role="alert" className="mt-3 border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">{error}</p>}
          <p className="mt-5 text-[10px] leading-relaxed text-slate-500">The host runs the authoritative match. Share the generated party code with other players.</p>
        </section>
      </div>
    );
  }

  if (!isMenuOpen) {
    return (
      <>
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={onOpenMenu}
          className="absolute left-3 top-3 z-40 border border-amber-300/55 bg-slate-950/88 px-4 py-3 font-mono text-[10px] font-black uppercase tracking-[0.2em] text-amber-100 shadow-[0_12px_32px_rgba(0,0,0,0.5),0_0_18px_rgba(251,191,36,0.12)] backdrop-blur-md transition hover:border-amber-200 hover:bg-amber-300/15 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-200 sm:left-5 sm:top-5"
        >
          ☰ Menu
        </button>
        <MobileTankControls onInputChange={onInputChange} />
      </>
    );
  }

  return (
    <aside
      role="dialog"
      aria-modal="true"
      aria-labelledby="pvp-menu-title"
      className="absolute inset-0 z-50 overflow-y-auto bg-[#03070d]/95 text-xs text-slate-100 backdrop-blur-md"
    >
      <div className="pointer-events-none fixed inset-0 opacity-20 [background-image:linear-gradient(rgba(251,191,36,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(251,191,36,0.12)_1px,transparent_1px)] [background-size:42px_42px]" />
      <div className="relative mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 py-5 sm:px-8 sm:py-8">
        <header className="flex items-center justify-between gap-4 border-b border-amber-300/25 pb-4">
          <div>
            <p className="font-mono text-[9px] font-bold uppercase tracking-[0.28em] text-amber-300/80">
              {isHost ? "Host online" : "Peer connected"}
            </p>
            <h2 id="pvp-menu-title" className="mt-1 text-2xl font-black uppercase tracking-[0.14em] text-white sm:text-4xl">
              Tank Arena
            </h2>
          </div>
          <button
            type="button"
            onClick={onCloseMenu}
            className="border border-amber-300/55 px-4 py-3 font-mono text-[10px] font-black uppercase tracking-[0.18em] text-amber-100 transition hover:bg-amber-300/15 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            Close ×
          </button>
        </header>

        <div className="grid flex-1 content-center gap-4 py-6 md:grid-cols-2">
          <section className="border border-slate-700/80 bg-slate-950/80 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.35)] sm:p-6">
            <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-slate-500">Party uplink</p>
            <p className="mt-1 font-bold uppercase tracking-wider text-slate-200">Invite code</p>
            <div className="mt-4 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate bg-black/35 px-3 py-3 text-base font-black tracking-[0.22em] text-cyan-200">{partyCode}</code>
              <button type="button" onClick={() => void navigator.clipboard.writeText(partyCode)} className="border border-cyan-300/50 px-3 py-3 text-[9px] font-bold uppercase text-cyan-200 hover:bg-cyan-300/10">Copy</button>
            </div>
            <p className="mt-4 hidden font-mono text-[9px] leading-relaxed text-slate-500 md:block">W/S DRIVE · A/D TURN · MOUSE AIM · ↑/↓ GEAR · SPACE FIRE</p>
            <p className="mt-4 font-mono text-[9px] leading-relaxed text-slate-500 md:hidden">JOYSTICK DRIVE · DRAG MAP TO AIM · TAP GEAR · HOLD FIRE</p>
            {localPlayer?.hp === 0 && (
              <p className="mt-4 border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-center font-mono text-xs text-rose-200">
                RESPAWN {Math.ceil(localPlayer.respawnIn)}s
              </p>
            )}
          </section>

          <section className="border border-slate-700/80 bg-slate-950/80 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.35)] sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-slate-500">Combat roster</p>
                <p className="mt-1 font-bold uppercase tracking-wider text-slate-200">Scoreboard</p>
              </div>
              <span className="font-mono text-2xl font-black text-amber-300">{players.length}</span>
            </div>
            <div className="mt-4 max-h-64 divide-y divide-slate-800 overflow-auto border border-slate-800">
              {[...players].sort((a, b) => b.score - a.score).map((player) => (
                <div key={player.id} className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold" style={{ color: player.color }}>
                      {player.name}{player.id === localPeerId ? " (you)" : ""}
                    </p>
                    <div className="mt-1.5 h-1 overflow-hidden bg-slate-800">
                      <div className="h-full" style={{ width: `${player.hp}%`, backgroundColor: player.color }} />
                    </div>
                  </div>
                  <div className="font-mono text-right">
                    <p className="text-sm font-black">{player.score}</p>
                    <p className="text-[8px] text-slate-600">K / {player.deaths} D</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <footer className="flex flex-col items-stretch justify-between gap-3 border-t border-amber-300/20 pt-4 sm:flex-row sm:items-center">
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-500">
            <span className="text-emerald-300">● Match connected</span>
            <span className="ml-3">Esc closes menu</span>
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onChangeMode} className="flex-1 border border-slate-600 px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-slate-300 hover:border-amber-300 hover:text-amber-100 sm:flex-none">Change game mode</button>
            <button type="button" onClick={onLeave} className="flex-1 border border-rose-400/40 px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-rose-200 hover:bg-rose-400/10 sm:flex-none">Leave party</button>
          </div>
        </footer>
      </div>
    </aside>
  );
};

export default TankPvpHud;
