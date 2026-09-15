import type { MatchResult, UnitState } from "../../../game/rts";

type RtsHudProps = {
  units: UnitState[];
  selectedCount: number;
  matchResult: MatchResult;
  onChangeMode: () => void;
  onRematch: () => void;
};

const RtsHud = ({ units, selectedCount, matchResult, onChangeMode, onRematch }: RtsHudProps) => {
  const playerAlive = units.filter((unit) => unit.team === "player" && unit.alive).length;
  const enemyAlive = units.filter((unit) => unit.team === "enemy" && unit.alive).length;

  return (
    <>
      <aside className="absolute left-3 top-3 z-20 w-[min(21rem,calc(100vw-1.5rem))] border border-cyan-300/35 bg-slate-950/90 text-slate-100 shadow-2xl backdrop-blur-md [clip-path:polygon(0_0,calc(100%-14px)_0,100%_14px,100%_100%,14px_100%,0_calc(100%-14px))] sm:left-5 sm:top-5">
        <header className="flex items-center justify-between border-b border-cyan-300/20 bg-cyan-300/5 px-4 py-3">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.25em] text-cyan-300/70">Command Mode</p>
            <h2 className="mt-0.5 text-sm font-black uppercase tracking-[0.14em]">Battle Control</h2>
          </div>
          <button
            type="button"
            onClick={onChangeMode}
            className="border border-slate-600 px-2 py-1 font-mono text-[9px] uppercase text-slate-400 hover:border-cyan-300 hover:text-cyan-200 focus-visible:outline-2 focus-visible:outline-cyan-300"
          >
            Modes
          </button>
        </header>
        <div className="grid grid-cols-3 divide-x divide-slate-700 border-b border-slate-700">
          <div className="px-3 py-3 text-center">
            <p className="font-mono text-xl font-black text-cyan-300">{playerAlive}</p>
            <p className="text-[8px] uppercase tracking-widest text-slate-500">Blue alive</p>
          </div>
          <div className="px-3 py-3 text-center">
            <p className="font-mono text-xl font-black text-white">{selectedCount}</p>
            <p className="text-[8px] uppercase tracking-widest text-slate-500">Selected</p>
          </div>
          <div className="px-3 py-3 text-center">
            <p className="font-mono text-xl font-black text-rose-300">{enemyAlive}</p>
            <p className="text-[8px] uppercase tracking-widest text-slate-500">Red alive</p>
          </div>
        </div>
        <div className="space-y-1 px-4 py-3 font-mono text-[9px] uppercase tracking-wider text-slate-400">
          <div className="md:hidden">
            <p><span className="text-cyan-300">Tap blue</span> select units</p>
            <p><span className="text-emerald-300">Tap terrain</span> send selected</p>
            <p><span className="text-rose-300">Tap red</span> attack · drag map to pan</p>
          </div>
          <div className="hidden space-y-1 md:block">
            <p><span className="text-cyan-300">LMB</span> select · drag box · Shift add</p>
            <p><span className="text-rose-300">RMB</span> move formation / attack target</p>
            <p><span className="text-amber-300">MMB</span> pan · wheel zoom · Q/E rotate</p>
          </div>
        </div>
      </aside>

      {!matchResult && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-30 -translate-x-1/2 border border-cyan-300/35 bg-slate-950/85 px-4 py-2 text-center font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-cyan-100 shadow-xl backdrop-blur-sm md:hidden">
          {selectedCount > 0 ? "Tap terrain to send · Tap red to attack" : "Tap a blue unit to command"}
        </div>
      )}

      {matchResult && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-black/65 px-4 backdrop-blur-sm">
          <div className={`w-full max-w-md border bg-slate-950/95 p-8 text-center shadow-2xl ${matchResult === "victory" ? "border-emerald-300" : "border-rose-400"}`}>
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-slate-500">Skirmish complete</p>
            <h2 className={`mt-3 text-4xl font-black uppercase tracking-[0.15em] ${matchResult === "victory" ? "text-emerald-300" : "text-rose-300"}`}>
              {matchResult}
            </h2>
            <div className="mt-7 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={onRematch}
                className="border border-emerald-300 bg-emerald-300 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-950"
              >
                Rematch
              </button>
              <button
                type="button"
                onClick={onChangeMode}
                className="border border-slate-600 bg-slate-900 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-200"
              >
                Mode Menu
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default RtsHud;
