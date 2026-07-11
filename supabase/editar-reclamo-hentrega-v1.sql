-- ============================================================================
-- MOMOS OPS — editar_reclamo v2: soporte de h_entrega (slice 3c)
-- Target: Supabase / PostgreSQL 17. Reemplaza editar_reclamo de
-- rpc-produccion-v1.sql (líneas 668-705) SIN cambiar su firma (text, jsonb):
-- CREATE OR REPLACE preserva grants existentes; se re-declaran igual por
-- convención de estos archivos espejo.
--
-- Gap cerrado: el modal "Guardar caso" de la maqueta edita "Hora de entrega
-- (HH:MM)" (claims.entregado_en), pero la v1 solo aceptaba tipo/descr/resp/
-- decision/solucion/costo/evidencia — al migrar el modal a esta RPC, esa
-- edición se perdería en silencio. La v2 acepta la clave opcional 'h_entrega':
--   · ausente        → entregado_en no se toca (igual que v1)
--   · ''             → entregado_en = null (limpiar el sello)
--   · 'HH:MM' válido → entregado_en = (orders.fecha + hora) America/Bogota,
--     misma composición que crear_reclamo (rpc-produccion-v1.sql línea 603).
--
-- NO EJECUTAR contra ninguna base desde acá — archivo de definición únicamente.
-- ============================================================================

create or replace function editar_reclamo(p_claim_id text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c claims%rowtype;
  v_costo numeric;
  v_hentrega text;
  v_entregado_en timestamptz;
begin
  if not is_staff() then
    raise exception 'Solo staff activo';
  end if;

  select * into c from claims where id = p_claim_id for update;
  if c.id is null then
    raise exception 'El reclamo % no existe', p_claim_id;
  end if;

  if p ? 'costo' then
    v_costo := (p->>'costo')::numeric;
    if v_costo is not null and v_costo < 0 then
      raise exception 'El costo del reclamo no puede ser negativo';
    end if;
  end if;

  -- h_entrega opcional: '' limpia el sello; 'HH:MM' lo recompone con la fecha
  -- del PEDIDO (no la del reclamo), igual que crear_reclamo.
  if p ? 'h_entrega' then
    v_hentrega := coalesce(p->>'h_entrega', '');
    if v_hentrega = '' then
      v_entregado_en := null;
    elsif v_hentrega !~ '^([01]\d|2[0-3]):[0-5]\d$' then
      raise exception 'Hora de entrega inválida (formato HH:MM): %', v_hentrega;
    else
      select (o.fecha + v_hentrega::time) at time zone 'America/Bogota'
        into v_entregado_en
      from orders o where o.id = c.order_id;
    end if;
  end if;

  update claims set
    -- tipo no admite vacío (claims.tipo es not null y un reclamo sin tipo no
    -- significa nada); los demás campos SÍ pueden vaciarse legítimamente.
    tipo     = coalesce(nullif(p->>'tipo',''), tipo),
    descr    = coalesce(p->>'descr', descr),
    resp     = coalesce(p->>'resp', resp),
    decision = coalesce(p->>'decision', decision),
    solucion = coalesce(p->>'solucion', solucion),
    costo    = case when p ? 'costo' then coalesce(v_costo, costo) else costo end,
    evidencia = coalesce(p->>'evidencia', evidencia),
    entregado_en = case when p ? 'h_entrega' then v_entregado_en else entregado_en end
  where id = p_claim_id;

  perform _add_audit('Reclamo', p_claim_id, 'Caso editado');

  return jsonb_build_object('ok', true);
end $$;

revoke execute on function editar_reclamo(text, jsonb) from public, anon;
grant execute on function editar_reclamo(text, jsonb) to authenticated;

-- Verificación esperada:
--   select editar_reclamo('R-001', '{"h_entrega":"25:00"}'::jsonb); → exception formato
--   select editar_reclamo('R-001', '{"h_entrega":"18:30"}'::jsonb); → ok, entregado_en recompuesto
--   select editar_reclamo('R-001', '{"h_entrega":""}'::jsonb);      → ok, entregado_en null
