type Props = {
  tags: string[];
};

export function StudyCardTags({ tags }: Props) {
  if (tags.length === 0) return null;

  return (
    <div className="study-card-tags" aria-label="Card tags">
      {tags.map((tag) => (
        <span key={tag} className="study-tag-pill">
          {tag}
        </span>
      ))}
    </div>
  );
}
