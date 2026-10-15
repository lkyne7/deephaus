-- Audio clips on cards (recordings, uploads and text-to-speech) share the
-- public card-media bucket with images. Audio is capped at 10 MiB by the
-- upload route; images stay at 5 MiB there, so only the bucket ceiling moves.

update storage.buckets
set
  file_size_limit = 10485760,
  allowed_mime_types = array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac',
    'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/webm'
  ]
where id = 'card-media';
