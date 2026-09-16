import { expect, test, type APIRequestContext } from '@playwright/test';
import { createCard, fixture, signIn } from './fixtures';

async function device(request: APIRequestContext) {
  const base = fixture('E2E_SUPABASE_URL');
  const apikey = fixture('E2E_SUPABASE_ANON_KEY');
  const response = await request.post(`${base}/auth/v1/token?grant_type=password`, {
    headers: { apikey }, data: { email: fixture('E2E_EMAIL'), password: fixture('E2E_PASSWORD') },
  });
  expect(response.ok()).toBeTruthy();
  const session = await response.json();
  const headers = { apikey, Authorization: `Bearer ${session.access_token}` };
  return {
    userId: session.user.id as string,
    rpc: (name: string, data: object) => request.post(`${base}/rest/v1/rpc/${name}`, { headers, data }),
    rows: async (table: string, filter: string) => {
      const result = await request.get(`${base}/rest/v1/${table}?${filter}`, { headers });
      expect(result.ok()).toBeTruthy();
      return result.json();
    },
    close: () => request.post(`${base}/auth/v1/logout?scope=local`, { headers }),
  };
}

test('two device sessions retain both offline answers in either upload order, including retry and undo', async ({ page, request }) => {
  test.setTimeout(90_000);
  fixture('E2E_SUPABASE_URL'); fixture('E2E_SUPABASE_ANON_KEY');
  await signIn(page);
  const a = await device(request), b = await device(request);
  const cards: string[] = [];
  try {
    for (const order of [[0, 1], [1, 0]]) {
      const id = await createCard(page, `Two device launch ${crypto.randomUUID()}`);
      cards.push(id);
      const events = [0, 1].map(index => {
        const time = new Date(Date.now() - (2 - index) * 60_000).toISOString();
        const state = { state: 2, stability: index + 1, difficulty: 5, elapsed_days: 1, scheduled_days: index + 1,
          reps: 1, lapses: 0, learning_steps: 0, last_review: time, due: new Date(Date.parse(time) + 86_400_000).toISOString() };
        return { p_user_id: a.userId, p_card_id: id, p_cloze_ord: 0, p_expected_version: 0, p_mutation_id: crypto.randomUUID(),
          p_review: state, p_log: { ...state, rating: 3, review: time, last_elapsed_days: 1, next_state: state }, p_response: { next_state: state } };
      });
      for (const index of order) {
        const response = await [a, b][index]!.rpc('apply_card_review', events[index]!);
        expect(response.ok()).toBeTruthy();
        const result = await response.json();
        expect(result.reconciliation, 'Enable reconciliation for the isolated owner fixture before running this gate').toBe(index === 0 && order[0] === 1 ? 'history_only' : 'authoritative');
      }
      const filter = `card_id=eq.${id}&select=*`;
      const winner = (await a.rows('card_reviews', filter))[0];
      expect(winner.winning_review_id).toBe(events[1]!.p_mutation_id);
      expect(winner.stability).toBe(2);
      for (const payload of events) expect((await b.rpc('apply_card_review', payload)).ok()).toBeTruthy();
      expect(await a.rows('review_logs', filter)).toHaveLength(2);
      expect(await b.rows('review_events', `target_id=eq.${id}&select=id`)).toHaveLength(2);
      expect((await a.rpc('restore_card_review', { p_card_id: id, p_cloze_ord: 0, p_log_id: events[0]!.p_mutation_id, p_undone: true })).ok()).toBeTruthy();
      expect((await b.rows('card_reviews', filter))[0].winning_review_id).toBe(events[1]!.p_mutation_id);
      expect(await a.rows('review_logs', filter)).toHaveLength(2);
    }
  } finally {
    for (const id of cards) expect((await page.request.delete(`/api/cards/${id}`)).ok()).toBeTruthy();
    await Promise.all([a.close(), b.close()]);
  }
});
