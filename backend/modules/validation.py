import json
import re

from groq import Groq

SYSTEM_PROMPT = """Sei un esperto di musica. Il tuo compito è verificare se esiste una canzone reale con i dati forniti.
Rispondi SEMPRE e SOLO con un oggetto JSON valido, senza markdown, senza spiegazioni aggiuntive."""

USER_TEMPLATE = """Verifica se esiste questa canzone:
Artista: {artist}
Titolo: {title}

Rispondi con JSON esatto in questo formato:
{{"valid": true/false, "artist_normalized": "nome artista corretto", "title_normalized": "titolo corretto", "message": "motivo se non valida, stringa vuota se valida"}}"""


def validate_song(artist: str, title: str, groq_api_key: str) -> dict:
    if not groq_api_key:
        return {
            "valid": False,
            "artist_normalized": artist,
            "title_normalized": title,
            "message": "Groq API key non configurata. Impostala dalla pagina Admin.",
        }

    client = Groq(api_key=groq_api_key)
    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": USER_TEMPLATE.format(artist=artist, title=title)},
            ],
            temperature=0.1,
            max_tokens=200,
        )
        raw = response.choices[0].message.content.strip()
        # Estrai JSON anche se c'è testo attorno
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            data = json.loads(match.group())
            return {
                "valid": bool(data.get("valid", False)),
                "artist_normalized": data.get("artist_normalized", artist),
                "title_normalized": data.get("title_normalized", title),
                "message": data.get("message", ""),
            }
    except Exception as e:
        return {
            "valid": False,
            "artist_normalized": artist,
            "title_normalized": title,
            "message": f"Errore validazione: {str(e)}",
        }

    return {
        "valid": False,
        "artist_normalized": artist,
        "title_normalized": title,
        "message": "Risposta non valida dal modello",
    }
