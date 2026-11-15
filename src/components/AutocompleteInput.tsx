import { useEffect, useId, useMemo, useRef, useState } from 'react';

interface AutocompleteInputProps {
  value: string;
  onChange: (val: string) => void;
  suggestions: string[];
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  className?: string;
}

export function AutocompleteInput({
  value,
  onChange,
  suggestions,
  placeholder,
  multiline = false,
  rows = 2,
  className = '',
}: AutocompleteInputProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    const filtered = suggestions.filter((s) =>
      q ? s.toLowerCase().includes(q) : true
    );
    return filtered.slice(0, 12);
  }, [value, suggestions]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [value, open]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, []);

  const selectSuggestion = (item: string) => {
    onChange(item);
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    if (!open || !matches.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % matches.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? matches.length - 1 : prev - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      selectSuggestion(matches[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const baseInputClass = `w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0a5b9c] focus:ring-2 focus:ring-[#0a5b9c]/15 ${className}`;

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0">
      {multiline ? (
        <textarea
          rows={rows}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          className={`${baseInputClass} resize-y min-h-[44px]`}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          className={`${baseInputClass} min-h-[44px]`}
        />
      )}

      {open && matches.length > 0 && (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 z-30 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl divide-y divide-slate-100"
        >
          {matches.map((item, idx) => (
            <button
              key={`${item}-${idx}`}
              type="button"
              role="option"
              aria-selected={idx === activeIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                selectSuggestion(item);
              }}
              onClick={() => selectSuggestion(item)}
              className={`w-full text-left px-3.5 py-2.5 text-sm leading-snug cursor-pointer transition-colors ${
                idx === activeIndex
                  ? 'bg-[#0a5b9c]/10 text-[#0a5b9c] font-medium'
                  : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
