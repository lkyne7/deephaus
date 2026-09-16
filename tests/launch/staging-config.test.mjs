import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stagingOfflineSettings, STAGING_POWERSYNC_URL} from '../../scripts/launch/offline-config.mjs';

test('staging offline configuration defaults off and ignores production endpoint values', () => {
  assert.deepEqual(stagingOfflineSettings({NEXT_PUBLIC_POWERSYNC_URL: 'https://production.invalid'}), {url:'',media:'false'});
});
test('staging replication pins the isolated instance with an independent media flag', () => {
  assert.deepEqual(stagingOfflineSettings({LAUNCH_POWERSYNC_ENABLED:'true'}), {url:STAGING_POWERSYNC_URL,media:'false'});
  assert.deepEqual(stagingOfflineSettings({LAUNCH_POWERSYNC_ENABLED:'true',LAUNCH_OFFLINE_MEDIA_ENABLED:'true',NEXT_PUBLIC_POWERSYNC_URL:'https://production.invalid'}), {url:STAGING_POWERSYNC_URL,media:'true'});
});
test('staging offline configuration rejects partial or mistyped rollout flags', () => {
  assert.throws(()=>stagingOfflineSettings({LAUNCH_OFFLINE_MEDIA_ENABLED:'true'}), /Enable staging PowerSync/);
  assert.throws(()=>stagingOfflineSettings({LAUNCH_POWERSYNC_ENABLED:'1'}), /must be true or false/);
});
