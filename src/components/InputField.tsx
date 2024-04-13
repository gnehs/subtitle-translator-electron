export default function InputField({
  label,
  description,
  children,
  ...props
}: {
  label: string;
  description?: string;
  children?: React.ReactNode;
} & React.HTMLProps<HTMLInputElement>) {
  const randomString = Math.random().toString(36).substring(7);
  return (
    <div className="flex flex-col gap-1">
      {label && <label htmlFor={randomString}>{label}</label>}
      <div className="flex flex-row gap-2">
        <input
          className="p-2 flex-1 rounded border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-slate-500"
          id={randomString}
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
