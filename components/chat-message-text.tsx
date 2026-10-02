export function ChatMessageText({
  className = "",
  text,
}: {
  className?: string;
  text: string;
}) {
  const paragraphs = text
    .split(/\r?\n(?:[ \t]*\r?\n)+/)
    .filter((paragraph) => paragraph.trim().length > 0);

  return (
    <div className={`space-y-2 break-words ${className}`}>
      {paragraphs.map((paragraph, index) => (
        <p className="whitespace-pre-wrap" key={index}>
          {paragraph}
        </p>
      ))}
    </div>
  );
}
