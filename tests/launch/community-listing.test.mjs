import test from 'node:test';
import assert from 'node:assert/strict';
import { fullSchema } from './full-schema.mjs';

const author = '10000000-0000-4000-8000-000000000011';
const learner = '10000000-0000-4000-8000-000000000012';
const stranger = '10000000-0000-4000-8000-000000000013';
const authorDeck = '20000000-0000-4000-8000-000000000011';
const learnerDeck = '20000000-0000-4000-8000-000000000012';
const publication = '30000000-0000-4000-8000-000000000011';
const subscription = '40000000-0000-4000-8000-000000000011';
const sourceCard = '50000000-0000-4000-8000-000000000011';

async function asUser(db, id) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${id}',false);
    select set_config('request.jwt.claim.role','authenticated',false); set role authenticated;`);
}

async function seed(db) {
  await db.exec(`
    insert into auth.users(id,email) values
      ('${author}','author@example.test'),('${learner}','learner@example.test'),('${stranger}','stranger@example.test');
    insert into user_profiles(user_id,username,full_name) values('${author}','maya_k','Private Name')
      on conflict (user_id) do update set username = excluded.username, full_name = excluded.full_name;
    insert into projects(id,user_id,name,deck_name) values
      ('${authorDeck}','${author}','Anatomy','Anatomy'),('${learnerDeck}','${learner}','Anatomy','Anatomy');
    insert into sources(id,project_id,type) values('${learnerDeck}','${learnerDeck}','text');
    insert into generation_jobs(id,source_id) values('${learnerDeck}','${learnerDeck}');
    insert into cards(id,job_id,type,front,back) values('${learnerDeck}','${learnerDeck}','basic','Q','A');
    insert into deck_publications(id,publisher_id,source_project_id,title,card_count,subject)
      values('${publication}','${author}','${authorDeck}','Anatomy',3,'medicine');
    insert into publication_cards(publication_id,type,front,back,cloze_text,tags,sort_order,source_card_id) values
      ('${publication}','basic','Q1','A1',null,'{heart,valves}',0,'${sourceCard}'),
      ('${publication}','basic','Q2','A2',null,'{heart}',1,gen_random_uuid()),
      ('${publication}','cloze',null,null,'{{c1::Aorta}}','{vessels,heart}',2,gen_random_uuid());
    insert into deck_subscriptions(id,publication_id,subscriber_id,sync_mode,local_project_id)
      values('${subscription}','${publication}','${learner}','follow','${learnerDeck}');
  `);
}

test('existing listings get a content date and the subject is length-checked', async () => {
  const { db } = await fullSchema();
  try {
    await seed(db);
    const row = (await db.query('select subject, content_updated_at from deck_publications')).rows[0];
    assert.equal(row.subject, 'medicine');
    assert.ok(row.content_updated_at);
    await assert.rejects(
      db.query('update deck_publications set subject=$1', ['x'.repeat(41)]),
      /deck_publications_subject_length/,
    );
  } finally { await db.close(); }
});

test('publication_card_facts counts card types and ranks tags for a signed-in reader', async () => {
  const { db } = await fullSchema();
  try {
    await seed(db);
    await asUser(db, stranger);
    const facts = (await db.query('select publication_card_facts($1) f', [publication])).rows[0].f;
    assert.deepEqual(facts.types, { basic: 2, cloze: 1 });
    assert.deepEqual(facts.tags, ['heart', 'valves', 'vessels']);
    const two = (await db.query('select publication_card_facts($1, 1) f', [publication])).rows[0].f;
    assert.deepEqual(two.tags, ['heart']);
    const none = (await db.query('select publication_card_facts(gen_random_uuid()) f')).rows[0].f;
    assert.deepEqual(none, { types: {}, tags: [] });
  } finally { await db.close(); }
});

test('publisher usernames are readable by the server only, and nothing else comes with them', async () => {
  const { db } = await fullSchema();
  try {
    await seed(db);
    await asUser(db, stranger);
    await assert.rejects(db.query('select * from get_publication_authors($1)', [[author]]), /permission denied/);
    await db.exec('reset role; set role service_role;');
    const rows = (await db.query('select * from get_publication_authors($1)', [[author, stranger]])).rows;
    assert.deepEqual(rows.filter(row => row.user_id === author), [{ user_id: author, username: 'maya_k' }]);
  } finally { await db.close(); }
});

test('card links belong to the subscriber and go with the card or the subscription', async () => {
  const { db } = await fullSchema();
  try {
    await seed(db);
    const link = 'insert into deck_subscription_cards(subscription_id,source_card_id,local_card_id) values($1,$2,$3)';

    await asUser(db, stranger);
    await assert.rejects(db.query(link, [subscription, sourceCard, learnerDeck]), /row-level security/);

    await asUser(db, learner);
    await db.query(link, [subscription, sourceCard, learnerDeck]);
    assert.equal((await db.query('select * from deck_subscription_cards')).rows.length, 1);

    await asUser(db, stranger);
    assert.equal((await db.query('select * from deck_subscription_cards')).rows.length, 0);
    await asUser(db, author);
    assert.equal((await db.query('select * from deck_subscription_cards')).rows.length, 0);

    // Deleting the learner's card removes its link; the published card is untouched.
    await db.exec('reset role');
    await db.exec(`delete from cards where id='${learnerDeck}'`);
    assert.equal((await db.query('select * from deck_subscription_cards')).rows.length, 0);
    assert.equal((await db.query('select * from publication_cards')).rows.length, 3);
  } finally { await db.close(); }
});
