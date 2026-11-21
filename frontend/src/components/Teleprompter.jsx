import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Guitar, Maximize2, Minus, Pause, Play, Plus, RotateCcw, X } from 'lucide-react'
import LyricsView from './LyricsView'
import { hasChords } from '../lib/chordpro'

const FONT = { min: 16, max: 72, step: 2, def: 26 }
const SPEED = { min: 4, max: 60, step: 2, def: 14 } // righe al minuto
const LINE_HEIGHT = 1.5
const HIDE_AFTER_MS = 3000

function readNumber(key, { min, max, def }) {
  try {
    const n = Number(localStorage.getItem(key))
    return Number.isFinite(n) && n >= min && n <= max ? n : def
  } catch {
    return def
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // archivio non disponibile (navigazione privata): le preferenze valgono solo per questa apertura
  }
}

const clamp = (n, { min, max }) => Math.min(max, Math.max(min, n))

/** Testo a tutto schermo con scorrimento automatico. Tocco = avvia/pausa. */
export default function Teleprompter({ song, onClose, storageId = song.id }) {
  const speedKey = `band_tp_speed_${storageId}`
  const [fontSize, setFontSize] = useState(() => readNumber('band_tp_font', FONT))
  const [speed, setSpeed] = useState(() => readNumber(speedKey, SPEED))
  const [showChords, setShowChords] = useState(() => {
    try {
      return localStorage.getItem('band_tp_chords') !== '0'
    } catch {
      return true
    }
  })
  const [playing, setPlaying] = useState(false)
  const [uiVisible, setUiVisible] = useState(true)

  const rootRef = useRef(null)
  const scrollRef = useRef(null)
  const posRef = useRef(0) // posizione frazionaria: scrollTop da solo perde i decimali
  const touchingRef = useRef(false)
  const speedRef = useRef(speed)
  const fontRef = useRef(fontSize)
  const ratioRef = useRef(null)
  const hideTimer = useRef(null)

  const withChords = useMemo(() => hasChords(song.lyrics), [song.lyrics])

  speedRef.current = speed
  fontRef.current = fontSize

  // Schermo acceso e pagina sotto ferma. Lo schermo intero nativo del browser NON parte da solo:
  // su telefono mostra un avviso che copre i comandi; resta a richiesta (pulsante), dove esiste.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    let lock = null
    let alive = true
    async function acquire() {
      try {
        if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return
        const l = await navigator.wakeLock.request('screen')
        if (alive) lock = l
        else l.release().catch(() => {})
      } catch {
        // rifiutato (batteria scarica, browser non compatibile)
      }
    }
    acquire()
    const onVisible = () => {
      if (document.visibilityState === 'visible') acquire()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
      lock?.release().catch(() => {})
      document.body.style.overflow = prevOverflow
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    }
  }, [])

  // Scorrimento
  useEffect(() => {
    if (!playing) return undefined
    const el = scrollRef.current
    posRef.current = el.scrollTop
    let last = performance.now()
    let raf = 0
    const step = (now) => {
      const dt = Math.min(now - last, 100) / 1000
      last = now
      if (touchingRef.current) {
        posRef.current = el.scrollTop // il dito comanda: si riparte da dove lascia
      } else {
        // Uno scorrimento non nostro (inerzia, rotella) sposta il punto di ripartenza
        if (Math.abs(el.scrollTop - posRef.current) > 2) posRef.current = el.scrollTop
        posRef.current += ((speedRef.current * fontRef.current * LINE_HEIGHT) / 60) * dt
        const max = el.scrollHeight - el.clientHeight
        if (posRef.current >= max) {
          el.scrollTop = max
          setPlaying(false)
          setUiVisible(true)
          return
        }
        el.scrollTop = posRef.current
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  // I comandi spariscono mentre scorre
  function armHide() {
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setUiVisible(false), HIDE_AFTER_MS)
  }
  useEffect(() => {
    clearTimeout(hideTimer.current)
    if (playing) armHide()
    else setUiVisible(true)
    return () => clearTimeout(hideTimer.current)
  }, [playing])

  function touchUi() {
    setUiVisible(true)
    if (playing) armHide()
  }

  function toggle() {
    const el = scrollRef.current
    // In fondo: il tocco ricomincia da capo
    if (!playing && el && el.scrollTop >= el.scrollHeight - el.clientHeight - 2) {
      el.scrollTop = 0
      posRef.current = 0
    }
    setPlaying((p) => !p)
  }

  const canNativeFullscreen = typeof document !== 'undefined' && document.fullscreenEnabled === true

  function toggleNativeFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
      else rootRef.current?.requestFullscreen?.()?.catch?.(() => {})
    } catch {
      // non disponibile
    }
    touchUi()
  }

  function restart() {
    const el = scrollRef.current
    if (el) el.scrollTop = 0
    posRef.current = 0
    touchUi()
  }

  function changeSpeed(delta) {
    setSpeed((s) => {
      const next = clamp(s + delta, SPEED)
      store(speedKey, next)
      return next
    })
    touchUi()
  }

  // Cambiando i caratteri si resta sullo stesso punto del testo
  function keepPlace() {
    const el = scrollRef.current
    if (el && el.scrollHeight > 0) ratioRef.current = el.scrollTop / el.scrollHeight
  }

  function changeFont(delta) {
    keepPlace()
    setFontSize((f) => {
      const next = clamp(f + delta, FONT)
      store('band_tp_font', next)
      return next
    })
    touchUi()
  }

  function toggleChords() {
    keepPlace()
    setShowChords((v) => {
      store('band_tp_chords', v ? '0' : '1')
      return !v
    })
    touchUi()
  }

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && ratioRef.current !== null) {
      el.scrollTop = ratioRef.current * el.scrollHeight
      posRef.current = el.scrollTop
      ratioRef.current = null
    }
  }, [fontSize, showChords])

  // Tastiera (tablet con tastiera, PC)
  useEffect(() => {
    function onKey(e) {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        toggle()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        changeSpeed(SPEED.step)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        changeSpeed(-SPEED.step)
      } else if (e.key === '+' || e.key === '=') {
        changeFont(FONT.step)
      } else if (e.key === '-') {
        changeFont(-FONT.step)
      } else if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const btn = 'flex items-center justify-center w-11 h-11 rounded-xl bg-gray-800 active:bg-gray-700 text-gray-100'

  return (
    <div ref={rootRef} className="fixed inset-0 z-50 bg-black text-gray-100 select-none">
      <div
        ref={scrollRef}
        onClick={toggle}
        onTouchStart={() => { touchingRef.current = true }}
        onTouchEnd={() => { touchingRef.current = false }}
        onTouchCancel={() => { touchingRef.current = false }}
        className="absolute inset-0 overflow-y-auto overscroll-contain"
      >
        {/* Mezza schermata vuota prima e dopo: la prima riga parte a metà schermo, l'ultima ci arriva */}
        <div style={{ height: '40vh' }} className="flex items-end justify-center pb-6">
          <div className="text-center px-5">
            <p className="text-gray-400 text-lg font-semibold">{song.title}</p>
            {song.artist && <p className="text-gray-600 text-sm">{song.artist}</p>}
          </div>
        </div>
        <LyricsView
          text={song.lyrics}
          fontSize={fontSize}
          showChords={showChords}
          className="px-5 mx-auto max-w-4xl font-sans"
        />
        <div style={{ height: '65vh' }} />
      </div>

      <div
        className={`absolute inset-x-0 bottom-0 bg-gray-950/95 border-t border-gray-800 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-opacity duration-300 ${
          uiVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-center text-[11px] text-gray-500 mb-2">Tocca il testo per avviare o fermare</p>
        <div className="mx-auto max-w-xl flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <button className={btn} onClick={() => changeSpeed(-SPEED.step)} aria-label="Più lento">
              <Minus className="w-5 h-5" />
            </button>
            <div className="w-16 text-center leading-tight">
              <p className="text-base font-semibold tabular-nums">{speed}</p>
              <p className="text-[10px] text-gray-500">righe/min</p>
            </div>
            <button className={btn} onClick={() => changeSpeed(SPEED.step)} aria-label="Più veloce">
              <Plus className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button className={`${btn} text-sm font-semibold`} onClick={() => changeFont(-FONT.step)} aria-label="Caratteri più piccoli">
              A−
            </button>
            <div className="w-10 text-center leading-tight">
              <p className="text-base font-semibold tabular-nums">{fontSize}</p>
              <p className="text-[10px] text-gray-500">px</p>
            </div>
            <button className={`${btn} text-lg font-semibold`} onClick={() => changeFont(FONT.step)} aria-label="Caratteri più grandi">
              A+
            </button>
          </div>

          <div className="flex items-center gap-2 w-full justify-between sm:w-auto">
            <button className={btn} onClick={onClose} aria-label="Chiudi">
              <X className="w-5 h-5" />
            </button>
            <button className={btn} onClick={restart} aria-label="Ricomincia">
              <RotateCcw className="w-5 h-5" />
            </button>
            {canNativeFullscreen && (
              <button className={btn} onClick={toggleNativeFullscreen} aria-label="Schermo intero del browser">
                <Maximize2 className="w-5 h-5" />
              </button>
            )}
            {withChords && (
              <button
                className={`${btn} ${showChords ? '!bg-amber-500/20 !text-amber-400' : 'text-gray-500'}`}
                onClick={toggleChords}
                aria-label={showChords ? 'Nascondi accordi' : 'Mostra accordi'}
                aria-pressed={showChords}
              >
                <Guitar className="w-5 h-5" />
              </button>
            )}
            <button
              className="flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-brand-600 active:bg-brand-700 text-white font-semibold text-sm"
              onClick={() => { toggle(); touchUi() }}
            >
              {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
              {playing ? 'Pausa' : 'Avvia'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
