import Link from "next/link";

export type Breadcrumb = {
  label: string;
  href?: string;
};

type Props = {
  breadcrumbs: Breadcrumb[];
  action?: React.ReactNode;
};

export function PageHeader({ breadcrumbs, action }: Props) {
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
        <button type="button" className="notion-topbar-icon-btn" title="Favorite (coming soon)" disabled>
          <i className="ri-star-line" aria-hidden />
        </button>
        <button type="button" className="notion-topbar-icon-btn" title="Updates (coming soon)" disabled>
          <i className="ri-time-line" aria-hidden />
        </button>
        <button type="button" className="notion-topbar-icon-btn" title="More" disabled>
          <i className="ri-more-line" aria-hidden />
        </button>
      </div>
    </header>
  );
}
