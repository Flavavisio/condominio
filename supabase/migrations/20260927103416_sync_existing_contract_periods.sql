-- Use the latest issued license for existing contract metadata; no validity changes.
update public.companies c set billing_cycle=l.billing_cycle,contract_start=l.starts_on,contract_end=l.expires_on
from (select distinct on (company_id) company_id,billing_cycle,starts_on,expires_on from public.company_admin_licenses order by company_id,created_at desc,id desc) l
where c.id=l.company_id;
