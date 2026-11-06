export type SearchAction = {
  id: string;
  label: string;
  icon: string;
  href: string;
};

const STATIC_ACTIONS: SearchAction[] = [
  { id: "new-deck", label: "New deck", icon: "ri-add-line", href: "/create" },
  { id: "study-settings", label: "Open study settings", icon: "ri-settings-3-line", href: "/settings/study" },
  { id: "insights", label: "Go to Insights", icon: "ri-bar-chart-2-line", href: "/insights" },
  { id: "import", label: "Import a deck", icon: "ri-upload-2-line", href: "/create/import" },
  { id: "billing", label: "Open usage and billing", icon: "ri-vip-crown-line", href: "/settings/billing" },
];

/** With no query, offers the shortcuts. With one, offers to make cards plus any action that fits. */
export function searchActions(query: string): SearchAction[] {
  const trimmed = query.trim();
  if (!trimmed) return STATIC_ACTIONS;

  const needle = trimmed.toLowerCase();
  const matches = STATIC_ACTIONS.filter((action) => action.label.toLowerCase().includes(needle));
  return [
    {
      id: "make-cards",
      label: `Make cards about “${trimmed}”`,
      icon: "ri-add-line",
      href: `/create?prompt=${encodeURIComponent(trimmed)}`,
    },
    ...(matches.length > 0
      ? matches
      : STATIC_ACTIONS.filter((action) => action.id === "study-settings")),
  ];
}
