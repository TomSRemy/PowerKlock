# PowerKlock warehouse — schema

Generated from `meta.dictionary` by `warehouse/export_skill_schema.py`. Prefer the `analytics` views; `market` holds the raw tables (arrays of 96 quarter-hours or 24 hours, Paris clock).


## analytics

### analytics.bess_spread_daily (view)
Battery arbitrage TB1 / TB2 / TB4: mean of the n most expensive hours − mean of the n cheapest (hourly averages, EUR/MWh).

| column | type | note |
|---|---|---|
| delivery_date | date |  |
| tb1 | real |  |
| tb2 | real |  |
| tb4 | real |  |
| zone | text |  |

### analytics.capture_price_daily (view)
Capture price = Σ(MW × price) / Σ(MW) per fuel and day; capture_rate = capture / average price of the same published slots.

| column | type | note |
|---|---|---|
| baseload_published | real |  |
| capture_price | real |  |
| capture_rate | real |  |
| delivery_date | date |  |
| fuel | text |  |
| slots_used | bigint |  |
| zone | text |  |

### analytics.clean_spread_daily (view)
Clean spark (CCGT 49.13 %, 0.411 tCO2/MWh) and clean dark (coal 36 %, 0.947 tCO2/MWh) spreads, and the coal-to-gas switch EUA price. Gas = TTF traded the day before delivery.

| column | type | note |
|---|---|---|
| base | real |  |
| cds_base | real |  |
| coal_gas_switch_eua | real |  |
| coal_usd | double precision |  |
| css_base | real |  |
| css_peak | real |  |
| delivery_date | date |  |
| eua | double precision |  |
| eurusd | double precision |  |
| peak | real |  |
| ttf | double precision |  |
| zone | text |  |

### analytics.commodity_daily (view)
Commodity closes with name, unit, contract and day-on-day change.

| column | type | note |
|---|---|---|
| change | double precision |  |
| contract | text |  |
| key | text |  |
| name | text |  |
| trade_date | date |  |
| unit | text |  |
| value | double precision |  |

### analytics.coverage (view)
First / last day and number of days per dataset and zone: check before comparing periods or zones.

| column | type | note |
|---|---|---|
| calendar_days | integer |  |
| dataset | text |  |
| days | bigint |  |
| first_day | date |  |
| last_day | date |  |
| zone | text |  |

### analytics.crossborder_flow_hourly (view)
One row per country, neighbour, day and hour (MW, + = import).

| column | type | note |
|---|---|---|
| country | text |  |
| delivery_date | date |  |
| hour | smallint |  |
| mw | real |  |
| neighbour | text |  |

### analytics.da_price_15min (view)
One row per zone, delivery day and quarter-hour. hour = 0..23 Paris; is_peak = 08:00–20:00.

| column | type | note |
|---|---|---|
| delivery_date | date |  |
| hour | smallint |  |
| is_peak | boolean |  |
| price | real |  |
| resolution_min | smallint |  |
| slot | smallint |  |
| slot_start | time without time zone |  |
| zone | text |  |

### analytics.da_price_daily (view)
Daily base / peak / off-peak, min, max, intraday spread and negative hours.

| column | type | note |
|---|---|---|
| base | real |  |
| delivery_date | date |  |
| intraday_spread | real |  |
| iso_weekday | smallint |  |
| max | real |  |
| min | real |  |
| month | date |  |
| neg_hours | real |  |
| offpeak | real |  |
| peak | real |  |
| resolution_min | smallint |  |
| zone | text |  |

### analytics.da_price_hourly (view)
Hourly average of the quarter-hour prices.

| column | type | note |
|---|---|---|
| delivery_date | date |  |
| hour | smallint |  |
| is_peak | boolean |  |
| price | real |  |
| zone | text |  |

### analytics.forward_curve (view)
Forward settlements with value_eur (GBP converted at the GBP/EUR cross of the trade date).

| column | type | note |
|---|---|---|
| currency | text |  |
| market | text |  |
| tenor | text |  |
| trade_date | date |  |
| value | double precision |  |
| value_eur | double precision |  |

### analytics.forward_curve_latest (view)
Latest settlement per market and tenor.

| column | type | note |
|---|---|---|
| currency | text |  |
| market | text |  |
| tenor | text |  |
| trade_date | date |  |
| value | double precision |  |
| value_eur | double precision |  |

### analytics.fr_generation_daily (view)
Daily averages of France generation per technology from RTE éCO2mix (MW).

| column | type | note |
|---|---|---|
| bio_mw | real |  |
| co2_g_kwh | real |  |
| coal_mw | real |  |
| dataset | text |  |
| delivery_date | date |  |
| exchanges_mw | real |  |
| gas_mw | real |  |
| hydro_mw | real |  |
| load_mw | real |  |
| nuclear_mw | real |  |
| oil_mw | real |  |
| pumping_mw | real |  |
| solar_mw | real |  |
| wind_mw | real |  |

### analytics.fr_generation_qh (view)
France quarter-hour generation from RTE éCO2mix next to the FR day-ahead price: base for capture prices and residual-load analyses.

| column | type | note |
|---|---|---|
| delivery_date | date |  |
| exchanges_mw | real |  |
| gas_mw | real |  |
| hydro_mw | real |  |
| load_mw | real |  |
| nuclear_mw | real |  |
| price_eur_mwh | real |  |
| slot | integer |  |
| slot_start_local | timestamp without time zone |  |
| solar_mw | real |  |
| wind_mw | real |  |

### analytics.fr_region_daily (view)
Daily averages per French region (MW, load factors in %).

| column | type | note |
|---|---|---|
| consumption_mw | real |  |
| dataset | text |  |
| delivery_date | date |  |
| exchanges_mw | real |  |
| hydro_mw | real |  |
| nuclear_mw | real |  |
| region | text |  |
| solar_lf_pct | real |  |
| solar_mw | real |  |
| thermal_mw | real |  |
| wind_lf_pct | real |  |
| wind_mw | real |  |

### analytics.fr_region_load_factor_monthly (view)
Monthly average wind and solar load factor per French region (%): the basis for regional PPA yield comparisons.

| column | type | note |
|---|---|---|
| days | bigint |  |
| month | date |  |
| region | text |  |
| solar_lf_pct | real |  |
| wind_lf_pct | real |  |

### analytics.generation_daily (view)
Daily average and max output per fuel; published_slots tells whether the day is complete.

| column | type | note |
|---|---|---|
| avg_mw | real |  |
| delivery_date | date |  |
| energy_mwh_if_full_day | real |  |
| fuel | text |  |
| max_mw | real |  |
| published_slots | bigint |  |
| slots | smallint |  |
| zone | text |  |

### analytics.generation_slot (view)
One row per zone, day, fuel and slot (MW).

| column | type | note |
|---|---|---|
| delivery_date | date |  |
| fuel | text |  |
| mw | real |  |
| slot | smallint |  |
| slot_start | time without time zone |  |
| slots | smallint |  |
| zone | text |  |

### analytics.installed_capacity (view)
Installed capacity per country, year and type. counts_in_total = false for planning targets, storage energy (GWh) and the DC duplicate of solar: never sum those.

| column | type | note |
|---|---|---|
| country | text |  |
| counts_in_total | boolean |  |
| gw | real |  |
| production_type | text |  |
| year | integer |  |

### analytics.installed_capacity_latest (view)
Latest year of installed capacity per country and production type (GW), with counts_in_total.

| column | type | note |
|---|---|---|
| country | text |  |
| counts_in_total | boolean |  |
| gw | real |  |
| production_type | text |  |
| year | integer |  |

### analytics.negative_hours_monthly (view)
Negative-price hours and days per zone and month.

| column | type | note |
|---|---|---|
| days | bigint |  |
| days_with_negative | bigint |  |
| lowest_price | real |  |
| month | date |  |
| neg_hours | real |  |
| zone | text |  |

### analytics.net_position_daily (view)
Daily average net import (MW) per country across all reported borders; negative = net exporter.

| column | type | note |
|---|---|---|
| country | text |  |
| delivery_date | date |  |
| neighbours | bigint |  |
| net_import_mw | double precision |  |


## market

### market.commodity (table)
Commodity series: ttf/peg/the (EUR/MWh), nbp (p/th), jkm ($/MMBtu), eua (EUR/t, front December), coal (API2 $/t, single benchmark contract), brent ($/bbl), eurusd/gbpusd, agsi (EU gas storage %), fr_nuc_avail / fr_nuc_avail_fc (French nuclear availability MW, actual / operator forecast).

| column | type | note |
|---|---|---|
| contract | text |  |
| key | text |  |
| name | text |  |
| source | text |  |
| unit | text |  |

### market.commodity_close (table)
Daily closes of fuel, carbon, FX and fundamentals series (see market.commodity for unit and contract).

| column | type | note |
|---|---|---|
| key | text |  |
| trade_date | date |  |
| value | double precision |  |

### market.crossborder_flow_day (table)
Physical cross-border flows per country and neighbour, hourly averages (MW) on the Paris delivery day; + = import into the country. Source Energy-Charts (Fraunhofer ISE), CC BY 4.0.

| column | type | note |
|---|---|---|
| country | text |  |
| delivery_date | date |  |
| mw | real[] |  |
| neighbour | text |  |
| source | text |  |

### market.da_price_day (table)
Day-ahead auction prices per bidding zone and delivery day (Paris). prices[] = 96 quarter-hours in EUR/MWh; hourly auctions are repeated ×4. Source ENTSO-E A44.

| column | type | note |
|---|---|---|
| avg | real |  |
| delivery_date | date | Delivery day in Europe/Paris. |
| flag | text | Null when valid. Otherwise the reason the day is kept but excluded from every analytics view (flat_zero_feed: whole day at 0.00 while coupled zones were well above zero). |
| loaded_at | timestamp with time zone |  |
| max | real |  |
| min | real |  |
| neg_hours | real | Hours with a strictly negative price. |
| offpeak_avg | real |  |
| peak_avg | real | Average 08:00–20:00 Paris, all days. |
| prices | real[] | 96 quarter-hour prices (EUR/MWh), slot 1 = 00:00–00:15 Paris. |
| resolution_min | smallint | Native auction resolution: 15 (quarter-hour products) or 60 (hourly, repeated ×4 in prices[]). |
| source | text |  |
| zone | text |  |

### market.forward_contract_close (table)
Settlement history of each calendar-year baseload contract (Cal2027 …).

| column | type | note |
|---|---|---|
| contract | text |  |
| currency | text |  |
| market | text |  |
| trade_date | date |  |
| value | double precision |  |

### market.forward_settlement (table)
Baseload power forward settlements by rolling tenor (M+1 … Y+3) per market. UK is in GBP.

| column | type | note |
|---|---|---|
| currency | text |  |
| market | text |  |
| source | text |  |
| tenor | text |  |
| trade_date | date |  |
| value | double precision |  |

### market.fr_eco2mix_day (table)
France national generation, load, exchanges and CO2 intensity from RTE éCO2mix (ODRÉ, Etalab licence): 96 Paris quarter-hours per day. Consolidated history since 2015 is half-hourly (each value held over its two quarter-hours); recent weeks are real-time 15-min data until consolidated. Preferred over ENTSO-E for France.

| column | type | note |
|---|---|---|
| battery_net_mw | real[] |  |
| bio_mw | real[] |  |
| co2_g_kwh | real[] |  |
| coal_mw | real[] |  |
| dataset | text |  |
| delivery_date | date |  |
| exchanges_mw | real[] |  |
| gas_mw | real[] |  |
| hydro_mw | real[] |  |
| hydro_ps_mw | real[] |  |
| load_mw | real[] |  |
| loaded_at | timestamp with time zone |  |
| nuclear_mw | real[] |  |
| oil_mw | real[] |  |
| pumping_mw | real[] |  |
| resolution_min | smallint |  |
| solar_mw | real[] |  |
| wind_mw | real[] |  |
| wind_offshore_mw | real[] |  |
| wind_onshore_mw | real[] |  |

### market.fr_m0_month (table)
Monthly M0 reference prices of the French complément de rémunération (wind, solar): Σ(day-ahead × RTE national production curve) ÷ Σ production. Recomputed by PowerKlock; may differ marginally from CRE publications.

| column | type | note |
|---|---|---|
| base_eur_mwh | real |  |
| complete | boolean |  |
| loaded_at | timestamp with time zone |  |
| month | date |  |
| solar_avg_mw | real |  |
| solar_m0_eur_mwh | real |  |
| solar_neg_share | real |  |
| wind_avg_mw | real |  |
| wind_m0_eur_mwh | real |  |
| wind_neg_share | real |  |

### market.fr_region_day (table)
French regions (RTE éCO2mix régional via ODRÉ, Etalab licence): 24 hourly averages per region and Paris day of consumption, production per technology, physical exchanges (+ = import) and wind / solar load factors (%). Consolidated since 2013; recent weeks real-time until consolidated.

| column | type | note |
|---|---|---|
| bio_mw | real[] |  |
| consumption_mw | real[] |  |
| dataset | text |  |
| delivery_date | date |  |
| exchanges_mw | real[] |  |
| hydro_mw | real[] |  |
| loaded_at | timestamp with time zone |  |
| nuclear_mw | real[] |  |
| region | text |  |
| solar_lf_pct | real[] |  |
| solar_mw | real[] |  |
| thermal_mw | real[] |  |
| wind_lf_pct | real[] |  |
| wind_mw | real[] |  |

### market.generation_day (table)
Actual generation per production type and day (ENTSO-E A75), realigned to the Paris clock. mw[] = average MW per slot; null = not published.

| column | type | note |
|---|---|---|
| delivery_date | date |  |
| fuel | text | PowerKlock aggregate: nuclear, wind, wind_onshore, wind_offshore, solar, hydro, fossil, biomass, other. Per ENTSO-E production type: market.generation_type_daily. |
| loaded_at | timestamp with time zone |  |
| mw | real[] |  |
| slots | smallint |  |
| source | text |  |
| zone | text |  |

### market.generation_type_daily (table)
Daily average and maximum output (MW) per ENTSO-E production type (psr:Bxx, see meta.fuel), Paris day; published_slots of slots tells whether the day is complete.

| column | type | note |
|---|---|---|
| avg_mw | real |  |
| delivery_date | date |  |
| max_mw | real |  |
| production_type | text |  |
| published_slots | smallint |  |
| slots | smallint |  |
| zone | text |  |

### market.go_auction (table)
French state GO auctions: volumes and clearing price per technology and production month.

| column | type | note |
|---|---|---|
| allocated_mwh | double precision |  |
| auction_month | date |  |
| offered_mwh | double precision |  |
| price_eur_mwh | double precision |  |
| source | text |  |
| technology | text |  |

### market.go_quote (table)
Guarantees of origin, weekly broker bid/ask (EUR/MWh) per product and production year.

| column | type | note |
|---|---|---|
| ask | double precision |  |
| bid | double precision |  |
| product | text |  |
| production_year | integer |  |
| quote_date | date |  |
| source | text |  |
| term | text |  |

### market.installed_capacity (table)
Installed net capacity per country, production type and year (GW). Source Energy-Charts (Fraunhofer ISE), CC BY 4.0.

| column | type | note |
|---|---|---|
| country | text |  |
| gw | real |  |
| production_type | text |  |
| source | text |  |
| year | integer |  |

### market.load_day (table)
Actual and day-ahead forecast total load (ENTSO-E A65), Paris clock.

| column | type | note |
|---|---|---|
| actual_mw | real[] |  |
| delivery_date | date |  |
| forecast_mw | real[] |  |
| loaded_at | timestamp with time zone |  |
| slots | smallint |  |
| source | text |  |
| zone | text |  |

### market.spot_reference (table)

| column | type | note |
|---|---|---|
| currency | text |  |
| market | text |  |
| trade_date | date |  |
| value | double precision |  |


## meta

### meta.convention (table)
Fuel-cost and calculation conventions shared with the website.

| column | type | note |
|---|---|---|
| description | text |  |
| key | text |  |
| unit | text |  |
| value | double precision |  |

### meta.dictionary (view)
Every table, view and column of the warehouse with its description.

| column | type | note |
|---|---|---|
| column_name | text |  |
| data_type | text |  |
| description | text |  |
| kind | text |  |
| object | name |  |
| schema | name |  |

### meta.fuel (table)
Fuels / ENTSO-E production types with the CO2 factor used by PowerKlock (life-cycle, g/kWh).

| column | type | note |
|---|---|---|
| co2_g_kwh | real |  |
| description | text |  |
| family | text |  |
| fuel | text |  |
| label | text |  |

### meta.zone (table)
Bidding zones used across PowerKlock.

| column | type | note |
|---|---|---|
| country | text |  |
| eic | text |  |
| name | text |  |
| timezone | text |  |
| zone | text |  |


## ops

### ops.quality_issue (table)
Current known data problems (refreshed after every sync): flat zero days, out-of-range prices, stale copies, missing days, unpublished generation, stale commodity series.

| column | type | note |
|---|---|---|
| check_name | text |  |
| dataset | text |  |
| day | date |  |
| detail | text |  |
| detected_at | timestamp with time zone |  |
| issue_id | bigint |  |
| severity | text |  |
| zone | text |  |

### ops.sync_run (table)
One row per warehouse sync (GitHub Actions), with status and row counts.

| column | type | note |
|---|---|---|
| files_read | integer |  |
| finished_at | timestamp with time zone |  |
| git_commit | text |  |
| message | text |  |
| mode | text |  |
| rows_written | integer |  |
| run_id | bigint |  |
| started_at | timestamp with time zone |  |
| status | text |  |

