#!/usr/bin/env bash
# Test de l'APK sur l'émulateur : site de test sur la machine hôte (10.0.2.2:4173 vu de l'émulateur).
set -euo pipefail
mkdir -p android-e2e
PORT=4173 ROUND_SECONDS=40 LIVE_SECONDS=6 npx tsx tools/mock-site/server.ts > android-e2e/mock.log 2>&1 &
for i in $(seq 1 30); do curl -sf http://localhost:4173/truth.json > /dev/null && break; sleep 1; done
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
node tools/ci/android-e2e.mjs
