<?php
// Copiare in config.php (non versionato, non sovrascritto dal deploy) e impostare secret_key.
// Generare la chiave con:  php -r "echo bin2hex(random_bytes(32));"
return [
    'secret_key' => 'CAMBIA-QUESTA-CHIAVE',
    'db_path'    => __DIR__ . '/data/band_manager.db',
    // Opzionali: se assenti, app_url e' dedotto dalla richiesta e il mittente e' noreply@motorn.it
    // 'app_url'   => 'https://www.motorn.it/band',
    // 'mail_from' => 'Band Manager <noreply@motorn.it>',
    // Email di reset password: su Aruba mail() non consegna, serve SMTP autenticato con una casella reale
    // di motorn.it (mail_from deve essere l'indirizzo di quella casella, altrimenti Aruba rifiuta).
    // 'smtp_host' => 'smtps.aruba.it',
    // 'smtp_port' => '465',
    // 'smtp_user' => 'casella@motorn.it',
    // 'smtp_pass' => '...',
];
