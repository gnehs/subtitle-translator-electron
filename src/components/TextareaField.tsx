import { useId, type ReactNode, type TextareaHTMLAttributes } from "react";

interface TextareaFieldProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "children"> {
  value: string;
  label: string;
  description?: string;
  children?: ReactNode;
  minHeight?: string;
}

export default function TextareaField({
  value,
  label,
  placeholder,
  onChange,
  description,
  children,
  minHeight = "350px",
  required = false,
}: TextareaFieldProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      {label && <label htmlFor={id}>{label}</label>}
      <div className="flex flex-row gap-2">
        <textarea
          value={value}
          className="p-2 flex-1 rounded border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-slate-500 max-w-full"
          placeholder={placeholder}
          onChange={onChange}
          id={id}
          style={{ resize: "none", minHeight: minHeight }}
          required={required}
        />
        {children}
      </div>

      {description && (
        <div
          className="text-sm opacity-80"
          dangerouslySetInnerHTML={{ __html: description }}
        />
      )}
    </div>
  );
}
