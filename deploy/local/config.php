<?php
// Solo per prova locale in Docker. Non e' la chiave di produzione.
return [
    'secret_key' => 'chiave-solo-locale-non-usare-in-produzione',
    'db_path'    => __DIR__ . '/data/band_manager.db',
    // Notifiche push: niente rete, le push finiscono in data/push_capture.jsonl (GET /admin/push/capture)
    'push_capture' => true,
];
