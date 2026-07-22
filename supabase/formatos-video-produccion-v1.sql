-- MOMOS OPS · H110 · Formato de video 4:3 para locaciones y puntos de venta
-- Amplía únicamente el contrato cerrado de salida. No crea trabajos ni consume créditos.
begin;

do $$
begin
  if not exists(select 1 from public.momos_ops_migrations where id='20260722_109_piloto_generacion_controlado') then
    raise exception 'Falta el paso 109_piloto_generacion_controlado.';
  end if;
end $$;

create or replace function public.crear_trabajo_creativo(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_actor public.users%rowtype; v_id bigint; v_creative text:=nullif(p->>'creative_id','');
  v_brief bigint:=nullif(p->>'brief_id','')::bigint; v_operation text:=p->>'operation'; v_assets jsonb:=coalesce(p->'input_asset_ids','[]'::jsonb);
  v_asset_id bigint; v_asset public.brand_media_assets%rowtype; v_product text; v_has_product boolean:=false; v_brand jsonb;
  v_format text:=btrim(coalesce(p->>'target_format','')); v_prompt text:=btrim(coalesce(p->>'prompt',''));
begin
  v_actor:=public._brand_actor();
  if v_creative is null and v_brief is null then raise exception 'El trabajo necesita un creativo o brief.'; end if;
  if v_creative is not null and not exists(select 1 from public.creatives where id=v_creative) then raise exception 'El creativo no existe.'; end if;
  if v_brief is not null and not exists(select 1 from public.agency_briefs where id=v_brief) then raise exception 'El brief no existe.'; end if;
  if v_operation not in ('Componer','Editar','Adaptar','Generar imagen','Generar video') then raise exception 'Operación creativa inválida.'; end if;
  if jsonb_typeof(v_assets)<>'array' then raise exception 'Los activos de entrada son inválidos.'; end if;
  if (select count(*)<>count(distinct value) from jsonb_array_elements_text(v_assets)) then raise exception 'Un activo no puede repetirse en el mismo trabajo.'; end if;
  if v_format not in ('Reel 9:16','Historia 9:16','TikTok 9:16','Post 4:5','Cuadrado 1:1','WhatsApp 4:5','Video 4:3') then raise exception 'Formato de salida inválido.'; end if;
  if length(v_prompt)<12 then raise exception 'El trabajo necesita un prompt suficientemente claro.'; end if;
  if v_operation in ('Componer','Editar','Adaptar') and jsonb_array_length(v_assets)=0 then raise exception 'La operación necesita archivos reales de la biblioteca.'; end if;
  v_product:=coalesce((select producto_foco_id from public.creatives where id=v_creative),(select product_id from public.agency_briefs where id=v_brief));
  for v_asset_id in select value::text::bigint from jsonb_array_elements(v_assets) loop
    select * into v_asset from public.brand_media_assets where id=v_asset_id;
    if v_asset.id is null then raise exception 'Un activo seleccionado ya no existe.'; end if;
    if v_asset.status<>'Activo' or v_asset.rights_status not in ('Propio','Autorizado') or v_asset.ai_use_allowed is not true
       or (v_asset.rights_expires_at is not null and v_asset.rights_expires_at<current_date)
       or (v_asset.contains_people and v_asset.rights_status<>'Autorizado') then
      raise exception 'El activo % no tiene permisos vigentes para IA.',v_asset_id;
    end if;
    if v_product is not null and v_asset.product_id=v_product then v_has_product:=true; end if;
  end loop;
  if v_product is not null and not v_has_product then raise exception 'Falta una toma real del producto foco.'; end if;
  select jsonb_build_object('frases',frases,'tono',tono,'palabras_si',palabras_si,'palabras_no',palabras_no)
    into v_brand from public.brand_library where id;
  insert into public.creative_generation_jobs(creative_id,brief_id,provider,operation,status,input_asset_ids,target_channel,target_format,
    prompt,negative_prompt,brand_snapshot,output_spec,created_by)
  values(v_creative,v_brief,coalesce(nullif(p->>'provider',''),'Por conectar'),v_operation,'Preparado',v_assets,
    coalesce(nullif(p->>'target_channel',''),'Instagram'),v_format,v_prompt,coalesce(p->>'negative_prompt',''),coalesce(v_brand,'{}'::jsonb),
    coalesce(p->'output_spec','{}'::jsonb)||jsonb_build_object('output_mode','new_asset'),v_actor.id)
  returning id into v_id;
  for v_asset_id in select value::text::bigint from jsonb_array_elements(v_assets) loop
    insert into public.brand_media_usages(asset_id,job_id,role,created_by)
    values(v_asset_id,v_id,case when not exists(select 1 from public.brand_media_usages where job_id=v_id) then 'Principal' else 'Apoyo' end,v_actor.id);
  end loop;
  perform public._add_audit('Estudio creativo',v_id::text,'Trabajo preparado','',v_operation||' · '||v_format);
  return jsonb_build_object('ok',true,'job_id',v_id,'status','Preparado');
end $$;

revoke all on function public.crear_trabajo_creativo(jsonb) from public,anon;
grant execute on function public.crear_trabajo_creativo(jsonb) to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260722_110_formato_video_cuatro_tres','Contrato cerrado Video 4:3 para locaciones y puntos de venta; sin ejecución externa')
on conflict(id) do update set detalle=excluded.detalle;

commit;
