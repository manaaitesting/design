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

export function blendLabel(value: string): string {
  return BLEND_MODES.find((mode) => mode.value === value)?.label ?? 'Normal';
}
