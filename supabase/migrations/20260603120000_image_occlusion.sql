-- Image occlusion cards (region masking on a single image).

alter table public.cards drop constraint if exists cards_type_check;
alter table public.cards
  add constraint cards_type_check
  check (type in ('basic', 'cloze', 'image-occlusion'));

alter table public.cards
  add column if not exists occlusion_data jsonb;

alter table public.publication_cards drop constraint if exists publication_cards_type_check;
alter table public.publication_cards
  add constraint publication_cards_type_check
  check (type in ('basic', 'cloze', 'image-occlusion'));

alter table public.publication_cards
  add column if not exists occlusion_data jsonb;
