export const STAGING_POWERSYNC_INSTANCE = '6a79589f2a3eee482f24045d';
export const STAGING_POWERSYNC_URL = `https://${STAGING_POWERSYNC_INSTANCE}.powersync.journeyapps.com`;

/** Only opt-in settings from the dedicated staging file may enable replication. */
export function stagingOfflineSettings(config) {
  for (const key of ['LAUNCH_POWERSYNC_ENABLED', 'LAUNCH_OFFLINE_MEDIA_ENABLED']) {
    if (config[key] !== undefined && !['true', 'false'].includes(config[key])) {
      throw new Error(`${key} must be true or false.`);
    }
  }
  const enabled = config.LAUNCH_POWERSYNC_ENABLED === 'true';
  const media = config.LAUNCH_OFFLINE_MEDIA_ENABLED === 'true';
  if (media && !enabled) throw new Error('Enable staging PowerSync before offline media downloads.');
  return {url: enabled ? STAGING_POWERSYNC_URL : '', media: String(media)};
}
