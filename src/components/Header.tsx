export default function Header({ children }: { children: React.ReactNode }) {
  return (
    <header className="text-xl font-bold text-slate-800 bg-slate-100 px-2 py-3 border-b border-slate-200 flex items-end sticky top-0 z-10 bg-opacity-80 backdrop-blur-xl">
      {children}
    </header>
  );
}
