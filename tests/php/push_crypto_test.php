<?php
declare(strict_types=1);

/**
 * Test della crittografia Web Push (Push.php) senza dipendenze.
 * Uso (container di deploy/local, dalla cartella band-manager/):
 *   docker exec -i local-web-1 php < tests/php/push_crypto_test.php
 * Percorso dei sorgenti: argomento 1 (default /var/www/html/band/api).
 */

$api = $argv[1] ?? '/var/www/html/band/api';
require "$api/src/Http.php";
require "$api/src/Db.php";
require "$api/src/Push.php";

$fails = 0;
function check(string $name, bool $ok, string $extra = ''): void
{
    global $fails;
    echo ($ok ? 'ok   ' : 'FAIL ') . $name . ($ok || $extra === '' ? '' : " — $extra") . "\n";
    $fails += $ok ? 0 : 1;
}
$d = fn(string $s) => Push::b64uDecode($s);

// ── RFC 8291 §5: vettori ufficiali ───────────────────────────────────────────
$plain = 'When I grow up, I want to be a watermelon';
$asPriv = $d('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw');
$asPub = $d('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
$uaPriv = $d('q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94');
$uaPub = $d('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4');
$salt = $d('DGv6ra1nlYgDCS1FRnbzlw');
$auth = $d('BTBZMqHH6r4Tts7J_aSIgg');
$expected = 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';

$body = Push::encrypt($plain, $uaPub, $auth, $salt, [$asPriv, $asPub]);
check('RFC 8291 vettore: corpo cifrato identico', Push::b64uEncode($body) === $expected, Push::b64uEncode($body));

// ── Decifratura lato "browser" di un messaggio con chiavi casuali ────────────
function decrypt(string $body, string $uaPriv, string $uaPub, string $auth): string|false
{
    $salt = substr($body, 0, 16);
    $idlen = ord($body[20]);
    $asPub = substr($body, 21, $idlen);
    $ct = substr($body, 21 + $idlen);
    $secret = openssl_pkey_derive(openssl_pkey_get_public(Push::publicPem($asPub)), openssl_pkey_get_private(Push::privatePem($uaPriv, $uaPub)), 32);
    $ikm = hash_hkdf('sha256', $secret, 32, "WebPush: info\x00" . $uaPub . $asPub, $auth);
    $cek = hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\x00", $salt);
    $nonce = hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\x00", $salt);
    $p = openssl_decrypt(substr($ct, 0, -16), 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, substr($ct, -16));
    if ($p === false) {
        return false;
    }
    $p = rtrim($p, "\x00");                                          // padding
    return substr($p, -1) === "\x02" ? substr($p, 0, -1) : false;   // delimitatore dell'ultimo record
}
$k = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
$ec = openssl_pkey_get_details($k)['ec'];
$pad = fn($v) => str_pad($v, 32, "\x00", STR_PAD_LEFT);
$myPriv = $pad($ec['d']);
$myPub = "\x04" . $pad($ec['x']) . $pad($ec['y']);
$myAuth = random_bytes(16);
$msg = json_encode(['title' => 'Band', 'body' => 'Marco ha commentato «Wonderwall» è così']);
$enc = Push::encrypt($msg, $myPub, $myAuth);
check('chiavi casuali: roundtrip', decrypt($enc, $myPriv, $myPub, $myAuth) === $msg);
check('header: rs 4096 e idlen 65', substr($enc, 16, 4) === pack('N', 4096) && ord($enc[20]) === 65);
check('due cifrature diverse (salt/chiave effimera nuovi)', Push::encrypt($msg, $myPub, $myAuth) !== $enc);

$bad = false;
try {
    Push::encrypt('x', substr($myPub, 1), $myAuth);
} catch (InvalidArgumentException $e) {
    $bad = true;
}
check('chiave del browser non valida rifiutata', $bad);

// ── derToRaw ─────────────────────────────────────────────────────────────────
$r = "\x00\xff" . str_repeat("\x11", 31);           // INTEGER con zero di segno (33 byte)
$s = str_repeat("\x22", 30);                         // INTEGER corto (30 byte)
$der = "\x30" . chr(4 + strlen($r) + strlen($s)) . "\x02" . chr(strlen($r)) . $r . "\x02" . chr(strlen($s)) . $s;
$raw = Push::derToRaw($der);
check('derToRaw: 64 byte, zero di segno tolto, padding a sinistra',
    strlen($raw) === 64 && substr($raw, 0, 32) === "\xff" . str_repeat("\x11", 31) && substr($raw, 32) === "\x00\x00" . $s);

// ── Firma ES256 verificabile come JWS ────────────────────────────────────────
openssl_sign('abc', $sig, Push::privatePem($myPriv, $myPub), OPENSSL_ALGO_SHA256);
$raw = Push::derToRaw($sig);
// Ricostruzione DER da r‖s e verifica con la chiave pubblica: la conversione non perde informazione
$int = function (string $x): string {
    $x = ltrim($x, "\x00");
    if ($x === '' || ord($x[0]) & 0x80) {
        $x = "\x00" . $x;
    }
    return "\x02" . chr(strlen($x)) . $x;
};
$der2 = $int(substr($raw, 0, 32)) . $int(substr($raw, 32));
$der2 = "\x30" . chr(strlen($der2)) . $der2;
check('ES256: r‖s riconvertito verifica con la chiave pubblica',
    openssl_verify('abc', $der2, Push::publicPem($myPub), OPENSSL_ALGO_SHA256) === 1);

// ── Allowlist (modalità cattura spenta: config non caricata → push_capture assente) ──
$cfg = new ReflectionProperty(Config::class, 'cfg');
$cfg->setValue(null, []);
$allowed = [
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QGx',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
];
$denied = [
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:8443/x',
    'https://evil.com/fcm.googleapis.com',
    'https://fcm.googleapis.com.evil.com/x',
    'https://user@fcm.googleapis.com/x',
    'https://127.0.0.1/x',
    'https://push.test.invalid/x',
    'ftp://web.push.apple.com/x',
];
foreach ($allowed as $u) {
    check("allowlist ammette $u", Push::endpointAllowed($u));
}
foreach ($denied as $u) {
    check("allowlist rifiuta $u", !Push::endpointAllowed($u));
}
$cfg->setValue(null, ['push_capture' => true]);
check('modalità cattura: ammette push.test.invalid', Push::endpointAllowed('https://push.test.invalid/x'));

echo $fails === 0 ? "\nTutti i test superati\n" : "\n$fails test falliti\n";
exit($fails === 0 ? 0 : 1);
