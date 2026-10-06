insert into locations(id,name,currency,jurisdiction) values ('10000000-0000-4000-8000-000000000001','Harbour Resale','NZD','NZ'),('10000000-0000-4000-8000-000000000002','Lane Resale','AUD','AU-NSW') on conflict do nothing;
insert into consignors(id,external_id,location_id,name,email,phone,address,identity_evidence,terms_ref,split_percent,opening_cents) values
('20000000-0000-4000-8000-000000000001','A-101','10000000-0000-4000-8000-000000000001','Mara Bell','mara@example.test','demo','Fictional Harbour address','External ID log MB','Agreement MB',50,2500),
('20000000-0000-4000-8000-000000000002','A-102','10000000-0000-4000-8000-000000000001','Mara Blake','blake@example.test','demo','Fictional Harbour address','','',60,0),
('20000000-0000-4000-8000-000000000003','A-201','10000000-0000-4000-8000-000000000002','Joel King','joel@example.test','demo','Fictional Lane address','External ID log JK','Agreement JK',45,0) on conflict do nothing;
insert into items(id,sku,consignor_id,title,category,received_on,expires_on,price_cents,split_percent,status,regulated,dealer_record_ref,donation_allowed) values
('30000000-0000-4000-8000-000000000001','HR-101','20000000-0000-4000-8000-000000000001','Wool coat','Coats',current_date-80,current_date-20,12000,50,'available',true,'Dealer MB-1',true),
('30000000-0000-4000-8000-000000000002','HR-102','20000000-0000-4000-8000-000000000001','Silk scarf','Accessories',current_date-55,current_date+5,4000,50,'available',false,'',true),
('30000000-0000-4000-8000-000000000003','HR-103','20000000-0000-4000-8000-000000000002','Leather jacket','Jackets',current_date-30,current_date+30,22000,60,'available',true,'',false),
('30000000-0000-4000-8000-000000000004','HR-104','20000000-0000-4000-8000-000000000001','Linen dress','Dresses',current_date-45,current_date+15,10000,50,'sold',false,'',true),
('30000000-0000-4000-8000-000000000005','LR-201','20000000-0000-4000-8000-000000000003','Silver watch','Watches',current_date-75,current_date-15,35000,45,'available',true,'NSW-JK-1',false),
('30000000-0000-4000-8000-000000000006','LR-202','20000000-0000-4000-8000-000000000003','Canvas tote','Bags',current_date-20,current_date+40,8000,45,'sold',false,'',false),
('30000000-0000-4000-8000-000000000007','HR-105','20000000-0000-4000-8000-000000000002','Cotton shirt','Shirts',current_date-90,current_date-30,4500,60,'available',false,'',false),
('30000000-0000-4000-8000-000000000008','HR-106','20000000-0000-4000-8000-000000000001','Pleated skirt','Skirts',current_date-10,current_date+50,6500,50,'available',false,'',true) on conflict do nothing;
insert into sales(reference,item_id,sold_on,net_cents,consignor_cents) values ('POS-4001','30000000-0000-4000-8000-000000000004',current_date-10,9000,4500),('POS-4002','30000000-0000-4000-8000-000000000006',current_date-5,7000,3150) on conflict do nothing;
insert into settlements(consignor_id,reference,paid_on,amount_cents,actor) values ('20000000-0000-4000-8000-000000000001','BANK-1001',current_date-4,3000,'Demo operator') on conflict do nothing;
