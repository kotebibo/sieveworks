/**
 * The page frame the older pages were missing: a centered column with a side
 * gutter and top/bottom breathing room, matching the redesigned pages. The root
 * <main> has no padding, so each page wraps its content in this. `max` overrides
 * the column width per page.
 */
export function PageShell({ children, max = "max-w-5xl" }: { children: React.ReactNode; max?: string }) {
  return <div className={`mx-auto ${max} px-5 sm:px-7 py-10 sm:py-14`}>{children}</div>;
}
