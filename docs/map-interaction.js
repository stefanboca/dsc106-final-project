const d3 = window.d3;

export function linkMapInteractions(maps, size, radius, onSelection) {
  const center = size / 2;
  const layers = maps.map(({ svg, scene }) => {
    const shade = scene.append("path").attr("class", "map-selection-shade")
      .attr("fill-rule", "evenodd").attr("pointer-events", "none");
    const brushLayer = scene.append("g").attr("class", "map-brush");
    const cursor = scene.append("g").attr("class", "map-crosshair")
      .attr("pointer-events", "none").attr("display", "none");
    cursor.append("path").attr("d", "M-10,0H10 M0,-10V10");
    return { svg, shade, brushLayer, cursor };
  });

  let synchronizing = false;
  const brush = d3.brush()
    .extent([[center - radius, center - radius], [center + radius, center + radius]])
    .on("start brush end", function(event) {
      if (synchronizing) return;
      syncSelection(event.selection, this);
    });

  function syncSelection(selection, origin) {
    const hasArea = selection && selection[0][0] < selection[1][0] && selection[0][1] < selection[1][1];
    const hole = hasArea ? rectanglePath(selection) : null;
    synchronizing = true;
    try {
      for (const { brushLayer, shade } of layers) {
        if (brushLayer.node() !== origin) brushLayer.call(brush.move, selection);
        shade.attr("d", hole ? `M0,0H${size}V${size}H0Z ${hole}` : null);
      }
      onSelection(hasArea ? selection : null);
    } finally {
      synchronizing = false;
    }
  }

  for (const source of layers) {
    source.brushLayer.call(brush);
    source.svg.on("pointermove.linked-maps", (event) => {
      const [x, y] = d3.pointer(event, source.svg.node());
      const inside = event.pointerType !== "touch" && Math.hypot(x - center, y - center) <= radius;
      for (const target of layers) {
        const visible = source !== target && inside;
        target.cursor.attr("display", visible ? null : "none")
          .attr("transform", visible ? `translate(${x},${y})` : null);
      }
    }).on("pointerleave.linked-maps pointercancel.linked-maps", () => {
      for (const { cursor } of layers) cursor.attr("display", "none");
    }).on("keydown.linked-maps", (event) => {
      if (event.key === "Escape") syncSelection(null);
    });
  }
}

function rectanglePath([[left, top], [right, bottom]]) {
  return `M${left},${top}H${right}V${bottom}H${left}Z`;
}
