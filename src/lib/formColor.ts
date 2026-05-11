const PALETTE = [
  "#FFE17C", // yellow
  "#7CFFB0", // green
  "#FF7C7C", // coral
  "#7CB6FF", // blue
  "#C77CFF", // purple
  "#FFB07C", // orange
  "#7CF3FF", // cyan
  "#FF7CB8", // pink
];

/** Deterministic color for a form based on its ID — never changes. */
export function getFormColor(formId: string): string {
  let hash = 0;
  for (let i = 0; i < formId.length; i++) {
    hash = (hash * 31 + formId.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}
