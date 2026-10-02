"use client";

interface Option {
  value: string;
  label: string;
}

interface BrutalistCheckboxGroupProps {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (values: string[]) => void;
  hint?: string;
  withOther?: boolean;
  otherValue?: string;
  onOtherChange?: (v: string) => void;
  otherPlaceholder?: string;
}

export function BrutalistCheckboxGroup({
  label, options, selected, onChange, hint,
  withOther, otherValue, onOtherChange, otherPlaceholder,
}: BrutalistCheckboxGroupProps) {
  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="label-brutal">{label}</span>
      <div className="flex flex-wrap gap-3">
        {options.map((opt) => (
          <label
            key={opt.value}
            className={`flex items-center gap-2 px-4 py-3 border-3 border-black cursor-pointer font-bold text-sm uppercase tracking-wide transition-all duration-100 select-none ${
              selected.includes(opt.value)
                ? "bg-lf-blue text-white shadow-brutal-xs translate-x-[2px] translate-y-[2px]"
                : "bg-white text-black shadow-brutal-sm hover:shadow-brutal-xs hover:translate-x-[2px] hover:translate-y-[2px]"
            }`}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={selected.includes(opt.value)}
              onChange={() => toggle(opt.value)}
            />
            {selected.includes(opt.value) && <span className="text-white font-black">✓</span>}
            {opt.label}
          </label>
        ))}
      </div>
      {withOther && selected.includes("autre") && (
        <input
          type="text"
          value={otherValue ?? ""}
          onChange={(e) => onOtherChange?.(e.target.value)}
          placeholder={otherPlaceholder ?? "Précisez..."}
          className="input-brutal mt-1"
        />
      )}
      {hint && <p className="hint-brutal">{hint}</p>}
    </div>
  );
}
