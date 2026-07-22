-- MOMOS OPS · H105 · Humanización y Comunidad. Siempre ROLLBACK.
-- Rompe PII, comentario crudo, consentimiento, autoaprobación y falso ganador.

begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_h105_humanization'));

create temporary table h105_context(
  admin_id text not null,
  auth_id uuid not null,
  campaign_id text not null,
  creative_id text not null,
  post_one text not null,
  post_two text not null,
  series_id bigint,
  episode_one bigint,
  episode_two bigint,
  signal_id bigint
) on commit drop;
grant select,update on table h105_context to authenticated,anon;

do $$
declare v_actor public.users%rowtype; v_suffix text:=pg_backend_pid()::text;
  v_campaign text:='CMP-H105-'||v_suffix; v_creative text:='CRE-H105-'||v_suffix;
  v_post_one text:='POST-H105-A-'||v_suffix; v_post_two text:='POST-H105-B-'||v_suffix;
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260722_105_humanizacion_comunidad'),
    'H105 requiere aplicar humanizacion-comunidad-v1.sql.';
  assert to_regclass('public.agency_humanization_series') is not null
    and to_regclass('public.agency_humanization_episodes') is not null
    and to_regclass('public.agency_humanization_episode_publications') is not null
    and to_regclass('public.agency_community_signal_rollups') is not null
    and to_regprocedure('public.proponer_serie_humanizacion_agente_v1(jsonb)') is not null
    and to_regprocedure('public.proponer_episodio_humanizacion_agente_v1(jsonb)') is not null
    and to_regprocedure('public.registrar_senal_comunidad_conector_v1(jsonb)') is not null
    and to_regprocedure('public.momos_humanization_community_v1()') is not null,
    'H105 no instaló el contrato completo.';
  assert not has_table_privilege('authenticated','public.agency_humanization_series','SELECT')
    and not has_table_privilege('authenticated','public.agency_community_signal_rollups','SELECT')
    and not has_table_privilege('service_role','public.agency_community_signal_rollups','SELECT')
    and has_function_privilege('authenticated','public.proponer_serie_humanizacion_v1(jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public.proponer_serie_humanizacion_agente_v1(jsonb)','EXECUTE')
    and has_function_privilege('service_role','public.proponer_serie_humanizacion_agente_v1(jsonb)','EXECUTE')
    and not has_function_privilege('service_role','public.revisar_serie_humanizacion_v1(bigint,text,text)','EXECUTE')
    and not has_function_privilege('anon','public.momos_humanization_community_v1()','EXECUTE'),
    'H105 perdió aislamiento, revisión humana o RBAC.';
  assert exists(select 1 from pg_trigger where tgrelid='public.agency_humanization_series'::regclass
      and tgname='momos_agency_snapshot_event_v1' and not tgisinternal)
    and exists(select 1 from pg_trigger where tgrelid='public.agency_community_signal_rollups'::regclass
      and tgname='momos_agency_snapshot_event_v1' and not tgisinternal),
    'H105 no despierta el cursor sanitario de Agencia.';

  select * into v_actor from public.users where activo and auth_id is not null
    and ('Administrador'=any(coalesce(roles,array[rol])) or 'Marketing/CRM'=any(coalesce(roles,array[rol])))
    order by case when 'Administrador'=any(coalesce(roles,array[rol])) then 0 else 1 end,id limit 1;
  assert v_actor.id is not null,'H105 necesita un actor de Agencia autenticado.';

  insert into public.campaigns(id,nombre,canal,objetivo,presupuesto,estado,external_platform,external_id)
  values(v_campaign,'H105 comunidad','Instagram','Branding',0,'Activa','meta','meta-h105-'||v_suffix);
  insert into public.creatives(id,campaign_id,titulo,canal,formato,estado,external_id)
  values(v_creative,v_campaign,'H105 producto real','Instagram','Reel','Publicado','creative-h105-'||v_suffix);
  insert into public.content_posts(id,fecha,hora,canal,campaign_id,creative_id,titulo,estado,external_post_id)
  values(v_post_one,current_date,'12:00','Instagram',v_campaign,v_creative,'H105 episodio uno','Publicado','ig-h105-a-'||v_suffix),
        (v_post_two,current_date,'13:00','Instagram',v_campaign,v_creative,'H105 episodio dos','Publicado','ig-h105-b-'||v_suffix);
  insert into public.metrics_daily(fecha,fuente,campaign_id,creative_id,post_id,impresiones,alcance,clicks,mensajes_wa,gasto,notas)
  values(current_date,'mcp-meta',v_campaign,v_creative,v_post_one,600,450,20,0,0,'H105 agregado'),
        (current_date,'mcp-meta',v_campaign,v_creative,v_post_two,400,300,12,0,0,'H105 agregado');
  insert into h105_context values(v_actor.id,v_actor.auth_id,v_campaign,v_creative,v_post_one,v_post_two,null,null,null,null);
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select auth_id::text from h105_context),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare
  v_series_payload jsonb; v_team_payload jsonb; v_contract jsonb; v_result jsonb;
  v_series bigint; v_team bigint; v_episode_one bigint; v_episode_two bigint; v_person bigint;
  v_signal bigint; v_empty_signal bigint; v_failed boolean:=false; v_snapshot jsonb;
begin
  v_contract:=jsonb_build_object(
    'audience','Personas que buscan un antojo cercano y real',
    'hook','El producto aparece desde un ritual cotidiano',
    'narrative_formula','Ritual, descubrimiento y payoff honesto',
    'ritual','Abrir, mostrar y probar','tone','Cálido, cercano y espontáneo',
    'format','Reel vertical 9:16','evidence','Producto y empaque reales',
    'cta','Preguntar por la figura favorita','frequency','Una vez por semana',
    'fixed_elements',jsonb_build_array('Identidad MOMOS','Producto real'),
    'allowed_variables',jsonb_build_array('Figura','Sabor'),
    'restrictions',jsonb_build_array('Sin testimonios inventados','Sin datos personales'));
  v_series_payload:=jsonb_build_object(
    'proposal_key','h105-series-'||pg_backend_pid(),'series_key','ritual-producto-real',
    'name','Ritual MOMOS real','purpose','Mostrar el producto real dentro de rituales cotidianos verificables.',
    'protagonist','Producto real','emotional_territory','Antojo','mode','Orgánico','channel','Instagram',
    'source_formula_id',null,'editorial_contract',v_contract);

  begin
    perform public.proponer_serie_humanizacion_v1(v_series_payload||jsonb_build_object('customer_phone','3001234567'));
  exception when others then v_failed:=true; end;
  assert v_failed,'H105 aceptó PII o campos abiertos en una serie.';

  v_result:=public.proponer_serie_humanizacion_v1(v_series_payload); v_series:=(v_result->>'series_id')::bigint;
  assert v_series is not null and v_result->>'status'='Propuesta'
    and (v_result->>'human_approval_required')::boolean and not (v_result->>'external_execution')::boolean,
    'H105 no dejó la serie como propuesta humana y cerrada.';
  assert (public.proponer_serie_humanizacion_v1(v_series_payload)->>'duplicate')::boolean,
    'H105 duplicó una serie durante replay.';
  v_failed:=false;
  begin perform public.proponer_serie_humanizacion_v1(jsonb_set(v_series_payload,'{name}',to_jsonb('Otra serie con la misma llave'::text)));
  exception when others then v_failed:=true; end;
  assert v_failed,'H105 aceptó una colisión idempotente.';
  perform public.revisar_serie_humanizacion_v1(v_series,'En revisión','Revisión humana de propósito, tono, evidencia y límites.');
  perform public.revisar_serie_humanizacion_v1(v_series,'Aprobada','Identidad, producto real, ritual, prueba, variables y restricciones verificados.');

  v_team_payload:=v_series_payload||jsonb_build_object(
    'proposal_key','h105-team-'||pg_backend_pid(),'series_key','equipo-cercano',
    'name','El equipo detrás del antojo','purpose','Mostrar momentos reales del equipo sin exponer información personal.',
    'protagonist','Equipo','emotional_territory','Compañía');
  v_team:=(public.proponer_serie_humanizacion_v1(v_team_payload)->>'series_id')::bigint;
  perform public.revisar_serie_humanizacion_v1(v_team,'En revisión','Revisión humana de equipo, privacidad, evidencia y consentimiento.');
  perform public.revisar_serie_humanizacion_v1(v_team,'Aprobada','Serie editorial aprobada; cada episodio todavía exige consentimiento vigente.');

  v_result:=public.proponer_episodio_humanizacion_v1(jsonb_build_object(
    'proposal_key','h105-person-'||pg_backend_pid(),'episode_key','persona-sin-consentimiento',
    'series_id',v_team,'title','Una persona abre la bolsa','story_kind','Momento de equipo',
    'representation','Persona real','production_pack_id',null,'source_formula_id',null,
    'source_brief_id',null,'source_creative_id',null,'episode_contract',jsonb_build_object(
      'angle','Momento cotidiano','hook','La bolsa llega a la mesa','story_arc','Apertura, mirada y producto',
      'proof','Persona y producto reales','single_variable','Figura mostrada','cta','Preguntar por el favorito',
      'synthetic_disclosure','','privacy_note','No identificar a la persona sin consentimiento vigente')));
  v_person:=(v_result->>'episode_id')::bigint;
  perform public.revisar_episodio_humanizacion_v1(v_person,'En revisión','Revisar paquete, derechos, consentimiento, canal y finalidad.');
  v_failed:=false;
  begin perform public.revisar_episodio_humanizacion_v1(v_person,'Aprobado',
    'Intento inválido de aprobar una persona sin paquete ni consentimiento.');
  exception when others then v_failed:=true; end;
  assert v_failed,'H105 aprobó persona o testimonio sin consentimiento verificable.';

  v_result:=public.proponer_episodio_humanizacion_v1(jsonb_build_object(
    'proposal_key','h105-episode-a-'||pg_backend_pid(),'episode_key','producto-real-a',
    'series_id',v_series,'title','Max aparece como antojo','story_kind','Ritual de producto',
    'representation','Producto real','production_pack_id',null,'source_formula_id',null,
    'source_brief_id',null,'source_creative_id',(select creative_id from h105_context),
    'episode_contract',jsonb_build_object('angle','Antojo visual','hook','Max aparece al abrir la bolsa',
      'story_arc','Bolsa, producto y cucharada','proof','Producto real visible','single_variable','Figura Max',
      'cta','Preguntar por el sabor','synthetic_disclosure','','privacy_note','Sin personas o datos personales')));
  v_episode_one:=(v_result->>'episode_id')::bigint;
  perform public.revisar_episodio_humanizacion_v1(v_episode_one,'En revisión','Revisar producto, prueba, privacidad y coherencia con la serie.');
  perform public.revisar_episodio_humanizacion_v1(v_episode_one,'Aprobado','Producto, identidad, prueba, privacidad y variable única fueron verificados.');
  perform public.vincular_episodio_humanizacion_publicacion_v1(v_episode_one,(select post_one from h105_context),
    'Vínculo exacto verificado entre episodio aprobado y publicación Meta.');

  v_result:=public.proponer_episodio_humanizacion_v1(jsonb_build_object(
    'proposal_key','h105-episode-b-'||pg_backend_pid(),'episode_key','producto-real-b',
    'series_id',v_series,'title','Toby aparece como antojo','story_kind','Ritual de producto',
    'representation','Producto real','production_pack_id',null,'source_formula_id',null,
    'source_brief_id',null,'source_creative_id',(select creative_id from h105_context),
    'episode_contract',jsonb_build_object('angle','Antojo visual','hook','Toby aparece al abrir la bolsa',
      'story_arc','Bolsa, producto y cucharada','proof','Producto real visible','single_variable','Figura Toby',
      'cta','Preguntar por el sabor','synthetic_disclosure','','privacy_note','Sin personas o datos personales')));
  v_episode_two:=(v_result->>'episode_id')::bigint;
  perform public.revisar_episodio_humanizacion_v1(v_episode_two,'En revisión','Revisar producto, prueba, privacidad y coherencia con la serie.');
  perform public.revisar_episodio_humanizacion_v1(v_episode_two,'Aprobado','Producto, identidad, prueba, privacidad y variable única fueron verificados.');
  perform public.vincular_episodio_humanizacion_publicacion_v1(v_episode_two,(select post_two from h105_context),
    'Vínculo exacto verificado entre segundo episodio y publicación Meta.');

  v_failed:=false;
  begin perform public.registrar_senal_comunidad_v1(jsonb_build_object(
    'signal_key','h105-raw-'||pg_backend_pid(),'episode_id',v_episode_one,'platform','Meta',
    'window_start',current_date,'window_end',current_date,
    'counts',jsonb_build_object('comments_total',4,'meaningful_comments',2,'questions',1,'shares',1,'saves',1,
      'mentions',0,'authorized_ugc',0,'recurring_conversations',0,'character_associations',1),
    'themes',jsonb_build_array(jsonb_build_object('theme','Personaje','count',3,'sentiment','Positivo')),
    'raw_comment','Amo a Max, soy persona privada'));
  exception when others then v_failed:=true; end;
  assert v_failed,'H105 aceptó comentario crudo o campo abierto desde Comunidad.';

  v_result:=public.registrar_senal_comunidad_v1(jsonb_build_object(
    'signal_key','h105-signal-'||pg_backend_pid(),'episode_id',v_episode_one,'platform','Meta',
    'window_start',current_date,'window_end',current_date,
    'counts',jsonb_build_object('comments_total',7,'meaningful_comments',3,'questions',2,'shares',2,'saves',2,
      'mentions',0,'authorized_ugc',0,'recurring_conversations',1,'character_associations',2),
    'themes',jsonb_build_array(jsonb_build_object('theme','Personaje','count',5,'sentiment','Positivo'))));
  v_signal:=(v_result->>'signal_id')::bigint;
  assert v_signal is not null and (v_result->>'reach')::bigint=450 and v_result->>'outcome'='En revisión'
    and not (v_result->>'external_execution')::boolean,'H105 no derivó la señal exacta o decidió automáticamente.';
  assert (public.registrar_senal_comunidad_v1(jsonb_build_object(
    'signal_key','h105-signal-'||pg_backend_pid(),'episode_id',v_episode_one,'platform','Meta',
    'window_start',current_date,'window_end',current_date,
    'counts',jsonb_build_object('comments_total',7,'meaningful_comments',3,'questions',2,'shares',2,'saves',2,
      'mentions',0,'authorized_ugc',0,'recurring_conversations',1,'character_associations',2),
    'themes',jsonb_build_array(jsonb_build_object('theme','Personaje','count',5,'sentiment','Positivo'))))->>'duplicate')::boolean,
    'H105 duplicó una señal durante replay.';
  v_result:=public.resolver_senal_comunidad_v1(v_signal,'Conexión ganadora',
    'Dos episodios publicados y señales significativas verifican conexión; vistas solas no sustentan esta decisión.');
  assert v_result->>'outcome'='Conexión ganadora' and not (v_result->>'external_execution')::boolean,
    'H105 no selló la decisión humana de conexión.';

  v_result:=public.registrar_senal_comunidad_v1(jsonb_build_object(
    'signal_key','h105-empty-'||pg_backend_pid(),'episode_id',v_episode_two,'platform','Meta',
    'window_start',current_date,'window_end',current_date,
    'counts',jsonb_build_object('comments_total',0,'meaningful_comments',0,'questions',0,'shares',0,'saves',0,
      'mentions',0,'authorized_ugc',0,'recurring_conversations',0,'character_associations',0),'themes','[]'::jsonb));
  v_empty_signal:=(v_result->>'signal_id')::bigint; v_failed:=false;
  begin perform public.resolver_senal_comunidad_v1(v_empty_signal,'Conexión ganadora',
    'Intento inválido: las vistas por sí solas no prueban conexión comunitaria.');
  exception when others then v_failed:=true; end;
  assert v_failed,'H105 fabricó una conexión ganadora usando solo vistas.';

  v_snapshot:=public.momos_humanization_community_v1();
  assert length(v_snapshot->>'fingerprint')=64
    and v_snapshot#>>'{snapshot,schema_version}'='momos-humanization-community/v1'
    and not (v_snapshot#>>'{snapshot,external_execution_allowed}')::boolean
    and (v_snapshot#>>'{snapshot,human_approval_required}')::boolean
    and not (v_snapshot#>>'{snapshot,privacy,contains_raw_comments}')::boolean
    and not (v_snapshot#>>'{snapshot,privacy,contains_handles}')::boolean
    and not (v_snapshot#>>'{snapshot,capabilities,can_reply}')::boolean
    and not (v_snapshot#>>'{snapshot,capabilities,can_publish}')::boolean
    and not (v_snapshot#>>'{snapshot,metric_definitions,views_alone_can_win}')::boolean
    and v_snapshot::text !~* '"(customer_phone|raw_comment|comment_text|user_handle|direct_message|order_id)"[[:space:]]*:',
    'H105 perdió huella, privacidad, decisión humana o cierre externo.';
  update h105_context set series_id=v_series,episode_one=v_episode_one,episode_two=v_episode_two,signal_id=v_signal;
end $$;

reset role;

do $$ declare v_failed boolean:=false;
begin
  begin update public.agency_humanization_series set editorial_contract='{}'::jsonb
    where id=(select series_id from h105_context); exception when others then v_failed:=true; end;
  assert v_failed,'H105 permitió reescribir una serie aprobada.';
  v_failed:=false;
  begin update public.agency_community_signal_rollups set meaningful_comments=999
    where id=(select signal_id from h105_context); exception when others then v_failed:=true; end;
  assert v_failed,'H105 permitió falsificar señales agregadas.';
  v_failed:=false;
  begin update public.agency_community_signal_rollups set outcome='Descartada'
    where id=(select signal_id from h105_context); exception when others then v_failed:=true; end;
  assert v_failed,'H105 permitió reabrir una decisión terminal.';
end $$;

select 'TESTS_OK — H105 series/episodios/consentimiento/señales agregadas/PII/RBAC/decisión humana PASS, rollback total'
  as resultado;
rollback;
