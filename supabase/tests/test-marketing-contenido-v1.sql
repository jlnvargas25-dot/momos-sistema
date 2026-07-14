-- ============================================================================
-- MOMOS OPS — Batería re-ejecutable marketing_contenido_v1.
-- PASS = termina en el error deliberado:
--   TESTS_OK — marketing-contenido-v1 bloques A-E PASS, rollback total
-- ============================================================================

begin;
select set_config('request.jwt.claims', '{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  r jsonb;
  v_campaign text;
  v_campaign_2 text;
  v_creative text;
  v_post text;
  v_metric bigint;
  v_prod text;
  v_fig text;
  v_u02_auth uuid;
  v_err boolean;
  v_msg text;
begin
  select id into v_prod from products where activo order by id limit 1;
  select nombre into v_fig from figuras where activo order by orden limit 1;
  assert v_prod is not null and v_fig is not null, 'PRE0 requiere producto y figura activos';

  r := crear_campana(jsonb_build_object(
    'nombre','T-CONT Campaña A','canal','Instagram','objetivo','Ventas','estado','Activa'));
  v_campaign := r->>'id';
  r := crear_campana(jsonb_build_object(
    'nombre','T-CONT Campaña B','canal','Facebook','objetivo','Branding'));
  v_campaign_2 := r->>'id';

  -- A. Creativo happy path + FKs normalizadas + audit.
  r := crear_creativo(jsonb_build_object(
    'campaign_id',v_campaign,'titulo','T-CONT Reel','canal','Instagram','formato','Reel',
    'producto_foco_id',v_prod,'figura',v_fig,'sabor','Coco','hook','Detiene el scroll',
    'copy','Copy de prueba','guion','Plano 1','estado','En revisión','responsable','Marketing',
    'fecha_entrega',current_date::text,'asset_url','https://example.test/asset','notas','fixture'));
  v_creative := r->>'id';
  assert (r->>'ok')::boolean and v_creative like 'CRE-%', 'A1 debe crear CRE-%';
  assert (select campaign_id=v_campaign and producto_foco_id=v_prod and figura=v_fig
                 and estado='En revisión' from creatives where id=v_creative),
    'A2 debe persistir FKs y dominio';
  assert exists (select 1 from audit_logs where entidad='Creativo' and entidad_id=v_creative
                 and accion='Creativo creado'), 'A3 debe auditar el alta';

  -- B. PATCH conserva ausentes; validaciones dan errores de dominio.
  r := editar_creativo(v_creative, jsonb_build_object('hook','Hook v2'));
  assert (select hook='Hook v2' and titulo='T-CONT Reel' and campaign_id=v_campaign
          and producto_foco_id=v_prod and estado='En revisión' from creatives where id=v_creative),
    'B1 PATCH parcial solo toca hook';
  r := editar_creativo(v_creative, jsonb_build_object('estado','Aprobado'));
  assert (r->>'cambio_estado')::boolean, 'B2 debe reportar cambio de estado';
  assert exists (select 1 from audit_logs where entidad='Creativo' and entidad_id=v_creative
                 and accion='Cambio de estado' and de='En revisión' and a='Aprobado'),
    'B3 debe auditar de/a';

  v_err:=false; begin
    r := crear_creativo(jsonb_build_object('titulo','x','canal','Instagram','formato','Formato inventado'));
  exception when others then v_err:=true; v_msg:=sqlerrm; end;
  assert v_err and v_msg like 'Formato inválido:%', 'B4 formato inválido debe tener mensaje de dominio';

  v_err:=false; begin
    r := editar_creativo(v_creative, jsonb_build_object('fecha_entrega','no-fecha'));
  exception when others then v_err:=true; v_msg:=sqlerrm; end;
  assert v_err and v_msg like 'Fecha de entrega inválida:%', 'B5 fecha basura debe rechazarse limpiamente';

  v_err:=false; begin
    r := crear_creativo(jsonb_build_object(
      'titulo','fecha infinita','canal','Instagram','formato','Reel','fecha_entrega','infinity'));
  exception when others then v_err:=true; end;
  assert v_err, 'B6 el RPC debe rechazar fecha_entrega infinita';

  v_err:=false; begin
    insert into creatives(id,titulo,canal,formato,fecha_entrega)
    values ('T-CONT-INF-CRE','fecha infinita directa','Instagram','Reel','infinity');
  exception when check_violation then v_err:=true; end;
  assert v_err, 'B7 el CHECK debe rechazar fecha_entrega infinita por escritura directa';

  -- C. Calendario: deriva campaña del creativo, evita mezcla y estado idempotente.
  r := crear_publicacion(jsonb_build_object(
    'fecha',current_date::text,'hora','19:00','canal','Instagram','creative_id',v_creative,
    'titulo','T-CONT publicación','copy_final','Copy final','estado','Programado','notas','fixture'));
  v_post := r->>'id';
  assert (select campaign_id=v_campaign and creative_id=v_creative and estado='Programado'
          from content_posts where id=v_post), 'C1 debe derivar campaign_id del creativo';
  r := set_publicacion_estado(v_post,'Publicado');
  assert (r->>'cambio')::boolean and (r->>'de')='Programado', 'C2 debe cambiar estado';
  r := set_publicacion_estado(v_post,'Publicado');
  assert not (r->>'cambio')::boolean, 'C3 repetir estado debe ser no-op';
  assert (select count(*) from audit_logs where entidad='Publicación' and entidad_id=v_post
          and accion='Cambio de estado')=1, 'C4 el no-op no duplica audit';

  v_err:=false; begin
    r := crear_publicacion(jsonb_build_object(
      'fecha',current_date::text,'canal','Instagram','campaign_id',v_campaign_2,
      'creative_id',v_creative,'titulo','mezcla inválida'));
  exception when others then v_err:=true; end;
  assert v_err, 'C5 campaña y creativo distintos deben rechazarse';

  v_err:=false; begin
    r := editar_creativo(v_creative, jsonb_build_object('campaign_id',v_campaign_2));
  exception when others then v_err:=true; end;
  assert v_err and (select campaign_id=v_campaign from creatives where id=v_creative),
    'C6 no debe romper campaña creativo/publicación después del alta';

  v_err:=false; begin
    insert into content_posts(id,fecha,hora,canal,campaign_id,creative_id,titulo)
    values ('T-CONT-DIRECT',current_date,'12:00','Instagram',v_campaign_2,v_creative,'mezcla directa');
  exception when others then v_err:=true; end;
  assert v_err, 'C7 el trigger debe bloquear mezcla por escritura directa';

  v_err:=false; begin
    update creatives set campaign_id=v_campaign_2 where id=v_creative;
  exception when others then v_err:=true; end;
  assert v_err and (select campaign_id=v_campaign from creatives where id=v_creative),
    'C8 el trigger debe bloquear cambio directo con publicaciones ligadas';

  v_err:=false; begin
    r := crear_publicacion(jsonb_build_object(
      'fecha','infinity','canal','Instagram','creative_id',v_creative,'titulo','fecha infinita'));
  exception when others then v_err:=true; end;
  assert v_err, 'C9 el RPC debe rechazar fecha de publicación infinita';

  v_err:=false; begin
    insert into content_posts(id,fecha,hora,canal,campaign_id,creative_id,titulo)
    values ('T-CONT-INF-POST','infinity','12:00','Instagram',v_campaign,v_creative,'fecha infinita directa');
  exception when check_violation then v_err:=true; end;
  assert v_err, 'C10 el CHECK debe rechazar fecha de publicación infinita por escritura directa';

  -- D. Resultados: métricas solamente; segundo envío hace upsert, no duplica.
  r := registrar_metricas_creativo(jsonb_build_object(
    'creative_id',v_creative,'fecha',current_date::text,'impresiones',1000,'alcance',700,
    'clicks',80,'mensajes_wa',20,'gasto',25000,'notas','primera'));
  v_metric := (r->>'id')::bigint;
  assert not (r->>'actualizado')::boolean, 'D1 primera captura debe insertar';
  assert (select campaign_id=v_campaign and impresiones=1000 and gasto=25000 and notas='primera'
          from metrics_daily where id=v_metric), 'D2 campaña se deriva y métricas quedan completas';

  r := registrar_metricas_creativo(jsonb_build_object(
    'creative_id',v_creative,'fecha',current_date::text,'impresiones',1200,'alcance',800,
    'clicks',90,'mensajes_wa',25,'gasto',30000,'notas','corregida'));
  assert (r->>'actualizado')::boolean and (r->>'id')::bigint=v_metric,
    'D3 repetir creativo+día debe actualizar la misma fila';
  assert (select count(*) from metrics_daily where fecha=current_date and fuente='manual'
          and creative_id=v_creative and post_id is null)=1, 'D4 no debe duplicar el día';
  assert (select impresiones=1200 and gasto=30000 and notas='corregida'
          from metrics_daily where id=v_metric), 'D5 el upsert aplica la corrección';
  assert not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='metrics_daily' and column_name in ('pedidos','ventas')
  ), 'D6 metrics_daily jamás persiste pedidos/ventas';

  v_err:=false; begin
    r := registrar_metricas_creativo(jsonb_build_object(
      'creative_id',v_creative,'fecha',current_date::text,'impresiones',-1));
  exception when others then v_err:=true; end;
  assert v_err, 'D7 métricas negativas deben rechazarse';

  v_err:=false; begin
    insert into metrics_daily(fecha,fuente,creative_id,impresiones)
    values (current_date + 1,'manual',v_creative,-1);
  exception when check_violation then v_err:=true; end;
  assert v_err, 'D8 el CHECK de tabla también bloquea negativos por escritura directa';

  v_err:=false; begin
    r := registrar_metricas_creativo(jsonb_build_object(
      'creative_id',v_creative,'fecha',current_date::text,'gasto','Infinity'));
  exception when others then v_err:=true; end;
  assert v_err, 'D9 gasto no finito debe rechazarse';

  v_err:=false; begin
    r := registrar_metricas_creativo(jsonb_build_object(
      'creative_id',v_creative,'fecha','infinity','impresiones',1));
  exception when others then v_err:=true; end;
  assert v_err, 'D10 el RPC debe rechazar fecha de métricas infinita';

  v_err:=false; begin
    insert into metrics_daily(fecha,fuente,creative_id,impresiones)
    values ('infinity','manual',v_creative,1);
  exception when check_violation then v_err:=true; end;
  assert v_err, 'D11 el CHECK debe rechazar fecha de métricas infinita por escritura directa';

  -- E. Gate: staff no-admin sí; identidad sin fila activa no puede escribir.
  select auth_id into v_u02_auth from users where id='U02';
  assert v_u02_auth is not null, 'PRE-E U02 debe tener auth_id';
  perform set_config('request.jwt.claims',
    json_build_object('sub',v_u02_auth,'role','authenticated')::text,true);
  r := crear_creativo(jsonb_build_object(
    'titulo','T-CONT staff','canal','WhatsApp','formato','Copy','estado','Idea'));
  assert (r->>'ok')::boolean, 'E1 staff activo no-admin puede crear';

  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000000","role":"authenticated"}',true);
  v_err:=false; begin
    r := crear_creativo(jsonb_build_object('titulo','hack','canal','Instagram','formato','Reel'));
  exception when others then v_err:=true; end;
  assert v_err, 'E2 no-staff no puede crear creativo';
  v_err:=false; begin
    r := editar_creativo(v_creative,jsonb_build_object('hook','hack'));
  exception when others then v_err:=true; end;
  assert v_err, 'E3 no-staff no puede editar creativo';
  v_err:=false; begin
    r := crear_publicacion(jsonb_build_object(
      'fecha',current_date::text,'canal','Instagram','creative_id',v_creative,'titulo','hack'));
  exception when others then v_err:=true; end;
  assert v_err, 'E4 no-staff no puede crear publicación';
  v_err:=false; begin
    r := set_publicacion_estado(v_post,'No publicado');
  exception when others then v_err:=true; end;
  assert v_err, 'E5 no-staff no puede cambiar publicación';
  v_err:=false; begin
    r := registrar_metricas_creativo(jsonb_build_object('creative_id',v_creative));
  exception when others then v_err:=true; end;
  assert v_err, 'E6 no-staff no puede registrar métricas';

  raise exception 'TESTS_OK — marketing-contenido-v1 bloques A-E PASS, rollback total';
end $$;
