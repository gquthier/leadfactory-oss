"use client";

interface Option {
  value: string;
  label: string;
}

interface BrutalistRadioGroupProps {
  label: string;
  options: Option[];
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  inline?: boolean;
  withOther?: boolean;
  otherValue?: string;
  onOtherChange?: (v: string) => void;
  otherPlaceholder?: string;
}

export function BrutalistRadioGroup({
  label, options, value, onChange, hint, inline = true,
  withOther, otherValue, onOtherChange, otherPlaceholder,
}: BrutalistRadioGroupProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="label-brutal">{label}</span>
      <div className={`flex gap-3 ${inline ? "flex-wrap" : "flex-col"}`}>
        {options.map((opt) => (
          <label
            key={opt.value}
            className={`flex items-center gap-2 px-4 py-3 border-3 border-black cursor-pointer font-bold text-sm uppercase tracking-wide transition-all duration-100 select-none ${
              value === opt.value
                ? "bg-lf-black text-white shadow-brutal-xs translate-x-[2px] translate-y-[2px]"
                : "bg-white text-black shadow-brutal-sm hover:shadow-brutal-xs hover:translate-x-[2px] hover:translate-y-[2px]"
            }`}
          >
            <input
              type="radio"
              className="sr-only"
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
            />
            {value === opt.value && <span className="font-black">●</span>}
            {opt.label}
          </label>
        ))}
      </div>
      {withOther && value === "autre" && (
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
