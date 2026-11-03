import { removeStorageTree } from '../../packages/shared/dist/index.js';
import { deleteSyntheticUser } from './delete-user.mjs';

/** Delete only the disposable account created by a textbook trial. */
export async function cleanupTextbookTrial(admin, userId) {
  try {
    const deadline = Date.now() + 60_000;
    for (const bucket of ['pdfs', 'card-media']) {
      await removeStorageTree(admin.storage.from(bucket), userId, deadline);
    }
    // Delete projects while their owner still exists: card/stat triggers can
    // otherwise fail when reached through the auth-user cascade.
    const { error } = await admin.from('projects').delete().eq('user_id', userId);
    if (error) throw error;
    return await deleteSyntheticUser(admin, userId);
  } catch (error) {
    return { userDeleted: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}
