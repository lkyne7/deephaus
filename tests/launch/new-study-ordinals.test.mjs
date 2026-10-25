import test from 'node:test';
import assert from 'node:assert/strict';
import { fullSchema } from './full-schema.mjs';

// New-card discovery is per (card, ordinal): studying c1 of a cloze note, or
// C1 of an image occlusion, must leave the remaining ordinals in the new queue.
const owner = '10000000-0000-4000-8000-000000000001';
const deck = '20000000-0000-4000-8000-000000000001';
const cloze = '30000000-0000-4000-8000-000000000001';
const occlusion = '30000000-0000-4000-8000-000000000002';
const basic = '30000000-0000-4000-8000-000000000003';
const suspendedCloze = '30000000-0000-4000-8000-000000000004';
const doneCloze = '30000000-0000-4000-8000-000000000005';

const occlusionData = JSON.stringify({
  imageUrl: 'https://example.test/heart.png',
  rects: [
    { id: 'a', x: 0.1, y: 0.1, width: 0.2, height: 0.2, ord: 1 },
    { id: 'b', x: 0.5, y: 0.5, width: 0.2, height: 0.2, ord: 2 },
    { id: 'c', x: 0.7, y: 0.1, width: 0.2, height: 0.2, ord: 3, enabled: false },
  ],
});

async function seed(db) {
  await db.exec(`
    insert into auth.users(id,email) values('${owner}','owner@example.test');
    insert into projects(id,user_id,name,deck_name) values('${deck}','${owner}','Fixture','Fixture');
    insert into sources(id,project_id,type) values('${deck}','${deck}','text');
    insert into generation_jobs(id,source_id) values('${deck}','${deck}');
  `);
  await db.query(
    `insert into cards(id,job_id,type,front,back,cloze_text,occlusion_data,sort_order) values
      ($1,$6,'cloze',null,null,'{{c1::Paris}} is the capital of {{C2::France}}',null,1),
      ($2,$6,'image-occlusion','<img src="https://example.test/heart.png">',null,null,$7::jsonb,2),
      ($3,$6,'basic','Question','Answer',null,null,3),
      ($4,$6,'cloze',null,null,'{{c1::Suspended}} {{c2::note}}',null,4),
      ($5,$6,'cloze',null,null,'{{c1::Done}} {{c2::note}}',null,5)`,
    [cloze, occlusion, basic, suspendedCloze, doneCloze, deck, occlusionData],
  );
  const review = (card, ord, state, suspended = false) =>
    db.query(
      `insert into card_reviews(card_id,user_id,cloze_ord,due,state,reps,last_review,suspended)
       values($1,$2,$3,now() + interval '3 days',$4::smallint,$5,case when $4::smallint = 0 then null else now() end,$6)`,
      [card, owner, ord, state, state === 0 ? 0 : 1, suspended],
    );
  await review(cloze, 1, 2); // c1 studied, c2 never seen
  await review(occlusion, 1, 2); // C1 studied, C2 never seen
  await review(suspendedCloze, 0, 0, true); // suspended before ever being studied
  await review(doneCloze, 1, 2);
  await review(doneCloze, 2, 2);
}

test('fetch_new_study_cards keeps cards with unstudied ordinals and returns occlusion data', async () => {
  const { db } = await fullSchema();
  try {
    await seed(db);
    const rows = (
      await db.query('select * from fetch_new_study_cards($1,$2,50)', [deck, owner])
    ).rows;
    assert.deepEqual(
      rows.map((row) => row.id),
      [cloze, occlusion, basic],
    );
    const io = rows.find((row) => row.id === occlusion);
    assert.equal(io.occlusion_data.rects.length, 3);

    const count = await db.query('select count_new_study_cards($1,$2) as n', [deck, owner]);
    assert.equal(Number(count.rows[0].n), 3);
  } finally {
    await db.close();
  }
});

test('fetch_new_study_cards drops a card once every ordinal is studied or suspended', async () => {
  const { db } = await fullSchema();
  try {
    await seed(db);
    await db.query(
      `insert into card_reviews(card_id,user_id,cloze_ord,due,state,reps,last_review)
       values($1,$3,2,now(),2,1,now()),($2,$3,2,now(),2,1,now())`,
      [cloze, occlusion, owner],
    );
    await db.query(`update card_reviews set suspended = true where card_id = $1`, [basic]);
    await db.query(
      `insert into card_reviews(card_id,user_id,cloze_ord,due,state,suspended)
       values($1,$2,0,now(),0,true)`,
      [basic, owner],
    );
    const rows = (
      await db.query('select id from fetch_new_study_cards($1,$2,50)', [deck, owner])
    ).rows;
    assert.deepEqual(rows, []);
    const count = await db.query('select count_new_study_cards($1,$2) as n', [deck, owner]);
    assert.equal(Number(count.rows[0].n), 0);
  } finally {
    await db.close();
  }
});
