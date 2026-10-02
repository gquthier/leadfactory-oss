"use client";
import {useId} from "react";

interface BrutalistTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  required?: boolean;
  rows?: number;
}

export function BrutalistTextarea({ label, hint, required, rows = 4, className = "", ...props }: BrutalistTextareaProps) {
  const generatedId=useId();const fieldId=props.id??generatedId;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="label-brutal">
        {label}
        {required && <span className="text-lf-blue ml-1">*</span>}
      </label>
      <textarea id={fieldId} rows={rows} className={`textarea-brutal ${className}`} {...props} />
      {hint && <p className="hint-brutal">{hint}</p>}
    </div>
  );
}
