-- ════════════════════════════════════════════════════════════════════
-- PowerKlock warehouse · 002 · reference data
-- Zones (js/prices.js ZONES), fuels and ENTSO-E production types with the
-- CO2 factors used on the site (js/genmix.js, js/carbon.js), and the
-- fuel-cost conventions of js/commodities.js (PKC.FUEL).
-- ════════════════════════════════════════════════════════════════════
insert into meta.zone (zone, name, country, eic) values
  ('IT_SOUTH', 'Italy South', 'IT', '10Y1001A1001A788'),
  ('IT_NORD', 'Italy North', 'IT', '10Y1001A1001A73I'),
  ('HU', 'Hungary', 'HU', '10YHU-MAVIR----U'),
  ('SI', 'Slovenia', 'SI', '10YSI-ELES-----O'),
  ('RO', 'Romania', 'RO', '10YRO-TEL------P'),
  ('HR', 'Croatia', 'HR', '10YHR-HEP------M'),
  ('RS', 'Serbia', 'RS', '10YCS-SERBIATSOV'),
  ('GR', 'Greece', 'GR', '10YGR-HTSO-----Y'),
  ('MK', 'N. Macedonia', 'MK', '10YMK-MEPSO----8'),
  ('BG', 'Bulgaria', 'BG', '10YCA-BULGARIA-R'),
  ('ME', 'Montenegro', 'ME', '10YCS-CG-TSO---S'),
  ('CH', 'Switzerland', 'CH', '10YCH-SWISSGRIDZ'),
  ('AT', 'Austria', 'AT', '10YAT-APG------L'),
  ('LT', 'Lithuania', 'LT', '10YLT-1001A0008Q'),
  ('LV', 'Latvia', 'LV', '10YLV-1001A00074'),
  ('EE', 'Estonia', 'EE', '10Y1001A1001A39I'),
  ('FI', 'Finland', 'FI', '10YFI-1--------U'),
  ('PT', 'Portugal', 'PT', '10YPT-REN------W'),
  ('SK', 'Slovakia', 'SK', '10YSK-SEPS-----K'),
  ('ES', 'Spain', 'ES', '10YES-REE------0'),
  ('DK_W', 'Denmark West', 'DK', '10YDK-1--------W'),
  ('CZ', 'Czechia', 'CZ', '10YCZ-CEPS-----N'),
  ('NO_2', 'Norway Central', 'NO', '10YNO-2--------T'),
  ('DE_LU', 'Germany', 'DE', '10Y1001A1001A82H'),
  ('NL', 'Netherlands', 'NL', '10YNL----------L'),
  ('BE', 'Belgium', 'BE', '10YBE----------2'),
  ('NO_3', 'Norway N-Mid', 'NO', '10YNO-3--------J'),
  ('NO_1', 'Norway North', 'NO', '10YNO-1--------2'),
  ('SE_3', 'Sweden N-Mid', 'SE', '10Y1001A1001A46L'),
  ('FR', 'France', 'FR', '10YFR-RTE------C'),
  ('GB', 'Great Britain', 'GB', '10YGB----------A'),
  ('DK_E', 'Denmark East', 'DK', '10YDK-2--------M'),
  ('SE', 'Sweden', 'SE', '10YSE-1--------K'),
  ('IT_SICI', 'Italy Sicily', 'IT', '10Y1001A1001A75E'),
  ('UK', 'Great Britain', 'GB', null),
  ('DE', 'Germany', 'DE', null)
on conflict (zone) do update set name = excluded.name, country = excluded.country, eic = coalesce(excluded.eic, meta.zone.eic);

insert into meta.fuel (fuel, label, family, co2_g_kwh, description) values
  ('nuclear', 'Nuclear', 'nuclear', 12, 'PowerKlock aggregate'),
  ('hydro', 'Hydro (all)', 'renewable', 24, 'PowerKlock aggregate'),
  ('wind', 'Wind (on + offshore)', 'renewable', 11, 'PowerKlock aggregate'),
  ('wind_onshore', 'Wind onshore', 'renewable', 11, 'PowerKlock aggregate'),
  ('wind_offshore', 'Wind offshore', 'renewable', 12, 'PowerKlock aggregate'),
  ('solar', 'Solar', 'renewable', 45, 'PowerKlock aggregate'),
  ('biomass', 'Biomass', 'renewable', 230, 'PowerKlock aggregate'),
  ('fossil', 'Fossil (gas + coal + oil)', 'fossil', 650, 'PowerKlock aggregate'),
  ('other', 'Other', 'other', 400, 'PowerKlock aggregate'),
  ('psr:B01', 'Biomass', 'renewable', 230, 'ENTSO-E production type B01'),
  ('psr:B02', 'Lignite', 'fossil', 1050, 'ENTSO-E production type B02'),
  ('psr:B03', 'Coal-derived gas', 'fossil', 820, 'ENTSO-E production type B03'),
  ('psr:B04', 'Fossil Gas', 'fossil', 490, 'ENTSO-E production type B04'),
  ('psr:B05', 'Hard coal', 'fossil', 820, 'ENTSO-E production type B05'),
  ('psr:B06', 'Fossil Oil', 'fossil', 650, 'ENTSO-E production type B06'),
  ('psr:B07', 'Oil shale', 'fossil', 900, 'ENTSO-E production type B07'),
  ('psr:B08', 'Peat', 'fossil', 1000, 'ENTSO-E production type B08'),
  ('psr:B09', 'Geothermal', 'renewable', 38, 'ENTSO-E production type B09'),
  ('psr:B10', 'Hydro Pumped Storage', 'storage', 24, 'ENTSO-E production type B10'),
  ('psr:B11', 'Hydro Run-of-river', 'renewable', 24, 'ENTSO-E production type B11'),
  ('psr:B12', 'Hydro Reservoir', 'renewable', 24, 'ENTSO-E production type B12'),
  ('psr:B13', 'Marine', 'renewable', 17, 'ENTSO-E production type B13'),
  ('psr:B14', 'Nuclear', 'nuclear', 12, 'ENTSO-E production type B14'),
  ('psr:B15', 'Other renewable', 'renewable', 26, 'ENTSO-E production type B15'),
  ('psr:B16', 'Solar', 'renewable', 45, 'ENTSO-E production type B16'),
  ('psr:B17', 'Waste', 'fossil', 580, 'ENTSO-E production type B17'),
  ('psr:B18', 'Wind Offshore', 'renewable', 12, 'ENTSO-E production type B18'),
  ('psr:B19', 'Wind Onshore', 'renewable', 11, 'ENTSO-E production type B19'),
  ('psr:B20', 'Other', 'other', 700, 'ENTSO-E production type B20'),
  ('psr:B25', 'Energy storage', 'storage', 0, 'ENTSO-E production type B25')
on conflict (fuel) do update set label = excluded.label, family = excluded.family, co2_g_kwh = excluded.co2_g_kwh, description = excluded.description;

insert into meta.convention (key, value, unit, description) values
  ('ccgt_efficiency', 0.4913, 'ratio', 'CCGT net efficiency (HHV basis) used for clean spark spreads'),
  ('gas_ef', 0.202, 'tCO2/MWh_th', 'Natural gas emission factor (thermal)'),
  ('coal_efficiency', 0.36, 'ratio', 'Coal unit net efficiency used for clean dark spreads'),
  ('coal_mwh_per_t', 6.978, 'MWh_th/t', 'API2 coal energy content'),
  ('coal_ef', 0.341, 'tCO2/MWh_th', 'Coal emission factor (thermal)'),
  ('peak_start_hour', 8, 'hour', 'Peak window start (Paris clock, inclusive)'),
  ('peak_end_hour', 20, 'hour', 'Peak window end (Paris clock, exclusive)'),
  ('fr_nuclear_installed_mw', 63000, 'MW', 'Installed French nuclear capacity (57 reactors incl. Flamanville 3)')
on conflict (key) do update set value = excluded.value, unit = excluded.unit, description = excluded.description;
