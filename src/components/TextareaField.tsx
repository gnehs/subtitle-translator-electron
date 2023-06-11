export default function TextareaField({
  value,
  label,
  placeholder,
  type = "text",
  onChange,
  description,
  children,
}: {
  value: string;
  label: string;
  placeholder?: string;
  type?: string;
  onChange: any;
  description?: string;
  children?: React.ReactNode;
}) {
  const randomString = Math.random().toString(36).substring(7);
  return (
    <div className="flex flex-col gap-1">
      {label && <label htmlFor={randomString}>{label}</label>}
      <div className="flex flex-row gap-2">
        <textarea
          value={value}
          className="p-2 flex-1 rounded border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-slate-500 max-w-full min-h-[350px]"
          placeholder={placeholder}
          onChange={onChange}
          id={randomString}
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
