-- The Notes page is gone; all sources now live inside decks via the Create
-- page. Standalone notes (sources without a deck) are unreachable from the UI
-- and were never able to generate cards, so delete them outright (pre-launch,
-- no user data to preserve). Deck-attached sources are untouched.
delete from public.sources where project_id is null;
