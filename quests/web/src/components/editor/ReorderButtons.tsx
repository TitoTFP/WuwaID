export default function ReorderButtons({
  onMoveUp,
  onMoveDown,
  onInsertAfter,
}: {
  onMoveUp: () => void;
  onMoveDown: () => void;
  onInsertAfter: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" className="btn" onClick={onMoveUp} title="Move up">
        ↑
      </button>
      <button type="button" className="btn" onClick={onMoveDown} title="Move down">
        ↓
      </button>
      <button type="button" className="btn" onClick={onInsertAfter} title="Insert after">
        + insert
      </button>
    </div>
  );
}
