export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>
          {title}
          <span className="heading-dot" />
        </h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{children}</div>
    </section>
  );
}
