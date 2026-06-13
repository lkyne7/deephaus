import Link from "next/link";
import { TopbarMoreMenu, type TopbarMenuItem } from "@/components/topbar-more-menu";

export type Breadcrumb = {
  label: string;
  href?: string;
};

type Props = {
  breadcrumbs: Breadcrumb[];
  action?: React.ReactNode;
  menuItems?: TopbarMenuItem[];
  assistant?: React.ReactNode;
};

export function PageHeader({ breadcrumbs, action, menuItems, assistant }: Props) {
  const lastIndex = breadcrumbs.length - 1;

  return (
    <header className="notion-topbar">
      <nav className="notion-breadcrumbs" aria-label="Breadcrumb">
        {breadcrumbs.map((crumb, index) => {
          const isLast = index === lastIndex;
          return (
            <span key={`${crumb.label}-${index}`} className="notion-breadcrumb-segment">
              {index > 0 && <span className="notion-breadcrumb-sep" aria-hidden>/</span>}
              {crumb.href && !isLast ? (
                <Link href={crumb.href} className="notion-breadcrumb-link">
                  {crumb.label}
                </Link>
              ) : (
                <span className={isLast ? "notion-breadcrumb-current" : "notion-breadcrumb-link"}>
                  {crumb.label}
                </span>
              )}
            </span>
          );
        })}
      </nav>

      <div className="notion-topbar-actions">
        {action}
        {assistant}
        {menuItems?.length ? <TopbarMoreMenu items={menuItems} /> : null}
      </div>
    </header>
  );
}
