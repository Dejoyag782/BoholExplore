import './App.css'
import ProviderMap from './components/Map/ProviderMap'

function App() {
  return (
    <div className="h-screen bg-black">
      <ProviderMap coordinates={["123.910515,9.693235,1000"]} />

      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="landscape-required-title"
        aria-describedby="landscape-required-description"
        className="mobile-landscape-gate fixed inset-0 z-[9999] place-items-center overflow-hidden bg-[#03070d] px-8 text-center text-slate-100"
      >
        <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(34,211,238,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.12)_1px,transparent_1px)] [background-size:32px_32px]" />
        <div className="relative max-w-sm">
          <div className="mx-auto grid h-28 w-28 place-items-center rounded-full border border-cyan-300/30 bg-cyan-300/5 shadow-[0_0_40px_rgba(34,211,238,0.16)]">
            <div className="rotate-device-icon relative h-16 w-10 rounded-md border-2 border-cyan-200 bg-slate-950 shadow-[0_0_18px_rgba(103,232,249,0.35)]">
              <span className="absolute left-1/2 top-1 h-0.5 w-3 -translate-x-1/2 rounded-full bg-cyan-200/70" />
              <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-cyan-200/70" />
            </div>
            <span className="absolute ml-20 mt-16 text-3xl text-amber-300" aria-hidden="true">↻</span>
          </div>
          <p className="mt-7 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-cyan-300/75">Landscape required</p>
          <h1 id="landscape-required-title" className="mt-2 text-2xl font-black uppercase tracking-[0.12em] text-white">
            Rotate your device
          </h1>
          <p id="landscape-required-description" className="mt-3 text-sm leading-relaxed text-slate-400">
            Bohol Trips 3D is designed for landscape play. Turn your phone sideways to continue.
          </p>
        </div>
      </section>
    </div>
  )
}

export default App
