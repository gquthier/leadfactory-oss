"use client";
import {useId} from "react";

interface BrutalistInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  required?: boolean;
}

export function BrutalistInput({ label, hint, required, className = "", ...props }: BrutalistInputProps) {
  const generatedId=useId();const fieldId=props.id??generatedId;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="label-brutal">
        {label}
        {required && <span className="text-lf-blue ml-1">*</span>}
      </label>
      <input id={fieldId} className={`input-brutal ${className}`} {...props} />
      {hint && <p className="hint-brutal">{hint}</p>}
    </div>
  );
}
