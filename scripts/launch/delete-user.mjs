// Delete a synthetic account the way the app does: queue the deletion request
// first so review-log triggers skip recounting stats for a user mid-cascade.
export async function deleteSyntheticUser(admin, userId) {
  const errors = [];
  const queued = await admin.from('account_deletion_requests')
    .upsert({ user_id: userId, status: 'processing' }, { onConflict: 'user_id' });
  if (queued.error) errors.push(queued.error.message);
  const deleted = await admin.auth.admin.deleteUser(userId);
  if (deleted.error && deleted.error.status !== 404) errors.push(deleted.error.message);
  else {
    const finished = await admin.from('account_deletion_requests')
      .update({ status: 'complete', last_error: null, lease_until: null }).eq('user_id', userId);
    if (finished.error) errors.push(finished.error.message);
  }
  return { userDeleted: !deleted.error || deleted.error.status === 404, errors };
}
