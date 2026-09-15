interface GearPreset {
  label: string;
  value: number;
}

interface GearShiftProps {
  gears: readonly GearPreset[];
  activeIndex: number;
  onChange: (index: number) => void;
  position?: "right" | "center" | "right-raised";
}

function GearShift({ gears, activeIndex, onChange, position = "right" }: GearShiftProps) {
  const activeGear = gears[activeIndex];

  return (
    <aside
      aria-label="Gear shift"
      className={`pointer-events-auto absolute z-40 select-none text-slate-100 ${
        position === "center"
          ? "bottom-40 left-1/2 -translate-x-1/2 md:bottom-5"
          : position === "right-raised"
            ? "bottom-40 right-4 md:bottom-5 md:right-5"
            : "bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-4 sm:bottom-5 sm:right-5"
      }`}
    >
      <div className="w-24 border border-amber-300/35 bg-slate-950/88 p-2 shadow-[0_16px_40px_rgba(0,0,0,0.55),0_0_24px_rgba(252,211,77,0.12)] backdrop-blur-md [clip-path:polygon(0_0,calc(100%-10px)_0,100%_10px,100%_100%,10px_100%,0_calc(100%-10px))] sm:w-28">
        <div className="mb-2 flex items-center justify-between border-b border-amber-300/20 pb-2">
          <span className="font-mono text-[8px] font-bold uppercase tracking-[0.18em] text-amber-200/70">
            Gear
          </span>
          <strong className="font-mono text-lg leading-none text-amber-200" aria-live="polite">
            {activeIndex + 1}
          </strong>
        </div>

        <div className="relative grid grid-cols-2 gap-1.5 rounded-sm border border-slate-700 bg-black/45 p-1.5 before:pointer-events-none before:absolute before:inset-y-2 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-slate-600/80">
          {gears.map((gear, index) => {
            const selected = index === activeIndex;
            return (
              <button
                key={gear.label}
                type="button"
                aria-label={`Shift to ${gear.label}`}
                aria-pressed={selected}
                onClick={() => onChange(index)}
                className={`relative z-10 grid min-h-9 place-items-center border font-mono text-xs font-black transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 sm:min-h-10 ${
                  selected
                    ? "border-amber-200 bg-amber-300 text-slate-950 shadow-[0_0_14px_rgba(252,211,77,0.45)]"
                    : "border-slate-700 bg-slate-900 text-slate-400 hover:border-amber-300/60 hover:text-amber-100"
                }`}
              >
                {index + 1}
              </button>
            );
          })}
        </div>

        <p className="mt-2 hidden text-center font-mono text-[7px] uppercase tracking-wider text-slate-500 md:block">
          ↑ / ↓ to shift
        </p>
        <p className="mt-2 truncate text-center font-mono text-[7px] uppercase tracking-wider text-slate-500 md:hidden">
          Tap to shift
        </p>
        <span className="sr-only">{activeGear?.value ?? 0} speed units</span>
      </div>
    </aside>
  );
}

export default GearShift;
