export default function Header({ children }: { children: React.ReactNode }) {
  return (
    <header className="text-xl font-bold text-slate-800 bg-slate-100 p-2 border-b border-slate-200 flex items-end sticky top-0 z-10">
      {children}
    </header>
  );
}
