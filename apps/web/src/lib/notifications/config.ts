/**
 * Browser push needs a VAPID key pair: the public half is given to browsers
 * when they subscribe, the private half signs what we send. Without both,
 * browser push is simply off and everything else still works.
 */
export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  /** A mailto: or https: contact the push service can reach the sender at. */
  subject: string;
}

export function vapidConfig(env: NodeJS.ProcessEnv = process.env): VapidConfig | null {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? env.VAPID_PUBLIC_KEY ?? "";
  const privateKey = env.VAPID_PRIVATE_KEY ?? "";
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: env.VAPID_SUBJECT || "mailto:support@deephaus.ai",
  };
}
