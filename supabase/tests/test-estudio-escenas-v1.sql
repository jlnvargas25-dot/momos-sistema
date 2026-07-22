-- MOMOS OPS · Prueba adversarial Estudio creativo por escenas v1. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260716_31_estudio_escenas'), 'Falta migración 31.';
  assert public.estudio_escenas_disponible(), 'Falta sonda del Estudio por escenas.';
  assert has_function_privilege('authenticated','public.crear_storyboard_agencia(jsonb)','EXECUTE'), 'Agencia no puede crear storyboards.';
  assert has_function_privilege('authenticated','public.guardar_toma_storyboard(jsonb)','EXECUTE'), 'Agencia no puede versionar tomas.';
  assert has_function_privilege('authenticated','public.enviar_storyboard_revision(bigint)','EXECUTE'), 'Agencia no puede enviar a revisión.';
  assert has_function_privilege('authenticated','public.resolver_storyboard_agencia(bigint,text,text)','EXECUTE'), 'Agencia no puede resolver la revisión.';
  assert not has_table_privilege('authenticated','public.agency_storyboards','INSERT'), 'El navegador puede insertar storyboards directos.';
  assert not has_table_privilege('authenticated','public.agency_storyboard_shots','UPDATE'), 'El navegador puede reescribir tomas directas.';
end $$;

do $$
declare v_actor public.users%rowtype; v_decision bigint; v_room bigint; v_contract bigint; v_context jsonb; v_contract_payload jsonb;
begin
  select * into v_actor from public.users where auth_id is not null and activo
    and ('Administrador'=any(coalesce(roles,array[rol])) or 'Marketing/CRM'=any(coalesce(roles,array[rol]))) order by id limit 1;
  assert v_actor.id is not null, 'Falta actor de Agencia para la prueba.';
  insert into public.agency_decisions(type,title,rationale,evidence,proposed_action,risk_level,status,author,created_by,approved_by,approved_at)
  values('Crear contenido','TEST31 pieza por escenas','Validar continuidad y retención antes de gastar.','{"source":"test31"}'::jsonb,
    '{"proposed_budget":0}'::jsonb,'Bajo','Aprobada','humano',v_actor.id,v_actor.id,now()) returning id into v_decision;
  v_context:=jsonb_build_object('schema_version',1,'decision_id',v_decision,'objective','Vender con una pieza MOMOS verificable.');
  insert into public.agency_collaboration_rooms(room_key,title,objective,status,decision_id,context_snapshot,context_fingerprint,created_by)
  values('test31-scene-room','TEST31 Estudio','Diseñar la pieza sin ejecutar proveedores.','Cerrada',v_decision,v_context,
    public._agency_mesa_fingerprint(v_context),v_actor.id) returning id into v_room;
  v_contract_payload:=jsonb_build_object('schema_version',1,'room_id',v_room,'creative_direction',jsonb_build_object(
    'concept','Abrir un Momo y revelar su relleno real','audience','Clientes de recompra','channel','Instagram',
    'primary_kpi','Beneficio incremental','human_intent','Tierno, premium y antojable','call_to_action','Pedí el tuyo'));
  insert into public.agency_creative_contracts(contract_key,room_id,version,status,sealed_payload,contract_fingerprint,
    prepared_by,approved_by,approved_at,approval_note,approval_snapshot)
  values('test31-approved-contract',v_room,1,'Aprobado',v_contract_payload,public._agency_mesa_fingerprint(v_contract_payload),
    v_actor.id,v_actor.id,now(),'Contrato de prueba aprobado','{"approved":true}'::jsonb) returning id into v_contract;
  perform set_config('momos.scene_auth',v_actor.auth_id::text,true);
  perform set_config('momos.scene_contract',v_contract::text,true);
  perform set_config('momos.scene_jobs_before',(select count(*)::text from public.creative_generation_jobs),true);
  perform set_config('momos.scene_posts_before',(select count(*)::text from public.content_posts),true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('momos.scene_auth'),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare v_result jsonb; v_duplicate jsonb; v_board bigint; v_failed boolean:=false;
begin
  v_result:=public.crear_storyboard_agencia(jsonb_build_object(
    'storyboard_key','test31-board-v1','contract_id',current_setting('momos.scene_contract')::bigint,
    'title','TEST31 Reel relleno real','channel','Instagram','format','Reel','aspect_ratio','9:16','target_duration_sec',6,
    'creative_brief',jsonb_build_object('hook','¿Qué esconde este Momo?','payoff','Ganache real en el centro',
      'call_to_action','Pedí el tuyo','visual_thesis','Producto real, macro cálido y manos humanas'),
    'retention_plan',jsonb_build_object('loops',jsonb_build_array(jsonb_build_object('loop_id','L1','open_sec',0,
      'close_sec',6,'promise','¿Qué hay dentro?','payoff','El relleno real'))),'estimated_cost_cop',2500));
  v_board:=(v_result->>'storyboard_id')::bigint;
  perform set_config('momos.scene_board',v_board::text,true);
  assert not (v_result->>'executed')::boolean and (v_result->>'requires_human_approval')::boolean, 'Crear storyboard ejecutó o evitó aprobación.';
  v_duplicate:=public.crear_storyboard_agencia(jsonb_build_object(
    'storyboard_key','test31-board-same-content','contract_id',current_setting('momos.scene_contract')::bigint,
    'title','TEST31 Reel relleno real','channel','Instagram','format','Reel','aspect_ratio','9:16','target_duration_sec',6,
    'creative_brief',jsonb_build_object('hook','¿Qué esconde este Momo?','payoff','Ganache real en el centro',
      'call_to_action','Pedí el tuyo','visual_thesis','Producto real, macro cálido y manos humanas'),
    'retention_plan',jsonb_build_object('loops',jsonb_build_array(jsonb_build_object('loop_id','L1','open_sec',0,
      'close_sec',6,'promise','¿Qué hay dentro?','payoff','El relleno real'))),'estimated_cost_cop',2500));
  assert (v_duplicate->>'duplicate')::boolean and (v_duplicate->>'storyboard_id')::bigint=v_board,
    'El mismo contenido creó un storyboard duplicado.';
  begin perform public.enviar_storyboard_revision(v_board); exception when others then v_failed:=true; end;
  assert v_failed, 'Se envió a revisión un storyboard sin tomas.';
end $$;

do $$
declare v_board bigint:=current_setting('momos.scene_board')::bigint; v_result jsonb; v_dup jsonb; v_failed boolean:=false;
begin
  begin
    perform public.guardar_toma_storyboard(jsonb_build_object('storyboard_id',v_board,'shot_number',1,'title','Intrusión',
      'purpose','Usar activo ajeno','duration_sec',3,'input_asset_ids',jsonb_build_array(999999999),
      'shot',jsonb_build_object('subject','Momo','action','Se abre','camera','Macro','continuity_out','Relleno visible')));
  exception when others then v_failed:=true; end;
  assert v_failed, 'Una toma aceptó un activo inexistente o sin derechos.';
  v_result:=public.guardar_toma_storyboard(jsonb_build_object('storyboard_id',v_board,'shot_number',1,'title','La promesa',
    'purpose','Abrir curiosidad','duration_sec',3,'estimated_cost_cop',1000,'input_asset_ids','[]'::jsonb,
    'shot',jsonb_build_object('subject','Momo real','action','Dos manos lo parten lentamente','physics','La cobertura cede con peso real',
      'environment','Mesa cálida MOMOS','camera','Macro fijo con acercamiento corto','lighting','Luz suave lateral','audio','Crujido real',
      'on_screen_text','¿Qué hay dentro?','continuity_in','Momo entero','continuity_out','Ganache apenas visible','avoid','Manos deformes')));
  v_dup:=public.guardar_toma_storyboard(jsonb_build_object('storyboard_id',v_board,'shot_number',1,'title','La promesa',
    'purpose','Abrir curiosidad','duration_sec',3,'estimated_cost_cop',1000,'input_asset_ids','[]'::jsonb,
    'shot',jsonb_build_object('subject','Momo real','action','Dos manos lo parten lentamente','physics','La cobertura cede con peso real',
      'environment','Mesa cálida MOMOS','camera','Macro fijo con acercamiento corto','lighting','Luz suave lateral','audio','Crujido real',
      'on_screen_text','¿Qué hay dentro?','continuity_in','Momo entero','continuity_out','Ganache apenas visible','avoid','Manos deformes')));
  assert (v_dup->>'duplicate')::boolean and (v_dup->>'shot_id')::bigint=(v_result->>'shot_id')::bigint, 'La misma toma se duplicó.';
  perform public.guardar_toma_storyboard(jsonb_build_object('storyboard_id',v_board,'shot_number',2,'title','El payoff',
    'purpose','Resolver y vender','duration_sec',3,'estimated_cost_cop',1500,'input_asset_ids','[]'::jsonb,
    'shot',jsonb_build_object('subject','Ganache real','action','El relleno cae lentamente','physics','Viscosidad natural y gravedad consistente',
      'environment','Misma mesa MOMOS','camera','Dolly corto al centro','lighting','Misma luz cálida','audio','Golpe musical y voz',
      'on_screen_text','Hecho para antojarte','continuity_in','Ganache visible','continuity_out','Logo y CTA','avoid','Texto ilegible')));
  perform public.guardar_toma_storyboard(jsonb_build_object('storyboard_id',v_board,'shot_number',1,'title','La promesa afinada',
    'purpose','Abrir curiosidad con producto','duration_sec',3,'estimated_cost_cop',1100,'input_asset_ids','[]'::jsonb,
    'shot',jsonb_build_object('subject','Momo real','action','Dos manos lo abren en cámara','physics','La cobertura resiste y cede con peso real',
      'environment','Mesa cálida MOMOS','camera','Macro fijo, sin órbita','lighting','Luz suave lateral','audio','Crujido real',
      'on_screen_text','¿Qué esconde?','continuity_in','Momo entero','continuity_out','Ganache visible','avoid','Deformación del producto')));
  assert (select count(*)=1 from public.agency_storyboard_shots where storyboard_id=v_board and shot_number=1 and status='Vigente'),
    'La revisión dejó más de una toma vigente.';
  assert exists(select 1 from public.agency_storyboard_shots where storyboard_id=v_board and shot_number=1 and revision=1 and status='Sustituida'),
    'La revisión anterior no quedó trazable.';
end $$;

do $$
declare v_board bigint:=current_setting('momos.scene_board')::bigint; v_result jsonb;
begin
  v_result:=public.enviar_storyboard_revision(v_board);
  assert v_result->>'status'='En revisión' and not (v_result->>'generation_started')::boolean, 'Enviar revisión generó contenido.';
  v_result:=public.resolver_storyboard_agencia(v_board,'Devolver','Ajustar el texto de cierre al lenguaje MOMOS.');
  assert v_result->>'status'='Borrador', 'La devolución no reabrió el storyboard.';
  perform public.guardar_toma_storyboard(jsonb_build_object('storyboard_id',v_board,'shot_number',2,'title','El payoff MOMOS',
    'purpose','Resolver y vender con voz de marca','duration_sec',3,'estimated_cost_cop',1500,'input_asset_ids','[]'::jsonb,
    'shot',jsonb_build_object('subject','Ganache real','action','El relleno cae lentamente','physics','Viscosidad natural y gravedad consistente',
      'environment','Misma mesa MOMOS','camera','Dolly corto al centro','lighting','Misma luz cálida','audio','Golpe musical y voz',
      'on_screen_text','Un Momo para vos','continuity_in','Ganache visible','continuity_out','Logo y CTA','avoid','Texto ilegible')));
  perform public.enviar_storyboard_revision(v_board);
  v_result:=public.resolver_storyboard_agencia(v_board,'Aprobar','Aprobado por marca para preparar generación controlada.');
  assert v_result->>'status'='Aprobado' and not (v_result->>'executed')::boolean
    and not (v_result->>'generation_started')::boolean and not (v_result->>'distribution_started')::boolean,
    'Aprobar storyboard gastó, generó o distribuyó.';
end $$;

do $$ declare v_failed boolean:=false; begin
  begin perform public.guardar_toma_storyboard(jsonb_build_object('storyboard_id',current_setting('momos.scene_board')::bigint,
    'shot_number',3,'title','Toma tardía','purpose','Alterar aprobado','duration_sec',1,
    'shot',jsonb_build_object('subject','Momo','action','Cambia','camera','Macro','continuity_out','Otro final')));
  exception when others then v_failed:=true; end;
  assert v_failed, 'Se agregó una toma después de aprobar el storyboard.';
end $$;
reset role;

do $$ declare v_failed boolean:=false; begin
  begin update public.agency_storyboard_shots set shot_payload=shot_payload||'{"tampered":true}'::jsonb
    where storyboard_id=current_setting('momos.scene_board')::bigint and status='Vigente';
  exception when others then v_failed:=true; end;
  assert v_failed, 'Una toma sellada pudo reescribirse.';
  assert (select count(*) from public.creative_generation_jobs)=current_setting('momos.scene_jobs_before')::bigint,
    'El Estudio creó un trabajo de generación.';
  assert (select count(*) from public.content_posts)=current_setting('momos.scene_posts_before')::bigint,
    'El Estudio publicó contenido.';
end $$;

do $$ declare v_auth uuid; v_failed boolean:=false; begin
  select auth_id into v_auth from public.users where auth_id is not null and activo
    and not ('Administrador'=any(coalesce(roles,array[rol]))) and not ('Marketing/CRM'=any(coalesce(roles,array[rol]))) order by id limit 1;
  if v_auth is not null then
    perform set_config('request.jwt.claims',jsonb_build_object('sub',v_auth,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    begin perform public.crear_storyboard_agencia(jsonb_build_object('storyboard_key','test31-intrusion','contract_id',
      current_setting('momos.scene_contract')::bigint,'title','Intrusión creativa','channel','TikTok','format','Video',
      'aspect_ratio','9:16','target_duration_sec',6,'creative_brief',jsonb_build_object('hook','x','payoff','y','call_to_action','z'),
      'retention_plan',jsonb_build_object('loops','[]'::jsonb)));
    exception when others then v_failed:=true; end;
    execute 'reset role';
    assert v_failed, 'Un rol ajeno a Agencia abrió un storyboard.';
  end if;
end $$;

select 'TESTS_OK — Estudio storyboard/tomas/continuidad/derechos/costo/aprobación/RBAC PASS, rollback total' as resultado;
rollback;
