import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { root } from './env.mjs';
import { runNativeFlow } from './maestro.mjs';
const fixture = parseEnv(readFileSync(path.join(root, '.env.launch-native-fixtures.local'), 'utf8'));
assert.match(fixture.E2E_EMAIL, /^launch-native-[a-f0-9]+@example\.test$/);
const device = process.env.LAUNCH_SIMULATOR_ID ?? 'booted';
const ui = (...args) => execFileSync('xcrun', ['simctl', 'ui', device, ...args], { encoding: 'utf8' }).trim();
const previous = ui('content_size');
try {
  for (const size of ['large', 'accessibility-large']) {
    ui('content_size', size);
    await runNativeFlow('.maestro/editor-accessibility.yaml', { APP_ID: 'com.deephaus.app.staging', E2E_CARD_ID: fixture.E2E_CARD_ID }, `staging-editor-${size}`);
  }
  console.log('PASS: named editor controls and reachable fields at standard and accessibility text sizes. Software-keyboard dismissal and VoiceOver speech require separate validation.');
} finally { ui('content_size', previous); }
