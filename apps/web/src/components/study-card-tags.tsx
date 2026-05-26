type Props = {
  tags: string[];
  /** Study view centers tags; lists and tables align to the start. */
  align?: "center" | "start";
};

export function StudyCardTags({ tags, align = "center" }: Props) {
  if (tags.length === 0) return null;

  const className =
    align === "start" ? "study-card-tags study-card-tags--start" : "study-card-tags";

  return (
    <div className={className} aria-label="Card tags">
      {tags.map((tag) => (
        <span key={tag} className="study-tag-pill">
          {tag}
        </span>
      ))}
    </div>
  );
}
