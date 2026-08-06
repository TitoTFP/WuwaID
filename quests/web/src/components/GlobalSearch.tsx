import { useEffect, useState, type FormEvent } from "react";

interface GlobalSearchProps {
  initialQuery: string;
  language: string;
  onSubmit: (query: string, language: string) => void;
}

export default function GlobalSearch({
  initialQuery,
  language,
  onSubmit,
}: GlobalSearchProps) {
  const [query, setQuery] = useState(initialQuery);

  useEffect(() => setQuery(initialQuery), [initialQuery]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    onSubmit(trimmed, language);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="sn-search"
      role="search"
      aria-label="Search quests, grouped texts, and dialogue"
    >
      <label htmlFor="global-search" className="sr-only">
        Search quests, grouped texts, and dialogue
      </label>
      <input
        id="global-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search quests, grouped texts, or dialogue…"
        className="input sn-search__input"
        autoComplete="off"
      />
      <button type="submit" className="sn-search__submit" aria-label="Search">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
      </button>
    </form>
  );
}
