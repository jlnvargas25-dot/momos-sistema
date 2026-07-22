export function SegmentedTabs({
  ariaLabel,
  items,
  value,
  onChange,
  className = "momo-segmented-tabs inline-flex max-w-full gap-1 overflow-x-auto p-1.5 mb-4 rounded-2xl",
  tabClassName = "momo-segmented-tab shrink-0 rounded-xl px-3 py-2 text-xs font-bold border-0",
  countClassName = "ml-1 inline-flex min-w-5 h-5 px-1 rounded-full items-center justify-center text-[10px]",
  plainCount = false,
  getCount,
}) {
  return (
    <div className={className} role="tablist" aria-label={ariaLabel}>
      {items.map((rawItem) => {
        const item = typeof rawItem === "string"
          ? { label: rawItem, value: rawItem }
          : Array.isArray(rawItem)
            ? { label: rawItem[0], value: rawItem[1], count: rawItem[2] }
            : rawItem;
        const itemValue = item.value ?? item.id;
        const selected = value === itemValue;
        const count = getCount ? getCount(itemValue, item) : item.count;

        return (
          <button
            key={item.key ?? itemValue ?? item.label}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(itemValue)}
            className={tabClassName}
            style={selected
              ? { background: "#E5714E", color: "#fff" }
              : { background: "transparent", color: "#8A6C5B" }}
          >
            {item.label}
            {count != null && (
              <span className={countClassName} style={plainCount ? undefined : { background: selected ? "rgba(255,255,255,.2)" : "#fff" }}>{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function InlineNotice({
  icon,
  title,
  children,
  tone = "warning",
  role = "status",
  className = "mb-4",
  style,
}) {
  const colors = tone === "danger"
    ? { background: "#FFF1ED", border: "1px solid #F0C1B8", color: "#A03B2A" }
    : { background: "#FFF5E4", border: "1px solid #EDD4A8", color: "#7B5410" };
  return (
    <div
      className={`rounded-2xl px-4 py-3 flex items-start gap-3 ${className}`.trim()}
      style={{ ...colors, ...style }}
      role={role}
    >
      <span className="text-lg">{icon}</span>
      <div>
        <div className="text-sm font-extrabold">{title}</div>
        <div className="text-xs mt-0.5">{children}</div>
      </div>
    </div>
  );
}
