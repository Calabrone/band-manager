<?php
declare(strict_types=1);

/**
 * Validazione del tema dell'utente (stesse regole di frontend/src/lib/theme.js → normalizeTheme,
 * ma qui un valore non valido è un errore 422 invece di tornare al default).
 */
final class Theme
{
    public const PRESETS = ['sala', 'palco', 'valvole', 'mezzanotte', 'spartito', 'giorno', 'auto'];
    public const CONTRASTS = ['normal', 'high'];
    public const FONTS = ['system', 'atkinson', 'barlow', 'literata'];
    public const SCALES = [90, 100, 112, 125];
    public const RADII = ['square', 'soft', 'round'];

    /** Restituisce il tema normalizzato (solo chiavi note) o lancia 422 con il nome del campo. */
    public static function validate(array $t): array
    {
        $bad = static fn (string $field) => Http::fail(422, "Tema non valido: $field");

        $out = ['v' => 1];
        if (isset($t['v']) && $t['v'] !== 1) {
            $bad('v');
        }
        $preset = $t['preset'] ?? 'sala';
        if (!is_string($preset) || !in_array($preset, self::PRESETS, true)) {
            $bad('preset');
        }
        $out['preset'] = $preset;

        $accent = $t['accent'] ?? null;
        if ($accent !== null && (!is_string($accent) || !preg_match('/^#[0-9a-fA-F]{6}$/', $accent))) {
            $bad('accent');
        }
        $out['accent'] = $accent === null ? null : strtolower($accent);

        $tint = $t['tint'] ?? null;
        if ($tint !== null) {
            if (!is_array($tint)
                || !is_int($tint['hue'] ?? null) || $tint['hue'] < 0 || $tint['hue'] > 360
                || !is_int($tint['amount'] ?? null) || $tint['amount'] < 0 || $tint['amount'] > 100) {
                $bad('tint');
            }
            $tint = ['hue' => $tint['hue'], 'amount' => $tint['amount']];
        }
        $out['tint'] = $tint;

        foreach ([
            'contrast' => [self::CONTRASTS, 'normal'],
            'font' => [self::FONTS, 'system'],
            'scale' => [self::SCALES, 100],
            'radius' => [self::RADII, 'soft'],
        ] as $key => [$allowed, $default]) {
            $v = $t[$key] ?? $default;
            if (!in_array($v, $allowed, true)) {
                $bad($key);
            }
            $out[$key] = $v;
        }
        return $out;
    }
}
