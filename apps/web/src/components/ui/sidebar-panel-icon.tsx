/** Panel-left icon (ChatGPT / Claude style sidebar toggle). */
export function SidebarPanelIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect
        x="2.25"
        y="2.25"
        width="15.5"
        height="15.5"
        rx="3.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M7.25 2.25v15.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
