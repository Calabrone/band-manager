import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Camera, Loader2, RefreshCw, Save, Wand2 } from 'lucide-react'
import client from '../api/client'
import ConfirmDialog from '../components/ConfirmDialog'
import ChordPicker from '../components/ChordPicker'
import LyricsView from '../components/LyricsView'
import { fromChordSheet, hasChordSheetLines, normalizeText, parse, setChord, usedChords } from '../lib/chordpro'

const MAX_CHARS = 30000
const SCAN_MAX_SIDE = 2000
const SCAN_MAX_BYTES = 4 * 1024 * 1024

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Immagine non leggibile'))
    }
    img.src = url
  })
}

// Le foto dei telefoni pesano troppo: lato lungo a 2000 px e JPEG, abbassando la qualità finché serve
async function shrinkImage(file) {
  const img = await loadImage(file)
  const scale = Math.min(1, SCAN_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  for (const quality of [0.85, 0.7, 0.5]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (blob && blob.size <= SCAN_MAX_BYTES) return blob
  }
  throw new Error('Immagine troppo grande')
}

export default function LyricsEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const fileRef = useRef(null)

  const [song, setSong] = useState(null)
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [original, setOriginal] = useState('')
  const [mode, setMode] = useState('text') // 'text' | 'chords'
  const [target, setTarget] = useState(null) // parola toccata in modalità accordi
  const [ocrAvailable, setOcrAvailable] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState(null) // testo letto dalla foto, in attesa di "sostituisci o aggiungi"
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmLeave, setConfirmLeave] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([client.get(`/songs/${id}`), client.get('/config')])
      .then(([songRes, configRes]) => {
        if (cancelled) return
        setSong(songRes.data)
        const lyrics = songRes.data.lyrics || ''
        setText(lyrics)
        setOriginal(lyrics)
        setOcrAvailable(Boolean(configRes.data.ocr_available))
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [id])

  const dirty = text !== original
  const used = useMemo(() => usedChords(text), [text])
  const sheetLines = useMemo(() => hasChordSheetLines(text), [text])

  // Chiusura della scheda o ricarica con modifiche non salvate
  useEffect(() => {
    if (!dirty) return undefined
    const warn = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function leave() {
    if (dirty) setConfirmLeave(true)
    else navigate(-1)
  }

  async function handleSave() {
    setError('')
    setSaving(true)
    try {
      await client.put(`/songs/${id}/lyrics`, { lyrics: text })
      navigate(`/songs/${id}`, { replace: true })
    } catch (err) {
      setError(err.response?.data?.detail || 'Errore durante il salvataggio')
      setSaving(false)
    }
  }

  async function handleScan(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // la stessa foto si può riscegliere
    if (!file) return
    setError('')
    setNotice('')
    setScanning(true)
    try {
      const blob = await shrinkImage(file)
      const form = new FormData()
      form.append('image', blob, 'scan.jpg')
      const { data } = await client.post(`/songs/${id}/lyrics/ocr`, form, { timeout: 120000 })
      // Rete di sicurezza: accordi all'italiana o rimasti sulla riga sopra
      const result = normalizeText(fromChordSheet(data.text))
      if (text.trim() === '') applyScan(result, 'replace')
      else setScanned(result)
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Scansione non riuscita')
    } finally {
      setScanning(false)
    }
  }

  function applyScan(result, how) {
    const next = how === 'append' ? `${text.replace(/\s+$/, '')}\n\n${result}` : result
    setText(next.slice(0, MAX_CHARS))
    setScanned(null)
    setMode('text')
    setNotice('Testo letto dalla foto: controllalo e correggilo prima di salvare.')
  }

  function wordAt(t) {
    const line = parse(text)[t.line]
    return line?.words?.[t.word]?.parts.map((p) => p.text).join('') || ''
  }

  function pickChord(chord) {
    setText((prev) => setChord(prev, target.line, target.word, chord, target.part))
    setTarget(null)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <RefreshCw className="w-6 h-6 text-gray-600 animate-spin" />
      </div>
    )
  }

  if (!song) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">Brano non trovato</div>
  }

  const tab = (value, label) => (
    <button
      onClick={() => setMode(value)}
      className={`flex-1 py-3 text-sm font-medium transition-colors ${
        mode === value ? 'text-brand-400 border-b-2 border-brand-500' : 'text-gray-400'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="min-h-screen pb-28">
      <header className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur border-b border-gray-800">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={leave} className="p-1 text-gray-400 hover:text-gray-200" aria-label="Indietro">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold text-white truncate">Testo e accordi</h1>
            <p className="text-xs text-gray-400 truncate">{song.title} — {song.artist}</p>
          </div>
        </div>
        <div className="flex">
          {tab('text', 'Testo')}
          {tab('chords', 'Accordi')}
        </div>
      </header>

      <div className="p-4 space-y-3">
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {notice && <p className="text-amber-300 text-sm">{notice}</p>}

        {mode === 'text' ? (
          <>
            <div className="flex flex-wrap gap-2">
              {ocrAvailable && (
                <>
                  <input ref={fileRef} type="file" accept="image/*" onChange={handleScan} className="hidden" />
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={scanning}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-800 border border-gray-700 text-gray-200 text-sm font-medium disabled:opacity-60"
                  >
                    {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                    {scanning ? 'Lettura della foto…' : 'Scansiona foto'}
                  </button>
                </>
              )}
              {sheetLines && (
                <button
                  onClick={() => setText((prev) => normalizeText(fromChordSheet(prev)))}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-sm font-medium"
                >
                  <Wand2 className="w-4 h-4" />
                  Porta gli accordi nel testo
                </button>
              )}
            </div>
            {sheetLines && (
              <p className="text-xs text-gray-500">
                Ci sono righe di soli accordi scritte sopra il testo: il pulsante le sposta sulle parole sottostanti.
              </p>
            )}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={MAX_CHARS}
              rows={18}
              spellCheck={false}
              placeholder={'Scrivi o incolla il testo.\n\nGli accordi vanno tra parentesi quadre prima della sillaba:\n[Am]Quando sei [G]qui\n\nLe sezioni su una riga a sé:\n[Ritornello]'}
              className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 text-base font-mono leading-relaxed"
            />
            <p className="text-xs text-gray-500">
              Per mettere gli accordi senza scrivere le parentesi passa alla scheda <span className="text-gray-300">Accordi</span>.
            </p>
          </>
        ) : text.trim() === '' ? (
          <p className="text-sm text-gray-500 italic">Prima inserisci il testo nella scheda Testo.</p>
        ) : (
          <>
            <p className="text-xs text-gray-500">
              Tocca una parola per mettere l'accordo; tocca un accordo già messo per cambiarlo o toglierlo.
            </p>
            <LyricsView
              text={text}
              fontSize={18}
              className="text-gray-200"
              onWordClick={(line, word, part, chord) => setTarget({ line, word, part, chord })}
            />
          </>
        )}
      </div>

      <div className="fixed bottom-0 inset-x-0 z-10 bg-gray-950/95 backdrop-blur border-t border-gray-800 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-base transition disabled:opacity-50"
        >
          <Save className="w-5 h-5" />
          {saving ? 'Salvataggio…' : dirty ? 'Salva' : 'Nessuna modifica'}
        </button>
      </div>

      {target && (
        <ChordPicker
          current={target.chord}
          used={used}
          word={wordAt(target)}
          onPick={pickChord}
          onClose={() => setTarget(null)}
        />
      )}

      {scanned !== null && (
        <ConfirmDialog
          title="C'è già un testo"
          message="Vuoi sostituirlo con quello letto dalla foto o aggiungerlo in coda (pagina successiva)?"
          cancelLabel="Aggiungi in coda"
          confirmLabel="Sostituisci"
          onCancel={() => applyScan(scanned, 'append')}
          onConfirm={() => applyScan(scanned, 'replace')}
        />
      )}

      {confirmLeave && (
        <ConfirmDialog
          title="Modifiche non salvate"
          message="Uscendo perdi le modifiche al testo."
          cancelLabel="Resta"
          confirmLabel="Esci senza salvare"
          onCancel={() => setConfirmLeave(false)}
          onConfirm={() => navigate(-1)}
        />
      )}
    </div>
  )
}
