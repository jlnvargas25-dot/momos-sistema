-- MOMOS OPS - H112 - prueba adversarial de recetas y ensamblaje V4.
begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_recetas_figuras_v4'));

do $$
declare
  v_draft_id bigint;
  v_failed boolean:=false;
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260723_112_recetas_figuras_v4'), 'H112 no esta registrada.';
  assert to_regclass('public.figure_assembly_specs') is not null
    and to_regclass('public.kitchen_recipe_pilot_controls') is not null
    and to_regclass('public.kitchen_recipe_pilot_results') is not null
    and to_regclass('public.fruit_yield_profiles') is not null,
    'H112 no instalo sus contratos versionados.';
  assert (select count(*) from public.figuras
    where activo and nombre in ('Lizi','Momo','Toby','Teo','Max','Rocco','Danna')
      and assembly_spec_version='V4'
      and gramaje_g=case nombre when 'Lizi' then 150 when 'Teo' then 320 else 210 end)=7,
    'Los gramajes canonicos V4 no coinciden.';
  assert (select count(*) from public.figure_assembly_specs
    where spec_version='V4' and status='Vigente' and ganache_g=30 and cheesecake_g=40
      and mousse_g+ganache_g+cheesecake_g=finished_weight_g)=7,
    'El ensamblaje V4 no conserva 30 g + 40 g ni el peso final.';
  assert exists(select 1 from public.figure_assembly_specs where spec_version='V4' and figure_name='Lizi' and finished_weight_g=150 and mousse_g=80)
    and exists(select 1 from public.figure_assembly_specs where spec_version='V4' and figure_name='Teo' and finished_weight_g=320 and mousse_g=250),
    'Lizi o Teo perdieron su BOM fisico V4.';
  assert (select gramos_por_unidad from public.figura_relleno where activo and subreceta_id='SR12')=40
    and (select gramos_por_unidad from public.figura_relleno where activo and subreceta_id='SR13')=30,
    'Los rellenos operativos no coinciden con V4.';
  assert (select count(*) from public.subrecetas where id between 'SR01' and 'SR11' and merma_pct=5)=11
    and (select count(*) from public.subrecetas where id in ('SR12','SR13') and merma_pct=3)=2,
    'La merma V4 no distingue mousse 5% de rellenos 3%.';
  assert not exists(select 1 from public.production_batches where assembly_spec_version is null), 'Existe un lote sin version de ensamblaje.';
  assert (select count(*) from public.inventory_items
    where id in ('I61','I62','I63','I64') and stock=0 and costo=0 and costo_estimado and origen_abastecimiento='Compra')=4,
    'Los nuevos insumos fueron inventados con stock/costo o quedaron incompletos.';
  assert (select count(*) from public.kitchen_recipe_pilot_controls
    where spec_version='4.0' and validation_status='VALIDACION_PILOTO' and not contains_maltodextrin
      and source_ref='MOMOS_OPS_Especificacion_Recetas_Figuras_v4.md')=13,
    'Las trece recetas V4 no quedaron en validacion piloto.';
  assert (select count(*) from public.kitchen_procedure_versions k
    join public.kitchen_recipe_pilot_controls c on c.procedure_version_id=k.id
    where k.status='Borrador' and k.process_defined and jsonb_array_length(k.steps)>0
      and encode(sha256(convert_to(k.formula::text,'UTF8')),'hex')=k.formula_fingerprint)=13,
    'Las formulas o procedimientos V4 no quedaron versionados e integros.';
  assert not exists(
    select 1 from public.kitchen_procedure_versions k
    join public.kitchen_recipe_pilot_controls c on c.procedure_version_id=k.id
    where c.spec_version='4.0' and (
      position(chr(65533) in concat_ws(' ',k.note,k.source_ref,k.steps::text))>0
      or position(chr(195) in concat_ws(' ',k.note,k.source_ref,k.steps::text))>0
      or position(chr(194) in concat_ws(' ',k.note,k.source_ref,k.steps::text))>0
    )
  ), 'Los textos V4 llegaron corruptos; aplicar H112 como bytes UTF-8.';
  assert not exists(
    select 1 from public.kitchen_recipe_pilot_controls c cross join lateral jsonb_array_elements(c.source_formula_g) line
    join public.inventory_items i on i.id=line->>'item_id' where lower(i.nombre) like '%maltodextrina%'
  ), 'Una formula V4 contiene maltodextrina.';
  assert exists(
    select 1 from public.kitchen_recipe_pilot_controls c
    cross join lateral jsonb_array_elements(c.source_formula_g) s
    cross join lateral jsonb_array_elements(c.source_formula_g) d
    where c.recipe_code='BASE-MOUSSE-MANGO-BICHE-V4'
      and s->>'item_id'='I18' and (s->>'qty_g')::numeric=11.9
      and d->>'item_id'='I61' and (d->>'qty_g')::numeric=2.1
  ), 'Mango biche perdio la relacion real 85/15.';
  assert exists(
    select 1 from public.kitchen_recipe_pilot_controls c cross join lateral jsonb_array_elements(c.source_formula_g) line
    where c.recipe_code='BASE-GANACHE-CHOCOLATE-V4' and line->>'item_id'='I37' and (line->>'qty_g')::numeric=600
  ) and exists(
    select 1 from public.kitchen_recipe_pilot_controls c cross join lateral jsonb_array_elements(c.source_formula_g) line
    where c.recipe_code='BASE-CHEESECAKE-NEUTRO-V4' and line->>'item_id'='I35' and (line->>'qty_g')::numeric=500
  ), 'Ganache o cheesecake no conservan su formula fuente real.';
  assert (select count(*) from public.fruit_yield_profiles where status='Provisional' and expected_yield_pct=50 and conversion_factor=2)=6,
    'La transformacion provisional 2:1 no quedo gobernada por fruta.';
  select c.procedure_version_id into v_draft_id from public.kitchen_recipe_pilot_controls c order by c.procedure_version_id limit 1;
  begin
    perform set_config('momos.activar_ficha_tecnica','1',true);
    update public.kitchen_procedure_versions set status='Vigente',approved_at=clock_timestamp() where id=v_draft_id;
  exception when others then
    v_failed:=position('receta V4' in sqlerrm)>0 and position('bloqueos' in sqlerrm)>0;
  end;
  assert v_failed, 'Una receta piloto V4 pudo publicarse sin resolver bloqueos.';
  assert not has_table_privilege('authenticated','public.kitchen_recipe_pilot_controls','INSERT')
    and not has_table_privilege('authenticated','public.kitchen_recipe_pilot_results','UPDATE')
    and not has_table_privilege('authenticated','public.figure_assembly_specs','DELETE'),
    'H112 expuso escrituras directas a usuarios autenticados.';
end $$;

select 'TESTS_OK - recetas/figuras V4/versiones/piloto/merma/RBAC PASS, rollback total' as resultado;
rollback;
