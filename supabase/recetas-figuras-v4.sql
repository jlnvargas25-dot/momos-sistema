-- MOMOS OPS · H112 · Recetas y ensamblaje de figuras V4.
-- Fuente confirmada por Producción: MOMOS_OPS_Especificacion_Recetas_Figuras_v4.md.
-- V4 reemplaza los gramajes y rellenos operativos, conserva los lotes históricos
-- con su versión anterior y registra las nuevas fórmulas como validación piloto.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260723'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations
    where id='20260722_111_conciliacion_higgsfield'
  ) then
    raise exception 'Falta el paso 111_conciliacion_higgsfield.';
  end if;
  if to_regclass('public.figuras') is null
     or to_regclass('public.figura_relleno') is null
     or to_regclass('public.kitchen_procedure_versions') is null
     or to_regclass('public.subrecetas') is null
     or to_regclass('public.inventory_items') is null then
    raise exception 'Faltan figuras, rellenos, fichas técnicas o inventario.';
  end if;
end $$;

-- La versión queda sellada también en cada lote: un cambio futuro del catálogo
-- jamás debe reinterpretar el peso de una producción anterior.
alter table public.figuras
  add column if not exists assembly_spec_version text not null default 'V3';
alter table public.figuras
  alter column assembly_spec_version set default 'V4';

alter table public.production_batches
  add column if not exists assembly_spec_version text not null default 'V3';
alter table public.production_batches
  alter column assembly_spec_version set default 'V4';

create table if not exists public.figure_assembly_specs(
  spec_version text not null,
  figure_name text not null,
  status text not null check(status in ('Histórica','Vigente','Suspendida')),
  finished_weight_g numeric not null check(finished_weight_g>0),
  mousse_g numeric not null check(mousse_g>0),
  ganache_g numeric not null check(ganache_g>0),
  cheesecake_g numeric not null check(cheesecake_g>0),
  mousse_loss_pct numeric not null check(mousse_loss_pct between 0 and 30),
  filling_loss_pct numeric not null check(filling_loss_pct between 0 and 30),
  source_ref text not null check(length(btrim(source_ref)) between 1 and 200),
  effective_from date not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(spec_version,figure_name),
  foreign key(figure_name) references public.figuras(nombre),
  check(mousse_g+ganache_g+cheesecake_g=finished_weight_g)
);
alter table public.figure_assembly_specs enable row level security;
drop policy if exists figure_assembly_specs_staff_read on public.figure_assembly_specs;
create policy figure_assembly_specs_staff_read on public.figure_assembly_specs
  for select to authenticated using(public.is_staff());
revoke all on table public.figure_assembly_specs from public,anon,authenticated,service_role;
grant select on table public.figure_assembly_specs to authenticated;

-- Captura de la especificación previa antes de activar V4.
insert into public.figure_assembly_specs(
  spec_version,figure_name,status,finished_weight_g,mousse_g,ganache_g,
  cheesecake_g,mousse_loss_pct,filling_loss_pct,source_ref,effective_from
)
select 'V3',f.nombre,'Histórica',f.gramaje_g,f.gramaje_g-35,15,20,0,0,
  'RECETAS.md · especificación anterior',date '2026-07-11'
from public.figuras f
where f.activo and f.nombre in ('Lizi','Momo','Toby','Teo','Max','Rocco','Danna')
on conflict(spec_version,figure_name) do nothing;

-- H90 protege el catalogo con esta funcion inmutable. V4 actualiza primero el
-- contrato canonico para que el trigger acepte los nuevos pesos confirmados.
create or replace function public._momos_gramaje_figura_esperado(p_nombre text)
returns integer language sql immutable parallel safe
set search_path=pg_catalog,public,pg_temp as $$
  select case btrim(coalesce(p_nombre,''))
    when 'Lizi' then 150 when 'Teo' then 320
    when 'Momo' then 210 when 'Toby' then 210 when 'Max' then 210
    when 'Rocco' then 210 when 'Danna' then 210 else null end
$$;


update public.figuras
set gramaje_g=case nombre
  when 'Lizi' then 150
  when 'Teo' then 320
  else 210
end,
assembly_spec_version='V4'
where activo and nombre in ('Lizi','Momo','Toby','Teo','Max','Rocco','Danna');

update public.figura_relleno
set gramos_por_unidad=case subreceta_id
  when 'SR12' then 40
  when 'SR13' then 30
  else gramos_por_unidad
end
where activo and subreceta_id in ('SR12','SR13');


-- La formula permanece como borrador hasta el piloto; los parametros de merma
-- si gobiernan desde V4 el calculo de cuanto debe prepararse.
update public.subrecetas
set merma_pct=case when id in ('SR12','SR13') then 3 else 5 end
where activo and id in (
  'SR01','SR02','SR03','SR04','SR05','SR06','SR07','SR08','SR09','SR10','SR11','SR12','SR13'
);
insert into public.figure_assembly_specs(
  spec_version,figure_name,status,finished_weight_g,mousse_g,ganache_g,
  cheesecake_g,mousse_loss_pct,filling_loss_pct,source_ref,effective_from
)
values
  ('V4','Lizi','Vigente',150,80,30,40,5,3,'MOMOS_OPS_Especificacion_Recetas_Figuras_v4.md',date '2026-07-23'),
  ('V4','Momo','Vigente',210,140,30,40,5,3,'MOMOS_OPS_Especificacion_Recetas_Figuras_v4.md',date '2026-07-23'),
  ('V4','Toby','Vigente',210,140,30,40,5,3,'MOMOS_OPS_Especificacion_Recetas_Figuras_v4.md',date '2026-07-23'),
  ('V4','Max','Vigente',210,140,30,40,5,3,'MOMOS_OPS_Especificacion_Recetas_Figuras_v4.md',date '2026-07-23'),
  ('V4','Rocco','Vigente',210,140,30,40,5,3,'MOMOS_OPS_Especificacion_Recetas_Figuras_v4.md',date '2026-07-23'),
  ('V4','Danna','Vigente',210,140,30,40,5,3,'MOMOS_OPS_Especificacion_Recetas_Figuras_v4.md',date '2026-07-23'),
  ('V4','Teo','Vigente',320,250,30,40,5,3,'MOMOS_OPS_Especificacion_Recetas_Figuras_v4.md',date '2026-07-23')
on conflict(spec_version,figure_name) do update set
  status=excluded.status,
  finished_weight_g=excluded.finished_weight_g,
  mousse_g=excluded.mousse_g,
  ganache_g=excluded.ganache_g,
  cheesecake_g=excluded.cheesecake_g,
  mousse_loss_pct=excluded.mousse_loss_pct,
  filling_loss_pct=excluded.filling_loss_pct,
  source_ref=excluded.source_ref,
  effective_from=excluded.effective_from;

-- Insumos definidos por V4. Nacen sin existencia, proveedor ni costo real:
-- el sistema no debe inventar una compra ni un costo.
insert into public.inventory_items(
  id,nombre,cat,unidad,stock,minimo,costo,proveedor,ubicacion,sede_id,
  costo_estimado,origen_abastecimiento
)
values
  ('I61','Dextrosa','Ingredientes','kg',0,0,0,'','Pendiente de alta','SEDE-01',true,'Compra'),
  ('I62','Inulina','Ingredientes','kg',0,0,0,'','Pendiente de alta','SEDE-01',true,'Compra'),
  ('I63','Multigel','Ingredientes','kg',0,0,0,'','Pendiente de alta','SEDE-01',true,'Compra'),
  ('I64','Emulsionante para mousse','Ingredientes','kg',0,0,0,'','Pendiente de ficha técnica','SEDE-01',true,'Compra')
on conflict(id) do update set
  nombre=excluded.nombre,
  cat=excluded.cat,
  origen_abastecimiento=excluded.origen_abastecimiento;

create table if not exists public.kitchen_recipe_pilot_controls(
  procedure_version_id bigint primary key
    references public.kitchen_procedure_versions(id),
  spec_version text not null,
  recipe_code text not null unique,
  validation_status text not null check(validation_status in (
    'VALIDACION_PILOTO','AJUSTE_REQUERIDO','APROBADA_PRODUCCION',
    'SUSPENDIDA','ARCHIVADA'
  )),
  source_yield_g numeric not null check(source_yield_g>0),
  transformation_loss_pct numeric not null check(transformation_loss_pct between 0 and 30),
  source_formula_g jsonb not null check(jsonb_typeof(source_formula_g)='array'),
  blockers jsonb not null check(jsonb_typeof(blockers)='array'),
  sugar_system jsonb not null default '{}'::jsonb
    check(jsonb_typeof(sugar_system)='object'),
  contains_maltodextrin boolean not null default false,
  source_ref text not null check(length(btrim(source_ref)) between 1 and 200),
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  resolved_by uuid references public.users(auth_id),
  resolution_note text,
  check(not contains_maltodextrin)
);
alter table public.kitchen_recipe_pilot_controls enable row level security;
drop policy if exists kitchen_recipe_pilot_staff_read on public.kitchen_recipe_pilot_controls;
create policy kitchen_recipe_pilot_staff_read on public.kitchen_recipe_pilot_controls
  for select to authenticated using(public.is_staff());
revoke all on table public.kitchen_recipe_pilot_controls from public,anon,authenticated,service_role;
grant select on table public.kitchen_recipe_pilot_controls to authenticated;

create table if not exists public.kitchen_recipe_pilot_results(
  id bigint generated always as identity primary key,
  procedure_version_id bigint not null
    references public.kitchen_recipe_pilot_controls(procedure_version_id),
  batch_key text not null,
  tested_at timestamptz not null default clock_timestamp(),
  gross_input_g numeric check(gross_input_g>0),
  net_output_g numeric check(net_output_g>0),
  actual_loss_pct numeric check(actual_loss_pct between 0 and 100),
  unmold_ok boolean,
  weight_tolerance_ok boolean,
  crystals_ok boolean,
  hardness_ok boolean,
  syneresis_ok boolean,
  emulsion_ok boolean,
  flavor_ok boolean,
  filling_flow_ok boolean,
  stability_ok boolean,
  fruit_gross_g numeric check(fruit_gross_g>0),
  fruit_pulp_g numeric check(fruit_pulp_g>0),
  fruit_yield_pct numeric check(fruit_yield_pct between 0 and 100),
  recorded_by uuid references public.users(auth_id),
  unique(procedure_version_id,batch_key),
  check(fruit_pulp_g is null or fruit_gross_g is not null),
  check(fruit_yield_pct is null or fruit_gross_g is not null)
);
alter table public.kitchen_recipe_pilot_results enable row level security;
drop policy if exists kitchen_recipe_pilot_results_staff_read on public.kitchen_recipe_pilot_results;
create policy kitchen_recipe_pilot_results_staff_read on public.kitchen_recipe_pilot_results
  for select to authenticated using(public.is_staff());
revoke all on table public.kitchen_recipe_pilot_results from public,anon,authenticated,service_role;
grant select on table public.kitchen_recipe_pilot_results to authenticated;

create table if not exists public.fruit_yield_profiles(
  net_item_id text primary key references public.inventory_items(id),
  expected_yield_pct numeric not null check(expected_yield_pct>0 and expected_yield_pct<=100),
  conversion_factor numeric generated always as (100/expected_yield_pct) stored,
  status text not null check(status in ('Provisional','Validado','Suspendido')),
  supplier text not null default '',
  source_ref text not null,
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.fruit_yield_profiles enable row level security;
drop policy if exists fruit_yield_profiles_staff_read on public.fruit_yield_profiles;
create policy fruit_yield_profiles_staff_read on public.fruit_yield_profiles
  for select to authenticated using(public.is_staff());
revoke all on table public.fruit_yield_profiles from public,anon,authenticated,service_role;
grant select on table public.fruit_yield_profiles to authenticated;

insert into public.fruit_yield_profiles(
  net_item_id,expected_yield_pct,status,source_ref
)
values
  ('I07',50,'Provisional','MOMOS_OPS_Especificacion_Recetas_Figuras_v4.md'),
  ('I23',50,'Provisional','MOMOS_OPS_Especificacion_Recetas_Figuras_v4.md'),
  ('I21',50,'Provisional','MOMOS_OPS_Especificacion_Recetas_Figuras_v4.md'),
  ('I19',50,'Provisional','MOMOS_OPS_Especificacion_Recetas_Figuras_v4.md'),
  ('I24',50,'Provisional','MOMOS_OPS_Especificacion_Recetas_Figuras_v4.md'),
  ('I25',50,'Provisional','MOMOS_OPS_Especificacion_Recetas_Figuras_v4.md')
on conflict(net_item_id) do update set
  expected_yield_pct=excluded.expected_yield_pct,
  status=excluded.status,
  source_ref=excluded.source_ref,
  updated_at=clock_timestamp();

-- Ningún borrador V4 puede convertirse en receta vigente si todavía conserva
-- bloqueos técnicos o no fue aprobado expresamente después del piloto.
create or replace function public._proteger_publicacion_receta_piloto_v4()
returns trigger
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare v_control public.kitchen_recipe_pilot_controls%rowtype;
begin
  if new.status='Vigente' and old.status<>'Vigente' then
    select * into v_control
    from public.kitchen_recipe_pilot_controls
    where procedure_version_id=new.id;
    if found and (
      v_control.validation_status<>'APROBADA_PRODUCCION'
      or jsonb_array_length(v_control.blockers)>0
    ) then
      raise exception 'La receta V4 continúa en validación piloto o conserva bloqueos técnicos.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public._proteger_publicacion_receta_piloto_v4()
  from public,anon,authenticated,service_role;
drop trigger if exists kitchen_recipe_pilot_publication_guard
  on public.kitchen_procedure_versions;
create trigger kitchen_recipe_pilot_publication_guard
before update on public.kitchen_procedure_versions
for each row execute function public._proteger_publicacion_receta_piloto_v4();

-- Las fórmulas fuente se conservan exactamente en gramos. La fórmula de la
-- ficha se normaliza a 1.000 g para ser compatible con el BOM actual.
create temporary table _momos_v4_specs(
  subrecipe_id text primary key,
  recipe_code text not null,
  source_yield_g numeric not null,
  loss_pct numeric not null,
  formula_g jsonb not null,
  steps jsonb not null,
  blockers jsonb not null,
  sugar_system jsonb not null
) on commit drop;

insert into _momos_v4_specs values
('SR01','BASE-MOUSSE-MANGO-BICHE-V4',206.9,5,
 '[{"item_id":"I07","qty_g":100},{"item_id":"I01","qty_g":58},{"item_id":"I20","qty_g":10},{"item_id":"I17","qty_g":10},{"item_id":"I18","qty_g":11.9},{"item_id":"I61","qty_g":2.1},{"item_id":"I62","qty_g":4},{"item_id":"I15","qty_g":2},{"item_id":"I63","qty_g":0.5},{"item_id":"I16","qty_g":1.4},{"item_id":"I19","qty_g":7}]',
 '[{"title":"Pesar y verificar","detail":"Pesar cada ingrediente y verificar su lote."},{"title":"Hidratar gelatina","detail":"Hidratar la gelatina en agua fría durante 8–10 minutos."},{"title":"Mezclar secos","detail":"Mezclar sacarosa, dextrosa, leche en polvo, inulina y Multigel."},{"title":"Dispersar","detail":"Añadir los secos gradualmente a la pulpa con batidora de inmersión."},{"title":"Calentar","detail":"Calentar la fase frutal a 45–55 °C."},{"title":"Incorporar estabilización","detail":"Añadir sal; el emulsionante queda bloqueado hasta contar con ficha técnica."},{"title":"Agregar gelatina","detail":"Fundir sin hervir e incorporar con la base a 30–35 °C."},{"title":"Ajustar acidez","detail":"Añadir el zumo de limón indicado."},{"title":"Enfriar","detail":"Llevar la base a 25–30 °C."},{"title":"Semimontar crema","detail":"Semimontar la crema hasta una textura fluida, no rígida."},{"title":"Integrar","detail":"Integrar la crema en 2–3 adiciones con movimientos envolventes."},{"title":"Dosificar y congelar","detail":"Llenar moldes y congelar inmediatamente en modo Turbo."}]',
 '["EMULSIONANTE_SIN_FICHA","DENSIDAD_LIQUIDOS_PENDIENTE","PRUEBA_PILOTO_PENDIENTE"]',
 '{"added_sugar":{"sucrose_pct":85,"dextrose_pct":15}}'),
('SR03','BASE-MOUSSE-MARACUYA-V4',202.5,5,
 '[{"item_id":"I23","qty_g":100},{"item_id":"I01","qty_g":60},{"item_id":"I20","qty_g":10},{"item_id":"I17","qty_g":10},{"item_id":"I18","qty_g":12.75},{"item_id":"I61","qty_g":2.25},{"item_id":"I62","qty_g":4},{"item_id":"I15","qty_g":2},{"item_id":"I63","qty_g":0.5},{"item_id":"I16","qty_g":1}]',
 '[{"title":"Hidratar gelatina","detail":"Hidratar la gelatina en agua fría durante 8–10 minutos."},{"title":"Mezclar secos","detail":"Mezclar sacarosa, dextrosa, leche en polvo, inulina y Multigel."},{"title":"Dispersar y calentar","detail":"Dispersar en la pulpa y calentar a 45–55 °C."},{"title":"Estabilizar","detail":"Añadir sal; incorporar emulsionante solo cuando exista ficha técnica."},{"title":"Agregar gelatina","detail":"Incorporar la gelatina con la base a 30–35 °C."},{"title":"Enfriar","detail":"Enfriar a 25–30 °C."},{"title":"Integrar crema","detail":"Semimontar e integrar la crema de forma envolvente."},{"title":"Dosificar y congelar","detail":"Llenar moldes inmediatamente y congelar en modo Turbo."}]',
 '["EMULSIONANTE_SIN_FICHA","DENSIDAD_LIQUIDOS_PENDIENTE","PRUEBA_PILOTO_PENDIENTE"]',
 '{"added_sugar":{"sucrose_pct":85,"dextrose_pct":15}}'),
('SR02','BASE-MOUSSE-COCO-V4',198.3,5,
 '[{"item_id":"I21","qty_g":100},{"item_id":"I01","qty_g":58},{"item_id":"I20","qty_g":10},{"item_id":"I17","qty_g":10},{"item_id":"I18","qty_g":8.5},{"item_id":"I61","qty_g":1.5},{"item_id":"I62","qty_g":4},{"item_id":"I15","qty_g":2},{"item_id":"I63","qty_g":0.5},{"item_id":"I19","qty_g":3},{"item_id":"I16","qty_g":0.8}]',
 '[{"title":"Hidratar gelatina","detail":"Hidratar la gelatina en agua fría durante 8–10 minutos."},{"title":"Mezclar secos","detail":"Mezclar sacarosa, dextrosa, leche en polvo, inulina y Multigel."},{"title":"Dispersar y calentar","detail":"Dispersar en la base de coco y calentar a 45–55 °C."},{"title":"Agregar gelatina","detail":"Incorporar la gelatina con la base a 30–35 °C."},{"title":"Añadir limón","detail":"Añadir el zumo de limón antes de integrar la crema."},{"title":"Enfriar e integrar","detail":"Enfriar a 25–30 °C e integrar crema semimontada."},{"title":"Dosificar y congelar","detail":"Llenar moldes inmediatamente y congelar en modo Turbo."}]',
 '["INSUMO_COCO_EXACTO_PENDIENTE","EMULSIONANTE_SIN_FICHA","DENSIDAD_LIQUIDOS_PENDIENTE","PRUEBA_PILOTO_PENDIENTE"]',
 '{"added_sugar":{"sucrose_pct":85,"dextrose_pct":15}}'),
('SR04','BASE-MOUSSE-LIMON-V4',209.3,5,
 '[{"item_id":"I19","qty_g":100},{"item_id":"I01","qty_g":62},{"item_id":"I20","qty_g":10},{"item_id":"I17","qty_g":10},{"item_id":"I18","qty_g":17},{"item_id":"I61","qty_g":3},{"item_id":"I62","qty_g":4},{"item_id":"I15","qty_g":2},{"item_id":"I63","qty_g":0.5},{"item_id":"I16","qty_g":0.8}]',
 '[{"title":"Preparar limón","detail":"Preparar una base colada y sin exceso de fibra gruesa."},{"title":"Hidratar gelatina","detail":"Hidratar la gelatina en agua fría durante 8–10 minutos."},{"title":"Mezclar secos","detail":"Mezclar sacarosa, dextrosa, leche en polvo, inulina y Multigel."},{"title":"Dispersar con cuidado","detail":"Dispersar sin calentar el zumo ácido durante demasiado tiempo."},{"title":"Agregar gelatina","detail":"Incorporar la gelatina con la mezcla por debajo de 35 °C."},{"title":"Integrar crema","detail":"Semimontar e integrar la crema evitando que se corte."},{"title":"Dosificar y congelar","detail":"Llenar moldes inmediatamente y congelar en modo Turbo."}]',
 '["EMULSIONANTE_SIN_FICHA","DENSIDAD_LIQUIDOS_PENDIENTE","PRUEBA_PILOTO_PENDIENTE"]',
 '{"added_sugar":{"sucrose_pct":85,"dextrose_pct":15}}'),
('SR05','BASE-MOUSSE-BANANO-V4',195.3,5,
 '[{"item_id":"I24","qty_g":100},{"item_id":"I01","qty_g":58},{"item_id":"I20","qty_g":10},{"item_id":"I17","qty_g":10},{"item_id":"I18","qty_g":6.8},{"item_id":"I61","qty_g":1.2},{"item_id":"I62","qty_g":4},{"item_id":"I15","qty_g":2},{"item_id":"I63","qty_g":0.5},{"item_id":"I19","qty_g":3},{"item_id":"I16","qty_g":0.8}]',
 '[{"title":"Procesar banano","detail":"Procesar el banano con el zumo de limón para limitar la oxidación."},{"title":"Hidratar gelatina","detail":"Hidratar la gelatina en agua fría durante 8–10 minutos."},{"title":"Mezclar secos","detail":"Mezclar sacarosa, dextrosa, leche en polvo, inulina y Multigel."},{"title":"Dispersar y calentar","detail":"Dispersar en el banano y calentar la fase a 45–55 °C."},{"title":"Agregar gelatina","detail":"Incorporar la gelatina con la base a 30–35 °C."},{"title":"Integrar crema","detail":"Enfriar, semimontar e integrar sin sobrebatir."},{"title":"Dosificar y congelar","detail":"Llenar moldes inmediatamente y congelar en modo Turbo."}]',
 '["EMULSIONANTE_SIN_FICHA","DENSIDAD_LIQUIDOS_PENDIENTE","PRUEBA_PILOTO_PENDIENTE"]',
 '{"added_sugar":{"sucrose_pct":85,"dextrose_pct":15}}'),
('SR06','BASE-MOUSSE-DURAZNO-V4',194.7,5,
 '[{"item_id":"I25","qty_g":100},{"item_id":"I01","qty_g":58},{"item_id":"I20","qty_g":10},{"item_id":"I17","qty_g":10},{"item_id":"I18","qty_g":6.8},{"item_id":"I61","qty_g":1.2},{"item_id":"I62","qty_g":4},{"item_id":"I15","qty_g":2},{"item_id":"I63","qty_g":0.5},{"item_id":"I19","qty_g":2},{"item_id":"I16","qty_g":0.7}]',
 '[{"title":"Verificar durazno","detail":"Pesar pulpa; si proviene de conserva, registrar producto y almíbar exactos."},{"title":"Hidratar gelatina","detail":"Hidratar la gelatina en agua fría durante 8–10 minutos."},{"title":"Mezclar secos","detail":"Mezclar sacarosa, dextrosa, leche en polvo, inulina y Multigel."},{"title":"Dispersar y calentar","detail":"Dispersar en la pulpa y calentar a 45–55 °C."},{"title":"Agregar gelatina","detail":"Incorporar la gelatina con la base a 30–35 °C."},{"title":"Integrar crema","detail":"Enfriar a 25–30 °C e integrar crema semimontada."},{"title":"Dosificar y congelar","detail":"Llenar moldes inmediatamente y congelar en modo Turbo."}]',
 '["EMULSIONANTE_SIN_FICHA","DENSIDAD_LIQUIDOS_PENDIENTE","PRUEBA_PILOTO_PENDIENTE"]',
 '{"added_sugar":{"sucrose_pct":85,"dextrose_pct":15}}'),
('SR07','BASE-MOUSSE-OREO-V4',200.5,5,
 '[{"item_id":"I01","qty_g":145},{"item_id":"I27","qty_g":35},{"item_id":"I17","qty_g":8},{"item_id":"I20","qty_g":10},{"item_id":"I15","qty_g":2},{"item_id":"I16","qty_g":0.5}]',
 '[{"title":"Hidratar gelatina","detail":"Hidratar la gelatina en el agua fría."},{"title":"Calentar fase","detail":"Calentar 45 g de crema con la leche en polvo."},{"title":"Incorporar gelatina","detail":"Fundir e incorporar la gelatina sin hervir."},{"title":"Añadir Oreo","detail":"Añadir la Oreo triturada fina y homogeneizar."},{"title":"Enfriar","detail":"Enfriar la base a 25–30 °C."},{"title":"Semimontar crema","detail":"Semimontar los 100 g restantes de crema."},{"title":"Integrar y dosificar","detail":"Integrar de forma envolvente y dosificar inmediatamente."}]',
 '["OREO_EXACTA_PENDIENTE","DENSIDAD_LIQUIDOS_PENDIENTE","PRUEBA_PILOTO_PENDIENTE"]','{}'),
('SR08','BASE-MOUSSE-NUTELLA-V4',202.4,5,
 '[{"item_id":"I01","qty_g":145},{"item_id":"I04","qty_g":40},{"item_id":"I17","qty_g":5},{"item_id":"I20","qty_g":10},{"item_id":"I15","qty_g":2},{"item_id":"I16","qty_g":0.4}]',
 '[{"title":"Hidratar gelatina","detail":"Hidratar la gelatina en el agua fría."},{"title":"Calentar fase","detail":"Calentar 45 g de crema con la leche en polvo."},{"title":"Incorporar gelatina","detail":"Incorporar la gelatina fundida sin hervir."},{"title":"Emulsionar Nutella","detail":"Emulsionar la fase caliente con la Nutella."},{"title":"Enfriar","detail":"Enfriar la base a 25–30 °C."},{"title":"Semimontar crema","detail":"Semimontar los 100 g restantes de crema."},{"title":"Integrar y dosificar","detail":"Integrar de forma envolvente y dosificar."}]',
 '["DENSIDAD_LIQUIDOS_PENDIENTE","PRUEBA_PILOTO_PENDIENTE"]','{}'),
('SR10','BASE-MOUSSE-MILO-V4',197.5,5,
 '[{"item_id":"I01","qty_g":145},{"item_id":"I33","qty_g":32},{"item_id":"I17","qty_g":8},{"item_id":"I20","qty_g":10},{"item_id":"I15","qty_g":2},{"item_id":"I16","qty_g":0.5}]',
 '[{"title":"Hidratar gelatina","detail":"Hidratar la gelatina en el agua fría."},{"title":"Calentar crema","detail":"Calentar 55 g de crema."},{"title":"Disolver sólidos","detail":"Disolver Milo y leche en polvo en la crema caliente."},{"title":"Incorporar gelatina","detail":"Incorporar la gelatina fundida."},{"title":"Enfriar","detail":"Enfriar la base a 25–30 °C."},{"title":"Semimontar crema","detail":"Semimontar los 90 g restantes de crema."},{"title":"Integrar y dosificar","detail":"Integrar de forma envolvente y llenar moldes."}]',
 '["DENSIDAD_LIQUIDOS_PENDIENTE","PRUEBA_PILOTO_PENDIENTE"]','{}'),
('SR09','BASE-MOUSSE-MNM-V4',211.4,5,
 '[{"item_id":"I01","qty_g":140},{"item_id":"I37","qty_g":25},{"item_id":"I32","qty_g":25},{"item_id":"I17","qty_g":5},{"item_id":"I20","qty_g":10},{"item_id":"I15","qty_g":2},{"item_id":"I18","qty_g":3.4},{"item_id":"I61","qty_g":0.6},{"item_id":"I16","qty_g":0.4}]',
 '[{"title":"Hidratar gelatina","detail":"Hidratar la gelatina en el agua fría."},{"title":"Calentar fase","detail":"Calentar 50 g de crema con sacarosa, dextrosa y leche en polvo."},{"title":"Emulsionar chocolate","detail":"Verter sobre el chocolate con leche y emulsionar."},{"title":"Incorporar gelatina","detail":"Incorporar la gelatina fundida."},{"title":"Añadir M&M","detail":"Añadir el M&M triturado fino."},{"title":"Enfriar","detail":"Enfriar la base a 25–30 °C."},{"title":"Integrar crema","detail":"Semimontar los 90 g restantes, integrar y dosificar."}]',
 '["CHOCOLATE_EXACTO_PENDIENTE","DENSIDAD_LIQUIDOS_PENDIENTE","PRUEBA_PILOTO_PENDIENTE"]',
 '{"added_sugar":{"sucrose_pct":85,"dextrose_pct":15}}'),
('SR11','BASE-MOUSSE-CARAMELO-SALADO-V4',200.4,5,
 '[{"item_id":"I01","qty_g":145},{"item_id":"I34","qty_g":38},{"item_id":"I17","qty_g":5},{"item_id":"I20","qty_g":10},{"item_id":"I15","qty_g":2},{"item_id":"I16","qty_g":0.4}]',
 '[{"title":"Hidratar gelatina","detail":"Hidratar la gelatina en el agua fría."},{"title":"Calentar fase","detail":"Calentar 45 g de crema con leche en polvo."},{"title":"Incorporar gelatina","detail":"Incorporar la gelatina fundida."},{"title":"Emulsionar caramelo","detail":"Emulsionar con el caramelo salado espeso."},{"title":"Ajustar sal","detail":"Probar y ajustar sal únicamente si el caramelo lo requiere."},{"title":"Enfriar","detail":"Enfriar la base a 25–30 °C."},{"title":"Integrar crema","detail":"Semimontar los 100 g restantes, integrar y dosificar."}]',
 '["CARAMELO_EXACTO_PENDIENTE","DENSIDAD_LIQUIDOS_PENDIENTE","PRUEBA_PILOTO_PENDIENTE"]','{}'),
('SR13','BASE-GANACHE-CHOCOLATE-V4',1000,3,
 '[{"item_id":"I37","qty_g":600},{"item_id":"I01","qty_g":390},{"item_id":"I16","qty_g":2},{"item_id":"I29","qty_g":8}]',
 '[{"title":"Preparar chocolate","detail":"Picar o fraccionar el chocolate uniformemente."},{"title":"Calentar crema","detail":"Calentar la crema a 75–80 °C sin hervir."},{"title":"Reposar","detail":"Verter sobre el chocolate y esperar 1 minuto."},{"title":"Emulsionar","detail":"Emulsionar desde el centro hasta obtener brillo y homogeneidad."},{"title":"Terminar mezcla","detail":"Añadir sal y vainilla."},{"title":"Madurar","detail":"Cubrir a contacto y refrigerar hasta obtener textura dosificable."},{"title":"Dosificar","detail":"Dosificar 30 g netos por figura."}]',
 '["CHOCOLATE_EXACTO_PENDIENTE","DENSIDAD_LIQUIDOS_PENDIENTE","PRUEBA_PILOTO_PENDIENTE"]','{}'),
('SR12','BASE-CHEESECAKE-NEUTRO-V4',1000,3,
 '[{"item_id":"I35","qty_g":500},{"item_id":"I01","qty_g":260},{"item_id":"I36","qty_g":180},{"item_id":"I19","qty_g":25},{"item_id":"I29","qty_g":10},{"item_id":"I15","qty_g":5},{"item_id":"I20","qty_g":20}]',
 '[{"title":"Ablandar queso","detail":"Ablandar el queso crema sin calentarlo excesivamente."},{"title":"Mezclar base","detail":"Mezclar queso crema y leche condensada hasta eliminar grumos."},{"title":"Añadir sabor","detail":"Añadir vainilla y zumo de limón."},{"title":"Hidratar gelatina","detail":"Hidratar la gelatina en agua durante 8–10 minutos."},{"title":"Fundir y temperar","detail":"Fundir suavemente y mezclar primero con una pequeña parte de la base."},{"title":"Reintegrar","detail":"Reintegrar la gelatina temperada y homogeneizar."},{"title":"Semimontar crema","detail":"Semimontar la crema de leche."},{"title":"Integrar","detail":"Integrar la crema de forma envolvente."},{"title":"Madurar","detail":"Refrigerar hasta alcanzar textura dosificable."},{"title":"Dosificar","detail":"Dosificar 40 g netos por figura."}]',
 '["DENSIDAD_LIQUIDOS_PENDIENTE","PRUEBA_PILOTO_PENDIENTE"]','{}');

do $$
declare
  v_spec record;
  v_formula jsonb;
  v_version integer;
  v_payload jsonb;
  v_fingerprint text;
  v_formula_fingerprint text;
  v_id bigint;
begin
  for v_spec in select * from _momos_v4_specs order by subrecipe_id loop
    if not exists(select 1 from public.subrecetas where id=v_spec.subrecipe_id and activo) then
      raise exception 'La subreceta V4 % no existe o está inactiva.',v_spec.subrecipe_id;
    end if;
    if exists(
      select 1 from jsonb_array_elements(v_spec.formula_g) line
      left join public.inventory_items i on i.id=line->>'item_id'
      where i.id is null
    ) then
      raise exception 'La fórmula V4 % contiene un insumo inexistente.',v_spec.recipe_code;
    end if;
    select jsonb_agg(jsonb_build_object(
      'item_id',x.item_id,
      'cantidad',round(x.qty_g/v_spec.source_yield_g,8)
    ) order by x.item_id)
    into v_formula
    from jsonb_to_recordset(v_spec.formula_g) x(item_id text,qty_g numeric);
    select coalesce(max(version),0)+1 into v_version
    from public.kitchen_procedure_versions
    where subrecipe_id=v_spec.subrecipe_id;
    v_formula_fingerprint:=encode(sha256(convert_to(v_formula::text,'UTF8')),'hex');
    v_payload:=jsonb_build_object(
      'subrecipe_id',v_spec.subrecipe_id,
      'version',v_version,
      'process_defined',true,
      'note','V4 confirmada por Producción. Validación piloto antes de publicar.',
      'steps',v_spec.steps,
      'source_ref','MOMOS_OPS_Especificacion_Recetas_Figuras_v4.md',
      'formula',v_formula,
      'formula_origin','Especificación real V4 · 2026-07-23'
    );
    v_fingerprint:=encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
    insert into public.kitchen_procedure_versions(
      subrecipe_id,version,status,process_defined,note,steps,source_ref,
      fingerprint,formula,formula_fingerprint,formula_origin
    ) values(
      v_spec.subrecipe_id,v_version,'Borrador',true,
      'V4 confirmada por Producción. Validación piloto antes de publicar.',
      v_spec.steps,'MOMOS_OPS_Especificacion_Recetas_Figuras_v4.md',
      v_fingerprint,v_formula,v_formula_fingerprint,
      'Especificación real V4 · 2026-07-23'
    ) returning id into v_id;
    insert into public.kitchen_recipe_pilot_controls(
      procedure_version_id,spec_version,recipe_code,validation_status,
      source_yield_g,transformation_loss_pct,source_formula_g,blockers,
      sugar_system,contains_maltodextrin,source_ref
    ) values(
      v_id,'4.0',v_spec.recipe_code,'VALIDACION_PILOTO',
      v_spec.source_yield_g,v_spec.loss_pct,v_spec.formula_g,v_spec.blockers,
      v_spec.sugar_system,false,'MOMOS_OPS_Especificacion_Recetas_Figuras_v4.md'
    );
  end loop;
end $$;

insert into public.momos_ops_migrations(id,detalle)
values(
  '20260723_112_recetas_figuras_v4',
  'V4 real: gramajes y rellenos versionados, fórmulas/pasos piloto, merma de fruta y publicación protegida'
);

commit;
