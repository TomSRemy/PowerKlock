-- Relabel the market-data source as PowerKlock (defaults and existing rows).
alter table market.commodity alter column source set default 'PowerKlock';
alter table market.forward_settlement alter column source set default 'PowerKlock';
update market.commodity set source = 'PowerKlock' where source <> 'PowerKlock';
update market.forward_settlement set source = 'PowerKlock' where source <> 'PowerKlock';
