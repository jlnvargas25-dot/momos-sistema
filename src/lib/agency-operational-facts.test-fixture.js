const limits = Object.freeze({
  product_catalog: 500, product_sales_30d: 500,
  campaign_attribution: 500, creative_attribution: 500, published_post_attribution: 500,
  critical_preparations: 50,
});

export function makeAgencyOperationalFacts(overrides = {}) {
  const productCatalog = (overrides.product_catalog || [{ product_id: "P1", name: "Momo", active: true, available_stock: 1 }])
    .map((row) => ({
      category: "Momos", type: "simple", species: "gato", price: 18000,
      queue_units: 0, in_process_units: 0, production_buffer: 0,
      stock_source: row.available_stock === null ? "unverified" : "exact-variants", ...row,
    }));
  const productSales = overrides.product_sales_30d || [];
  const campaigns = overrides.campaign_attribution || [];
  const creatives = overrides.creative_attribution || [];
  const posts = overrides.published_post_attribution || [];
  const production = {
    plan_units: 0, plan_runs: 0, queue_units: 0, active_batch_units: 0, critical_preparations: [],
    ...(overrides.production || {}),
  };
  const counts = {
    product_catalog: productCatalog.length, product_sales_30d: productSales.length,
    campaign_attribution: campaigns.length, creative_attribution: creatives.length,
    published_post_attribution: posts.length, critical_preparations: production.critical_preparations.length,
  };
  return {
    facts_ready: true, contract_version: 1, generated_at: "2026-07-17T12:00:00Z",
    limits: { ...limits }, counts,
    truncated: Object.fromEntries(Object.keys(limits).map((key) => [key, false])),
    product_catalog: productCatalog, product_sales_30d: productSales,
    paid_summary: { orders_30d: 0, revenue_30d: 0, orders_all: 0, revenue_all: 0, attributed_orders_30d: 0, ...(overrides.paid_summary || {}) },
    campaign_attribution: campaigns, creative_attribution: creatives, published_post_attribution: posts,
    crm_segments: { birthdays_7d: 0, dormant_30d: 0, contains_customer_ids: false, ...(overrides.crm_segments || {}) },
    calendar: overrides.calendar || { today: { posts: 0 }, next_7d: [] },
    production,
  };
}
