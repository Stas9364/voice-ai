-- Сегменты summary с датой добавления; обрезка старше 3 дней выполняется в приложении при сохранении.
alter table public.conversation_memory
  add column if not exists summary_segments jsonb not null default '[]'::jsonb;

-- Перенос существующего summary в один сегмент с датой updated_at.
update public.conversation_memory
set summary_segments = jsonb_build_array(
  jsonb_build_object('addedAt', updated_at::text, 'text', summary)
)
where
  trim(coalesce(summary, '')) <> ''
  and summary_segments = '[]'::jsonb;
