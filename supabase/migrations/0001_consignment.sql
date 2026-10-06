create function touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
create table locations (
 id uuid primary key default gen_random_uuid(), name text not null unique, currency text not null check(currency in ('NZD','AUD','USD')), jurisdiction text not null check(jurisdiction in ('NZ','AU-NSW','OTHER')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table consignors (
 id uuid primary key default gen_random_uuid(), external_id text, location_id uuid not null references locations, name text not null, email text not null default '', phone text not null default '', address text not null default '', identity_evidence text not null default '', terms_ref text not null default '', split_percent numeric(5,2) not null default 50 check(split_percent between 0 and 100), opening_cents integer not null default 0, opening_date date not null default current_date,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(location_id,external_id)
);
create table items (
 id uuid primary key default gen_random_uuid(), sku text not null unique, consignor_id uuid not null references consignors, title text not null, category text not null default '', received_on date not null, expires_on date not null, price_cents integer not null check(price_cents>=0), split_percent numeric(5,2) not null check(split_percent between 0 and 100), status text not null default 'available' check(status in ('available','sold','returned','donated','archived')),
 regulated boolean not null default false, dealer_record_ref text not null default '', donation_allowed boolean not null default false, disposed_on date, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(expires_on>=received_on)
);
create table sales (
 id uuid primary key default gen_random_uuid(), reference text not null unique, item_id uuid not null references items, sold_on date not null, net_cents integer not null check(net_cents>0), consignor_cents integer not null check(consignor_cents>=0 and consignor_cents<=net_cents), refunded_on date, refund_reference text unique,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(refunded_on is null or refunded_on>=sold_on)
);
create unique index one_active_sale_per_item on sales(item_id) where refunded_on is null;
create table settlements (
 id uuid primary key default gen_random_uuid(), consignor_id uuid not null references consignors, reference text not null unique, paid_on date not null, amount_cents integer not null check(amount_cents>0), actor text not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table events (
 id uuid primary key default gen_random_uuid(), item_id uuid not null references items, actor text not null, note text not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table import_batches (
 id uuid primary key default gen_random_uuid(), source_hash text not null unique, account_count integer not null, item_count integer not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
do $$ declare t text; begin foreach t in array array['locations','consignors','items','sales','settlements','events','import_batches'] loop execute format('create trigger touch before update on %I for each row execute function touch_updated_at()',t); end loop; end $$;
create view stock as select i.*,c.name consignor,c.location_id,l.name location,l.currency,l.jurisdiction,current_date-i.received_on age_days,i.expires_on-current_date days_to_expiry from items i join consignors c on c.id=i.consignor_id join locations l on l.id=c.location_id;
create view balances as select c.id,c.name,c.location_id,l.name location,l.currency,c.opening_cents,
 coalesce((select sum(s.consignor_cents) from sales s join items i on i.id=s.item_id where i.consignor_id=c.id and s.refunded_on is null),0)::bigint earned_cents,
 coalesce((select sum(p.amount_cents) from settlements p where p.consignor_id=c.id),0)::bigint paid_cents,
 (c.opening_cents+coalesce((select sum(s.consignor_cents) from sales s join items i on i.id=s.item_id where i.consignor_id=c.id and s.refunded_on is null),0)-coalesce((select sum(p.amount_cents) from settlements p where p.consignor_id=c.id),0))::bigint due_cents
 from consignors c join locations l on l.id=c.location_id;
create view expiry_queue as select sku,title,consignor,location,currency,expires_on,days_to_expiry,price_cents,donation_allowed from stock where status='available' and expires_on<=current_date+14;
create view compliance_issues as
 select i.id,i.sku,'TERMS' rule,'Internal policy' basis,'Missing agreement reference' issue from items i join consignors c on c.id=i.consignor_id where c.terms_ref=''
 union all select i.id,i.sku,'DEALER_RECORD','NZ Police / NSW Government','Regulated item needs linked external dealer record' from stock i where regulated and dealer_record_ref=''
 union all select i.id,i.sku,'IDENTITY','NZ Police / NSW Government','Regulated item needs supplier identity evidence' from items i join consignors c on c.id=i.consignor_id where i.regulated and c.identity_evidence=''
 union all select i.id,i.sku,'NSW_EXTERNAL','NSW Government','Keep approved dealer records and required Police transmission outside this system' from stock i where regulated and jurisdiction='AU-NSW';
create view attention_queue as
 select sku,title,consignor,location,'Expired consignment' reason from stock where status='available' and expires_on<current_date
 union all select sku,title,consignor,location,'Stock over 60 days old' from stock where status='available' and age_days>60
 union all select sku,title,consignor,location,issue from stock join compliance_issues using(id,sku)
 union all select ''::text,name,name,location,'Negative consignor balance after refund' from balances where due_cents<0;
