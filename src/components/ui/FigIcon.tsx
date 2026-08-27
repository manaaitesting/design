import raw from './figma-icons.json';

/**
 * Renders Figma's own icon geometry, harvested from its running panel.
 *
 * Figma draws most glyphs with two fills: the main shape in the icon colour and
 * a "tertiary" element — the ruler line in the align icons, for instance — in a
 * lighter tone. Collapsing both to currentColor is what made my hand-drawn
 * versions read wrong, so the distinction is preserved here.
 */
interface IconPath {
  d: string;
  evenodd?: boolean;
  tertiary?: boolean;
}

const ICONS = raw as Record<string, { viewBox: string; paths: IconPath[] }>;

export type FigIconName = keyof typeof raw;

export function FigIcon({ name, size = 24 }: { name: string; size?: number }) {
  const icon = ICONS[name];
  if (!icon) return null;

  return (
    <svg
      width={size}
      height={size}
      viewBox={icon.viewBox}
      fill="none"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      {icon.paths.map((path, index) => (
        <path
          key={index}
          d={path.d}
          fill={path.tertiary ? 'var(--fig-icon-3)' : 'currentColor'}
          fillRule={path.evenodd ? 'evenodd' : undefined}
          clipRule={path.evenodd ? 'evenodd' : undefined}
        />
      ))}
    </svg>
  );
}

export function hasFigIcon(name: string): boolean {
  return name in ICONS;
}
