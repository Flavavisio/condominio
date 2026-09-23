drop policy if exists "company_branding_select" on storage.objects;
create policy "company_branding_select" on storage.objects
for select to authenticated
using (bucket_id = 'company-branding');
