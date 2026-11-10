import { column, Schema, Table } from "@powersync/common";

// Local SQLite mirror of the synced Postgres tables. Postgres types map to
// SQLite as: uuid/timestamptz/text -> text, jsonb/array -> JSON text,
// boolean -> integer 0/1, double precision -> real.

const projects = new Table(
  {
    user_id: column.text,
    name: column.text,
    deck_name: column.text,
    settings: column.text,
    created_at: column.text,
    updated_at: column.text,
  },
  { indexes: { user: ["user_id"] } },
);

const sources = new Table(
  {
    project_id: column.text,
    type: column.text,
    raw_text: column.text,
    storage_path: column.text,
    page_count: column.integer,
    created_at: column.text,
    edited_content: column.text,
    content_edited_at: column.text,
    title: column.text,
    extract_images: column.integer,
    preview_storage_path: column.text,
    external_url: column.text,
    user_id: column.text,
    parent_id: column.text,
    position: column.real,
    icon: column.text,
    is_favorite: column.integer,
    updated_at: column.text,
  },
  { indexes: { project: ["project_id"], user: ["user_id"], parent: ["parent_id"] } },
);

const generation_jobs = new Table(
  {
    source_id: column.text,
    status: column.text,
    error: column.text,
    token_usage: column.integer,
    progress: column.integer,
    created_at: column.text,
    updated_at: column.text,
    credit_transaction_id: column.text,
    plan_priority: column.integer,
  },
  { indexes: { source: ["source_id"] } },
);

const cards = new Table(
  {
    job_id: column.text,
    type: column.text,
    front: column.text,
    back: column.text,
    cloze_text: column.text,
    extra: column.text,
    tags: column.text,
    sort_order: column.integer,
    user_edited: column.integer,
    created_at: column.text,
    updated_at: column.text,
    occlusion_data: column.text,
    source_chunk_id: column.text,
    source_ref: column.text,
    source_quote: column.text,
  },
  { indexes: { job: ["job_id"] } },
);

const card_reviews = new Table(
  {
    card_id: column.text,
    user_id: column.text,
    due: column.text,
    stability: column.real,
    difficulty: column.real,
    elapsed_days: column.real,
    scheduled_days: column.real,
    reps: column.integer,
    lapses: column.integer,
    state: column.integer,
    last_review: column.text,
    created_at: column.text,
    updated_at: column.text,
    learning_steps: column.integer,
    suspended: column.integer,
    cloze_ord: column.integer,
    version: column.integer,
    winning_review_id: column.text,
    stability_fast: column.real,
    fsrs_version: column.integer,
  },
  { indexes: { card: ["card_id"], due: ["user_id", "due"] } },
);

const review_logs = new Table(
  {
    card_id: column.text,
    user_id: column.text,
    rating: column.integer,
    state: column.integer,
    due: column.text,
    stability: column.real,
    difficulty: column.real,
    elapsed_days: column.real,
    last_elapsed_days: column.real,
    scheduled_days: column.real,
    review: column.text,
    raw_review: column.text,
    created_at: column.text,
    cloze_ord: column.integer,
    response_payload: column.text,
    undone: column.integer,
    next_state: column.text,
    previous_state: column.text,
    base_version: column.integer,
    context: column.text,
    exam_id: column.text,
    response_ms: column.integer,
  },
  { indexes: { card: ["card_id"], user_review: ["user_id", "review"] } },
);

// Read-only on clients: exams are created and changed through the API. An
// exam keeps no card state; study for it is recorded in review_logs.
const exams = new Table(
  {
    user_id: column.text,
    name: column.text,
    exam_at: column.text,
    timezone: column.text,
    has_time: column.integer,
    target_recall: column.real,
    daily_minutes_cap: column.integer,
    selection_spec: column.text,
    study_windows: column.text,
    result_score: column.real,
    archived_at: column.text,
    created_at: column.text,
    updated_at: column.text,
  },
  { indexes: { user: ["user_id"] } },
);

// Per-user singletons: synced with `user_id AS id`, so `id === user_id`.
const user_study_settings = new Table({
  easy_days: column.text,
  user_id: column.text,
  desired_retention: column.real,
  new_cards_per_day: column.integer,
  updated_at: column.text,
  day_start_hour: column.integer,
  timezone: column.text,
});

const user_fsrs_params = new Table({
  user_id: column.text,
  params: column.text,
  log_count: column.integer,
  optimized_at: column.text,
  updated_at: column.text,
  fsrs7_params: column.text,
  fsrs7_log_count: column.integer,
  fsrs7_optimized_at: column.text,
});

const user_profiles = new Table({
  user_id: column.text,
  username: column.text,
  full_name: column.text,
  university_name: column.text,
  university_domain: column.text,
  university_email: column.text,
  university_email_verified_at: column.text,
  created_at: column.text,
  updated_at: column.text,
  avatar_url: column.text,
});

// Read-only on clients: written by the /api/cards/[id]/explain routes.
const card_explanations = new Table(
  {
    card_id: column.text,
    user_id: column.text,
    content_hash: column.text,
    explanation: column.text,
    hints: column.text,
    thread: column.text,
    model: column.text,
    created_at: column.text,
    updated_at: column.text,
  },
  { indexes: { card: ["card_id"] } },
);

export const APP_SCHEMA = new Schema({
  projects,
  sources,
  generation_jobs,
  cards,
  card_reviews,
  review_logs,
  exams,
  user_study_settings,
  user_fsrs_params,
  user_profiles,
  card_explanations,
});

export type AppSchema = typeof APP_SCHEMA;
