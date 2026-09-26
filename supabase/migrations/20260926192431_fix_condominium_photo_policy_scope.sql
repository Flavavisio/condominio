drop policy condominium_photos_read on storage.objects;
drop policy condominium_photos_insert on storage.objects;
drop policy condominium_photos_delete on storage.objects;
create policy condominium_photos_read on storage.objects for select to authenticated
using(bucket_id='condominium-photos' and exists(select 1 from public.condominiums c where c.id::text=(storage.foldername(storage.objects.name))[1]));
create policy condominium_photos_insert on storage.objects for insert to authenticated
with check(bucket_id='condominium-photos' and exists(select 1 from public.condominiums c where c.id::text=(storage.foldername(storage.objects.name))[1] and private.can_manage_condo(c.id)));
create policy condominium_photos_delete on storage.objects for delete to authenticated
using(bucket_id='condominium-photos' and exists(select 1 from public.condominiums c where c.id::text=(storage.foldername(storage.objects.name))[1] and private.can_manage_condo(c.id)));
