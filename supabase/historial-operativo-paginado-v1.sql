-- MOMOS OPS · H79 Historial operativo filtrado, paginado y acotado en servidor.
-- Las búsquedas históricas dejan de descargar páginas sin relación al navegador.
begin;

select pg_advisory_xact_lock(hashtext('momos_ops_migrations'));

do $$
begin
  if not exists(select 1 from public.momos_ops_migrations where id='20260719_78_produccion_estados_fisicos') then
    raise exception 'Falta el paso 78_produccion_estados_fisicos.';
  end if;
  if to_regprocedure('public.is_staff()') is null
     or to_regclass('public.audit_logs') is null
     or to_regprocedure('public.momos_history_page_v1(jsonb,integer)') is null then
    raise exception 'Falta el contrato base del historial operativo.';
  end if;
end $$;

create index if not exists audit_logs_history_recent_idx
on public.audit_logs(fecha desc,id desc);

create or replace function public._momos_history_area_v2(p_entity text)
returns text language sql immutable parallel safe
set search_path=pg_catalog,public,pg_temp as $$
  select case
    when coalesce(p_entity,'') in ('Pedido','Evidencia') then 'Pedidos'
    when coalesce(p_entity,'') in ('Lote','Producción','Corrida','Subreceta') then 'Producción'
    when coalesce(p_entity,'') in ('Empaque','Verificación de empaque','Relevo') then 'Empaque'
    when coalesce(p_entity,'') in ('Domicilio','Entrega') then 'Domicilios'
    when coalesce(p_entity,'')='Reclamo' then 'Reclamos'
    when coalesce(p_entity,'') in ('Inventario','Insumo','Lote de insumo','Movimiento') then 'Inventario'
    when coalesce(p_entity,'') in ('Inventario terminado','Producto terminado','Reserva de producto') then 'Inventario terminado'
    when coalesce(p_entity,'') in ('Producto','Receta') then 'Productos'
    when coalesce(p_entity,'') in ('Cliente','CRM','Activación','Beneficio') then 'Clientes'
    when coalesce(p_entity,'') in ('Campaña','Creativo','Publicación','Brief','Decisión') then 'Agencia MOMOS'
    when coalesce(p_entity,'') in ('Brief agencia','Decisión agencia','Cerebro Agencia','Biblioteca marca','Identidad de marca','Storyboard','Motion') then 'Agencia MOMOS'
    when coalesce(p_entity,'') in ('Finanzas','Movimiento financiero','Caja','Gasto','Costo') then 'Finanzas'
    when coalesce(p_entity,'') in ('Usuario','Configuración') then 'Configuración'
    when lower(coalesce(p_entity,'')) like '%pedido%' or lower(coalesce(p_entity,'')) like '%pago%' then 'Pedidos'
    when lower(coalesce(p_entity,'')) like '%lote%' or lower(coalesce(p_entity,'')) like '%produ%' then 'Producción'
    when lower(coalesce(p_entity,'')) like '%empaque%' then 'Empaque'
    when lower(coalesce(p_entity,'')) like '%domic%' or lower(coalesce(p_entity,'')) like '%entrega%' then 'Domicilios'
    when lower(coalesce(p_entity,'')) like '%reclamo%' or lower(coalesce(p_entity,'')) like '%incidente%' then 'Reclamos'
    when (lower(coalesce(p_entity,'')) like '%inventario%' or lower(coalesce(p_entity,'')) like '%producto%')
      and lower(coalesce(p_entity,'')) like '%terminado%' then 'Inventario terminado'
    when lower(coalesce(p_entity,'')) like '%invent%' or lower(coalesce(p_entity,'')) like '%insumo%' then 'Inventario'
    when lower(coalesce(p_entity,'')) like '%cliente%' or lower(coalesce(p_entity,'')) like '%crm%' then 'Clientes'
    when lower(coalesce(p_entity,'')) like '%agencia%' or lower(coalesce(p_entity,'')) like '%marketing%'
      or lower(coalesce(p_entity,'')) like '%creativ%' or lower(coalesce(p_entity,'')) like '%campaña%'
      or lower(coalesce(p_entity,'')) like '%brief%' or lower(coalesce(p_entity,'')) like '%biblioteca marca%'
      or lower(coalesce(p_entity,'')) like '%identidad de marca%' or lower(coalesce(p_entity,'')) like '%storyboard%'
      or lower(coalesce(p_entity,'')) like '%motion%' then 'Agencia MOMOS'
    when lower(coalesce(p_entity,'')) like '%finanz%' or lower(coalesce(p_entity,'')) like '%movimiento financiero%'
      or lower(coalesce(p_entity,'')) like '%gasto%' or lower(coalesce(p_entity,'')) like '%costo%' then 'Finanzas'
    else coalesce(nullif(btrim(p_entity),''),'Operación')
  end
$$;
revoke all on function public._momos_history_area_v2(text) from public,anon,authenticated,service_role;

create index if not exists audit_logs_history_area_recent_idx
on public.audit_logs(public._momos_history_area_v2(entidad),fecha desc,id desc);

create or replace function public.momos_history_page_v2(
  p_cursor jsonb default null,
  p_limit integer default 50,
  p_query text default '',
  p_area text default '',
  p_from date default null,
  p_to date default null
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_limit integer:=least(50,greatest(1,coalesce(p_limit,50)));
  v_at timestamptz;
  v_id text;
  v_query text:=btrim(coalesce(p_query,''));
  v_area text:=btrim(coalesce(p_area,''));
  v_pattern text;
  v_rows jsonb:='[]'::jsonb;
  v_next jsonb;
  v_has_more boolean:=false;
begin
  if auth.uid() is null or public.is_staff() is not true then
    raise exception 'Solo el equipo activo de MOMOS puede consultar el historial.' using errcode='42501';
  end if;
  if p_cursor is not null and (
    jsonb_typeof(p_cursor)<>'object'
    or not (p_cursor ?& array['at','id'])
    or exists(select 1 from jsonb_object_keys(p_cursor) k where k<>all(array['at','id']))
  ) then raise exception 'Cursor de historial inválido.' using errcode='22023'; end if;
  begin
    v_at:=nullif(p_cursor->>'at','')::timestamptz;
    v_id:=coalesce(p_cursor->>'id','');
  exception when others then
    raise exception 'Cursor de historial inválido.' using errcode='22023';
  end;
  if p_cursor is not null and (v_at is null or v_id='') then
    raise exception 'Cursor de historial incompleto.' using errcode='22023';
  end if;
  if length(v_query)>80 or v_query~'[[:cntrl:]]' then
    raise exception 'Búsqueda de historial inválida.' using errcode='22023';
  end if;
  if v_area<>'' and v_area<>all(array[
    'Pedidos','Producción','Empaque','Domicilios','Reclamos','Inventario','Inventario terminado',
    'Productos','Clientes','Agencia MOMOS','Finanzas','Configuración','Operación'
  ]) then raise exception 'Área de historial inválida.' using errcode='22023'; end if;
  if p_from is not null and p_to is not null and (p_from>p_to or p_to-p_from>3660) then
    raise exception 'Rango de historial inválido.' using errcode='22023';
  end if;
  v_pattern:='%'||replace(replace(replace(v_query,'\','\\'),'%','\%'),'_','\_')||'%';

  with candidates as materialized(
    select a.id,a.fecha,coalesce(u.rol,'Sistema') as "user",a.entidad,a.entidad_id,a.accion,a.de,a.a,
      public._momos_history_area_v2(a.entidad) area
    from public.audit_logs a left join public.users u on u.id=a.user_id
    where (v_at is null or (a.fecha,a.id)<(v_at,v_id))
      and (p_from is null or a.fecha>=(p_from::timestamp at time zone 'America/Bogota'))
      and (p_to is null or a.fecha<((p_to+1)::timestamp at time zone 'America/Bogota'))
      and (v_area='' or public._momos_history_area_v2(a.entidad)=v_area)
      and (v_query='' or concat_ws(' ',a.entidad,a.entidad_id,a.accion,a.de,a.a,coalesce(u.rol,'')) ilike v_pattern escape '\')
    order by a.fecha desc,a.id desc
    limit v_limit+1
  ), page as(
    select * from candidates order by fecha desc,id desc limit v_limit
  )
  select
    coalesce((select jsonb_agg(to_jsonb(x) order by x.fecha desc,x.id desc) from page x),'[]'::jsonb),
    (select count(*)>v_limit from candidates),
    case when (select count(*)>v_limit from candidates) then
      (select jsonb_build_object('at',x.fecha,'id',x.id) from page x order by x.fecha,x.id limit 1)
    end
  into v_rows,v_has_more,v_next;

  return jsonb_build_object(
    'version',2,'contract','momos.history-page.v2','rows',v_rows,'next_cursor',v_next,
    'limit',v_limit,'has_more',v_has_more,'filtered',(v_query<>'' or v_area<>'' or p_from is not null or p_to is not null),
    'privacy',jsonb_build_object(
      'contains_customer_pii',false,'contains_staff_identity',false,'contains_storage_references',false,
      'contains_secrets',false,'contains_free_text',true,'external_execution',false
    )
  );
end $$;
revoke all on function public.momos_history_page_v2(jsonb,integer,text,text,date,date) from public,anon,service_role;
grant execute on function public.momos_history_page_v2(jsonb,integer,text,text,date,date) to authenticated;

create or replace function public.historial_operativo_paginado_disponible()
returns boolean language sql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
  select public.is_staff()
    and to_regprocedure('public.momos_history_page_v2(jsonb,integer,text,text,date,date)') is not null
    and exists(select 1 from public.momos_ops_migrations where id='20260719_79_historial_operativo_paginado')
$$;
revoke all on function public.historial_operativo_paginado_disponible() from public,anon,service_role;
grant execute on function public.historial_operativo_paginado_disponible() to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260719_79_historial_operativo_paginado','Historial filtrado y paginado en servidor con cursor estable, límites, privacidad y RBAC')
on conflict(id) do update set detalle=excluded.detalle;

commit;
