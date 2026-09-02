/**
 * The blend modes, grouped the way Figma's menu groups them.
 *
 * One list, because the panel and the paint picker both offer blend mode and a
 * user who finds "Plus lighter" in one and not the other has found a bug.
 */
export interface BlendMode {
  value: string;
  label: string;
  /** starts a new group — Figma rules a hairline above these */
  divider?: boolean;
}

export const BLEND_MODES: BlendMode[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'darken', label: 'Darken', divider: true },
  { value: 'multiply', label: 'Multiply' },
  { value: 'plus-darker', label: 'Plus darker' },
  { value: 'color-burn', label: 'Color burn' },
  { value: 'lighten', label: 'Lighten', divider: true },
  { value: 'screen', label: 'Screen' },
  { value: 'plus-lighter', label: 'Plus lighter' },
  { value: 'color-dodge', label: 'Color dodge' },
  { value: 'overlay', label: 'Overlay', divider: true },
  { value: 'soft-light', label: 'Soft light' },
  { value: 'hard-light', label: 'Hard light' },
  { value: 'difference', label: 'Difference', divider: true },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'hue', label: 'Hue', divider: true },
  { value: 'saturation', label: 'Saturation' },
  { value: 'color', label: 'Color' },
  { value: 'luminosity', label: 'Luminosity' },
];

/**
 * A group's extra mode, and its default.
 *
 * Pass through is the absence of a stacking context: a Multiply child inside
 * the group blends against whatever is behind the group. Choosing Normal
 * instead isolates it, so the child blends only against its siblings. Only a
 * container can be either, which is why this is not in the list above — a
 * rectangle offering "Pass through" would be offering nothing.
 */
export const PASS_THROUGH: BlendMode = { value: 'pass-through', label: 'Pass through' };

export function blendModes(container: boolean): BlendMode[] {
  if (!container) return BLEND_MODES;
  const [normal, ...rest] = BLEND_MODES;
  return [PASS_THROUGH, { ...normal, divider: true }, ...rest];
}

/** Neither of the two quiet modes composites the layer against anything. */
export function blends(value: string): boolean {
  return value !== 'normal' && value !== PASS_THROUGH.value;
}

export function blendLabel(value: string): string {
  if (value === PASS_THROUGH.value) return PASS_THROUGH.label;
  return BLEND_MODES.find((mode) => mode.value === value)?.label ?? 'Normal';
}
