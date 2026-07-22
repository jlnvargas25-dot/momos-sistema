-- MOMOS OPS · Bandeja semántica del Cerebro de Agencia v1.
-- Paso 44. Traduce cada decisión humana aprobada en un único siguiente paso
-- determinístico, sin texto libre, PII, secretos ni ejecución externa.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260716'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260716_43_ciclo_cooperativo_mcp'
  ) then raise exception 'Falta el paso 43_ciclo_cooperativo_mcp.'; end if;
end $$;

-- Conserva el wrapper H43 como núcleo privado y añade la cola sobre el mismo
-- snapshot. No cambia el contrato MCP ni requiere reiniciar Codex.
do $$ begin
  if to_regprocedure('public._obtener_contexto_director_agencia_h43()') is null then
    alter function public.obtener_contexto_director_agencia()
      rename to _obtener_contexto_director_agencia_h43;
  end if;
end $$;

create or replace function public._agency_mcp_next_action(p_decision_id bigint) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  v_decision public.agency_decisions%rowtype;
  v_room public.agency_collaboration_rooms%rowtype;
  v_contract public.agency_creative_contracts%rowtype;
  v_board public.agency_storyboards%rowtype;
  v_motion public.agency_motion_plans%rowtype;
  v_route public.agency_scene_routing_plans%rowtype;
  v_package public.agency_postproduction_packages%rowtype;
  v_code text; v_label text; v_stage text; v_area text; v_route_path text;
  v_blocked boolean:=false; v_blocker text:=''; v_human boolean:=true;
  v_jobs integer:=0; v_completed integer:=0; v_failed integer:=0;
  v_pending_review integer:=0; v_rejected_review integer:=0; v_approved_review integer:=0;
  v_qa_total integer:=0; v_qa_pending integer:=0; v_qa_rejected integer:=0; v_qa_approved integer:=0;
begin
  select * into v_decision from public.agency_decisions
  where id=p_decision_id and status='Aprobada';
  if v_decision.id is null then return null; end if;

  if v_decision.type='Reponer stock' then
    v_code:='REVIEW_PRODUCTION_PLAN'; v_label:='Revisar y confirmar el plan de producción';
    v_stage:='Planificación'; v_area:='Producción'; v_route_path:='/produccion';
  elsif v_decision.type='Contactar segmento' then
    v_code:='REVIEW_CONSENT_AND_SEGMENT'; v_label:='Verificar consentimiento y segmento antes de contactar';
    v_stage:='CRM'; v_area:='Clientes'; v_route_path:='/clientes';
  elsif v_decision.type='Revisar oferta' then
    v_code:='REVIEW_COMMERCIAL_OFFER'; v_label:='Revisar la oferta, margen, stock y vigencia';
    v_stage:='Estrategia comercial'; v_area:='Agencia MOMOS'; v_route_path:='/agencia';
  elsif v_decision.type in ('Activar campaña','Pausar campaña','Escalar presupuesto') then
    v_code:='REVIEW_CAMPAIGN_SCENARIO'; v_label:='Revisar el escenario sin ejecutar cambios externos';
    v_stage:='Inversión'; v_area:='Agencia MOMOS'; v_route_path:='/agencia';
    v_blocked:=true; v_blocker:='EXTERNAL_CONNECTOR_DISABLED';
  elsif v_decision.type='Otro' then
    v_code:='HUMAN_TRIAGE'; v_label:='Clasificar la decisión y asignar su siguiente responsable';
    v_stage:='Coordinación'; v_area:='Agencia MOMOS'; v_route_path:='/agencia';
  else
    -- Crear contenido y Revisar creativo recorren el pipeline gobernado.
    select * into v_room from public.agency_collaboration_rooms
    where decision_id=v_decision.id order by id desc limit 1;
    if v_room.id is null or v_room.status in ('Cancelada') then
      v_code:='OPEN_COLLABORATION_ROOM'; v_label:='Abrir la Mesa cooperativa';
      v_stage:='Mesa'; v_area:='Agencia MOMOS'; v_route_path:='/agencia';
    else
      select * into v_contract from public.agency_creative_contracts
      where room_id=v_room.id order by version desc,id desc limit 1;
      if v_contract.id is null then
        v_code:='PREPARE_CREATIVE_CONTRACT'; v_label:='Preparar el contrato creativo';
        v_stage:='Contrato'; v_area:='Agencia MOMOS'; v_route_path:='/agencia';
      elsif v_contract.status='En revisión' then
        v_code:='REVIEW_CREATIVE_CONTRACT'; v_label:='Revisar y resolver el contrato creativo';
        v_stage:='Contrato'; v_area:='Agencia MOMOS'; v_route_path:='/agencia';
      elsif v_contract.status<>'Aprobado' then
        v_code:='PREPARE_CREATIVE_CONTRACT'; v_label:='Preparar una nueva versión del contrato creativo';
        v_stage:='Contrato'; v_area:='Agencia MOMOS'; v_route_path:='/agencia';
      else
        select * into v_board from public.agency_storyboards
        where contract_id=v_contract.id order by version desc,id desc limit 1;
        if v_board.id is null then
          v_code:='CREATE_STORYBOARD'; v_label:='Crear el storyboard por tomas';
          v_stage:='Storyboard'; v_area:='Creativos'; v_route_path:='/creativos';
        elsif v_board.status='Borrador' then
          v_code:='COMPLETE_STORYBOARD'; v_label:='Completar y enviar el storyboard a revisión';
          v_stage:='Storyboard'; v_area:='Creativos'; v_route_path:='/creativos';
        elsif v_board.status='En revisión' then
          v_code:='REVIEW_STORYBOARD'; v_label:='Revisar y resolver el storyboard';
          v_stage:='Storyboard'; v_area:='Creativos'; v_route_path:='/creativos';
        elsif v_board.status<>'Aprobado' then
          v_code:='CREATE_STORYBOARD'; v_label:='Crear una nueva versión del storyboard';
          v_stage:='Storyboard'; v_area:='Creativos'; v_route_path:='/creativos';
        else
          select * into v_motion from public.agency_motion_plans
          where storyboard_id=v_board.id order by version desc,id desc limit 1;
          if v_motion.id is null then
            v_code:='PREPARE_MOTION_PLAN'; v_label:='Preparar cámara, luz, física y continuidad';
            v_stage:='Motion'; v_area:='Creativos'; v_route_path:='/creativos';
          elsif v_motion.status='En revisión' then
            v_code:='REVIEW_MOTION_PLAN'; v_label:='Revisar y resolver el plan de motion';
            v_stage:='Motion'; v_area:='Creativos'; v_route_path:='/creativos';
          elsif v_motion.status='Devuelto' then
            v_code:='REVISE_MOTION_PLAN'; v_label:='Corregir el plan de motion devuelto';
            v_stage:='Motion'; v_area:='Creativos'; v_route_path:='/creativos';
          elsif v_motion.status<>'Aprobado' then
            v_code:='PREPARE_MOTION_PLAN'; v_label:='Preparar una nueva versión del plan de motion';
            v_stage:='Motion'; v_area:='Creativos'; v_route_path:='/creativos';
          else
            select * into v_route from public.agency_scene_routing_plans
            where storyboard_id=v_board.id order by version desc,id desc limit 1;
            if v_route.id is null then
              v_code:='PREPARE_SCENE_ROUTING'; v_label:='Preparar el enrutamiento de escenas por motor';
              v_stage:='Enrutamiento'; v_area:='Creativos'; v_route_path:='/creativos';
            elsif v_route.status='Preparado' then
              v_code:='AUTHORIZE_SCENE_ROUTING'; v_label:='Revisar y autorizar el enrutamiento de escenas';
              v_stage:='Enrutamiento'; v_area:='Creativos'; v_route_path:='/creativos';
            elsif v_route.status<>'Autorizado' then
              v_code:='PREPARE_SCENE_ROUTING'; v_label:='Preparar un nuevo enrutamiento de escenas';
              v_stage:='Enrutamiento'; v_area:='Creativos'; v_route_path:='/creativos';
            else
              select count(*),
                count(*) filter(where status='Completado'),
                count(*) filter(where status='Fallido'),
                count(*) filter(where status='Completado' and output_review_status='Pendiente'),
                count(*) filter(where status='Completado' and output_review_status in ('Cambios solicitados','Descartada')),
                count(*) filter(where status='Completado' and output_review_status='Aprobada')
              into v_jobs,v_completed,v_failed,v_pending_review,v_rejected_review,v_approved_review
              from public.creative_generation_jobs where id=any(v_route.job_ids);

              if v_jobs=0 or coalesce(cardinality(v_route.job_ids),0)<>v_jobs then
                v_code:='REVIEW_ROUTING_JOBS'; v_label:='Corregir trabajos faltantes del enrutamiento';
                v_stage:='Generación'; v_area:='Creativos'; v_route_path:='/creativos';
                v_blocked:=true; v_blocker:='ROUTING_JOBS_INCOMPLETE';
              elsif v_failed>0 then
                v_code:='REVIEW_GENERATION_FAILURE'; v_label:='Revisar fallos antes de regenerar';
                v_stage:='Generación'; v_area:='Creativos'; v_route_path:='/creativos';
              elsif v_completed<v_jobs then
                v_code:='WAIT_FOR_GENERATION'; v_label:='Esperar y conciliar la generación autorizada';
                v_stage:='Generación'; v_area:='Sistema'; v_route_path:='/creativos';
                v_human:=false;
              elsif v_rejected_review>0 then
                v_code:='REVISE_GENERATED_OUTPUT'; v_label:='Corregir las salidas con cambios solicitados';
                v_stage:='Revisión creativa'; v_area:='Creativos'; v_route_path:='/creativos';
              elsif v_pending_review>0 or v_approved_review<v_jobs then
                v_code:='REVIEW_GENERATED_OUTPUT'; v_label:='Revisar cada salida generada';
                v_stage:='Revisión creativa'; v_area:='Creativos'; v_route_path:='/creativos';
              else
                select count(*),
                  count(*) filter(where status='En revisión'),
                  count(*) filter(where status='Rechazada'),
                  count(*) filter(where status='Aprobada')
                into v_qa_total,v_qa_pending,v_qa_rejected,v_qa_approved
                from public.agency_scene_quality_reviews where routing_plan_id=v_route.id;
                if v_qa_total<v_jobs or v_qa_pending>0 then
                  v_code:='REVIEW_SCENE_QUALITY'; v_label:='Completar la revisión técnica y de marca por escena';
                  v_stage:='Calidad'; v_area:='Creativos'; v_route_path:='/creativos';
                elsif v_qa_rejected>0 then
                  v_code:='CORRECT_REJECTED_SCENES'; v_label:='Corregir las escenas rechazadas';
                  v_stage:='Calidad'; v_area:='Creativos'; v_route_path:='/creativos';
                else
                  select * into v_package from public.agency_postproduction_packages
                  where storyboard_id=v_board.id order by version desc,id desc limit 1;
                  if v_package.id is null then
                    v_code:='PREPARE_POSTPRODUCTION'; v_label:='Preparar montaje, audio, color y entregables';
                    v_stage:='Postproducción'; v_area:='Creativos'; v_route_path:='/creativos';
                  elsif v_package.status='Preparado' then
                    v_code:='REVIEW_POSTPRODUCTION'; v_label:='Revisar y resolver el paquete final';
                    v_stage:='Postproducción'; v_area:='Creativos'; v_route_path:='/creativos';
                  elsif v_package.status='Devuelto' then
                    v_code:='REVISE_POSTPRODUCTION'; v_label:='Corregir el paquete de postproducción';
                    v_stage:='Postproducción'; v_area:='Creativos'; v_route_path:='/creativos';
                  elsif v_package.status='Aprobado' then
                    v_code:='PREPARE_DISTRIBUTION'; v_label:='Preparar distribución comercial y checklist';
                    v_stage:='Distribución'; v_area:='Agencia MOMOS'; v_route_path:='/agencia';
                  else
                    v_code:='PREPARE_POSTPRODUCTION'; v_label:='Preparar una nueva versión de postproducción';
                    v_stage:='Postproducción'; v_area:='Creativos'; v_route_path:='/creativos';
                  end if;
                end if;
              end if;
            end if;
          end if;
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'decision_id',v_decision.id,
    'decision_type',v_decision.type,
    'decision_status',v_decision.status,
    'risk_level',v_decision.risk_level,
    'next_action_code',v_code,
    'next_action_label',v_label,
    'stage',v_stage,
    'area',v_area,
    'route',v_route_path,
    'blocked',v_blocked,
    'blocker_code',v_blocker,
    'human_action_required',v_human,
    'external_execution',false,
    'room_id',v_room.id,
    'contract_id',v_contract.id,
    'storyboard_id',v_board.id,
    'motion_plan_id',v_motion.id,
    'routing_plan_id',v_route.id,
    'postproduction_package_id',v_package.id
  );
end $$;

create or replace function public._agency_mcp_action_queue() returns jsonb
language sql stable security definer set search_path=public as $$
  with pending as (
    select d.id,d.created_at,
      case d.risk_level when 'Alto' then 1 when 'Medio' then 2 else 3 end as risk_order,
      public._agency_mcp_next_action(d.id) as item
    from public.agency_decisions d
    where d.status='Aprobada'
  ), limited as (
    select * from pending where item is not null
    order by risk_order,created_at,id limit 20
  )
  select jsonb_build_object(
    'actionable_total',(select count(*)::integer from pending where item is not null),
    'returned_total',(select count(*)::integer from limited),
    'contains_pii',false,
    'free_text_exposed',false,
    'external_execution_allowed',false,
    'items',coalesce((select jsonb_agg(item order by risk_order,created_at,id) from limited),'[]'::jsonb)
  )
$$;

create or replace function public.obtener_contexto_director_agencia() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  v_base jsonb:=public._obtener_contexto_director_agencia_h43();
  v_snapshot jsonb;
begin
  v_snapshot:=v_base->'snapshot';
  v_snapshot:=jsonb_set(v_snapshot,'{agency,action_queue}',public._agency_mcp_action_queue(),true);
  return jsonb_build_object('snapshot',v_snapshot,'fingerprint',md5(v_snapshot::text));
end $$;

create or replace function public.mcp_agency_action_queue_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

revoke all on function public._obtener_contexto_director_agencia_h43() from public,anon,authenticated,service_role;
revoke all on function public._agency_mcp_next_action(bigint) from public,anon,authenticated,service_role;
revoke all on function public._agency_mcp_action_queue() from public,anon,authenticated,service_role;
revoke all on function public.obtener_contexto_director_agencia() from public,anon,authenticated;
revoke all on function public.mcp_agency_action_queue_disponible() from public,anon;
grant execute on function public.obtener_contexto_director_agencia() to service_role;
grant execute on function public.mcp_agency_action_queue_disponible() to authenticated,service_role;

insert into public.momos_ops_migrations(id,detalle)
values(
  '20260716_44_bandeja_semantica_agencia',
  'Un siguiente paso determinístico por decisión aprobada, sin texto libre, PII, secretos o ejecución externa'
)
on conflict(id) do update set detalle=excluded.detalle;

commit;
