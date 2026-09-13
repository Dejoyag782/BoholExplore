import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export interface RoamInput {
  forward: number;
  turn: number;
}

interface MobileRoamControlsProps {
  onInputChange: (input: RoamInput) => void;
}

const STICK_TRAVEL = 42;
const DEAD_ZONE = 0.12;
const IDLE_INPUT: RoamInput = { forward: 0, turn: 0 };

function MobileRoamControls({ onInputChange }: MobileRoamControlsProps) {
  const joystickRef = useRef<HTMLDivElement>(null);
  const activePointerRef = useRef<number | null>(null);
  const [stickPosition, setStickPosition] = useState({ x: 0, y: 0 });

  const updateJoystick = useCallback((clientX: number, clientY: number) => {
    const bounds = joystickRef.current?.getBoundingClientRect();
    if (!bounds) return;

    const rawX = clientX - (bounds.left + bounds.width / 2);
    const rawY = clientY - (bounds.top + bounds.height / 2);
    const distance = Math.hypot(rawX, rawY);
    const scale = distance > STICK_TRAVEL ? STICK_TRAVEL / distance : 1;
    const x = rawX * scale;
    const y = rawY * scale;
    const normalizedX = x / STICK_TRAVEL;
    const normalizedY = y / STICK_TRAVEL;

    setStickPosition({ x, y });
    onInputChange({
      forward: Math.abs(normalizedY) < DEAD_ZONE ? 0 : -normalizedY,
      turn: Math.abs(normalizedX) < DEAD_ZONE ? 0 : -normalizedX,
    });
  }, [onInputChange]);

  const stopJoystick = useCallback(() => {
    activePointerRef.current = null;
    setStickPosition({ x: 0, y: 0 });
    onInputChange(IDLE_INPUT);
  }, [onInputChange]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerRef.current !== null) return;
    event.preventDefault();
    event.stopPropagation();
    activePointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateJoystick(event.clientX, event.clientY);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    updateJoystick(event.clientX, event.clientY);
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    stopJoystick();
  };

  useEffect(() => () => onInputChange(IDLE_INPUT), [onInputChange]);

  return (
    <div
      className="pointer-events-none absolute bottom-0 left-0 z-40 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:hidden"
      aria-label="Mobile roam controls"
    >
      <div className="pointer-events-auto flex flex-col items-center gap-2">
        <div
          ref={joystickRef}
          role="application"
          aria-label="Drag to drive and steer"
          className="relative h-28 w-28 touch-none select-none rounded-full border-2 border-cyan-200/65 bg-slate-950/65 shadow-[0_0_24px_rgba(34,211,238,0.22)] backdrop-blur-sm"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onLostPointerCapture={handlePointerEnd}
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
    </div>
  );
}

export default MobileRoamControls;
