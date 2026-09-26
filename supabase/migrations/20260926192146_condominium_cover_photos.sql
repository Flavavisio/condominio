insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('condominium-photos','condominium-photos',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy condominium_photos_read on storage.objects for select to authenticated
using(bucket_id='condominium-photos' and exists(select 1 from public.condominiums c where c.id::text=(storage.foldername(name))[1]));
create policy condominium_photos_insert on storage.objects for insert to authenticated
with check(bucket_id='condominium-photos' and exists(select 1 from public.condominiums c where c.id::text=(storage.foldername(name))[1] and private.can_manage_condo(c.id)));
create policy condominium_photos_delete on storage.objects for delete to authenticated
using(bucket_id='condominium-photos' and exists(select 1 from public.condominiums c where c.id::text=(storage.foldername(name))[1] and private.can_manage_condo(c.id)));
