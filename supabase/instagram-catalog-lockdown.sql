-- Phase 2 - NOT YET DEPLOYED.
-- Apply ONLY after catalog.html is published and its RPC path verified for existing share URLs.
-- Existing staff UI uses x-session-token; the public catalog must use get_public_catalog(p_token).
-- Switching RLS before the new client is live would break active published links.
begin;
drop policy if exists project_cards_select on public.project_cards;
create policy project_cards_select on public.project_cards
  for select to public
  using ((select public.has_session()));
drop policy if exists share_links_select on public.share_links;
create policy share_links_select on public.share_links
  for select to public
  using ((select public.has_session()));
commit;
