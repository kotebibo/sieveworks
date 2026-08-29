"use client";

import { useEffect, useState } from "react";

export interface DocsNavItem {
  id: string;
  label: string;
}

/** Sticky docs sidebar with scrollspy: the section currently in view is
 * highlighted brass with a hairline marker, like every good docs site. */
export function DocsNav({ items }: { items: DocsNavItem[] }) {
  const [active, setActive] = useState<string>(items[0]?.id ?? "");

  useEffect(() => {
    const sections = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        // pick the section closest to the top band of the viewport
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          const top = visible.reduce((a, b) =>
            a.boundingClientRect.top < b.boundingClientRect.top ? a : b
          );
          setActive(top.target.id);
        }
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 }
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav aria-label="On this page">
      <div className="num text-[12px] text-[var(--text-faint)] mb-3">On this page</div>
      <ul className="space-y-0.5 border-l border-[var(--border)]">
        {items.map((i) => {
          const isActive = active === i.id;
          return (
            <li key={i.id}>
              <a
                href={`#${i.id}`}
                className="block py-1.5 pl-4 -ml-px border-l text-[13.5px] leading-snug transition-colors"
                style={
                  isActive
                    ? { color: "var(--accent)", borderColor: "var(--accent)" }
                    : { color: "var(--text-dim)", borderColor: "transparent" }
                }
              >
                {i.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
