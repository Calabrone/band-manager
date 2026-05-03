from groq import Groq

SYSTEM_PROMPT = (
    "Sei un musicista esperto con conoscenza precisa degli accordi delle canzoni. "
    "Genera schemi accordi nel formato chord-over-lyrics: "
    "scrivi il nome dell'accordo sopra la parola/sillaba esatta in cui cambia. "
    "Rispondi SOLO con lo schema, niente spiegazioni, niente markdown."
)

USER_TEMPLATE = """Genera lo schema accordi completo per "{title}" di {artist}.

Usa il formato chord-over-lyrics:
- Nome accordo posizionato sopra la parola dove cambia (allineamento con spazi)
- Sezioni tra parentesi quadre: [Intro], [Verse 1], [Pre-Chorus], [Chorus], [Bridge], [Outro]
- Usa i nomi reali degli accordi (Am, G, F, E, Cadd9, D/F#, Bm7 ecc.)
- Se una sezione si ripete, scrivi "(repeat)" invece di copiare

Formato di esempio:
[Intro]
Am      G       F       E

[Verse 1]
Am              G
When I was young I knew everything
F                   E
She a punk who rarely ever took advice

[Chorus]
F       C           G          Am
Now I'm falling apart with all my heart

Genera lo schema completo per "{title}" di {artist}.
Se la canzone non è conosciuta con precisione, scrivi: Non disponibile"""


def fetch_chords_text(artist: str, title: str, groq_api_key: str) -> str | None:
    if not groq_api_key:
        return None
    try:
        client = Groq(api_key=groq_api_key)
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": USER_TEMPLATE.format(artist=artist, title=title)},
            ],
            temperature=0.1,
            max_tokens=1500,
        )
        text = response.choices[0].message.content.strip()
        if not text or text.lower().startswith("non disponibile"):
            return None
        return text
    except Exception:
        return None
