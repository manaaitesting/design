'use client';

/**
 * The sort field of the files toolbar.
 *
 * It shares the search box's GET form so that what you are looking at stays a
 * URL you can send to yourself — but a `<select>` has no Enter to press, and
 * that form carries no submit button, so choosing a sort order used to do
 * nothing whatever. Picking an option submits the form it is in, which is what
 * every other sort menu in the world does and what makes the control worth
 * drawing.
 *
 * Submitting the form rather than pushing a route is deliberate: the form
 * already carries the folder and the query in hidden fields, so the sort cannot
 * silently drop the view it was chosen in.
 */
export function SortSelect({
  value,
  options,
  style,
}: {
  value: string;
  options: { value: string; label: string }[];
  style?: React.CSSProperties;
}) {
  return (
    <select
      name="sort"
      defaultValue={value}
      aria-label="Sort files"
      style={style}
      onChange={(event) => event.currentTarget.form?.requestSubmit()}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
