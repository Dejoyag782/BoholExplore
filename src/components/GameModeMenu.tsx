import { useState } from "react";
import type { GameMode } from "../game/rts";

type GameModeMenuProps = {
  currentMode: GameMode | null;
  onStart: (mode: GameMode) => void;
};

const modes: Array<{
  id: GameMode;
  number: string;
  title: string;
  subtitle: string;
  description: string;
  controls: string;
}> = [
  {
    id: "roam",
    number: "01",
    title: "Roam",
    subtitle: "Open-world traversal",
    description: "Drive Bohol terrain, launch from ridges, and run checkpoint routes.",
    controls: "WASD · AUTO AIR · ROUTE COMMAND",
  },
  {
    id: "command",
    number: "02",
    title: "Command",
    subtitle: "Tactical skirmish",
    description: "Lead a three-unit squad against a guarded enemy strike team.",
    controls: "SELECT · FORMATION MOVE · TARGET ATTACK",
  },
  {
    id: "pvp",
    number: "03",
    title: "Tank PvP",
    subtitle: "Peer-to-peer arena",
    description: "Host one authoritative party and battle other players over PeerJS.",
    controls: "HOST / JOIN · WASD · SPACE TO FIRE",
  },
];

const GameModeMenu = ({ currentMode, onStart }: GameModeMenuProps) => {
  const [selectedMode, setSelectedMode] = useState<GameMode>(currentMode ?? "roam");

  return (
    <div className="absolute inset-0 z-50 grid place-items-center overflow-auto bg-[#03070d]/92 px-4 py-8 text-slate-100 backdrop-blur-md">
      <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(34,211,238,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.12)_1px,transparent_1px)] [background-size:42px_42px]" />
      <div className="relative w-full max-w-4xl">
        <div className="mb-8 flex items-end justify-between gap-4 border-b border-cyan-300/25 pb-4">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.35em] text-cyan-300/70">
              Bohol Tactical Network
            </p>
            <h1 className="mt-2 text-3xl font-black uppercase tracking-[0.13em] text-white sm:text-5xl">
              Select Mode
            </h1>
          </div>
          <div className="hidden text-right font-mono text-[9px] uppercase tracking-[0.2em] text-slate-500 sm:block">
            <p>Terrain mesh online</p>
            <p className="mt-1 text-emerald-300">Systems ready</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {modes.map((mode) => {
            const selected = mode.id === selectedMode;
            return (
              <button
                key={mode.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setSelectedMode(mode.id)}
                className={`group relative min-h-64 overflow-hidden border p-5 text-left transition focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-300 [clip-path:polygon(0_0,calc(100%-18px)_0,100%_18px,100%_100%,18px_100%,0_calc(100%-18px))] ${
                  selected
                    ? "border-cyan-300 bg-cyan-300/10 shadow-[0_0_32px_rgba(34,211,238,0.14)]"
                    : "border-slate-700 bg-slate-950/80 hover:border-slate-500 hover:bg-slate-900/90"
                }`}
              >
                <span className={`font-mono text-5xl font-black ${selected ? "text-cyan-300/20" : "text-slate-800"}`}>
                  {mode.number}
                </span>
                <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">
                  {mode.subtitle}
                </p>
                <h2 className="mt-1 text-2xl font-black uppercase tracking-[0.14em] text-white">
                  {mode.title}
                </h2>
                <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-400">{mode.description}</p>
                <p className={`absolute inset-x-6 bottom-5 font-mono text-[9px] font-bold tracking-[0.13em] ${selected ? "text-cyan-200" : "text-slate-600"}`}>
                  {mode.controls}
                </p>
                {selected && <span className="absolute right-5 top-5 h-2 w-2 bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,1)]" />}
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-slate-600">
            Escape opens mode selector · Simulation pauses in menu
          </p>
          <button
            type="button"
            onClick={() => onStart(selectedMode)}
            className="border border-emerald-300 bg-emerald-300 px-8 py-3 text-xs font-black uppercase tracking-[0.22em] text-slate-950 shadow-[0_0_24px_rgba(110,231,183,0.2)] transition hover:bg-emerald-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            {currentMode ? "Resume Mode" : "Initialize"} ▶
          </button>
        </div>
      </div>
    </div>
  );
};

export default GameModeMenu;
