export default function InputField({
  value,
  label,
  placeholder,
  type = "text",
  onChange,
  description,
  children,
  required = false,
}: {
  value: string;
  label: string;
  placeholder?: string;
  type?: string;
  onChange: any;
  description?: string;
  children?: React.ReactNode;
  required?: boolean;
}) {
  const randomString = Math.random().toString(36).substring(7);
  return (
    <div className="flex flex-col gap-1">
      {label && <label htmlFor={randomString}>{label}</label>}
      <div className="flex flex-row gap-2">
        <input
          type={type}
          value={value}
          className="p-2 flex-1 rounded border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-slate-500"
          placeholder={placeholder}
          onChange={onChange}
          id={randomString}
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
