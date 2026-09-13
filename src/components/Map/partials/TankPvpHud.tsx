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
  onHost: (name: string) => void;
  onBeginSpawnSelection: () => void;
  onCancelSpawnSelection: () => void;
  onJoin: (code: string, name: string) => void;
  onLeave: () => void;
  onChangeMode: () => void;
  onInputChange: (input: TankInput) => void;
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
  onHost,
  onBeginSpawnSelection,
  onCancelSpawnSelection,
  onJoin,
  onLeave,
  onChangeMode,
  onInputChange,
}: TankPvpHudProps) => {
  const [name, setName] = useState(() => `Player ${Math.floor(Math.random() * 900 + 100)}`);
  const [code, setCode] = useState("");
  const [isMobileHudMinimized, setIsMobileHudMinimized] = useState(true);
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

  return (
    <>
      <aside className={`absolute left-3 top-3 z-30 max-h-[calc(100vh-11rem)] overflow-y-auto overscroll-contain border border-amber-300/40 bg-slate-950/92 text-slate-100 shadow-2xl backdrop-blur-md sm:left-5 sm:top-5 md:max-h-none md:w-[min(22rem,calc(100vw-1.5rem))] md:overflow-visible ${isMobileHudMinimized ? "w-auto" : "w-[min(22rem,calc(100vw-1.5rem))]"}`}>
      <header className="flex items-center justify-between border-b border-amber-300/20 px-4 py-3">
        <div><p className="text-[9px] font-bold uppercase tracking-[0.24em] text-amber-300">{isHost ? "Host online" : "Peer connected"}</p><h2 className="text-sm font-black uppercase tracking-wider">Tank Arena</h2></div>
        <div className="ml-4 flex items-center gap-2">
          <button
            type="button"
            aria-expanded={!isMobileHudMinimized}
            aria-label={isMobileHudMinimized ? "Expand tank menu" : "Minimize tank menu"}
            onClick={() => setIsMobileHudMinimized((minimized) => !minimized)}
            className="border border-amber-300/45 px-2 py-1 font-mono text-[9px] uppercase text-amber-200 md:hidden"
          >
            {isMobileHudMinimized ? "Show ▾" : "Hide ▴"}
          </button>
          <button type="button" onClick={onChangeMode} className="border border-slate-600 px-2 py-1 font-mono text-[9px] uppercase">Modes</button>
        </div>
      </header>
      <div className={isMobileHudMinimized ? "hidden md:block" : "block"}>
      <div className="border-b border-slate-700 px-4 py-3">
        <div className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate bg-black/35 px-2 py-2 text-sm font-black tracking-[0.22em] text-cyan-200">{partyCode}</code><button type="button" onClick={() => void navigator.clipboard.writeText(partyCode)} className="border border-cyan-300/50 px-2 py-2 text-[9px] font-bold uppercase text-cyan-200">Copy</button></div>
        <p className="mt-2 hidden font-mono text-[9px] text-slate-500 md:block">W/S DRIVE · A/D TURN · SPACE FIRE</p>
        <p className="mt-2 font-mono text-[9px] text-slate-500 md:hidden">JOYSTICK DRIVE · HOLD FIRE</p>
      </div>
      <div className="max-h-56 divide-y divide-slate-800 overflow-auto">
        {[...players].sort((a, b) => b.score - a.score).map((player) => (
          <div key={player.id} className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-2.5">
            <div className="min-w-0"><p className="truncate text-xs font-bold" style={{ color: player.color }}>{player.name}{player.id === localPeerId ? " (you)" : ""}</p><div className="mt-1 h-1 overflow-hidden bg-slate-800"><div className="h-full" style={{ width: `${player.hp}%`, backgroundColor: player.color }} /></div></div>
            <div className="font-mono text-right"><p className="text-sm font-black">{player.score}</p><p className="text-[8px] text-slate-600">K / {player.deaths} D</p></div>
          </div>
        ))}
      </div>
      {localPlayer?.hp === 0 && <p className="border-t border-rose-400/30 bg-rose-400/10 px-4 py-2 text-center font-mono text-xs text-rose-200">RESPAWN {Math.ceil(localPlayer.respawnIn)}s</p>}
      <button type="button" onClick={onLeave} className="w-full border-t border-slate-700 px-4 py-2 text-[9px] font-bold uppercase tracking-widest text-slate-500 hover:text-rose-300">Leave party</button>
      </div>
      </aside>
      <MobileTankControls onInputChange={onInputChange} />
    </>
  );
};

export default TankPvpHud;
