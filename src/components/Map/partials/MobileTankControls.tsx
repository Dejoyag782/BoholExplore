import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { TankInput } from "../../../game/tankPvp";

interface MobileTankControlsProps {
  onInputChange: (input: TankInput) => void;
}

const STICK_TRAVEL = 42;
const DEAD_ZONE = 0.12;

const MobileTankControls = ({ onInputChange }: MobileTankControlsProps) => {
  const joystickRef = useRef<HTMLDivElement>(null);
  const joystickPointerRef = useRef<number | null>(null);
  const firePointerRef = useRef<number | null>(null);
  const inputRef = useRef<TankInput>({ forward: 0, turn: 0, firing: false });
  const [stickPosition, setStickPosition] = useState({ x: 0, y: 0 });
  const [isFiring, setIsFiring] = useState(false);

  const publishInput = useCallback((patch: Partial<TankInput>) => {
    inputRef.current = { ...inputRef.current, ...patch };
    onInputChange(inputRef.current);
  }, [onInputChange]);

  const updateJoystick = useCallback((clientX: number, clientY: number) => {
    const bounds = joystickRef.current?.getBoundingClientRect();
    if (!bounds) return;

    const rawX = clientX - (bounds.left + bounds.width / 2);
    const rawY = clientY - (bounds.top + bounds.height / 2);
    const distance = Math.hypot(rawX, rawY);
    const scale = distance > STICK_TRAVEL ? STICK_TRAVEL / distance : 1;
    const x = rawX * scale;
    const y = rawY * scale;
    const turn = Math.abs(x / STICK_TRAVEL) < DEAD_ZONE ? 0 : -(x / STICK_TRAVEL);
    const forward = Math.abs(y / STICK_TRAVEL) < DEAD_ZONE ? 0 : -(y / STICK_TRAVEL);

    setStickPosition({ x, y });
    publishInput({ forward, turn });
  }, [publishInput]);

  const stopJoystick = useCallback(() => {
    joystickPointerRef.current = null;
    setStickPosition({ x: 0, y: 0 });
    publishInput({ forward: 0, turn: 0 });
  }, [publishInput]);

  const handleJoystickDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (joystickPointerRef.current !== null) return;
    event.preventDefault();
    event.stopPropagation();
    joystickPointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateJoystick(event.clientX, event.clientY);
  };

  const handleJoystickMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (joystickPointerRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    updateJoystick(event.clientX, event.clientY);
  };

  const handleJoystickEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (joystickPointerRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    stopJoystick();
  };

  const stopFiring = useCallback(() => {
    if (firePointerRef.current === null) return;
    firePointerRef.current = null;
    setIsFiring(false);
    publishInput({ firing: false });
  }, [publishInput]);

  const handleFireDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (firePointerRef.current !== null) return;
    event.preventDefault();
    event.stopPropagation();
    firePointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsFiring(true);
    publishInput({ firing: true });
  };

  const handleFireEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (firePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    stopFiring();
  };

  useEffect(() => () => {
    onInputChange({ forward: 0, turn: 0, firing: false });
  }, [onInputChange]);

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex items-end justify-between px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:hidden"
      aria-label="Mobile tank controls"
    >
      <div className="pointer-events-auto flex flex-col items-center gap-2">
        <div
          ref={joystickRef}
          role="application"
          aria-label="Drag to drive and turn"
          className="relative h-28 w-28 touch-none select-none rounded-full border-2 border-cyan-200/65 bg-slate-950/65 shadow-[0_0_24px_rgba(34,211,238,0.22)] backdrop-blur-sm"
          onPointerDown={handleJoystickDown}
          onPointerMove={handleJoystickMove}
          onPointerUp={handleJoystickEnd}
          onPointerCancel={handleJoystickEnd}
          onLostPointerCapture={handleJoystickEnd}
          onContextMenu={(event) => event.preventDefault()}
        >
          <span className="absolute left-1/2 top-2 -translate-x-1/2 text-[9px] font-black text-cyan-100/65">▲</span>
          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[9px] font-black text-cyan-100/65">▼</span>
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] font-black text-cyan-100/65">◀</span>
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-black text-cyan-100/65">▶</span>
          <span
            className="absolute left-1/2 top-1/2 h-12 w-12 rounded-full border border-cyan-100 bg-cyan-300/35 shadow-[0_0_18px_rgba(103,232,249,0.5)]"
            style={{ transform: `translate(calc(-50% + ${stickPosition.x}px), calc(-50% + ${stickPosition.y}px))` }}
          />
        </div>
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-cyan-100 drop-shadow-md">Drive</span>
      </div>

      <div className="pointer-events-auto flex flex-col items-center gap-2">
        <button
          type="button"
          aria-label="Hold to fire"
          aria-pressed={isFiring}
          className={`h-24 w-24 touch-none select-none rounded-full border-2 font-black uppercase tracking-widest shadow-2xl backdrop-blur-sm transition-colors ${
            isFiring
              ? "border-amber-100 bg-amber-300 text-slate-950 shadow-[0_0_28px_rgba(251,191,36,0.6)]"
              : "border-amber-300/75 bg-slate-950/70 text-amber-200 shadow-[0_0_22px_rgba(251,191,36,0.22)]"
          }`}
          onPointerDown={handleFireDown}
          onPointerUp={handleFireEnd}
          onPointerCancel={handleFireEnd}
          onLostPointerCapture={handleFireEnd}
          onContextMenu={(event) => event.preventDefault()}
        >
          Fire
        </button>
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-amber-100 drop-shadow-md">Hold</span>
      </div>
    </div>
  );
};

export default MobileTankControls;
