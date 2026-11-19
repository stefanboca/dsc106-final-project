const d3 = window.d3;
const monthDay = d3.utcFormat("%B %-d");

export function createLookback({ firstDate, onChange }) {
  const enabled = document.querySelector("#lookback-enabled");
  const slider = document.querySelector("#lookback-years");
  const output = document.querySelector("#lookback-value");
  const legend = document.querySelector("#overlay-legend");
  const extentLegend = document.querySelector("#extent-legend");
  const selectedLabel = document.querySelector("#selected-year-label");
  const earlierLabel = document.querySelector("#comparison-year-label");
  const firstYear = +firstDate.slice(0, 4);
  let preferredOffset = slider.valueAsNumber;

  enabled.addEventListener("change", onChange);
  slider.addEventListener("input", () => {
    preferredOffset = slider.valueAsNumber;
    onChange();
  });

  return {
    forDate(date) {
      const suffix = date.slice(4);
      const year = +date.slice(0, 4);
      const earliest = `${firstYear}${suffix}` < firstDate ? firstYear + 1 : firstYear;
      const maximum = year - earliest;
      slider.max = Math.max(1, maximum);
      slider.disabled = !enabled.checked || maximum < 1;
      slider.value = Math.min(preferredOffset, +slider.max);
      const offset = slider.valueAsNumber;
      const label = `${offset} ${offset === 1 ? "year" : "years"} back`;
      output.textContent = offset;
      slider.setAttribute("aria-valuetext", label);
      if (!enabled.checked) return {};
      if (maximum < 1) return { notice: "No earlier year is available for this date." };
      const reference = `${year - offset}${suffix}`;
      const candidate = new Date(reference + "T00:00:00Z");
      if (!candidate.toISOString().startsWith(reference)) {
        const day = monthDay(new Date(date + "T00:00:00Z"));
        return { notice: `${day} does not occur in ${year - offset}.` };
      }
      return { reference };
    },
    setLegend(date, reference) {
      legend.hidden = !reference;
      extentLegend.hidden = !!reference;
      if (reference) {
        selectedLabel.textContent = date.slice(0, 4);
        earlierLabel.textContent = reference.slice(0, 4);
      }
    },
  };
}
