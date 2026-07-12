import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

interface InputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  description?: string;
  children?: ReactNode;
}

export default function InputField({
  label,
  description,
  className = "",
  children,
  ...props
}: InputFieldProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      {label && <label htmlFor={id}>{label}</label>}
      <div className="flex flex-row gap-2">
        <input
          className={twMerge(
            "p-2 flex-1 rounded border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-slate-500",
            className
          )}
          id={id}
          {...props}
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
