import { useMemo } from 'react'
import { parse, stripChords } from '../lib/chordpro'

/**
 * Testo del brano con gli accordi sopra le parole. Ogni parola è un blocco che va a capo intero
 * portandosi dietro il suo accordo; la riga degli accordi esiste solo nelle righe che ne hanno.
 * Con onWordClick le parole diventano toccabili (editor): (riga, parola, parte, accordo attuale).
 */
export default function LyricsView({ text, fontSize, showChords = true, onWordClick, className = '' }) {
  const lines = useMemo(() => parse(showChords ? text : stripChords(text)), [text, showChords])
  const editable = typeof onWordClick === 'function'

  return (
    <div className={className} style={fontSize ? { fontSize: `${fontSize}px` } : undefined}>
      {lines.map((line, li) => {
        if (line.type === 'empty') {
          return <div key={li} style={{ height: '0.9em' }} />
        }
        if (line.type === 'section') {
          return (
            <div
              key={li}
              className="font-semibold uppercase tracking-wider text-gray-500"
              style={{ fontSize: '0.6em', marginTop: '0.8em', marginBottom: '0.2em' }}
            >
              {line.label}
            </div>
          )
        }
        const chordRow = line.hasChords
        return (
          <div
            key={li}
            className="flex flex-wrap items-end"
            style={{ columnGap: '0.28em', lineHeight: chordRow ? 1.25 : 1.5, marginTop: chordRow ? '0.25em' : 0 }}
          >
            {line.words.map((word, wi) => (
              <span key={wi} className="inline-flex items-end">
                {word.parts.map((part, pi) => {
                  const Tag = editable ? 'button' : 'span'
                  return (
                    <Tag
                      key={pi}
                      type={editable ? 'button' : undefined}
                      onClick={editable ? () => onWordClick(li, wi, pi, part.chord) : undefined}
                      className={`inline-flex flex-col items-start text-left ${
                        editable ? 'rounded border-b border-dashed border-gray-600 active:bg-gray-800' : ''
                      }`}
                    >
                      {chordRow && (
                        <span
                          className="font-bold text-amber-400 whitespace-pre"
                          style={{ fontSize: '0.7em', lineHeight: 1.2, paddingRight: part.chord ? '0.35em' : 0 }}
                        >
                          {part.chord || ' '}
                        </span>
                      )}
                      <span className="whitespace-pre">{part.text || (editable ? '  ' : ' ')}</span>
                    </Tag>
                  )
                })}
              </span>
            ))}
          </div>
        )
      })}
    </div>
  )
}
